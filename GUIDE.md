# FELLA CLI — Deep Implementation Guide (Teacher Edition)

File Exploration and Local Logic Automation.

This document is a “how it works + how to extend it” guide for the FELLA CLI in this repo. It focuses on the real implementation (UI → engine → LLM → tools → safety → persistence), the important design choices, and the practical tradeoffs.

If you want the mental model in one sentence:

FELLA is a terminal chat app (Ink/React) that converts user intent into strict JSON tool calls (Groq via OpenAI-compatible API with optional local Ollama fallback), executes those tools under a cross-platform path-safety policy, streams tool steps live, and persists visible session history + run traces into local SQLite.

---

## 0) Prerequisites

- Node.js `>= 18` (required by `package.json`)
- Windows is the primary target (some parts are cross-platform)
- LLM: `GROQ_API_KEY` (required for normal operation)
- Auth: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (required)
- Browser automation: an installed Chrome or Edge (FELLA attaches over CDP)
- Optional: local Ollama at `http://127.0.0.1:11434` for fallback

---

## 1) Tech Stack (What’s used and why)

### 1.1 Runtime

- TypeScript + Node.js (ESM project: `"type": "module"`)
- Ink + React: a React renderer for the terminal UI

### 1.2 Network services

- Groq LLM: called via the `openai` npm package (OpenAI-compatible endpoint)
- Supabase Auth: email/password + Google OAuth (PKCE)

### 1.3 Local persistence

- SQLite via `better-sqlite3`: sessions + turn history + “facts” + run traces

### 1.4 Automation

- Screen automation: PowerShell + Explorer integration, plus optional nut-js OCR/mouse/keyboard
- Browser automation: Playwright controlling a real Chrome/Edge session via CDP

### 1.5 Build and packaging

- `tsc --noEmit`: typecheck only
- `esbuild`: bundles the app to `dist/index.js`
- `caxa`: packages `dist/` into an executable on Windows
- SEA scripts exist as an alternate packaging route

---

## 2) Repo Structure (Where to look)

High-signal areas:

```text
src/
  index.tsx              Entry point (dotenv + CLI commands + render Ink UI)
  ui/                    Ink/React UI
  execution/engine.ts    Deterministic routing + confirmation + tool dispatch + persistence
  agent/loop.ts          Multi-step tool-using loop (ReAct-style)
  llm/
    client.ts            Groq primary + Ollama fallback routing
    ollama.ts            Groq client + system prompt (JSON-only tool protocol)
    schema.ts            Zod schemas for JSON payloads & tool calls
  tools/                 Tool implementations (file ops + automation)
  security/pathGuard.ts  Path alias resolution + allow/block policy
  memory/
    store.ts             SQLite persistence (sessions + memory + facts)
    context.ts           Context injection (guide snippet + facts + recall)
  auth/                  Supabase auth flows + token storage

scripts/                 Build + packaging scripts (bundle, predist, SEA)
assets/                  Icons/logos used in packaging
bin/                     Packaged binaries output
```

Files created on a user machine:

- `%USERPROFILE%\.fella\auth.json` (Supabase tokens)
- `%USERPROFILE%\.fella\memory.db` (SQLite)
- `%USERPROFILE%\.fella\chrome-debug-profile\` (Chrome/Edge debug profile)
- `%USERPROFILE%\.fella\screenshots\` (browser screenshots)
- `%TEMP%\.fella-trash\` (engine soft-delete staging)

---

## 3) End-to-End Request Lifecycle

When the user types a message in the TUI:

```text
Ink UI (src/ui/App.tsx)
  -> Engine.send(userMessage) (src/execution/engine.ts)
     -> deterministic shortcut? (fast path)
        OR
     -> AgentLoop.run(...) (src/agent/loop.ts)
        -> LLMClient.chat(...) (src/llm/client.ts)
           -> Groq primary (src/llm/ollama.ts)
           -> Ollama fallback (src/llm/ollama.ts + src/llm/client.ts)
        -> registry.execute(tool,args) (src/tools/registry.ts)
        -> tool implementation (src/tools/*.ts)
     -> persist visible turns (src/memory/store.ts)
  -> UI renders reply + step stream
```

Two core design ideas:

1) **Deterministic shortcuts** exist so common intents don’t depend on LLM compliance.
2) **Agent loop** exists so complex tasks are executed step-by-step with tool results fed back into the model.

---

## 4) Entry Point & Environment Loading

Main file: `src/index.tsx`

### 4.1 Why env loading is “special” in ESM

Because the project is ESM, modules can be evaluated before your `.env` is loaded. FELLA avoids “env not ready yet” bugs by:

- Loading dotenv early in `src/index.tsx`
- Initializing network clients (Groq, Supabase) lazily so they read env vars at first use

### 4.2 `.env` search order

At startup, `src/index.tsx` tries:

1) `%FELLA_HOME%\.env` (often set by `bin/fella.bat`)
2) `dist/../.env` (for packaged layouts)
3) `cwd/.env` (fallback)

### 4.3 CLI commands vs TUI

Before launching the TUI, the entry point handles:

- `signup`, `login`, `login --google`, `logout`, `whoami`
- Session commands: `sessions`, `resume <id>`

It then ensures the user is authenticated (refreshing tokens if needed) and renders the Ink UI.

### 4.4 Why `chrome-devtools-mcp` is invoked at startup

`src/index.tsx` runs `npx --yes chrome-devtools-mcp@latest --version` as a **prewarm** step. It does not control the browser in the current Playwright/CDP implementation; it simply makes any future `npx` usage of that package faster.

---

## 5) UI Layer (Ink + React)

Key files:

- `src/ui/App.tsx`: owns the screen mode and keeps one long-lived Engine instance
- `src/ui/components/InputBar.tsx`: input capture (`ink-text-input`)
- `src/ui/components/MessageList.tsx`: message rendering + spinner
- `src/ui/components/StatusBar.tsx`: status/help

### 5.1 Step streaming

The agent loop streams steps via an `onStep` callback; the UI renders those as “system” messages so you can watch tool execution in real time.

---

## 6) The Engine (Deterministic Router + Safety Gates)

Main file: `src/execution/engine.ts`

The engine is the traffic controller between:

- UI messages
- deterministic shortcuts
- agent loop
- tool dispatch
- persistence
- confirmations + undo/redo

### 6.1 Why deterministic shortcuts exist

Shortcuts are faster (no network), safer (less probabilistic wandering), and more reliable for common phrases.

Examples of intents the engine handles without the LLM (representative, not exhaustive):

- `undo` / `redo`
- acknowledgements (`ok`, `thanks`) to avoid pointless model calls
- navigation shortcuts (`navigate to downloads`, “open latest downloaded pdf”)
- settings/control-panel phrases
- app launches
- LeetCode problem URL construction + “solutions page of it” follow-ups (when browser context is active)
- “close this folder / close current folder” Explorer close (Windows)
- Google Docs follow-ups like “write more in it” → append-to-doc behavior

### 6.2 Confirmation gating (destructive actions)

The engine requires an explicit confirmation for destructive operations.

Two important cases:

- `deleteFile`: engine can halt and ask for user confirmation before executing
- `organiseByRule`: engine expects a preview (`dry_run: true`) before moving files

### 6.3 Undo/redo

Undo/redo is implemented via a stack in `src/execution/history.ts`. The engine records inverse actions for moves, renames, directory creation, organisation moves, and “soft deletes” (trash moves).

---

## 7) The Agent Loop (Multi-step tool use)

Main file: `src/agent/loop.ts`

This is a ReAct-style loop: call model → tool → feed result → repeat.

### 7.1 JSON-only protocol

The model is instructed to output exactly one JSON object per step:

- Tool call: `{ "tool": "<toolName>", "args": { ... } }`
- Final reply: `{ "response": "..." }`

The loop validates tool calls before dispatch.

### 7.2 Verification requirement

The loop is designed to prefer “verify after mutate” behavior: if a tool creates/moves/writes/deletes, it should be followed by a read-only check (read/list/find) before finishing.

### 7.3 Memory writeback

After a successful run, the loop stores a “run trace” into SQLite (`memory` table): the goal + step list + timestamp.

---

## 8) LLM Layer (Groq primary, Ollama fallback)

Core files:

- `src/llm/client.ts`: chooses Groq primary, falls back to Ollama if available
- `src/llm/ollama.ts`: Groq client + system prompt (historical naming)
- `src/llm/schema.ts`: Zod schemas

### 8.1 Why Groq + OpenAI-compatible client

Using the `openai` npm package with Groq’s OpenAI-compatible endpoint simplifies request/response handling and keeps the integration familiar.

### 8.2 Robust JSON parsing

`src/llm/client.ts` includes pragmatic parsing:

- strips markdown fences if the model accidentally emits them
- tries to extract JSON objects from extra text
- normalizes legacy `{ action: ... }` to `{ tool: ... }` style where possible

### 8.3 Tool validation

`src/llm/schema.ts` defines `TOOL_NAMES` (the allowed tool name enum). If the model emits an unregistered tool, it is rejected before execution.

---

## 9) Tool Registry

File: `src/tools/registry.ts`

The registry maps canonical tool names to implementations and can normalize aliases.

This keeps the LLM’s tool vocabulary small and consistent (and avoids “invented tool names”).

---

## 10) Security Model (Path Guard)

File: `src/security/pathGuard.ts`

### 10.1 Why it exists

Tooling without a path policy is unsafe. The path guard is the main defense-in-depth layer that keeps file access inside user-controlled zones.

### 10.2 Alias resolution

User-friendly aliases map to real directories:

- `downloads`, `documents`, `desktop`, `pictures`, `music`, `videos`, `temp`, `home`
- `appdata`, `localappdata` (Windows)
- `d:` / `droot` (Windows)

On Windows, the guard also queries shell folders via PowerShell (so OneDrive redirects still work).

### 10.3 Allowed vs blocked zones

Windows policy:

- Allowed roots: `C:\Users\...` and `D:\...`
- Blocked examples: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`, etc.

macOS/Linux have similar “user space only” policies.

---

## 11) Persistence (SQLite) + Session Semantics

File: `src/memory/store.ts`

### 11.1 Database location

- `%USERPROFILE%\.fella\memory.db`

### 11.2 Tables (schema)

The schema is created automatically on first run:

- `memory(id, goal, steps, timestamp)`
- `facts(id, fact, source, timestamp)`
- `sessions(id, started_at, last_at)`
- `session_turns(id, session_id, role, content, timestamp, visible)`

### 11.3 “Visible turns” (why it matters)

FELLA stores both user-visible messages and internal/system/tool messages. Resume/session listing uses **visible turns only** so the session list stays meaningful.

### 11.4 Empty-session avoidance

Session rows are created lazily (only once there is at least one persisted visible turn). This prevents the sessions list from filling with “0 message” sessions.

---

## 12) Context Loading (Lightweight RAG)

File: `src/memory/context.ts`

`ContextLoader` injects extra context as a temporary system message for each agent run:

- a snippet of `GUIDE.md` (first ~4000 chars, from cwd or parent)
- persistent “facts” from SQLite
- recalled past goals from `memory` (keyword match)

This is intentionally **not** a vector DB. It’s a cheap, effective RAG-lite strategy.

---

## 13) Tools (What exists and how to reason about them)

### 13.1 File tools

Files in `src/tools/` include:

- `listFiles`, `findFile`
- `createDirectory`
- `createFile`, `writeFile`, `readFile`
- `moveFile`, `renameFile`
- `deleteFile`

Important behavior: the engine wraps “delete” with a soft-delete strategy when possible (move to a temp trash staging dir) so undo can work.

### 13.2 Organise tool

`src/tools/organiseByRule.ts` supports a two-phase workflow:

1) `dry_run: true` → preview
2) `dry_run: false` → execute

### 13.3 Settings tool

`src/tools/openSettings.ts` opens Settings/Control Panel pages and can run real system queries like listing Wi‑Fi networks.

### 13.4 Screen automation

File: `src/tools/screenAutomation.ts`

This tool has two internal styles:

- “Visible app actions” via PowerShell/Explorer (no nut-js required)
- OCR/mouse/keyboard via `@nut-tree-fork/nut-js` (lazy-loaded)

Notable actions:

- `launch`: open an app visibly
- `navigate`: open Explorer to a folder, or open a file directly (by passing a file path)
- `close_folder` (Windows): closes an Explorer window using Shell COM enumeration

### 13.5 Browser automation (Playwright + CDP + Google Docs)

File: `src/tools/browserAutomation.ts`

Key design choice: FELLA attaches to an installed Chrome/Edge over CDP.

- Debug port: `127.0.0.1:9222`
- Debug profile dir: `%USERPROFILE%\.fella\chrome-debug-profile`

This is packaging-friendly (no large browser downloads during dist) and avoids clobbering the user’s normal browser session.

Supported actions (high-level):

- `navigate` (supports `newTab: true`)
- `search`, `click`, `get_text`, `scroll`, `wait`, `screenshot`
- `close_tab`, `close_all_tabs`, `close`

Google Docs actions:

- `append_text` (append-at-end; prevents overwriting)
- `rename_document`, `select_all`
- `set_font`, `set_font_size`, `set_text_color`
- `add_header_footer`

Safety behavior:

- Domain hint blocking for obvious login/payment targets
- Refuses to type into Google sign-in pages; user must complete login manually

---

## 14) Authentication (Supabase)

Files:

- `src/auth/client.ts`
- `src/auth/commands.ts`

### 14.1 Token storage

Tokens are stored at:

- `%USERPROFILE%\.fella\auth.json`

### 14.2 Google OAuth

Google OAuth uses PKCE and a localhost callback server (port `54321`) to receive `?code=...`, exchange it for a session, and persist tokens.

---

## 15) Build, Bundle, and Packaging

### 15.1 Typecheck vs bundle

- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: typecheck + bundle

### 15.2 Bundling (`scripts/bundle.mjs`)

- Bundles `src/index.tsx` → `dist/index.js` with esbuild
- Injects build-time env values via `define` (Groq + Supabase)
- Marks some modules as external (native addons and dynamic-import libraries)

### 15.3 Packaging prep (`scripts/predist.mjs`)

`predist` installs external/native packages into `dist/node_modules` so caxa can package them reliably.

Important detail: it sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to avoid downloading browser binaries during packaging. This works because FELLA attaches to an installed Chrome/Edge over CDP.

### 15.4 `npm run dist`

Builds a Windows executable via caxa, using a stub with an icon stamped in advance.

---

## 16) Packages Map (From package.json)

### Runtime dependencies (high signal)

- `ink`, `react`, `ink-text-input`, `ink-spinner`: terminal UI
- `openai`: Groq client (OpenAI-compatible)
- `@supabase/supabase-js`: auth
- `zod`: schema validation
- `better-sqlite3`: SQLite persistence
- `execa`: OS command execution
- `playwright`: browser automation (CDP attach + DOM ops)
- `@nut-tree-fork/nut-js`: OCR/mouse/keyboard automation
- `dotenv`: `.env` loading

### Present but currently not imported in `src/` (safe to remove if desired)

- `chalk`
- `env-paths`
- `trash` (engine implements its own trash staging)

### One “legacy/utility” dependency

- `chrome-devtools-mcp`: currently used only for an `npx` prewarm step in `src/index.tsx`

---

## 17) How to Add a New Tool (Checklist)

1) Implement the tool in `src/tools/<toolName>.ts`.
   - Use `resolvePath()` for any user-provided paths.
2) Register it in `src/tools/registry.ts`.
3) Add the tool name to `TOOL_NAMES` in `src/llm/schema.ts`.
4) Update the system prompt in `src/llm/ollama.ts`:
   - exact args schema
   - examples
5) Decide if the engine should:
   - add deterministic routing
   - add confirmation gating
6) If it mutates state, ensure there’s a read-only verification path.

---

## 18) Glossary

- **Tool call**: structured `{ tool, args }` emitted by the model.
- **Deterministic shortcut**: a direct engine code path that bypasses the LLM.
- **Confirmation gate**: engine requires explicit yes/no before destructive actions.
- **RAG-lite**: guide snippet + facts + recall injected as context.
- **Path guard**: safety layer limiting filesystem access.
- **CDP**: Chrome DevTools Protocol (used to attach to Chrome/Edge).

---

## 19) Practical Debugging Checklist

When something behaves unexpectedly, debug in this order:

1) Did `src/index.tsx` load the correct `.env`?
2) Was the request handled by an engine shortcut? (If yes, LLM wasn’t involved.)
3) If it hit the agent loop: did the model emit valid JSON?
4) Did the registry recognize the tool name?
5) Did `resolvePath()` block the requested path?
6) Did the engine persist visible turns and update `sessions.last_at`?

---

## 20) Known limits (Current reality)

- Screen OCR/mouse/keyboard reliability depends on nut-js/native availability.
- Browser automation selectors can drift (especially in Google Docs).
- Settings tool opens pages and reads some status, but does not "change settings" unless explicitly implemented.
