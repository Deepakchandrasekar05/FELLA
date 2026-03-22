// screenAutomation.ts — Mouse, keyboard and screen control.
//
// actionLaunch uses PowerShell keybd_event (no native addon) so it works
// inside the caxa exe without any external dependencies.
// All other actions (screenshot, OCR, click, type…) use nut-js loaded lazily.

import { execa } from 'execa';
import { spawn } from 'node:child_process';
import { existsSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolvePath } from '../security/pathGuard.js';

// Type-only imports — erased at compile time, zero runtime cost
import type {
  Button as ButtonType,
  Key as KeyType,
} from '@nut-tree-fork/nut-js';

// â”€â”€ Lazy loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Caches the resolved module so the dynamic import only runs once.

type NutModule = typeof import('@nut-tree-fork/nut-js');

let _nut: NutModule | null = null;

async function loadNut(): Promise<NutModule> {
  if (_nut) return _nut;

  try {
    // Dynamic createRequire — avoids conflicts with esbuild banner's
    // top-level `import{createRequire}from'module'` declaration.
    const { createRequire: mkRequire } = await import('node:module');
    const req = mkRequire(import.meta.url);
    _nut = req('@nut-tree-fork/nut-js') as NutModule;
  } catch (err) {
    throw new Error(
      `Screen automation is unavailable: the nut-js native addon could not be loaded.\n` +
      `Run from source (npx tsx src/index.tsx) or place @nut-tree-fork/nut-js next to the exe.\n` +
      `Underlying error: ${err}`,
    );
  }

  // â”€â”€ Visual-feedback config â€” applied once on first load â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _nut.screen.config.autoHighlight      = true;  // highlight box on every find()
  _nut.screen.config.highlightDurationMs = 600;  // box stays for 600 ms
  _nut.screen.config.highlightOpacity   = 0.7;  // semi-transparent overlay
  _nut.mouse.config.mouseSpeed          = 800;  // px/s â€” visible glide, not instant

  return _nut;
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function resolveButton(nut: NutModule, btnStr: string): ButtonType {
  if (btnStr === 'right')  return nut.Button.RIGHT;
  if (btnStr === 'middle') return nut.Button.MIDDLE;
  return nut.Button.LEFT;
}

function buildKeyMap(Key: typeof KeyType): Record<string, KeyType> {
  return {
    enter:     Key.Return,
    return:    Key.Return,
    escape:    Key.Escape,
    esc:       Key.Escape,
    tab:       Key.Tab,
    space:     Key.Space,
    backspace: Key.Backspace,
    delete:    Key.Delete,
    up:        Key.Up,
    down:      Key.Down,
    left:      Key.Left,
    right:     Key.Right,
    home:      Key.Home,
    end:       Key.End,
    pageup:    Key.PageUp,
    pagedown:  Key.PageDown,
    f1:  Key.F1,  f2:  Key.F2,  f3:  Key.F3,  f4:  Key.F4,
    f5:  Key.F5,  f6:  Key.F6,  f7:  Key.F7,  f8:  Key.F8,
    f9:  Key.F9,  f10: Key.F10, f11: Key.F11, f12: Key.F12,
    // Modifier keys
    ctrl:      Key.LeftControl,
    control:   Key.LeftControl,
    shift:     Key.LeftShift,
    alt:       Key.LeftAlt,
    win:       Key.LeftWin,
    windows:   Key.LeftWin,
    super:     Key.LeftSuper,
    meta:      Key.LeftMeta,
    // Letters — used for hotkeys like ctrl+c, ctrl+v, win+r
    a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E,
    f: Key.F, g: Key.G, h: Key.H, i: Key.I, j: Key.J,
    k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O,
    p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T,
    u: Key.U, v: Key.V, w: Key.W, x: Key.X, y: Key.Y,
    z: Key.Z,
  };
}

/** Friendly app name → executable accepted by the Windows Run dialog (Win+R). */
const RUN_DIALOG_MAP: Record<string, string> = {
  notepad:          'notepad',
  calculator:       'calc',
  calc:             'calc',
  paint:            'mspaint',
  explorer:         'explorer',
  vscode:           'code',
  code:             'code',
  terminal:         'wt',
  powershell:       'powershell',
  chrome:           'chrome',
  browser:          'msedge',
  wordpad:          'write',
  // Edge aliases — all map to the msedge Run-dialog command
  edge:             'msedge',
  msedge:           'msedge',
  'microsoft edge': 'msedge',
  microsoftedge:    'msedge',
  // Other common apps
  firefox:          'firefox',
  excel:            'excel',
  word:             'winword',
  winword:          'winword',
  powerpoint:       'powerpnt',
  powerpnt:         'powerpnt',
  outlook:          'outlook',
  taskmgr:          'taskmgr',
  regedit:          'regedit',
  cmd:              'cmd',
};

const NON_WINDOWS_APP_MAP: Record<string, { darwin?: string; linux?: string }> = {
  notepad: { darwin: 'TextEdit', linux: 'gedit' },
  calculator: { darwin: 'Calculator', linux: 'gnome-calculator' },
  calc: { darwin: 'Calculator', linux: 'gnome-calculator' },
  explorer: { darwin: 'Finder', linux: 'nautilus' },
  terminal: { darwin: 'Terminal', linux: 'x-terminal-emulator' },
  chrome: { darwin: 'Google Chrome', linux: 'google-chrome' },
  browser: { darwin: 'Safari', linux: 'xdg-open' },
  vscode: { darwin: 'Visual Studio Code', linux: 'code' },
};

async function openPathWithDefault(pathOrUri: string): Promise<void> {
  if (process.platform === 'win32') {
    const isShellUri = /^shell:/i.test(pathOrUri) || /^control$/i.test(pathOrUri);
    const exists = existsSync(pathOrUri);
    const isDirectory = exists ? statSync(pathOrUri).isDirectory() : false;

    if (isShellUri || isDirectory) {
      const child = spawn('explorer.exe', [pathOrUri], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
      });
      child.unref();
      return;
    }

    const child = spawn('cmd', ['/c', 'start', '', pathOrUri], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    await execa('open', [pathOrUri], { reject: false });
    return;
  }
  await execa('xdg-open', [pathOrUri], { reject: false });
}

/** Find text on screen with OCR. Tries single-word match first, then full-line. */
async function locateText(nut: NutModule, text: string): Promise<{ x: number; y: number }> {
  const words = text.trim().split(/\s+/);
  const query = words.length === 1 ? nut.singleWord(text) : nut.textLine(text);
  const region = await nut.screen.find(query);
  return nut.centerOf(region);
}

// â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** System directory names that must never be launched or opened as apps. */
const BLOCKED_SYSTEM_APPS = new Set([
  'program files', 'program files (x86)',
  'programfiles',  'programfiles(x86)',
  'windows',       'system32', 'syswow64', 'sysarm32',
  'programdata',   'winsxs',   'servicing',
  'system volume information', 'recovery', 'boot',
]);

async function actionLaunch(app: string): Promise<string> {
  if (process.platform !== 'win32') {
    const appLower = app.toLowerCase().trim();
    const mapped = NON_WINDOWS_APP_MAP[appLower];

    if (process.platform === 'darwin') {
      const target = mapped?.darwin ?? app;
      await execa('open', ['-a', target], { reject: false, detached: true, stdio: 'ignore' });
      return `Launched "${target}"`;
    }

    const target = mapped?.linux ?? app;
    if (target === 'xdg-open') {
      await execa('xdg-open', ['https://'], { reject: false, detached: true, stdio: 'ignore' });
    } else {
      await execa(target, [], { reject: false, detached: true, stdio: 'ignore' });
    }
    return `Launched "${target}"`;
  }

  const appLower = app.toLowerCase().trim();

  // Hard block — never launch system directories
  if (
    BLOCKED_SYSTEM_APPS.has(appLower) ||
    appLower.startsWith('c:\\windows') ||
    appLower.startsWith('c:\\program files')
  ) {
    throw new Error(
      `⛔ Access denied: Cannot open or launch system directories.\n` +
      `"${app}" is a protected system location (Windows, Program Files, ProgramData, etc.).\n` +
      `I can only open applications and user files — not system folders.`,
    );
  }

  const executable = RUN_DIALOG_MAP[appLower] ?? app;

  // ── Step 1: search Start Menu for a matching .lnk shortcut ────────────────
  // This handles apps like "PC Remote Receiver" that are not PATH commands.
  // We search both the user Start Menu and the system-wide one, ranked by how
  // closely the shortcut name matches the requested name.
  const safeApp = app.replace(/'/g, "''");
  const searchScript = [
    `$name = '${safeApp}'`,
    `$dirs = @(`,
    `  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",`,
    `  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"`,
    `)`,
    `$lnk = Get-ChildItem -Path $dirs -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |`,
    `  Where-Object { $_.BaseName -like "*$name*" } |`,
    `  Sort-Object { ($_.BaseName -replace '[^a-z0-9]','').Length } |`,
    `  Select-Object -First 1`,
    `if ($lnk) { Write-Output $lnk.FullName } else { Write-Output '' }`,
  ].join('\r\n');

  const searchTmp = join(tmpdir(), `fella-search-${Date.now()}.ps1`);
  writeFileSync(searchTmp, searchScript, 'utf8');
  let lnkPath = '';
  try {
    const { stdout } = await execa('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', searchTmp,
    ]);
    lnkPath = stdout.trim();
  } finally {
    try { unlinkSync(searchTmp); } catch { /* ignore */ }
  }

  if (lnkPath) {
    // Found a Start Menu shortcut — launch it directly (no Win+R dialog needed).
    const safeLnk = lnkPath.replace(/'/g, "''");
    const launchScript = `Start-Process '${safeLnk}'`;
    const launchTmp = join(tmpdir(), `fella-launch-${Date.now()}.ps1`);
    writeFileSync(launchTmp, launchScript, 'utf8');
    try {
      await execa('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launchTmp,
      ]);
    } finally {
      try { unlinkSync(launchTmp); } catch { /* ignore */ }
    }
    return `Launched "${app}" via Start Menu shortcut`;
  }

  // ── Step 2: fall back to Win+R for known shell commands and .exe names ─────
  const script = [
    `$sh = New-Object -ComObject Shell.Application`,
    `$sh.FileRun()`,
    `Start-Sleep -Milliseconds 700`,
    `Add-Type -AssemblyName System.Windows.Forms`,
    `[System.Windows.Forms.SendKeys]::SendWait('${executable}')`,
    `Start-Sleep -Milliseconds 250`,
    `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`,
  ].join('\r\n');

  const tmp = join(tmpdir(), `fella-launch-${Date.now()}.ps1`);
  writeFileSync(tmp, script, 'utf8');
  try {
    await execa('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp,
    ]);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }

  return `Launched "${app}" via Win+R → "${executable}" → Enter`;
}

async function actionScreenshot(nut: NutModule): Promise<string> {
  const [w, h, savedPath] = await Promise.all([
    nut.screen.width(),
    nut.screen.height(),
    nut.screen.capture(`fella-screenshot-${Date.now()}`),
  ]);
  return `Screenshot captured â€” ${w}Ã—${h} px â†’ ${savedPath}`;
}

async function actionFindText(nut: NutModule, target: string): Promise<string> {
  const pt = await locateText(nut, target);
  return `Found "${target}" at (${Math.round(pt.x)}, ${Math.round(pt.y)})`;
}

async function actionMove(
  nut: NutModule,
  args: Record<string, unknown>,
): Promise<string> {
  const target = args['target'];

  if (typeof target === 'string' && target.trim()) {
    const pt = await locateText(nut, target);
    await nut.mouse.move(nut.straightTo(pt));
    return `Cursor moved to "${target}" at (${Math.round(pt.x)}, ${Math.round(pt.y)})`;
  }

  const x = Number(args['x'] ?? 0);
  const y = Number(args['y'] ?? 0);
  await nut.mouse.move(nut.straightTo(new nut.Point(x, y)));
  return `Cursor moved to (${x}, ${y})`;
}

async function actionClick(
  nut: NutModule,
  args: Record<string, unknown>,
): Promise<string> {
  const btnStr = String(args['button'] ?? 'left');
  const btn    = resolveButton(nut, btnStr);
  const target = args['target'];

  if (typeof target === 'string' && target.trim()) {
    const pt = await locateText(nut, target);
    await nut.mouse.move(nut.straightTo(pt));
    await nut.mouse.click(btn);
    return `${btnStr}-clicked "${target}" at (${Math.round(pt.x)}, ${Math.round(pt.y)})`;
  }

  if (args['x'] !== undefined && args['y'] !== undefined) {
    const x = Number(args['x']);
    const y = Number(args['y']);
    await nut.mouse.move(nut.straightTo(new nut.Point(x, y)));
    await nut.mouse.click(btn);
    return `${btnStr}-clicked at (${x}, ${y})`;
  }

  await nut.mouse.click(btn);
  return `${btnStr}-clicked at current cursor position`;
}

async function actionDoubleClick(
  nut: NutModule,
  args: Record<string, unknown>,
): Promise<string> {
  const btnStr = String(args['button'] ?? 'left');
  const btn    = resolveButton(nut, btnStr);
  const target = args['target'];

  if (typeof target === 'string' && target.trim()) {
    const pt = await locateText(nut, target);
    await nut.mouse.move(nut.straightTo(pt));
    await nut.mouse.doubleClick(btn);
    return `Double-clicked "${target}" at (${Math.round(pt.x)}, ${Math.round(pt.y)})`;
  }

  if (args['x'] !== undefined && args['y'] !== undefined) {
    const x = Number(args['x']);
    const y = Number(args['y']);
    await nut.mouse.move(nut.straightTo(new nut.Point(x, y)));
    await nut.mouse.doubleClick(btn);
    return `Double-clicked at (${x}, ${y})`;
  }

  await nut.mouse.doubleClick(btn);
  return `Double-clicked at current cursor position`;
}

async function actionType(nut: NutModule, text: string): Promise<string> {
  await nut.keyboard.type(text);
  const preview = text.length > 40 ? `${text.slice(0, 40)}â€¦` : text;
  return `Typed: "${preview}"`;
}

async function actionKey(nut: NutModule, keyName: string): Promise<string> {
  const keyMap = buildKeyMap(nut.Key);
  const mapped = keyMap[keyName.toLowerCase()];
  if (!mapped) {
    throw new Error(
      `Unknown key "${keyName}". Supported: ${Object.keys(keyMap).join(', ')}`,
    );
  }
  await nut.keyboard.pressKey(mapped);
  await nut.keyboard.releaseKey(mapped);
  return `Pressed key: ${keyName}`;
}

async function actionHotkey(nut: NutModule, keys: string[]): Promise<string> {
  const keyMap = buildKeyMap(nut.Key);
  const mapped = keys.map((k) => {
    const m = keyMap[k.toLowerCase()];
    if (!m) throw new Error(`Unknown key "${k}" in hotkey combination`);
    return m;
  });
  // Press all, then release in reverse â€” classic hotkey pattern
  for (const k of mapped)           await nut.keyboard.pressKey(k);
  for (const k of [...mapped].reverse()) await nut.keyboard.releaseKey(k);
  return `Pressed hotkey: ${keys.join('+')}`;
}

async function actionScroll(
  nut: NutModule,
  direction: 'up' | 'down',
  amount: number,
): Promise<string> {
  for (let i = 0; i < amount; i++) {
    if (direction === 'down') await nut.mouse.scrollDown(1);
    else                      await nut.mouse.scrollUp(1);
  }
  return `Scrolled ${direction} ${amount} step${amount !== 1 ? 's' : ''}`;
}

/**
 * Windows shell: virtual folder names that have no real filesystem path.
 * explorer.exe / cmd start accept these shell: URIs natively.
 */
const SHELL_VIRTUAL_FOLDERS: Record<string, string> = {
  'recycle bin':   'shell:RecycleBinFolder',
  'recyclebin':    'shell:RecycleBinFolder',
  'trash':         'shell:RecycleBinFolder',
  'this pc':       'shell:MyComputerFolder',
  'thispc':        'shell:MyComputerFolder',
  'my computer':   'shell:MyComputerFolder',
  'mycomputer':    'shell:MyComputerFolder',
  'control panel': 'control',
  'controlpanel':  'control',
  'network':       'shell:NetworkPlacesFolder',
};

/**
 * Navigate Windows Explorer to a folder, then optionally open a file inside.
 *
 * Flow:
 *  1. Open Explorer to the resolved folder with `explorer.exe <path>`.
 *     Virtual shell folders (Recycle Bin, This PC, …) are resolved via the
 *     SHELL_VIRTUAL_FOLDERS table and opened with their shell: URI.
 *  2. If `file` is supplied: open the file directly with its default application
 *     using `cmd /c start "" <filePath>` — reliable for all file types.
 */
async function actionNavigate(
  args: Record<string, unknown>,
): Promise<string> {
  const rawPath = String(args['path'] ?? args['folder'] ?? args['target'] ?? '');
  if (!rawPath) throw new Error('"path" is required for navigate action');

  // Hard block — reject system directory names before any path resolution
  const rawLower = rawPath.toLowerCase().trim();
  const isSystemPath =
    BLOCKED_SYSTEM_APPS.has(rawLower) ||
    /^[a-z]:[/\\]windows([/\\]|$)/i.test(rawPath) ||
    /^[a-z]:[/\\]program files/i.test(rawPath) ||
    /^[a-z]:[/\\]programdata/i.test(rawPath);
  if (isSystemPath) {
    throw new Error(
      `⛔ Access denied: Cannot navigate to system directories.\n` +
      `"${rawPath}" is a protected system location.\n` +
      `I can only navigate to user folders (Documents, Downloads, Desktop, etc.) and D:\.`,
    );
  }

  // If path itself is a full file path (has a file extension), open it directly.
  const FILE_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|mp4|mkv|avi|mov|wmv|mp3|flac|jpg|jpeg|png|gif|webp|zip|rar|7z|exe|msi|iso|odt|rtf)$/i;
  if (FILE_EXT.test(rawPath.trim()) && !args['file']) {
    const resolvedFile = resolvePath(rawPath);
    await openPathWithDefault(resolvedFile);
    return `Opened "${resolvedFile}" with its default application`;
  }

  // Resolve virtual shell folders before hitting the filesystem path guard.
  const shellPath = SHELL_VIRTUAL_FOLDERS[rawPath.trim().toLowerCase()];
  const folderPath = shellPath ?? resolvePath(rawPath);
  const fileName   = args['file'] ? String(args['file']).trim() : undefined;

  // Open file manager to the folder
  await openPathWithDefault(folderPath);

  if (fileName) {
    const filePath = join(folderPath, fileName);

    // Brief pause so Explorer has time to open, then launch the file
    // with its default associated application.
    await new Promise<void>((r) => setTimeout(r, 600));
    await openPathWithDefault(filePath);

    return `Navigated Explorer to "${folderPath}" and opened "${fileName}"`;
  }

  return `Navigated to "${folderPath}"`;
}

async function actionCloseFolder(args: Record<string, unknown>): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('close_folder is currently supported on Windows only');
  }

  const rawPath = String(args['path'] ?? '').trim();
  const normalizedPath = rawPath
    ? rawPath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    : '';

  const safePath = normalizedPath.replace(/'/g, "''");
  const script = [
    `$target = '${safePath}'`,
    `$shell = New-Object -ComObject Shell.Application`,
    `$wins = @($shell.Windows())`,
    `$closed = 0`,
    `foreach ($w in $wins) {`,
    `  try {`,
    `    $name = [string]$w.FullName`,
    `    if (-not $name.ToLower().EndsWith('explorer.exe')) { continue }`,
    `    $loc = [string]$w.LocationURL`,
    `    if ([string]::IsNullOrWhiteSpace($loc)) { continue }`,
    `    $localPath = $null`,
    `    try { $localPath = [uri]::UnescapeDataString(($loc -replace '^file:///', '')) } catch { $localPath = $null }`,
    `    if ($localPath) { $localPath = ($localPath -replace '/', '\\').TrimEnd('\\').ToLower() }`,
    `    if ([string]::IsNullOrEmpty($target) -or ($localPath -eq $target)) {`,
    `      $w.Quit()`,
    `      $closed++`,
    `    }`,
    `  } catch { }`,
    `}`,
    `Write-Output $closed`,
  ].join('\r\n');

  const tmpScript = join(tmpdir(), `fella-close-folder-${Date.now()}.ps1`);
  writeFileSync(tmpScript, script, 'utf8');
  try {
    const { stdout } = await execa('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      tmpScript,
    ]);
    const closed = Number.parseInt(stdout.trim(), 10);
    if (Number.isFinite(closed) && closed > 0) {
      return rawPath
        ? `Closed folder window for "${rawPath}".`
        : `Closed ${closed} Explorer window(s).`;
    }
    return rawPath
      ? `No open Explorer window found for "${rawPath}".`
      : 'No open Explorer window found to close.';
  } finally {
    try { unlinkSync(tmpScript); } catch { /* ignore */ }
  }
}

// â”€â”€ Public tool handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Screen-automation tool.
 *
 * args:
 *   action     — required: screenshot | find_text | move | click | double_click
 *                           | type | key | hotkey | scroll | navigate | close_folder
 *   target     — text to locate with OCR (for find_text / move / click)
 *   x, y       — pixel coordinates (for move / click)
 *   text       — string to type (for type action)
 *   key        — key name e.g. "enter" (for key action)
 *   keys       — array of key names for hotkey e.g. ["ctrl","c"]
 *   button     — "left" | "right" | "middle" (for click / double_click)
 *   direction  — "up" | "down" (for scroll)
 *   amount     — number of scroll steps (for scroll, default 3)
 *   path       — folder path alias or absolute path (for navigate)
 *   file       — filename to open after navigating (for navigate, optional)
 *   path       — optional folder path to close the matching Explorer window (for close_folder)
 */
export async function screenAutomation(
  args: Record<string, unknown>,
): Promise<string> {
  const action = (
    String(args['action'] ?? '').trim().toLowerCase()
    // If the LLM calls openApplication-style with just {app} and no action,
    // default to the visible launch sequence.
    || (args['app'] ? 'launch' : '')
  );

  try {
    switch (action) {
      case 'launch':
      case 'open': {
        const app = String(args['app'] ?? args['target'] ?? '');
        if (!app) throw new Error('"app" is required for launch action');
        return await actionLaunch(app);  // PowerShell-based, no nut-js needed
      }

      case 'screenshot': {
        const nut = await loadNut();
        return await actionScreenshot(nut);
      }

      case 'find_text': {
        const nut = await loadNut();
        const target = String(args['target'] ?? '');
        if (!target) throw new Error('"target" is required for find_text');
        return await actionFindText(nut, target);
      }

      case 'move': {
        const nut = await loadNut();
        return await actionMove(nut, args);
      }

      case 'click': {
        const nut = await loadNut();
        return await actionClick(nut, args);
      }

      case 'double_click': {
        const nut = await loadNut();
        return await actionDoubleClick(nut, args);
      }

      case 'type': {
        const nut = await loadNut();
        const text = String(args['text'] ?? '');
        if (!text) throw new Error('"text" is required for type action');
        return await actionType(nut, text);
      }

      case 'key': {
        const nut = await loadNut();
        const keyName = String(args['key'] ?? '');
        if (!keyName) throw new Error('"key" is required for key action');
        return await actionKey(nut, keyName);
      }

      case 'hotkey': {
        const nut = await loadNut();
        const raw = args['keys'];
        const keys: string[] = Array.isArray(raw)
          ? raw.map(String)
          : String(raw ?? '').split('+').map((k) => k.trim());
        if (!keys.length) throw new Error('"keys" is required for hotkey action');
        return await actionHotkey(nut, keys);
      }

      case 'scroll': {
        const nut = await loadNut();
        const dir    = String(args['direction'] ?? 'down') as 'up' | 'down';
        const amount = Math.max(1, Number(args['amount'] ?? 3));
        return await actionScroll(nut, dir, amount);
      }

      case 'navigate':
      case 'goto':
      case 'open_folder': {
        // No nut-js needed for basic navigation; OCR step handled inside if file is given
        return await actionNavigate(args);
      }

      case 'close_folder': {
        return await actionCloseFolder(args);
      }

      default:
        throw new Error(
          `Unknown action "${action}". Valid actions: ` +
          'launch, screenshot, find_text, move, click, double_click, type, key, hotkey, scroll, navigate, close_folder',
        );
    }
  } catch (err) {
    return `screenAutomation error (${action}): ${err instanceof Error ? err.message : String(err)}`;
  }
}
