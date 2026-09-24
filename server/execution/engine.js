import { join, basename, dirname, extname, isAbsolute } from "node:path";
import { rename, mkdir, rm, rmdir, access } from "node:fs/promises";
import { readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { AgentLoop, AgentLoopHalt } from "../agent/loop.js";
import { LLMClient } from "../llm/client.js";
import { resolvePath } from "../security/pathGuard.js";
import { extractSettingRequest, getBatteryStatus } from "../tools/openSettings.js";
import { executeTool, resolveToolName } from "../tools/registry.js";
import { agenticBrowserTask } from "../tools/browserAutomation.js";
import { UndoStack } from "./history.js";
import { buildPlan, executePlan, resolveSinceDate } from "../tools/organiseByRule.js";
import { MemoryStore } from "../memory/store.js";
import { defaultSearchRoots, defaultNavigateAliases } from "../platform/runtime.js";
const TRASH_DIR = join(tmpdir(), ".fella-trash");
const MOCK_MODE = process.env["FELLA_MOCK"] === "1";
const CONFIRM_WORDS = /* @__PURE__ */ new Set(["yes", "y", "confirm", "do it", "proceed", "ok", "okay", "sure"]);
const CANCEL_WORDS = /* @__PURE__ */ new Set(["no", "n", "cancel", "stop", "abort", "nope"]);
const ACKNOWLEDGEMENT_WORDS = /* @__PURE__ */ new Set([
  "ok",
  "okay",
  "got it",
  "understood",
  "alright",
  "all right",
  "thanks",
  "thank you"
]);
const FOLDER_SEARCH_MAX_DEPTH = 8;
const FOLDER_SEARCH_MAX_RESULTS = 8;
const DEFAULT_SEARCH_DIRS = defaultSearchRoots();
const SYSTEM_DIRS = /* @__PURE__ */ new Set([
  "windows",
  "system32",
  "syswow64",
  "sysarm32",
  "program files",
  "program files (x86)",
  "programdata",
  "system volume information",
  "recovery",
  "boot",
  "efi",
  "winsxs",
  "servicing"
]);
const JUNK_DIRS = /* @__PURE__ */ new Set([
  "$recycle.bin",
  "$recycler",
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".tmp",
  "temp"
]);
function tokenise(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2").split(/[\s_\-.]+/).map((token) => token.toLowerCase()).filter((token) => token.length > 1);
}
function scoreName(name, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const tokens = tokenise(name);
  let hits = 0;
  for (const queryToken of queryTokens) {
    if (tokens.some((token) => token.includes(queryToken))) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}
function isSystemDir(name) {
  return SYSTEM_DIRS.has(name.toLowerCase());
}
function isJunkDir(name) {
  return JUNK_DIRS.has(name.toLowerCase()) || name.startsWith("$");
}
function walkFolders(dir, queryTokens, depth, results) {
  if (depth > FOLDER_SEARCH_MAX_DEPTH || results.length >= FOLDER_SEARCH_MAX_RESULTS * 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = String(entry.name);
    if (isSystemDir(name) || isJunkDir(name)) continue;
    const fullPath = join(dir, name);
    const matchScore = scoreName(name, queryTokens);
    if (matchScore >= 1) {
      results.push({ path: fullPath, name, score: matchScore, depth });
    }
    walkFolders(fullPath, queryTokens, depth + 1, results);
  }
}
function findFoldersByName(folderName) {
  const queryTokens = tokenise(folderName.trim());
  if (queryTokens.length === 0) return [];
  const searchRoots = DEFAULT_SEARCH_DIRS.flatMap((dir) => {
    try {
      const resolved = resolvePath(dir);
      return existsSync(resolved) ? [resolved] : [];
    } catch {
      return [];
    }
  });
  const matches = [];
  for (const root of searchRoots) {
    const rootName = basename(root);
    const rootScore = scoreName(rootName, queryTokens);
    if (rootScore >= 1) {
      matches.push({ path: root, name: rootName, score: rootScore, depth: 0 });
    }
    walkFolders(root, queryTokens, 1, matches);
  }
  const unique = matches.filter(
    (match, index, all) => all.findIndex((candidate) => candidate.path === match.path) === index
  );
  unique.sort((left, right) => left.depth - right.depth || left.name.length - right.name.length || left.path.localeCompare(right.path));
  return unique.slice(0, FOLDER_SEARCH_MAX_RESULTS).map((match) => match.path);
}
function buildFolderChoicePrompt(folderName, options) {
  const lines = options.map((option, index) => `${index + 1}. ${option}`);
  return `I found multiple folder matches for "${folderName}":
${lines.join("\n")}
Type 1 to open the first folder, 2 for the second, and so on.`;
}
function parseFindFilePaths(resultText) {
  const matches = [...resultText.matchAll(/Full path:\s*(.+)$/gim)];
  const paths = matches.map((match) => match[1]?.trim()).filter((path) => Boolean(path));
  return paths.filter((path, index) => paths.indexOf(path) === index);
}
function buildFileChoicePrompt(target, options) {
  const lines = options.map((option, index) => `${index + 1}. ${option}`);
  return `I found multiple file matches for "${target}":
${lines.join("\n")}
Type 1 to open the first file, 2 for the second, and so on.`;
}
function extractFolderIntent(text) {
  const trimmed = text.trim();
  const findMatch = trimmed.match(
    /^(?:find|search(?:\s+for)?|look\s+for|locate)\s+(?:the\s+)?(.+?)\s+folder(?:\s+.*)?$/i
  );
  if (findMatch?.[1]) {
    return { mode: "find", folderName: findMatch[1].trim() };
  }
  const openMatch = trimmed.match(
    /^(?:open|show(?:\s+me)?|navigate\s+to|go\s+to)\s+(?:the\s+)?(.+?)\s+folder(?:\s+.*)?$/i
  );
  if (openMatch?.[1]) {
    return { mode: "open", folderName: openMatch[1].trim() };
  }
  return null;
}
function resolveSelectionByName(input, options) {
  const normalizedInput = input.toLowerCase().replace(/^(?:the\s+)?(?:one\s+)?(?:named|called)?\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedInput) return null;
  const candidates = options.filter((opt) => {
    const base = basename(opt).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return base === normalizedInput || base.includes(normalizedInput);
  });
  if (candidates.length === 1) return candidates[0];
  return null;
}
function looksLikeAppTarget(target) {
  const trimmed = target.trim();
  if (!trimmed) return false;
  if (/\sin\s+(chrome|chromium|edge|firefox|safari|browser)$/i.test(trimmed)) return false;
  if (/^[a-z]:[\\/]/i.test(trimmed)) return false;
  if (trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("/")) return false;
  if (/\.(?:txt|pdf|docx?|xlsx?|pptx?|csv|jpg|jpeg|png|gif|webp|mp4|mkv|avi|mov|mp3|wav|zip|rar|7z|lnk)$/i.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return /^[a-z0-9][a-z0-9 _.-]{0,40}$/i.test(trimmed);
}
function normaliseAppKey(target) {
  return target.trim().toLowerCase().replace(/\s+/g, "");
}
const KNOWN_APP_KEYS = /* @__PURE__ */ new Set([
  // Windows allowlist exact keys
  "notepad",
  "explorer",
  "calculator",
  "calc",
  "vscode",
  "code",
  "browser",
  "chrome",
  "googlechrome",
  "msedge",
  "edge",
  "microsoftedge",
  "firefox",
  "terminal",
  "windowsterminal",
  "paint",
  "mspaint",
  "wordpad",
  "powershell",
  "cmd",
  "excel",
  "microsoftexcel",
  "word",
  "winword",
  "microsoftword",
  "powerpoint",
  "microsoftpowerpoint",
  "outlook",
  "microsoftoutlook",
  "taskmgr",
  "taskmanager",
  "regedit",
  "registryeditor",
  "snipping",
  "snippingtool",
  // Common aliases / natural-language names
  "visualstudiocode",
  "visualstudio",
  "vsstorage",
  "cursor",
  "sublime",
  "sublimetext",
  "atom",
  "notepadplusplus",
  "notepad++",
  "vlc",
  "vlcmediaplayer",
  "winamp",
  "spotify",
  "discord",
  "slack",
  "zoom",
  "teams",
  "microsoftteams",
  "skype",
  "telegram",
  "whatsapp",
  "steam",
  "epicgames",
  "epicgameslauncher",
  "obs",
  "obsstudio",
  "gimp",
  "inkscape",
  "blender",
  "audacity",
  "handbrake",
  "winrar",
  "sevenzip",
  "7zip",
  "acrobat",
  "adobeacrobat",
  "adobeacrobatreader",
  "adobereader",
  "brave",
  "opera",
  "vivaldi",
  "postman",
  "insomnia",
  "docker",
  "figma",
  "onenote",
  "onedrive",
  "dropbox",
  "anydesk",
  "teamviewer",
  "putty",
  "filezilla",
  "winscp",
  "winpcap",
  "wireshark",
  "cpuz",
  "gpuz",
  "hwinfo",
  "everything",
  "everythingsearch",
  "7-zip"
]);
function isKnownAppTarget(target) {
  return KNOWN_APP_KEYS.has(normaliseAppKey(target));
}
function shouldAskOpenKindClarification(target) {
  const trimmed = target.trim();
  if (!trimmed) return false;
  if (/\b(?:application|app|program|exe|file|shortcut|folder|directory|setting|settings|control panel)\b/i.test(trimmed)) {
    return false;
  }
  if (looksLikeWebTarget(trimmed)) return false;
  if (isKnownAppTarget(trimmed)) return false;
  if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("/")) {
    return false;
  }
  if (/\.(?:txt|pdf|docx?|xlsx?|pptx?|csv|jpg|jpeg|png|gif|webp|mp4|mkv|avi|mov|mp3|wav|zip|rar|7z|lnk|exe|msi|bat|cmd)$/i.test(trimmed)) {
    return false;
  }
  if (isChainedInstruction(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  return /^[a-z0-9][a-z0-9 _.-]{0,60}$/i.test(trimmed);
}
function looksLikeWebTarget(target) {
  const trimmed = target.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (trimmed.includes(" ")) return false;
  return /\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed);
}
function isChainedInstruction(text) {
  return /\b(and|then|after that|afterwards|next)\b|,/.test(text.toLowerCase());
}
function normaliseWebsiteTarget(target) {
  const trimmed = target.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const knownSites = {
    "google drive": "drive.google.com",
    "google docs": "docs.google.com",
    "google doc": "docs.google.com",
    gmail: "mail.google.com",
    youtube: "youtube.com",
    leetcode: "leetcode.com"
  };
  if (knownSites[lower]) return knownSites[lower];
  if (/^[a-z0-9-]+$/i.test(trimmed)) return `${trimmed}.com`;
  return trimmed;
}
function normaliseSearchTarget(target) {
  const trimmed = target.trim();
  if (!trimmed) return trimmed;
  const withoutArticle = trimmed.replace(/^(?:the|a|an)\s+/i, "");
  const withoutLocationFiller = withoutArticle.replace(/\b(?:that'?s|which\s+is)\s+somewhere\s+in\s+the\s+system\b/gi, " ").replace(/\bsomewhere\s+in\s+the\s+system\b/gi, " ").replace(/\bin\s+the\s+system\b/gi, " ");
  const withoutGenericNouns = withoutLocationFiller.replace(/\b(?:movie|film|video|installer|setup|app|application|program|file|folder|directory)\b/gi, " ").replace(/\s+/g, " ").trim();
  const cleaned = withoutGenericNouns || withoutLocationFiller || withoutArticle || trimmed;
  return cleaned.replace(/\s+/g, " ").trim();
}
function extractExplicitPathFromText(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const windowsPath = trimmed.match(/[a-zA-Z]:\\[^"<>|?*]+/);
  if (windowsPath?.[0]) return windowsPath[0].trim();
  if (trimmed.startsWith("/")) return trimmed;
  return null;
}
function extractContentsIntent(text) {
  const trimmed = text.trim();
  if (/^(?:what\s+are\s+)?(?:the\s+)?(?:contents|files)(?:\s+(?:in|of)\s+it|\s+inside\s+it|\s+(?:in|of)\s+this|\s+inside\s+this|\s+here)\??$/i.test(trimmed)) {
    return { target: "it", value: "it" };
  }
  const pathMatch = trimmed.match(/(?:contents|files).*(?:in|of|inside)\s+([a-zA-Z]:\\[^"<>|?*]+|\/[^\s]+)$/i);
  if (pathMatch?.[1]) {
    return { target: "path", value: pathMatch[1].trim() };
  }
  const folderMatch = trimmed.match(/(?:contents|files)\s+(?:in|of|inside)\s+(?:the\s+)?(.+?)\s+folder\??$/i);
  if (folderMatch?.[1]) {
    return { target: "folderName", value: folderMatch[1].trim() };
  }
  return null;
}
function inferExtensionsFromQuery(target) {
  const t = target.toLowerCase();
  if (/\bpdf\b/.test(t)) return [".pdf"];
  if (/\b(doc|docx|word)\b/.test(t)) return [".doc", ".docx"];
  if (/\b(xls|xlsx|excel|spreadsheet)\b/.test(t)) return [".xls", ".xlsx", ".csv"];
  if (/\b(ppt|pptx|powerpoint|slides)\b/.test(t)) return [".ppt", ".pptx"];
  if (/\b(image|photo|jpg|jpeg|png|webp|gif)\b/.test(t)) return [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  if (/\b(video|movie|mp4|mkv|avi|mov|wmv)\b/.test(t)) return [".mp4", ".mkv", ".avi", ".mov", ".wmv"];
  return null;
}
function extractFollowUpAppForLastFile(input) {
  const trimmed = input.trim();
  const patterns = [
    /^(?:open|play)\s+(?:it|this|that|the\s+file|the\s+movie|the\s+video)\s+(?:with|using|in)\s+(.+)$/i,
    /^open\s+in\s+it\s+using\s+(.+)$/i,
    /^(?:use|try)\s+(.+)\s+(?:for|to\s+open)\s+(?:it|this|that)$/i
  ];
  for (const pattern of patterns) {
    const m = trimmed.match(pattern);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const cleaned = raw.replace(/\b(media|player|app|application|software)\b/gi, " ").replace(/\s+/g, " ").trim();
    return cleaned || raw;
  }
  return null;
}
function isLikelyFilePath(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return extname(path).length > 0;
  }
}
function parseListFilesEntries(resultText) {
  const headerMatch = resultText.match(/^Contents of (.+):$/m);
  const basePath = headerMatch?.[1]?.trim();
  if (!basePath) return null;
  const entries = [];
  const lineMatches = resultText.matchAll(/^\[(FILE|DIR)\]\s+(.+)$/gm);
  for (const m of lineMatches) {
    const kind = m[1] ?? "";
    const name = (m[2] ?? "").trim();
    if (!name) continue;
    entries.push({
      path: join(basePath, name),
      isDirectory: kind === "DIR"
    });
  }
  return { basePath, entries };
}
function resolveOrdinal(raw) {
  const token = raw.trim().toLowerCase();
  if (/^\d+$/.test(token)) {
    const n = Number.parseInt(token, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const map = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10
  };
  return map[token] ?? null;
}
function normaliseAppName(raw) {
  return raw.replace(/\b(media|player|app|application|software)\b/gi, " ").replace(/\s+/g, " ").trim();
}
function toKebabCase(input) {
  return input.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
function extractLeetCodeProblemName(text) {
  const sanitized = text.replace(/\s+in\s+(?:chrome|chromium|edge|firefox|safari|browser)\s*$/i, "").trim();
  const hasLeadingProblemNumber = /\b\d+\./.test(sanitized);
  const numberedDirect = sanitized.match(
    /^\s*\d+\.\s*([a-z0-9][a-z0-9\s'\-]*?)(?=\s+(?:open|show|find|go\s+to|navigate\s+to|in\s+leetcode|on\s+leetcode|leetcode|in\s+chrome|in\s+browser|new\s+tab)\b|$)/i
  );
  if (numberedDirect?.[1]) {
    return numberedDirect[1].trim();
  }
  const patterns = [
    /(?:open|show|find|go\s+to|navigate\s+to)\s+(.+?)\s+problem'?s?\s+solutions?(?:\s+page)?(?:\s+in\s+leetcode(?:\.com)?)?/i,
    /(?:open|solve|show|find)\s+\d+\.\s*([^.,]+?)(?:\s+in\s+leetcode(?:\.com)?|$)/i,
    /^\d+\.\s*([^.,]+?)(?:\s+in\s+leetcode(?:\.com)?|$)/i,
    /(?:open|solve|show|find)\s+(?:the\s+)?(.+?)\s+problem\s+(?:in|on)\s+leetcode(?:\.com)?/i,
    /(?:named|called)\s+(.+?)(?:\s+in\s+leetcode(?:\.com)?|\s+on\s+leetcode(?:\.com)?|$)/i,
    /\bin\s+\d+\.\s*([^.,]+?)\s+in\s+leetcode(?:\.com)?/i,
    /problem\s+(.+?)(?:\s+in\s+leetcode(?:\.com)?|\s+on\s+leetcode(?:\.com)?|$)/i
  ];
  for (const pattern of patterns) {
    const match = sanitized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    let cleaned = candidate.replace(/^the\s+/i, "").replace(/\s+this\s+sum$/i, "").replace(/\s+(?:sum|page)$/i, "").replace(/\s+open\b.*$/i, "").replace(/\s+(?:in|on)\s+leetcode(?:\.com)?$/i, "").replace(/\s+(?:in\s+chrome|in\s+browser|new\s+tab)\b.*$/i, "").trim();
    if (hasLeadingProblemNumber && /\s+sum$/i.test(cleaned) && !/\b(?:two|three|four)\s+sum$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s+sum$/i, "").trim();
    }
    if (cleaned && !/^in\s+leetcode(?:\.com)?$/i.test(cleaned)) return cleaned;
  }
  return null;
}
function buildLeetCodeUrlFromPrompt(text) {
  const lower = text.toLowerCase();
  if (!lower.includes("leetcode")) return null;
  const isSolutions = /\bsolution|solutions\b/i.test(text);
  const wantsJava = /\bjava\b/i.test(text);
  const explicitUrlMatch = text.match(/https?:\/\/leetcode\.com\/[^\s]+/i);
  if (explicitUrlMatch?.[0]) return explicitUrlMatch[0];
  const problemName = extractLeetCodeProblemName(text);
  if (!problemName) {
    return "https://leetcode.com/";
  }
  const slug = toKebabCase(problemName);
  if (!slug) return "https://leetcode.com/";
  const base = `https://leetcode.com/problems/${slug}/`;
  if (!isSolutions) return base;
  return wantsJava ? `${base}solutions/?language=java` : `${base}solutions/`;
}
function extractLeetCodeSlugFromUrl(url) {
  const m = url.match(/leetcode\.com\/problems\/([a-z0-9-]+)\//i);
  return m?.[1] ?? null;
}
function extractDocsWriteRequest(text) {
  const raw = text.trim();
  const hasDocsAnchor = /\b(?:google\s+docs?|docs\.new|document|doc)\b/i.test(raw) || /\buntitled\s+document\b/i.test(raw) || /\b(?:in|inside)\s+(?:it|this|that|here)\b/i.test(raw);
  if (!hasDocsAnchor) {
    return null;
  }
  if (!/\b(write|type|draft|compose|add|insert)\b/i.test(raw)) {
    return null;
  }
  const quoted = raw.match(/["']([^"']{1,4000})["']/);
  if (quoted?.[1]) {
    return { explicitText: quoted[1].trim(), topic: null };
  }
  const topicPatterns = [
    /\b(?:about|on)\s+(.+?)(?:\s+in\s+(?:that|this)\s+document|\s+in\s+(?:the\s+)?(?:untitled\s+)?(?:google\s+)?doc(?:ument)?(?:s)?(?:\s+in\s+chrome)?|\s+in\s+(?:it|this|that|here)|$)/i,
    /\bwrite\s+(?:some\s+)?(?:content|paragraph|note|notes|essay)?\s*(?:for\s+)?(.+?)(?:\s+in\s+(?:that|this)\s+document|\s+in\s+(?:the\s+)?(?:untitled\s+)?(?:google\s+)?doc(?:ument)?(?:s)?(?:\s+in\s+chrome)?|\s+in\s+(?:it|this|that|here)|$)/i
  ];
  for (const rx of topicPatterns) {
    const m = raw.match(rx);
    const topic = m?.[1]?.trim().replace(/\s+in\s+(?:that|this)\s+document$/i, "").trim();
    if (topic) {
      return { explicitText: null, topic };
    }
  }
  return { explicitText: null, topic: "Fella and AI productivity" };
}
function extractDocsRenameRequest(text) {
  const m = text.trim().match(/^(?:rename|set|change)\s+(?:the\s+)?document(?:\s+(?:name|title))?\s+(?:to|as)\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
function extractDocsFontRequest(text) {
  const m = text.trim().match(/(?:change|set)\s+(?:the\s+)?font\s+(?:to|as)\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
function extractDocsFontSizeRequest(text) {
  const trimmed = text.trim();
  const explicit = trimmed.match(/(?:increase|decrease|change|set)\s+(?:the\s+)?(?:text\s+)?(?:font\s+)?size\s+(?:to|as)?\s*([0-9]+(?:\.[0-9]+)?(?:\s*pt)?)$/i);
  if (explicit?.[1]) return explicit[1].trim();
  const shortForm = trimmed.match(/^(?:font\s+size|text\s+size)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*pt)?)$/i);
  return shortForm?.[1]?.trim() ?? null;
}
function extractDocsColorRequest(text) {
  const m = text.trim().match(/(?:change|set)\s+(?:the\s+)?(?:text\s+)?colou?r\s+(?:to|as)\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
function isAgenticBrowserIntent(text, browserContextActive) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const isCloseOrExit = /^(?:close|exit)\b/i.test(trimmed);
  if (isCloseOrExit) return false;
  const wantsYouTubePlayback = /\b(?:play|listen|watch)\b/i.test(trimmed) && /\byoutube\b/i.test(trimmed);
  if (wantsYouTubePlayback) return true;
  const mediaControlIntent = /\b(pause|resume|play\s*\/\s*pause|seek|rewind|skip\s+forward|skip\s+back|next\s+(song|track|video)?|previous\s+(song|track|video)?|mute|volume\s+up|volume\s+down)\b/i.test(trimmed) && /\b(youtube|spotify|browser|chrome)\b/i.test(trimmed);
  if (mediaControlIntent) return true;
  const docsRefineOrFormat = /\bgoogle\s+docs?|\bdoc\b|\bdocument\b/i.test(trimmed) && /\b(refine|improve|rewrite|polish|rephrase|font|font\s*size|text\s*size)\b/i.test(trimmed);
  if (docsRefineOrFormat) return true;
  const browserAnchors = /\b(chrome|browser|youtube|spotify|docs\.google\.com|google\s+docs)\b/i.test(trimmed);
  const browserAction = /\b(play|search|find|open|navigate|go\s+to|click|type|write)\b/i.test(trimmed);
  if (browserAnchors && browserAction) return true;
  if (browserContextActive && /\b(refine|improve|rewrite|font|font\s*size|play|youtube|spotify|search|click|type|pause|resume|seek|next|previous|mute|volume)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}
function generateSessionId() {
  const now = /* @__PURE__ */ new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const rand = randomBytes(2).toString("hex");
  return `sess-${date}-${time}-${rand}`;
}
function isVisibleTurn(role, content) {
  if (role === "user") {
    return !content.startsWith("Tool result:") && !content.includes("Continue working toward the goal:");
  }
  if (role === "assistant") {
    const trimmed = content.trim();
    return !(trimmed.startsWith("{") && trimmed.endsWith("}"));
  }
  return false;
}
export class Engine {
  /** Rolling conversation history sent to the model on every turn. */
  history = [];
  /** Pending destructive action awaiting "yes" confirmation. */
  pendingConfirmation = null;
  /** Pending folder disambiguation awaiting a numeric selection. */
  pendingSelection = null;
  /** Pending user clarification for ambiguous open intent target. */
  pendingOpenClarification = null;
  /** Pending context switch confirmation (escaping browser to desktop). */
  pendingContextSwitch = null;
  /** Last file opened successfully, used for follow-ups like "open it with VLC". */
  lastOpenedFilePath = null;
  /** Last folder navigated/opened successfully, used for follow-ups like "organize ... in it". */
  lastNavigatedFolderPath = null;
  /** Current working directory for CLI-style follow-ups (`cd`, `open first one`, `in it`). */
  currentDirectory = null;
  /** Most recent directory listing entries, used by ordinal follow-ups. */
  lastListedEntries = [];
  /** Tracks whether the current active context is Chrome/Edge browser automation. */
  browserContextActive = false;
  /** Last opened LeetCode problem slug for browser-context follow-ups like "open solutions page of it". */
  lastLeetCodeSlug = null;
  llmClient = new LLMClient();
  async executeBrowserTool(args) {
    const result = await executeTool("browserAutomation", args);
    const action = String(args["action"] ?? "").toLowerCase();
    this.browserContextActive = action !== "close";
    if (action === "navigate") {
      const rawUrl = String(args["url"] ?? "");
      const slug = extractLeetCodeSlugFromUrl(rawUrl);
      if (slug) this.lastLeetCodeSlug = slug;
    }
    return result;
  }
  async generateDocsDraft(topic) {
    const prompt = `Write polished content about: ${topic}. Length: 2 concise paragraphs. No markdown, no bullet points unless the topic clearly requires a list.`;
    const generated = await this.llmClient.generateText(prompt);
    const trimmed = generated.trim();
    if (trimmed) return trimmed;
    throw new Error("Could not generate draft content from LLM response.");
  }
  rememberNavigatedFolder(pathOrAlias) {
    try {
      const resolved = resolvePath(pathOrAlias);
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        this.lastNavigatedFolderPath = resolved;
        this.currentDirectory = resolved;
        this.browserContextActive = false;
      }
    } catch {
    }
  }
  rememberListedEntries(listResult) {
    const parsed = parseListFilesEntries(listResult);
    if (!parsed) return;
    this.lastListedEntries = parsed.entries;
    this.currentDirectory = parsed.basePath;
    this.lastNavigatedFolderPath = parsed.basePath;
  }
  resolveWithinCurrentDirectory(raw) {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("Path cannot be empty.");
    if (isAbsolute(trimmed) || /^[a-z]:[\\/]/i.test(trimmed)) return resolvePath(trimmed);
    if (this.currentDirectory) return resolvePath(join(this.currentDirectory, trimmed));
    return resolvePath(trimmed);
  }
  /** Undo / Redo stack — tracks reversible file operations. */
  undoStack = new UndoStack();
  /** ReAct loop runner used for multi-step planning and tool use. */
  agentLoop;
  /** Persistent store that owns the session turns table. */
  sessionStore;
  /** Unique identifier for this session, shown to the user. */
  _sessionId;
  /** Tracks whether a row exists in the sessions table for this engine. */
  sessionCreated;
  /** Index into this.history up to which turns have already been persisted. */
  lastSavedIdx = 0;
  constructor(resumeSessionId) {
    this.sessionStore = new MemoryStore();
    if (resumeSessionId) {
      const turns = this.sessionStore.loadSessionHistory(resumeSessionId);
      this.history = turns.map((t) => ({
        role: t.role,
        content: t.content
      }));
      this._sessionId = resumeSessionId;
      this.sessionCreated = true;
    } else {
      this._sessionId = generateSessionId();
      this.sessionCreated = false;
    }
    this.lastSavedIdx = this.history.length;
    this.agentLoop = new AgentLoop({
      maxSteps: 8,
      executeTool: async (tool, args) => this.executeAgentTool(tool, args)
    });
  }
  /** Unique identifier for this session. */
  get id() {
    return this._sessionId;
  }
  getAssistantLabel() {
    if (this.browserContextActive) return "fella (inside Chrome)";
    return this.currentDirectory ? `fella (inside ${this.currentDirectory})` : "fella";
  }
  /** Returns visible turns from this session for UI reconstruction on resume. */
  getVisibleHistory() {
    return this.sessionStore.loadSessionHistory(this._sessionId).filter((t) => t.visible).map((t) => ({ role: t.role, content: t.content }));
  }
  /** Persist any new history messages added since the last checkpoint. */
  persistDelta() {
    const newMessages = this.history.slice(this.lastSavedIdx);
    if (newMessages.length > 0 && !this.sessionCreated) {
      this.sessionStore.createSession(this._sessionId);
      this.sessionCreated = true;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const msg of newMessages) {
      this.sessionStore.appendTurn(
        this._sessionId,
        msg.role,
        msg.content,
        now,
        isVisibleTurn(msg.role, msg.content)
      );
    }
    if (newMessages.length > 0) {
      this.sessionStore.touchSession(this._sessionId);
    }
    this.lastSavedIdx = this.history.length;
  }
  // ── Private: execute a tool and record a matching undo entry ───────────────
  /**
   * Execute `tool` with `args`, record an undo/redo entry for reversible
   * operations, and return the human-readable result string.
   *
   * Special handling:
   *  - `deleteFile`           — soft-delete via TRASH_DIR so the operation
   *                             is always reversible.
   *  - `organiseByRule` (run) — uses buildPlan/executePlan to capture the
   *                             exact list of moves made.
   *  - `moveFile`             — records the inverse rename.
   *  - `createDirectory`      — records a safe (non-recursive) rmdir so the
   *                             undo only succeeds when the folder is still empty.
   */
  async executeWithHistory(tool, args) {
    const resolved = resolveToolName(tool);
    if (resolved === "deleteFile") {
      const filePath = String(args["path"] ?? "");
      if (!filePath) throw new Error('deleteFile: "path" argument is required');
      const resolvedPath = resolvePath(filePath);
      await access(resolvedPath);
      await mkdir(TRASH_DIR, { recursive: true });
      const trashPath = join(TRASH_DIR, `${Date.now()}_${basename(resolvedPath)}`);
      try {
        await rename(resolvedPath, trashPath);
      } catch (renameErr) {
        if (renameErr.code === "EXDEV") {
          await rm(resolvedPath, { recursive: true, force: true });
          return `Deleted: ${resolvedPath}`;
        }
        throw renameErr;
      }
      this.undoStack.push({
        description: `delete ${basename(resolvedPath)}`,
        undo: async () => {
          await mkdir(dirname(resolvedPath), { recursive: true });
          await rename(trashPath, resolvedPath);
        },
        redo: async () => {
          await mkdir(TRASH_DIR, { recursive: true });
          await rename(resolvedPath, trashPath);
        }
      });
      return `Deleted: ${resolvedPath}`;
    }
    if (resolved === "organiseByRule" && args["dry_run"] === false) {
      const rawDir = String(args["source_dir"] ?? "");
      const rule = String(args["rule"] ?? "by_type");
      const sinceRaw = args["since"] != null ? String(args["since"]) : null;
      if (!rawDir) throw new Error('organiseByRule: "source_dir" argument is required');
      let since;
      if (sinceRaw) {
        const sinceDate = resolveSinceDate(sinceRaw);
        if (!sinceDate) throw new Error(`organiseByRule: invalid "since" value: "${sinceRaw}"`);
        since = sinceDate;
      }
      const sourceDir = resolvePath(rawDir);
      const plan = buildPlan(sourceDir, rule, since);
      const { moved, skipped, errors, actualMoves } = executePlan(plan);
      if (actualMoves.length > 0) {
        const cleanupRoots = [...new Set(actualMoves.map((m) => dirname(m.destination)))];
        const removeEmptyParents = async (startDir, stopDir) => {
          let current = startDir;
          const stopResolved = resolvePath(stopDir);
          while (true) {
            const currentResolved = resolvePath(current);
            if (currentResolved === stopResolved) break;
            try {
              await rmdir(currentResolved);
            } catch {
              break;
            }
            const parent = dirname(currentResolved);
            if (parent === currentResolved) break;
            current = parent;
          }
        };
        this.undoStack.push({
          description: `organise ${actualMoves.length} file${actualMoves.length !== 1 ? "s" : ""} in ${basename(sourceDir)}`,
          undo: async () => {
            for (const { source, destination } of [...actualMoves].reverse()) {
              await mkdir(dirname(source), { recursive: true });
              await rename(destination, source);
            }
            const deepestFirst = cleanupRoots.sort((a, b) => b.length - a.length);
            for (const dir of deepestFirst) {
              await removeEmptyParents(dir, sourceDir);
            }
          },
          redo: async () => {
            for (const { source, destination } of actualMoves) {
              await mkdir(dirname(destination), { recursive: true });
              await rename(source, destination);
            }
          }
        });
      }
      const parts = [`Moved ${moved} of ${plan.length} files`];
      if (skipped) parts.push(`${skipped} skipped (already exist)`);
      if (errors.length) parts.push(`${errors.length} error(s):
  ${errors.join("\n  ")}`);
      return parts.join("\n");
    }
    const result = await executeTool(tool, args);
    if (resolved === "moveFile") {
      const src = resolvePath(String(args["source"] ?? ""));
      const dest = resolvePath(String(args["destination"] ?? ""));
      this.undoStack.push({
        description: `move "${basename(src)}" \u2192 "${basename(dest)}"`,
        undo: async () => {
          await rename(dest, src);
        },
        redo: async () => {
          await mkdir(dirname(dest), { recursive: true });
          await rename(src, dest);
        }
      });
    } else if (resolved === "createDirectory") {
      const dirPath = resolvePath(String(args["path"] ?? ""));
      this.undoStack.push({
        description: `create folder "${basename(dirPath)}"`,
        // Use non-recursive rmdir so undo only works when the folder is still empty
        undo: async () => {
          try {
            await rmdir(dirPath);
          } catch {
            throw new Error(`Cannot undo: folder "${basename(dirPath)}" is not empty or already removed`);
          }
        },
        redo: async () => {
          await mkdir(dirPath, { recursive: true });
        }
      });
    }
    return result;
  }
  /**
   * Engine-specific execution policy layered on top of tool execution.
   * This keeps confirmation gates and deferred execution logic in one place.
   */
  async executeAgentTool(tool, args) {
    const resolvedTool = resolveToolName(tool);
    if (resolvedTool === "deleteFile") {
      const filePath = String(args["path"] ?? "");
      this.pendingConfirmation = { tool: "deleteFile", args };
      throw new AgentLoopHalt(
        `Are you sure you want to delete "${filePath}"? This cannot be undone. (yes / no)`
      );
    }
    const result = await this.executeWithHistory(tool, args);
    if (resolvedTool === "browserAutomation") {
      const action = String(args["action"] ?? "").toLowerCase();
      this.browserContextActive = action !== "close";
    }
    if (resolvedTool === "listFiles") {
      this.rememberListedEntries(result);
    }
    if (resolvedTool === "organiseByRule" && args["dry_run"] !== false) {
      this.pendingConfirmation = {
        tool: "organiseByRule",
        args: { ...args, dry_run: false }
      };
    }
    return result;
  }
  /**
   * Public entry-point: delegates to sendInner and persists the new history
   * turns unconditionally (even on error) via a finally block.
   */
  async send(userMessage, onStep) {
    try {
      return await this.sendInner(userMessage, onStep);
    } finally {
      this.persistDelta();
    }
  }
  async sendInner(userMessage, onStep) {
    const trimmed = userMessage.trim().toLowerCase();
    if (/^undo(\s+(the\s+)?(last\s+)?(operation|action|that|previous))?[.!]?$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.undoStack.undo();
      } catch (err) {
        reply = `Undo failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^redo(\s+(the\s+)?(last\s+)?(operation|action|that|previous))?[.!]?$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.undoStack.redo();
      } catch (err) {
        reply = `Redo failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(profile\s+selected|selected\s+profile|profile\s+chosen)[.!]?$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "profile_selected" });
      } catch (err) {
        reply = `Browser setup error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (!this.pendingConfirmation && !this.pendingSelection && !this.pendingOpenClarification && ACKNOWLEDGEMENT_WORDS.has(trimmed)) {
      const reply = trimmed === "thanks" || trimmed === "thank you" ? "You can tell me the next thing to do." : "Okay.";
      this.history.push({ role: "user", content: userMessage });
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (this.pendingContextSwitch) {
      if (CONFIRM_WORDS.has(trimmed)) {
        const savedCmd = this.pendingContextSwitch;
        this.pendingContextSwitch = null;
        this.browserContextActive = false;
        return await this.sendInner(savedCmd, onStep);
      }
      if (CANCEL_WORDS.has(trimmed)) {
        this.pendingContextSwitch = null;
        this.history.push({ role: "user", content: userMessage });
        const reply = "Cancelled. Staying in the browser.";
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      this.pendingContextSwitch = null;
    }
    const EXPLICIT_BROWSER_KEYWORDS = /\b(chrome|browser|web|site|url|link|domain|http|https|google\s+d(?:rive|ocs?|sheets?|slides?)|gmail|youtube|github|leetcode|linkedin|twitter|facebook|instagram|reddit|stackoverflow)\b/i;
    const EXPLICIT_SYSTEM_KEYWORDS = /\b(folder|directory|file|system|app|application|control\s+panel|settings?|pc|computer|downloaded|downloads|home|local)\b/i;
    const IS_BASIC_COMMAND = /^(?:undo|redo|cd|close|exit)\b/i.test(trimmed);
    const docsWriteIntentInContext = extractDocsWriteRequest(userMessage) || /\b(write|type|draft|compose|add|insert)\b/i.test(userMessage) && /\b(?:about|on)\s+.+/i.test(userMessage);
    const docsRenameIntentInContext = extractDocsRenameRequest(userMessage);
    const pdfExportIntentInContext = /^(?:download|save|export)\s+(?:this\s+|the\s+|current\s+)?(?:page|document|doc|file)?\s*(?:as\s+)?pdf(?:\s+(?:as|named)\s+(.+))?$/i.test(userMessage.trim());
    if (this.browserContextActive && !IS_BASIC_COMMAND && !this.pendingConfirmation && !this.pendingSelection && !this.pendingOpenClarification) {
      const isSystemCommand = EXPLICIT_SYSTEM_KEYWORDS.test(trimmed) || /^(?:open|launch|start|run|list|show)\s+(?![a-z]+(?:\.[a-z]+)+)/i.test(trimmed) && !EXPLICIT_BROWSER_KEYWORDS.test(trimmed);
      if (isSystemCommand) {
        this.pendingContextSwitch = userMessage;
        this.history.push({ role: "user", content: userMessage });
        const reply = "You are currently inside Chrome. Do you want to switch back to home to do this? (yes / no)";
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      if (docsWriteIntentInContext || docsRenameIntentInContext || pdfExportIntentInContext) {
      } else {
        this.history.push({ role: "user", content: userMessage });
        try {
          const reply = await agenticBrowserTask(userMessage, (stepMsg) => {
            if (onStep) {
              onStep({ thought: "", tool: "browserAutomation", args: {}, result: stepMsg, success: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
            }
          });
          this.history.push({ role: "assistant", content: reply });
          return reply;
        } catch (err) {
          const errorReply = `Browser automation error: ${err instanceof Error ? err.message : String(err)}`;
          this.history.push({ role: "assistant", content: errorReply });
          return errorReply;
        }
      }
    }
    if (/^(?:cd\s*~?|home|go\s+home|come\s+out(?:\s+of\s+the\s+directory)?|come\s+to\s+home\s+dir(?:ectory)?)$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      const homeDir = resolvePath("home");
      this.currentDirectory = homeDir;
      this.lastNavigatedFolderPath = homeDir;
      this.browserContextActive = false;
      const reply = `Changed directory to ${homeDir}`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(?:close|exit)\s+(?:chrome|browser)$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "close" });
      } catch (err) {
        reply = `Close browser error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(?:close|exit)\s+(?:tab|this\s+tab|current\s+tab)$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "close_tab" });
      } catch (err) {
        reply = `Close tab error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(?:close|exit)\s+(?:all\s+)?(?:the\s+)?tabs?(?:\s+in\s+(?:chrome|browser))?$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "close_all_tabs" });
      } catch (err) {
        reply = `Close tabs error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (isAgenticBrowserIntent(userMessage, this.browserContextActive)) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await agenticBrowserTask(userMessage, (stepMsg) => {
          if (onStep) {
            onStep({
              thought: "",
              tool: "browserAutomation",
              args: { action: "agentic_goal" },
              result: stepMsg,
              success: true,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        });
        this.browserContextActive = true;
      } catch (err) {
        reply = `Browser automation error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(?:close|exit)\s+(?:folder|this\s+folder|current\s+folder)$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      this.browserContextActive = false;
      let reply;
      try {
        const targetPath = this.currentDirectory ?? this.lastNavigatedFolderPath ?? "";
        reply = await executeTool("screenAutomation", {
          action: "close_folder",
          ...targetPath ? { path: targetPath } : {}
        });
        if (/^Closed folder window/i.test(reply) || /^Closed \d+ Explorer window/i.test(reply)) {
          this.currentDirectory = null;
          this.lastNavigatedFolderPath = null;
          this.lastListedEntries = [];
        }
      } catch (err) {
        reply = `Close folder error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/^(?:close|exit)\s+(?:file|window|application|app|this\s+window|current\s+window)$/i.test(trimmed)) {
      this.history.push({ role: "user", content: userMessage });
      this.browserContextActive = false;
      let reply;
      try {
        reply = await executeTool("screenAutomation", {
          action: "hotkey",
          keys: ["alt", "f4"]
        });
      } catch (err) {
        reply = `Close window error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const cdMatch = userMessage.trim().match(/^cd\s+(.+)$/i);
    if (cdMatch) {
      this.history.push({ role: "user", content: userMessage });
      const target = cdMatch[1].trim();
      let reply;
      try {
        const resolved = this.resolveWithinCurrentDirectory(target);
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
          reply = `Directory not found: ${resolved}`;
        } else {
          this.currentDirectory = resolved;
          this.lastNavigatedFolderPath = resolved;
          this.browserContextActive = false;
          reply = `Changed directory to ${resolved}`;
        }
      } catch (err) {
        reply = `cd error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openLeetCodeSolutionsFollowUpEarly = userMessage.trim().match(
      /^(?:open|show|go\s+to|navigate\s+to)\s+(?:the\s+)?solutions?(?:\s+page)?(?:\s+(?:of|in)\s+(?:it|this|that))?(?:\s+in\s+leetcode(?:\.com)?)?(?:\s+in\s+(?:chrome|browser))?$/i
    );
    if (openLeetCodeSolutionsFollowUpEarly && this.browserContextActive) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.lastLeetCodeSlug) {
        const reply2 = "I do not have a recent LeetCode problem in browser context yet. Open a LeetCode problem first, then I can open its solutions page.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const wantsNewTab = /\bnew\s+tab\b/i.test(userMessage);
      const url = `https://leetcode.com/problems/${this.lastLeetCodeSlug}/solutions/`;
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "navigate", url, newTab: wantsNewTab });
      } catch (err) {
        reply = `Open LeetCode solutions error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const pdfExportMatch = userMessage.trim().match(
      /^(?:download|save|export)\s+(?:this\s+|the\s+|current\s+)?(?:page|document|doc|file)?\s*(?:as\s+)?pdf(?:\s+(?:as|named)\s+(.+))?$/i
    );
    if (pdfExportMatch && this.browserContextActive) {
      this.history.push({ role: "user", content: userMessage });
      const name = pdfExportMatch[1]?.trim() ?? "";
      const filename = name ? name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf` : void 0;
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "download_pdf", filename });
      } catch (err) {
        reply = `Download PDF error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const driveOpenDocMatch = userMessage.trim().match(
      /^(?:open\s+google\s+drive)(?:\s+in\s+(?:chrome|browser))?(?:\s+and\s+open\s+(?:the\s+)?(?:document|doc|file)\s+(?:named|called)\s+(.+?))(?:\s+in\s+(?:chrome|browser))?$/i
    );
    if (driveOpenDocMatch) {
      this.history.push({ role: "user", content: userMessage });
      const docName = driveOpenDocMatch[1].trim();
      let reply;
      try {
        await this.executeBrowserTool({ action: "navigate", url: "https://drive.google.com/" });
        reply = await this.executeBrowserTool({ action: "drive_open_item", name: docName });
      } catch (err) {
        reply = `Open Google Drive document error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openInCurrentMatch = userMessage.trim().match(/^open\s+(.+?)\s+in\s+(?:it|this|that|here)\.?$/i);
    if (openInCurrentMatch) {
      this.history.push({ role: "user", content: userMessage });
      if (this.browserContextActive) {
        const rawItemName = openInCurrentMatch[1].trim();
        const cleanedItemName = rawItemName.replace(/^the\s+/i, "").replace(/\s+(?:document|doc|file|folder|tab)\b.*$/i, "").trim();
        const candidates = [rawItemName, cleanedItemName].filter(
          (v, idx, arr) => Boolean(v) && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === idx
        );
        let reply2 = `I couldn't find "${rawItemName}" on the current browser page.`;
        try {
          await this.executeBrowserTool({ action: "snapshot" });
          let opened = false;
          try {
            reply2 = await this.executeBrowserTool({ action: "drive_open_item", name: rawItemName });
            opened = true;
          } catch {
          }
          if (!opened) {
            for (const candidate of candidates) {
              try {
                await this.executeBrowserTool({ action: "click", text: candidate, doubleClick: true });
                reply2 = `Opened "${candidate}" in the current browser context.`;
                opened = true;
                break;
              } catch {
                await this.executeBrowserTool({ action: "click", text: candidate });
                reply2 = `Clicked "${candidate}" in the current browser context.`;
                opened = true;
                break;
              }
            }
          }
          if (!opened) {
            reply2 = `I couldn't open "${rawItemName}" from the current browser view. I can try searching within this page if you want.`;
          }
        } catch (err) {
          reply2 = `Open item in browser error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (!this.currentDirectory) {
        const reply2 = "I do not have a current folder context yet. Open or navigate to a folder first.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const itemName = openInCurrentMatch[1].trim();
      let reply;
      try {
        const targetPath = resolvePath(join(this.currentDirectory, itemName));
        if (!existsSync(targetPath)) {
          reply = `I couldn't find "${itemName}" inside ${this.currentDirectory}.`;
        } else {
          reply = await executeTool("screenAutomation", { action: "navigate", path: targetPath });
          if (statSync(targetPath).isDirectory()) this.rememberNavigatedFolder(targetPath);
          else this.lastOpenedFilePath = targetPath;
        }
      } catch (err) {
        reply = `Open item error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openOrdinalWithAppMatch = userMessage.trim().match(
      /^open\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+)(?:\s+(?:listed|shown|mentioned))?(?:\s+(?:one|item|file|folder))?\s+(?:in|with|using)\s+(.+)$/i
    );
    if (openOrdinalWithAppMatch) {
      this.history.push({ role: "user", content: userMessage });
      const ord = resolveOrdinal(openOrdinalWithAppMatch[1] ?? "");
      const rawApp = openOrdinalWithAppMatch[2] ?? "";
      const app = normaliseAppName(rawApp) || rawApp.trim();
      if (!ord || this.lastListedEntries.length === 0) {
        const reply2 = "I do not have a recent indexed list in context. Ask for folder contents or recent downloads first, then I can open by number.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const entry = this.lastListedEntries[ord - 1];
      if (!entry) {
        const reply2 = `Please choose a number between 1 and ${this.lastListedEntries.length}.`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      let reply;
      try {
        reply = await executeTool("openApplication", {
          app,
          file_path: entry.path
        });
        if (entry.isDirectory) this.rememberNavigatedFolder(entry.path);
        else this.lastOpenedFilePath = entry.path;
      } catch (err) {
        reply = `Open item error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openOrdinalMatch = userMessage.trim().match(
      /^open\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+)(?:\s+(?:listed|shown|mentioned))?(?:\s+(?:one|item|file|folder))?$/i
    );
    if (openOrdinalMatch) {
      this.history.push({ role: "user", content: userMessage });
      const ord = resolveOrdinal(openOrdinalMatch[1] ?? "");
      if (!ord) {
        const reply2 = "I do not have a recent indexed list in context. Ask for folder contents first, then I can open by number.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (this.lastListedEntries.length === 0 && this.currentDirectory) {
        try {
          const listResult = await executeTool("listFiles", { path: this.currentDirectory });
          this.rememberListedEntries(listResult);
        } catch {
        }
      }
      if (this.lastListedEntries.length === 0) {
        const reply2 = "I do not have a recent indexed list in context. Ask for folder contents first, then I can open by number.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const entry = this.lastListedEntries[ord - 1];
      if (!entry) {
        const reply2 = `Please choose a number between 1 and ${this.lastListedEntries.length}.`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      let reply;
      try {
        reply = await executeTool("screenAutomation", { action: "navigate", path: entry.path });
        if (entry.isDirectory) {
          this.rememberNavigatedFolder(entry.path);
        } else {
          this.lastOpenedFilePath = entry.path;
        }
      } catch (err) {
        reply = `Open item error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const contentsIntent = extractContentsIntent(userMessage);
    if (contentsIntent) {
      this.history.push({ role: "user", content: userMessage });
      if (contentsIntent.target === "it") {
        if (!this.lastNavigatedFolderPath) {
          const reply3 = "I do not have a recent opened folder in context yet. Tell me the folder name or path, and I will list its contents.";
          this.history.push({ role: "assistant", content: reply3 });
          return reply3;
        }
        let reply2;
        try {
          reply2 = await executeTool("listFiles", { path: this.lastNavigatedFolderPath });
          this.rememberListedEntries(reply2);
        } catch (err) {
          reply2 = `List contents error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (contentsIntent.target === "path") {
        let reply2;
        try {
          const targetPath = this.resolveWithinCurrentDirectory(contentsIntent.value);
          reply2 = await executeTool("listFiles", { path: targetPath });
          this.rememberListedEntries(reply2);
        } catch (err) {
          reply2 = `List contents error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const folders = findFoldersByName(contentsIntent.value);
      if (folders.length === 0) {
        const reply2 = `I couldn't find a folder named "${contentsIntent.value}".`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (folders.length === 1) {
        let reply2;
        try {
          reply2 = await executeTool("listFiles", { path: folders[0] });
          this.rememberListedEntries(reply2);
        } catch (err) {
          reply2 = `List contents error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      this.pendingSelection = { kind: "list-folder", options: folders };
      const reply = `I found multiple folders named "${contentsIntent.value}":
${folders.map((f, i) => `${i + 1}. ${f}`).join("\n")}
Type 1 to choose the first folder, 2 for the second, and so on.`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const followUpApp = extractFollowUpAppForLastFile(userMessage);
    if (followUpApp) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.lastOpenedFilePath) {
        const reply2 = "I do not have a recent opened file in context yet. Tell me which file to open first, then I can reopen it with a specific app.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      let reply;
      try {
        reply = await executeTool("openApplication", {
          app: followUpApp,
          file_path: this.lastOpenedFilePath
        });
      } catch (err) {
        reply = `Open with app error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/(?:organi[sz]e|oraginze)\b/i.test(userMessage) && /\bin\s+(?:it|this|that|here)\b/i.test(userMessage)) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.lastNavigatedFolderPath) {
        const reply2 = "I do not have a recent opened folder in context yet. Open or navigate to a folder first, then I can organize files in it.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const lower = userMessage.toLowerCase();
      const mentionsImages = /\bimage|images|photo|photos|picture|pictures\b/.test(lower);
      const mentionsVideos = /\bvideo|videos|movie|movies\b/.test(lower);
      const rule = mentionsImages && mentionsVideos ? "by_category" : "by_type";
      let reply;
      try {
        reply = await this.executeAgentTool("organiseByRule", {
          source_dir: this.lastNavigatedFolderPath,
          rule,
          dry_run: true
        });
      } catch (err) {
        reply = `Organize error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (this.pendingSelection) {
      const selection = Number.parseInt(userMessage.trim(), 10);
      const numberChoice = Number.isInteger(selection) ? this.pendingSelection.options[selection - 1] ?? null : null;
      const nameChoice = numberChoice ? null : resolveSelectionByName(userMessage, this.pendingSelection.options);
      const chosenPath = numberChoice ?? nameChoice;
      if (chosenPath) {
        const kind = this.pendingSelection.kind;
        this.pendingSelection = null;
        this.history.push({ role: "user", content: userMessage });
        let reply;
        if (kind === "delete-folder") {
          this.pendingConfirmation = { tool: "deleteFile", args: { path: chosenPath } };
          reply = `Are you sure you want to permanently delete "${chosenPath}" and all its contents? (yes / no)`;
        } else if (kind === "list-folder") {
          try {
            reply = await executeTool("listFiles", { path: chosenPath });
            this.rememberListedEntries(reply);
          } catch (err) {
            reply = `List contents error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else if (kind === "open-file") {
          try {
            reply = await executeTool("screenAutomation", {
              action: "navigate",
              path: chosenPath
            });
            this.lastOpenedFilePath = chosenPath;
          } catch (err) {
            reply = `Open file error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          try {
            reply = await executeTool("screenAutomation", {
              action: "navigate",
              path: chosenPath
            });
            this.rememberNavigatedFolder(chosenPath);
          } catch (err) {
            reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      if (Number.isInteger(selection)) {
        const reply = `Please choose a number between 1 and ${this.pendingSelection.options.length}.`;
        this.history.push({ role: "user", content: userMessage });
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      if (CANCEL_WORDS.has(trimmed)) {
        this.pendingSelection = null;
        this.pendingOpenClarification = null;
        const reply = "Cancelled.";
        this.history.push({ role: "user", content: userMessage });
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
    }
    if (this.pendingConfirmation) {
      const token = userMessage.trim().toLowerCase();
      if (CONFIRM_WORDS.has(token)) {
        const { tool, args } = this.pendingConfirmation;
        this.pendingConfirmation = null;
        let reply;
        try {
          reply = await this.executeWithHistory(tool, args);
        } catch (err) {
          reply = `Tool error (${tool}): ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "user", content: userMessage });
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      if (CANCEL_WORDS.has(token)) {
        this.pendingConfirmation = null;
        const reply = "Cancelled \u2014 no changes were made.";
        this.history.push({ role: "user", content: userMessage });
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
      this.pendingConfirmation = null;
    }
    const leetCodeUrl = buildLeetCodeUrlFromPrompt(userMessage);
    if (leetCodeUrl) {
      this.history.push({ role: "user", content: userMessage });
      const wantsNewTab = /\bnew\s+tab\b/i.test(userMessage);
      let reply;
      try {
        reply = await this.executeBrowserTool({
          action: "navigate",
          url: leetCodeUrl,
          newTab: wantsNewTab
        });
        const slug = extractLeetCodeSlugFromUrl(leetCodeUrl);
        if (slug) this.lastLeetCodeSlug = slug;
      } catch (err) {
        reply = `Open LeetCode error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (/\bgoogle\s+docs\b/i.test(userMessage) && /\b(create|new|untitled|open)\b/i.test(userMessage)) {
      this.history.push({ role: "user", content: userMessage });
      const wantsNewTab = /\bnew\s+tab\b/i.test(userMessage);
      const writeRequestInSameTurn = extractDocsWriteRequest(userMessage);
      let reply;
      try {
        const openReply = await this.executeBrowserTool({
          action: "navigate",
          url: "https://docs.new",
          newTab: wantsNewTab
        });
        if (writeRequestInSameTurn || /\b(write|type|draft|compose|add|insert)\b/i.test(userMessage)) {
          const topicLabel = writeRequestInSameTurn?.topic ?? "Fella and AI productivity";
          const content = writeRequestInSameTurn?.explicitText ?? await this.generateDocsDraft(topicLabel);
          await this.executeBrowserTool({ action: "append_text", text: content, humanLike: true, delayMs: 45 });
          reply = writeRequestInSameTurn?.explicitText ? `${openReply}
Added your text to the new Google Doc.` : `${openReply}
Generated and added content about "${topicLabel}" to the new Google Doc.`;
        } else {
          reply = openReply;
        }
      } catch (err) {
        reply = `Open Google Docs error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const docsWriteRequest = extractDocsWriteRequest(userMessage);
    const docsWriteByContext = !docsWriteRequest && this.browserContextActive && /\b(write|type|draft|compose|add|insert)\b/i.test(userMessage) && /\b(?:about|on)\s+.+/i.test(userMessage);
    if (docsWriteRequest || docsWriteByContext) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        const topicFromContext = userMessage.match(/\b(?:about|on)\s+(.+?)(?:\s+in\s+(?:it|this|that|here)|$)/i)?.[1]?.trim() ?? null;
        const topicLabel = docsWriteRequest?.topic ?? topicFromContext ?? "Fella and AI productivity";
        const content = docsWriteRequest?.explicitText ?? await this.generateDocsDraft(topicLabel);
        await this.executeBrowserTool({ action: "append_text", text: content, humanLike: true, delayMs: 45 });
        reply = docsWriteRequest?.explicitText ? "Added your text to the current Google Docs page in Chrome." : `Generated and added content about "${topicLabel}" to the current Google Docs page in Chrome.`;
      } catch (err) {
        reply = `Write in Google Docs error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const docsRenameTarget = extractDocsRenameRequest(userMessage);
    if (docsRenameTarget && this.browserContextActive) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "rename_document", title: docsRenameTarget });
      } catch (err) {
        reply = `Rename document error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openLeetCodeSolutionsFollowUp = userMessage.trim().match(
      /^(?:open|show|go\s+to|navigate\s+to)\s+(?:the\s+)?solutions?(?:\s+page)?(?:\s+of\s+(?:it|this|that))?(?:\s+in\s+leetcode(?:\.com)?)?(?:\s+in\s+(?:chrome|browser))?$/i
    );
    if (openLeetCodeSolutionsFollowUp && this.browserContextActive) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.lastLeetCodeSlug) {
        const reply2 = "I do not have a recent LeetCode problem in browser context yet. Open a LeetCode problem first, then I can open its solutions page.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const wantsNewTab = /\bnew\s+tab\b/i.test(userMessage);
      const url = `https://leetcode.com/problems/${this.lastLeetCodeSlug}/solutions/`;
      let reply;
      try {
        reply = await this.executeBrowserTool({ action: "navigate", url, newTab: wantsNewTab });
      } catch (err) {
        reply = `Open LeetCode solutions error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (this.pendingOpenClarification) {
      const target = this.pendingOpenClarification.target;
      const answer = trimmed;
      this.history.push({ role: "user", content: userMessage });
      if (CANCEL_WORDS.has(answer)) {
        this.pendingOpenClarification = null;
        const reply2 = "Cancelled.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (/\b(setting|settings|control panel)\b/i.test(answer)) {
        this.pendingOpenClarification = null;
        let reply2;
        try {
          reply2 = await executeTool("openSettings", { setting: target });
        } catch {
          reply2 = `I couldn't find a settings page named "${target}" on this system.`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (/\b(folder|directory)\b/i.test(answer)) {
        this.pendingOpenClarification = null;
        const folders = findFoldersByName(target);
        if (folders.length === 0) {
          const reply3 = `I couldn't find a folder named "${target}" on this system.`;
          this.history.push({ role: "assistant", content: reply3 });
          return reply3;
        }
        if (folders.length === 1) {
          let reply3;
          try {
            reply3 = await executeTool("screenAutomation", { action: "navigate", path: folders[0] });
            this.rememberNavigatedFolder(folders[0]);
          } catch (err) {
            reply3 = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
          }
          this.history.push({ role: "assistant", content: reply3 });
          return reply3;
        }
        this.pendingSelection = { kind: "navigate-folder", options: folders };
        const reply2 = buildFolderChoicePrompt(target, folders);
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (/\b(file|shortcut|notepad|text)\b/i.test(answer)) {
        this.pendingOpenClarification = null;
        let reply2;
        try {
          const lookup = await executeTool("findFile", {
            query: target,
            sort_by: "recent",
            max_results: 8
          });
          const filePaths = parseFindFilePaths(lookup);
          if (filePaths.length === 0) {
            reply2 = `I couldn't find a file or shortcut named "${target}" on this system.`;
          } else if (filePaths.length === 1) {
            reply2 = await executeTool("screenAutomation", {
              action: "navigate",
              path: filePaths[0]
            });
            this.lastOpenedFilePath = filePaths[0];
          } else {
            this.pendingSelection = { kind: "open-file", options: filePaths };
            reply2 = buildFileChoicePrompt(target, filePaths);
          }
        } catch (err) {
          reply2 = `Open file error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (/\b(app|application|program|exe)\b/i.test(answer)) {
        this.pendingOpenClarification = null;
        let reply2;
        try {
          reply2 = await executeTool("openApplication", { app: target });
        } catch {
          reply2 = `I couldn't find an application named "${target}" on this system.`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (CONFIRM_WORDS.has(answer)) {
        this.pendingOpenClarification = null;
        let reply2;
        try {
          reply2 = await executeTool("openApplication", { app: target });
        } catch {
          reply2 = `I couldn't find an application named "${target}" on this system.`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const reply = `Please tell me what "${target}" is: application, folder, file/shortcut, or setting.`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const openFileInFolderMatch = userMessage.trim().match(
      /^open\s+(.+?)\s+in\s+(?:the\s+)?(.+?)\s+folder$/i
    );
    if (openFileInFolderMatch) {
      this.history.push({ role: "user", content: userMessage });
      const fileName = openFileInFolderMatch[1].trim();
      const folderName = openFileInFolderMatch[2].trim();
      const folders = findFoldersByName(folderName);
      if (folders.length === 0) {
        const reply2 = `I couldn't find a folder named "${folderName}".`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const openFromFolder = async (folderPath) => {
        const directPath = join(folderPath, fileName);
        if (existsSync(directPath)) {
          const opened = await executeTool("screenAutomation", {
            action: "navigate",
            path: directPath
          });
          this.lastOpenedFilePath = directPath;
          this.rememberNavigatedFolder(folderPath);
          return opened;
        }
        const lookup = await executeTool("findFile", {
          query: fileName,
          dir: folderPath,
          sort_by: "score",
          max_results: 8
        });
        const filePaths = parseFindFilePaths(lookup);
        if (filePaths.length === 0) {
          return `I couldn't find "${fileName}" inside ${folderPath}.`;
        }
        if (filePaths.length === 1) {
          const opened = await executeTool("screenAutomation", {
            action: "navigate",
            path: filePaths[0]
          });
          this.lastOpenedFilePath = filePaths[0];
          this.rememberNavigatedFolder(folderPath);
          return opened;
        }
        this.pendingSelection = { kind: "open-file", options: filePaths };
        return buildFileChoicePrompt(fileName, filePaths);
      };
      if (folders.length === 1) {
        let reply2;
        try {
          reply2 = await openFromFolder(folders[0]);
        } catch (err) {
          reply2 = `Open file error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      this.pendingSelection = { kind: "navigate-folder", options: folders };
      const reply = `I found multiple folders named "${folderName}":
${folders.map((f, i) => `${i + 1}. ${f}`).join("\n")}
Type 1 to choose the folder first, then I'll open "${fileName}".`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const folderIntent = extractFolderIntent(userMessage);
    if (folderIntent) {
      const { mode, folderName } = folderIntent;
      const folders = findFoldersByName(folderName);
      this.history.push({ role: "user", content: userMessage });
      if (folders.length === 0) {
        const reply2 = `I couldn't find a folder named "${folderName}".`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (mode === "open" && folders.length === 1) {
        let reply2;
        try {
          reply2 = await executeTool("screenAutomation", {
            action: "navigate",
            path: folders[0]
          });
          this.rememberNavigatedFolder(folders[0]);
        } catch (err) {
          reply2 = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      this.pendingSelection = { kind: "navigate-folder", options: folders };
      const reply = mode === "find" ? `I found ${folders.length} folder match(es) for "${folderName}":
${folders.map((f, i) => `${i + 1}. ${f}`).join("\n")}
Type 1 to open the first folder, 2 for the second, and so on.` : buildFolderChoicePrompt(folderName, folders);
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const genericOpenMatch = userMessage.trim().match(/^open\s+(.+)$/i);
    const isRecentDownloadOpen = genericOpenMatch ? /^(?:the\s+)?(?:last(?:ly|est)?\s+downloaded|latest\s+downloaded|most\s+recent(?:ly)?\s+downloaded|recently\s+downloaded)\b/i.test(genericOpenMatch[1].trim()) : false;
    const isFolderOpenText = genericOpenMatch ? /\bfolder\b/i.test(genericOpenMatch[1].trim()) : false;
    const isSimpleOpen = genericOpenMatch ? !isChainedInstruction(genericOpenMatch[1].trim()) : false;
    if (genericOpenMatch && !isRecentDownloadOpen && !isFolderOpenText && isSimpleOpen) {
      const rawTarget = genericOpenMatch[1].trim();
      const target = extractExplicitPathFromText(rawTarget) ?? rawTarget;
      const wantsNewTab = /\bnew\s+tab\b/i.test(target) || /\bnew\s+tab\b/i.test(userMessage);
      const searchTarget = normaliseSearchTarget(target);
      const inferredExtensions = inferExtensionsFromQuery(target);
      this.history.push({ role: "user", content: userMessage });
      const openInBrowserMatch = target.match(/^(.+?)\s+in\s+(?:(?:(?:a|the)\s+)?new\s+tab\s+in\s+)?(chrome|chromium|edge|firefox|safari|browser)$/i);
      if (openInBrowserMatch) {
        const rawSite = openInBrowserMatch[1].trim().replace(/\s+in\s+(?:(?:a|the)\s+)?new\s+tab$/i, "").trim();
        const browserName = openInBrowserMatch[2].trim();
        const url = normaliseWebsiteTarget(rawSite);
        if (!looksLikeWebTarget(url) && !/^[a-z0-9-]+\.[a-z]{2,}$/i.test(url)) {
          const reply3 = `I couldn't identify "${rawSite}" as a website. Please provide a URL like github.com.`;
          this.history.push({ role: "assistant", content: reply3 });
          return reply3;
        }
        let reply2;
        try {
          reply2 = await this.executeBrowserTool({ action: "navigate", url, newTab: wantsNewTab });
          reply2 += ` (requested browser: ${browserName})`;
        } catch (err) {
          reply2 = `Open website error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const explicitAppRequest = /\b(app|application|program|exe)\b/i.test(target);
      if (explicitAppRequest) {
        const appName = target.replace(/\b(open|launch|start|run)\b/ig, " ").replace(/\b(app|application|program|exe)\b/ig, " ").replace(/\s+/g, " ").trim();
        if (!appName) {
          const reply3 = "Please tell me the application name to open.";
          this.history.push({ role: "assistant", content: reply3 });
          return reply3;
        }
        let reply2;
        try {
          reply2 = await executeTool("openApplication", { app: appName });
        } catch (err) {
          reply2 = `Launch error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const settingRequest2 = extractSettingRequest(userMessage);
      if (settingRequest2) {
        let reply2;
        try {
          reply2 = await executeTool("openSettings", { setting: settingRequest2 });
        } catch (err) {
          reply2 = `Open settings error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (isKnownAppTarget(target)) {
        let reply2;
        try {
          reply2 = await executeTool("openApplication", { app: target });
        } catch (err) {
          reply2 = `Launch error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (shouldAskOpenKindClarification(target)) {
        this.pendingOpenClarification = { target };
        const reply2 = `Before I open "${target}", is it an application, folder, file/shortcut, or setting?`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (looksLikeWebTarget(target)) {
        let reply2;
        try {
          reply2 = await this.executeBrowserTool({ action: "navigate", url: target, newTab: wantsNewTab });
        } catch (err) {
          reply2 = `Open website error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      try {
        const resolvedTarget = this.resolveWithinCurrentDirectory(target);
        if (existsSync(resolvedTarget)) {
          const reply2 = await executeTool("screenAutomation", {
            action: "navigate",
            path: resolvedTarget
          });
          if (isLikelyFilePath(resolvedTarget)) {
            this.lastOpenedFilePath = resolvedTarget;
          } else {
            this.rememberNavigatedFolder(resolvedTarget);
          }
          this.history.push({ role: "assistant", content: reply2 });
          return reply2;
        }
      } catch {
      }
      const folderMatches = findFoldersByName(searchTarget);
      if (folderMatches.length === 1) {
        let reply2;
        try {
          reply2 = await executeTool("screenAutomation", { action: "navigate", path: folderMatches[0] });
          this.rememberNavigatedFolder(folderMatches[0]);
        } catch (err) {
          reply2 = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (folderMatches.length > 1) {
        this.pendingSelection = { kind: "navigate-folder", options: folderMatches };
        const reply2 = buildFolderChoicePrompt(target, folderMatches);
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      try {
        const lookup = await executeTool("findFile", {
          query: searchTarget,
          ...this.currentDirectory ? { dir: this.currentDirectory } : {},
          ...inferredExtensions ? { extensions: inferredExtensions } : {},
          sort_by: "recent",
          max_results: 8
        });
        const filePaths = parseFindFilePaths(lookup);
        if (filePaths.length === 1) {
          this.pendingSelection = { kind: "open-file", options: filePaths };
          const reply2 = buildFileChoicePrompt(target, filePaths);
          this.history.push({ role: "assistant", content: reply2 });
          return reply2;
        }
        if (filePaths.length > 1) {
          this.pendingSelection = { kind: "open-file", options: filePaths };
          const reply2 = buildFileChoicePrompt(target, filePaths);
          this.history.push({ role: "assistant", content: reply2 });
          return reply2;
        }
      } catch {
      }
      if (looksLikeAppTarget(target)) {
        try {
          const reply2 = await executeTool("openApplication", { app: target });
          this.history.push({ role: "assistant", content: reply2 });
          return reply2;
        } catch {
        }
      }
      this.pendingOpenClarification = { target };
      const reply = `I couldn't identify "${target}" yet. Is it an application, folder, file/shortcut, or setting?`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const deleteFolderMatch = userMessage.trim().match(/^(?:delete|remove|trash|erase)\s+(?:the\s+)?(.+?)\s+folder(?:\s+.*)?$/i);
    if (deleteFolderMatch) {
      const folderName = deleteFolderMatch[1].trim();
      const folders = findFoldersByName(folderName);
      this.history.push({ role: "user", content: userMessage });
      if (folders.length === 0) {
        const reply2 = `I couldn't find a folder named "${folderName}".`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      if (folders.length === 1) {
        this.pendingConfirmation = { tool: "deleteFile", args: { path: folders[0] } };
        const reply2 = `Are you sure you want to permanently delete "${folders[0]}" and all its contents? (yes / no)`;
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      this.pendingSelection = { kind: "delete-folder", options: folders };
      const lines = folders.map((f, i) => `${i + 1}. ${f}`);
      const reply = `I found multiple folders named "${folderName}". Which one should I delete?
${lines.join("\n")}`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const createFileInCurrentMatch = userMessage.trim().match(/^(?:create|make|new)\s+(?:a\s+)?(?:file|text\s+file|txt\s+file)\s+(?:called|named)?\s*(.+?)\s+in\s+(?:it|this|that|here)$/i);
    if (createFileInCurrentMatch) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.currentDirectory) {
        const reply2 = "I do not have a current folder context yet. Open or navigate to a folder first.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const rawName = createFileInCurrentMatch[1].trim();
      const fileName = /\.[a-z0-9]{1,10}$/i.test(rawName) ? rawName : `${rawName}.txt`;
      const fullPath = join(this.currentDirectory, fileName);
      let reply;
      try {
        reply = await this.executeWithHistory("createFile", { path: fullPath });
      } catch (err) {
        reply = `Create file error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const createFileMatch = userMessage.trim().match(
      /^(?:create|make|new)\s+(?:a\s+)?(?:file|text\s+file|txt\s+file)\s+(?:on|in)\s+(?:the\s+)?([^\s].+?)\s+(?:called|named)?\s*(.+)$/i
    );
    if (createFileMatch) {
      this.history.push({ role: "user", content: userMessage });
      const location = createFileMatch[1].trim();
      const rawName = createFileMatch[2].trim();
      const fileName = /\.[a-z0-9]{1,10}$/i.test(rawName) ? rawName : `${rawName}.txt`;
      const fullPath = join(resolvePath(location), fileName);
      let reply;
      try {
        reply = await this.executeWithHistory("createFile", { path: fullPath });
      } catch (err) {
        reply = `Create file error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const createFolderInCurrentMatch = userMessage.trim().match(/^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:called|named)\s+(.+?)\s+in\s+(?:it|this|that|here)$/i);
    if (createFolderInCurrentMatch) {
      this.history.push({ role: "user", content: userMessage });
      if (!this.currentDirectory) {
        const reply2 = "I do not have a current folder context yet. Open or navigate to a folder first.";
        this.history.push({ role: "assistant", content: reply2 });
        return reply2;
      }
      const folderName = createFolderInCurrentMatch[1].trim();
      const fullPath = join(this.currentDirectory, folderName);
      let reply;
      try {
        reply = await this.executeWithHistory("createDirectory", { path: fullPath });
      } catch (err) {
        reply = `Create folder error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const createFolderMatch = userMessage.trim().match(
      /^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:(?:on|in)\s+(?:the\s+)?)?([^\s].+?)\s+(?:called|named)\s+(.+)$/i
    );
    if (createFolderMatch) {
      const location = createFolderMatch[1].trim();
      const folderName = createFolderMatch[2].trim();
      const fullPath = join(resolvePath(location), folderName);
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await this.executeWithHistory("createDirectory", { path: fullPath });
      } catch (err) {
        reply = `Create folder error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const organizeExeMatch = userMessage.trim().match(
      /^(?:organi[sz]e|move)\s+(?:all\s+)?(?:the\s+)?(?:\.?exe|exe)\s+files?.*\bdownloads\b.*(?:named|called)\s+(.+)$/i
    );
    const organizeExeDefaultMatch = userMessage.trim().match(
      /^(?:organi[sz]e|move)\s+(?:all\s+)?(?:the\s+)?(?:\.?exe|exe)\s+files?.*\bdownloads\b/i
    );
    if (organizeExeMatch || organizeExeDefaultMatch) {
      this.history.push({ role: "user", content: userMessage });
      const targetFolderName = (organizeExeMatch?.[1] ?? "Apps").trim();
      let reply;
      try {
        const downloadsDir = resolvePath("downloads");
        const destinationDir = join(downloadsDir, targetFolderName);
        const destinationExistedBefore = existsSync(destinationDir);
        await executeTool("createDirectory", { path: destinationDir });
        const exeFiles = readdirSync(downloadsDir, { withFileTypes: true }).filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".exe").map((e) => e.name).sort((a, b) => a.localeCompare(b));
        if (exeFiles.length === 0) {
          reply = `No .exe files found in ${downloadsDir}.`;
        } else {
          let moved = 0;
          const movedNames = [];
          const skipped = [];
          const actualMoves = [];
          for (const fileName of exeFiles) {
            const source = join(downloadsDir, fileName);
            const destination = join(destinationDir, fileName);
            try {
              await executeTool("moveFile", {
                source,
                destination,
                create_parent: true
              });
              moved += 1;
              movedNames.push(fileName);
              actualMoves.push({ source, destination });
            } catch {
              skipped.push(fileName);
            }
          }
          if (actualMoves.length > 0) {
            this.undoStack.push({
              description: `organise ${actualMoves.length} .exe file${actualMoves.length !== 1 ? "s" : ""} in Downloads`,
              undo: async () => {
                for (const { source, destination } of [...actualMoves].reverse()) {
                  await mkdir(dirname(source), { recursive: true });
                  await rename(destination, source);
                }
                if (!destinationExistedBefore) {
                  try {
                    await rmdir(destinationDir);
                  } catch {
                  }
                }
              },
              redo: async () => {
                await mkdir(destinationDir, { recursive: true });
                for (const { source, destination } of actualMoves) {
                  await mkdir(dirname(destination), { recursive: true });
                  await rename(source, destination);
                }
              }
            });
          }
          const movedList = movedNames.slice(0, 10).map((n, i) => `${i + 1}. ${n}`).join("\n");
          const skippedText = skipped.length > 0 ? `
Skipped ${skipped.length} file(s) (already exists or locked).` : "";
          reply = `Moved ${moved} .exe file(s) to ${destinationDir}.${skippedText}
${moved > 0 ? `Examples:
${movedList}` : ""}`.trim();
        }
        this.rememberNavigatedFolder(downloadsDir);
      } catch (err) {
        reply = `Organize .exe error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const organizeZipMatch = userMessage.trim().match(
      /^(?:organi[sz]e|move)\s+(?:all\s+)?(?:the\s+)?(?:\.?zip|zip)\s+files?.*(?:named|called)\s+"?([^"\n]+)"?$/i
    );
    const organizeZipDefaultMatch = userMessage.trim().match(
      /^(?:organi[sz]e|move)\s+(?:all\s+)?(?:the\s+)?(?:\.?zip|zip)\s+files?.*$/i
    );
    if (organizeZipMatch || organizeZipDefaultMatch) {
      this.history.push({ role: "user", content: userMessage });
      const targetFolderName = (organizeZipMatch?.[1] ?? "ZIPs").trim();
      let reply;
      try {
        const lower = userMessage.toLowerCase();
        const baseDir = lower.includes("downloads") ? resolvePath("downloads") : this.currentDirectory ?? resolvePath("downloads");
        const destinationDir = join(baseDir, targetFolderName);
        const destinationExistedBefore = existsSync(destinationDir);
        await executeTool("createDirectory", { path: destinationDir });
        const zipFiles = readdirSync(baseDir, { withFileTypes: true }).filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".zip").map((e) => e.name).sort((a, b) => a.localeCompare(b));
        if (zipFiles.length === 0) {
          reply = `No .zip files found in ${baseDir}.`;
        } else {
          let moved = 0;
          const movedNames = [];
          const skipped = [];
          const actualMoves = [];
          for (const fileName of zipFiles) {
            const source = join(baseDir, fileName);
            const destination = join(destinationDir, fileName);
            try {
              await executeTool("moveFile", {
                source,
                destination,
                create_parent: true
              });
              moved += 1;
              movedNames.push(fileName);
              actualMoves.push({ source, destination });
            } catch {
              skipped.push(fileName);
            }
          }
          if (actualMoves.length > 0) {
            this.undoStack.push({
              description: `organise ${actualMoves.length} .zip file${actualMoves.length !== 1 ? "s" : ""} in ${basename(baseDir)}`,
              undo: async () => {
                for (const { source, destination } of [...actualMoves].reverse()) {
                  await mkdir(dirname(source), { recursive: true });
                  await rename(destination, source);
                }
                if (!destinationExistedBefore) {
                  try {
                    await rmdir(destinationDir);
                  } catch {
                  }
                }
              },
              redo: async () => {
                await mkdir(destinationDir, { recursive: true });
                for (const { source, destination } of actualMoves) {
                  await mkdir(dirname(destination), { recursive: true });
                  await rename(source, destination);
                }
              }
            });
          }
          const movedList = movedNames.slice(0, 10).map((n, i) => `${i + 1}. ${n}`).join("\n");
          const skippedText = skipped.length > 0 ? `
Skipped ${skipped.length} file(s) (already exists or locked).` : "";
          reply = `Moved ${moved} .zip file(s) to ${destinationDir}.${skippedText}
${moved > 0 ? `Examples:
${movedList}` : ""}`.trim();
        }
        this.rememberNavigatedFolder(baseDir);
      } catch (err) {
        reply = `Organize .zip error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const navigateMatch = userMessage.trim().match(
      /^(?:navigate\s+to|go\s+to|show(?:\s+me)?)\s+(?:the\s+)?([^\s].+?)(?:\s+folder)?$/i
    );
    const FOLDER_ALIASES = new Set(defaultNavigateAliases());
    if (navigateMatch) {
      const target = navigateMatch[1].trim().toLowerCase().replace(/\s+/g, "");
      const isKnownFolder = FOLDER_ALIASES.has(target) || /^[a-z]:[\\\/]/i.test(navigateMatch[1].trim()) || navigateMatch[1].trim().startsWith("/");
      if (isKnownFolder) {
        this.history.push({ role: "user", content: userMessage });
        let reply;
        try {
          reply = await executeTool("screenAutomation", {
            action: "navigate",
            path: navigateMatch[1].trim()
          });
          this.rememberNavigatedFolder(navigateMatch[1].trim());
        } catch (err) {
          reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
    }
    const openLastDownloadedMatch = userMessage.trim().match(
      /^open\s+(?:the\s+)?(?:last(?:ly|est)?\s+downloaded|latest\s+downloaded|most\s+recent(?:ly)?\s+downloaded|recently\s+downloaded)\s+(.+)$/i
    );
    if (openLastDownloadedMatch) {
      const typeHint = openLastDownloadedMatch[1].trim().toLowerCase();
      const TYPE_EXT_MAP = {
        image: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif", ".tiff", ".svg"],
        photo: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif"],
        picture: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif"],
        video: [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"],
        audio: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"],
        pdf: [".pdf"],
        document: [".pdf", ".docx", ".doc", ".txt", ".odt", ".rtf"],
        zip: [".zip", ".rar", ".7z", ".tar", ".gz"],
        archive: [".zip", ".rar", ".7z", ".tar", ".gz"],
        exe: [".exe", ".msi"],
        installer: [".exe", ".msi"]
      };
      const allowedExts = TYPE_EXT_MAP[typeHint] ?? null;
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        const downloadsDir = resolvePath("downloads");
        const entries = readdirSync(downloadsDir, { withFileTypes: true });
        const files = entries.filter((e) => {
          if (!e.isFile()) return false;
          if (!allowedExts) return true;
          return allowedExts.includes(extname(e.name).toLowerCase());
        }).map((e) => ({
          name: e.name,
          mtime: statSync(join(downloadsDir, e.name)).mtimeMs
        })).sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) {
          reply = allowedExts ? `No ${typeHint} files found in Downloads.` : "Downloads folder is empty.";
        } else {
          const newest = files[0];
          reply = await executeTool("screenAutomation", {
            action: "navigate",
            path: "downloads",
            file: newest.name
          });
          reply = `Opening latest downloaded ${typeHint}: "${newest.name}"
${reply}`;
        }
      } catch (err) {
        reply = `Error opening last downloaded ${typeHint}: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const listDownloadedMatch = userMessage.trim().match(
      /^(?:list|show(?:\s+me)?)\s+(?:the\s+)?(?:files\s+)?(?:downloaded\s+)?(?:in\s+)?(last_week|last_month|last_3_months|last_year|last\s+week|last\s+month|last\s+3\s+months|last\s+year)\s+(?:downloaded\s+)?files?$/i
    );
    if (listDownloadedMatch) {
      this.history.push({ role: "user", content: userMessage });
      const rawSince = (listDownloadedMatch[1] ?? "").toLowerCase().replace(/\s+/g, "_");
      const sinceDate = resolveSinceDate(rawSince);
      let reply;
      if (!sinceDate) {
        reply = "I could not parse the requested time window. Try: last week, last month, last 3 months, or last year.";
      } else {
        try {
          const downloadsDir = resolvePath("downloads");
          const entries = readdirSync(downloadsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => {
            const full = join(downloadsDir, e.name);
            const mtime = statSync(full).mtime;
            return { name: e.name, full, mtime };
          }).filter((f) => f.mtime >= sinceDate).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
          this.rememberNavigatedFolder(downloadsDir);
          if (entries.length === 0) {
            reply = `No downloaded files found since ${sinceDate.toLocaleDateString()} in ${downloadsDir}.`;
          } else {
            this.lastListedEntries = entries.map((e) => ({ path: e.full, isDirectory: false }));
            const top = entries.slice(0, 25);
            const lines = top.map((f, i) => `${i + 1}. ${f.name}`);
            const more = entries.length > top.length ? `
...and ${entries.length - top.length} more file(s).` : "";
            reply = `Downloaded files since ${sinceDate.toLocaleDateString()} in ${downloadsDir}:
${lines.join("\n")}${more}`;
          }
        } catch (err) {
          reply = `List downloads error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const settingRequest = extractSettingRequest(userMessage);
    if (settingRequest) {
      this.history.push({ role: "user", content: userMessage });
      let reply;
      try {
        reply = await executeTool("openSettings", { setting: settingRequest });
      } catch (err) {
        reply = `Open settings error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const batteryStatusMatch = userMessage.trim().match(/^(?:what(?:'?s|\s+is)?|show(?:\s+me)?|tell\s+me|check)\s+(?:the\s+)?battery(?:\s+(?:status|level|percentage|percent|charge))?\??$|^battery\s+(?:status|level|percentage|percent|charge)\??$/i);
    if (batteryStatusMatch) {
      this.history.push({ role: "user", content: userMessage });
      const reply = await getBatteryStatus();
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    const launchMatch = userMessage.trim().match(/^(?:open|launch|start|run)\s+([a-z0-9][a-z0-9 _.-]{0,40})$/i);
    if (launchMatch) {
      const appName = launchMatch[1].trim().toLowerCase();
      const SENTENCE_WORDS = /\b(?:the|a|an|my|this|that|last(?:ly|est)?|latest|recent(?:ly)?|downloaded|file|image|photo|video|document|folder|from|in|on|to)\b/i;
      const FILE_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|odt|rtf|mp4|mkv|avi|mov|wmv|mp3|flac|aac|jpg|jpeg|png|gif|webp|zip|rar|7z|exe|msi|iso)$/i;
      if (!SENTENCE_WORDS.test(appName) && !FILE_EXT.test(appName)) {
        this.history.push({ role: "user", content: userMessage });
        let reply;
        try {
          reply = await executeTool("openApplication", { app: appName });
        } catch (err) {
          reply = `Launch error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: "assistant", content: reply });
        return reply;
      }
    }
    const bareTarget = userMessage.trim();
    const startsWithCommand = /^(?:open|launch|start|run|create|make|new|delete|remove|trash|erase|move|rename|list|show|navigate|go|cd|undo|redo|help|search|find|write|type|send|export|download)\b/i.test(bareTarget);
    const looksLikeBareName = /^[a-z0-9][a-z0-9 _.-]{0,60}$/i.test(bareTarget) && /[a-z]/i.test(bareTarget);
    if (!this.pendingConfirmation && !startsWithCommand && looksLikeBareName && shouldAskOpenKindClarification(bareTarget)) {
      this.history.push({ role: "user", content: userMessage });
      this.pendingOpenClarification = { target: bareTarget };
      const reply = `Do you want me to open "${bareTarget}" as an application, folder, file/shortcut, or setting?`;
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    if (MOCK_MODE) {
      const reply = `[mock] You said: "${userMessage}"`;
      this.history.push({ role: "user", content: userMessage });
      this.history.push({ role: "assistant", content: reply });
      return reply;
    }
    try {
      const result = await this.agentLoop.run(userMessage, this.history, (step) => {
        onStep?.(step);
      });
      this.history = result.messages;
      return result.finalResponse;
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Unknown error communicating with Ollama"
      );
    }
  }
  /** Clear the conversation history and undo stack to start a fresh session. */
  
  getPendingConfirmation() {
    return this.pendingConfirmation;
  }

  getPendingSelection() {
    return this.pendingSelection;
  }

  reset() {
    this.history = [];
    this.pendingConfirmation = null;
    this.pendingSelection = null;
    this.pendingOpenClarification = null;
    this.pendingContextSwitch = null;
    this.browserContextActive = false;
    this.undoStack.clear();
    this.lastSavedIdx = 0;
  }
  /** Read-only snapshot of the current conversation history. */
  get turns() {
    return this.history;
  }
}
