# FELLA CLI — Deep Implementation Guide (Teacher Edition)

File Exploration and Local Logic Automation.

This document is a “how it works + how to build it” guide for the FELLA CLI in this repo. It explains the full runtime pipeline (UI → engine → LLM → tools → safety → persistence), the external APIs, the local database schema, and why each major npm package exists.

If you want a mental model in one sentence:

FELLA is a terminal chat app (Ink/React) that turns natural language into structured JSON tool calls (Groq/OpenAI-compatible API; optional local Ollama fallback), executes those tools under a strict path policy, streams tool steps live, and persists visible conversation turns + run traces into SQLite.

---

## 0) Prerequisites

- Node.js `>= 18` (required by package.json)
- Windows is the primary target, but many pieces are cross-platform
- A Groq API key for LLM operation (`GROQ_API_KEY`)
- Supabase project credentials for auth (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
- For browser automation: Playwright browsers installed (see “Playwright” section)
- For advanced screen automation (OCR/mouse/keyboard): nut-js native addon availability (works best from source)

---

## 1) Tech Stack Overview

### 1.1 Frameworks & core runtime

- TypeScript: the codebase language (`tsconfig.json` is strict)
- Node.js: runtime (ESM project: `"type": "module"` in package.json)
- Ink + React: renders the terminal UI as a React component tree

### 1.2 External APIs (network)

- Groq (LLM): called via the `openai` npm package using Groq’s OpenAI-compatible endpoint
- Supabase Auth: email/password + Google OAuth, via `@supabase/supabase-js`

### 1.3 Local services

- Ollama (optional fallback LLM): HTTP calls to `http://127.0.0.1:11434/api/*`

### 1.4 Local “DB” (persistence)

- SQLite: stored via `better-sqlite3` in `%USERPROFILE%\.fella\memory.db`

### 1.5 Automation

- Playwright (Chromium): deterministic web automation and scraping
- nut-js (OCR + mouse + keyboard): optional screen automation
- execa: safe child-process spawning for OS commands (`cmd start`, `netsh`, `powershell`, etc.)

### 1.6 Build & packaging

- TypeScript compiler: typechecking only (`tsc --noEmit`)
- esbuild: bundles `src/index.tsx` → `dist/index.js`
- caxa: packages Node + dist into a Windows executable
- SEA pipeline (Node Single Executable Application): alternate packaging route via scripts

---

## 2) Repo Structure (What lives where)

Key folders (high signal):

```text
src/
  index.tsx              Entry point (dotenv + CLI commands + render Ink UI)
  ui/                    Ink/React UI
  execution/engine.ts    Deterministic routing + confirmation + agent loop entry
  agent/loop.ts          Multi-step tool-using loop (ReAct-style)
  llm/                   LLM adapters + Zod schemas + system prompt
  tools/                 Tool implementations (file ops + automation)
  security/pathGuard.ts  Path alias resolution + allow/block policy
  memory/store.ts        SQLite persistence (sessions + memory + facts)
  memory/context.ts      Context loader (GUIDE + facts + recall → system msg)
  platform/runtime.ts    Platform helpers (default roots/aliases)

scripts/                 Build + packaging scripts (esbuild, SEA, icons)
assets/                  Logos/icons used by packaging
bin/                     Packaged binaries output
```

Runtime files created on the user machine:

- `%USERPROFILE%\.fella\auth.json` (Supabase tokens)
- `%USERPROFILE%\.fella\memory.db` (SQLite sessions + memory + facts)
- `%USERPROFILE%\.fella\screenshots\` (Playwright screenshots)
- `%TEMP%\.fella-trash\` (engine soft-delete staging)

---

## 3) The End-to-End Request Lifecycle

When the user types something like:

```text
open the latest downloaded pdf
```

the runtime path is:

```text
Ink UI (src/ui/App.tsx)
  -> Engine.send(userMessage) (src/execution/engine.ts)
     -> deterministic shortcut? (fast path)
        OR
     -> AgentLoop.run(...) (src/agent/loop.ts)
        -> LLMClient.chat(...) (src/llm/client.ts)
           -> Groq primary (src/llm/ollama.ts)
           -> Ollama fallback (local HTTP) if configured/available
        -> registry.execute(tool,args) (src/tools/registry.ts)
        -> tool implementation (src/tools/*.ts)
     -> persist visible turns (src/memory/store.ts)
  -> UI renders reply + step stream
```

Two important ideas:

1) “Deterministic shortcuts” exist so that simple intents don’t depend on LLM compliance.
2) The “agent loop” exists so that complex tasks can be done step-by-step with tool results fed back into the model.

---

## 4) Entry Point & Environment Loading

### 4.1 Why `.env` loading is non-trivial in ESM

This repo is ESM (`"type": "module"`). In Node ESM, modules are evaluated as they are imported. Some modules (Supabase client, Groq client) must read environment variables, but environment variables are loaded in the entrypoint.

To avoid “module imported before dotenv ran”, the code does two things:

- In [src/index.tsx](src/index.tsx), it loads dotenv early.
- In modules like the Groq client and Supabase client, it initializes lazily (function or Proxy) so it reads env values at first use.

### 4.2 `.env` search order

At startup, [src/index.tsx](src/index.tsx) tries:

1) `%FELLA_HOME%\.env` (often set by a wrapper like `bin/fella.bat`)
2) `<runtime_dir>\..\.env` (for `dist/` execution)
3) `<cwd>\.env`

It loads the first file that exists (dotenv with `override: true`).

### 4.3 CLI commands vs TUI

Before launching the TUI, it handles:

- `signup`, `login`, `login --google`, `logout`, `whoami`
- Session management: `sessions`, `resume <id>`

If the user is not authenticated, the app renders a login-mode UI (still Ink/React), then executes the chosen auth command.

---

## 5) UI Layer (Ink + React)

### 5.1 What Ink is

Ink is a React renderer for the terminal. Instead of building a “raw readline UI”, you write React components (`<Box>`, `<Text>`) and Ink re-renders the terminal.

Key files:

- [src/ui/App.tsx](src/ui/App.tsx): owns screens (`login` | `welcome` | `chat`) and holds one long-lived `Engine`
- [src/ui/components/InputBar.tsx](src/ui/components/InputBar.tsx): uses `ink-text-input` to capture user input
- [src/ui/components/MessageList.tsx](src/ui/components/MessageList.tsx): renders messages + `ink-spinner` while thinking
- [src/ui/components/StatusBar.tsx](src/ui/components/StatusBar.tsx): shows shortcuts + session id

### 5.2 Step streaming

When the agent loop executes tools, the UI receives `onStep(step)` callbacks and renders system messages like:

```text
Step 2 - findFile {"query":"resume","extensions":[".pdf"]} ✓
Found 1 result(s) ...
```

That’s implemented by calling `Engine.send(trimmed, onStep)` and appending a synthetic “system” message in the UI.

---

## 6) The Engine (Deterministic Router + Safety Gates)

The engine is the “traffic controller” between:

- your UI messages
- deterministic shortcuts
- the agent loop
- tool execution
- persistence

Main file: [src/execution/engine.ts](src/execution/engine.ts)

### 6.1 Core engine state

- `history`: rolling conversation history (messages sent to the LLM)
- `pendingConfirmation`: stores a destructive action until the user says “yes”
- `pendingSelection`: disambiguation when multiple folders/files match
- `pendingOpenClarification`: when “open X” is ambiguous (app/folder/file/setting)
- `undoStack`: reversible actions (move/create/organise/delete via trash)
- `sessionStore`: SQLite persistence via `MemoryStore`

### 6.2 Deterministic shortcuts (why they exist)

Shortcuts exist because:

- they’re faster (no network)
- they’re safer (less chance the model “wanders”)
- they improve reliability for common commands

Examples handled without the LLM:

- `undo`, `redo`
- acknowledgements (`ok`, `thanks`) to avoid pointless model calls
- `navigate to downloads`
- `open the latest downloaded pdf`
- `battery status`
- short app launches (`open notepad`)
- LeetCode “open problem by name” URL construction

### 6.3 The “open …” resolver (important behavior)

For simple `open X` (non-chained), the engine tries in order:

1) “open in browser” syntax (`open github.com in chrome`) → `browserAutomation.navigate`
2) settings intent (`open wifi settings`) → `openSettings`
3) URL-like targets → `browserAutomation.navigate`
4) direct path/alias resolution (if it exists) → `screenAutomation.navigate`
5) app-like targets → `screenAutomation.launch`
6) folder search by name → `screenAutomation.navigate`
7) file search by name → `screenAutomation.navigate`
8) if still ambiguous → ask clarification and store `pendingOpenClarification`

This avoids a major failure mode: interpreting every “open X” as either Windows Settings or file search.

### 6.4 Confirmation gating (delete + organise)

The engine enforces “you must type yes” for destructive actions:

- If the model calls `deleteFile`, the engine does not execute it immediately; it throws `AgentLoopHalt` with a prompt to the user.
- `organiseByRule` must run as `dry_run: true` first; the engine queues the `dry_run: false` execution behind a confirmation.

This gate exists because LLMs are probabilistic: you don’t want one accidental parse to delete files.

### 6.5 Undo/Redo (how it’s implemented)

Undo/redo is implemented as a two-stack history manager in [src/execution/history.ts](src/execution/history.ts).

- Each reversible action is stored as a `{ description, undo(), redo() }` entry.
- The engine pushes entries after successful operations (e.g., a move) and clears the redo stack whenever a new action is pushed.
- `undo` pops from the “past” stack, runs `entry.undo()`, then pushes to the “future” stack.
- `redo` pops from “future”, runs `entry.redo()`, then pushes back to “past”.

---

## 7) The Agent Loop (Multi-step tool use)

Main file: [src/agent/loop.ts](src/agent/loop.ts)

### 7.1 The protocol: JSON-only tool calling

The model is instructed to return exactly one JSON object, shaped as one of:

- `{ "tool": "toolName", "args": { ... } }`
- `{ "response": "text" }`
- `{ "error": "text" }`

This is critical: it makes the model’s output machine-readable.

### 7.2 Verify-before-done rule

The loop enforces a reliability rule:

If the model performed a mutating action (`createDirectory`, `moveFile`, `writeFile`, etc.), it must verify using a read-only tool (`listFiles`, `findFile`, `readFile`) before it is allowed to end with a final response.

This prevents “hallucinated success”, where a model says “done” without checking the filesystem.

### 7.3 Step limit

There is a maximum step count (defaults in the engine config). This prevents infinite loops.

### 7.4 Memory writeback

At the end of a run, the loop stores a record of the run in SQLite (`memory` table):

- goal
- steps (serialized)
- timestamp

---

## 8) LLM Layer (Groq primary + Ollama fallback)

There are two related modules:

- [src/llm/ollama.ts](src/llm/ollama.ts): the Groq client + system prompt + JSON parsing
- [src/llm/client.ts](src/llm/client.ts): a hybrid adapter (Groq first, then Ollama fallback)

### 8.1 Groq API usage (OpenAI-compatible)

The `openai` npm package is used like:

- `baseURL: https://api.groq.com/openai/v1`
- `chat.completions.create({ model, messages, response_format })`

`response_format: { type: 'json_object' }` asks Groq to force JSON output.

### 8.2 Why Groq code lives in `ollama.ts`

Historically the project started with Ollama; the types remained, but the actual client is Groq. The naming is a legacy detail; functionally it is “LLM JSON tool-caller client”.

### 8.3 JSON parsing + failure fallback

Even with JSON enforcement, models can fail. The code:

- strips markdown code fences if they appear
- tries direct JSON parse, then tries “extract first `{...}` block”
- normalizes `{ action: ..., args: ... }` into `{ tool: ..., args: ... }`

If Groq returns the known error “Failed to generate JSON” (HTTP 400), it retries without strict `response_format` but with an extra system message that re-states the JSON-only requirement.

### 8.4 Ollama fallback (local)

If Groq fails, `LLMClient` checks `http://127.0.0.1:11434/api/tags` to see whether Ollama is running and whether `qwen2.5` exists.

If available, it calls:

- `POST /api/chat` with `format: 'json'` and the messages.

If both Groq and Ollama fail, the client returns a normal `{response: ...}` payload (so the app doesn’t crash).

---

## 9) Tool System

### 9.1 The registry

Main file: [src/tools/registry.ts](src/tools/registry.ts)

Responsibilities:

- map canonical tool names → handlers
- support aliases the model may emit (e.g. `mkdir` → `createDirectory`)
- enforce that the tool is in the allowed tool-name enum (from Zod schema)

### 9.2 Tool schema validation (Zod)

Main file: [src/llm/schema.ts](src/llm/schema.ts)

Zod is used to define:

- message shape
- the JSON payload shape
- the allowed tool list (`TOOL_NAMES`)

This reduces accidental “tool name drift” and makes failures explicit.

---

## 10) File Tools (What they do and which Node APIs they use)

All file tools resolve paths through the safety layer first.

### 10.1 Path safety: `resolvePath()` is non-optional

Before touching the filesystem, tools call `resolvePath(raw)` from [src/security/pathGuard.ts](src/security/pathGuard.ts).

It:

- expands friendly aliases (`downloads`, `desktop`, `d:`)
- normalizes absolute/relative paths
- blocks system directories (Windows: `C:\Windows`, `Program Files`, etc.)
- allows only `C:\Users\...` and `D:\...` on Windows

If `resolvePath` throws, the tool stops.

### 10.2 listFiles

File: [src/tools/listFiles.ts](src/tools/listFiles.ts)

- Uses `fs.promises.readdir(..., { withFileTypes: true })`
- Prints `[DIR]` vs `[FILE]`

### 10.3 findFile (fuzzy recursive search)

File: [src/tools/findFile.ts](src/tools/findFile.ts)

Core algorithm:

- tokenize filenames (handles underscores, dots, camelCase, digit boundaries)
- compute a score in `[0..1]` based on query token matches
- optionally filter by extensions
- optionally restrict to “inside a folder that matches folder_hint”
- skip system folders always; skip junk folders on pass 1; include them only on fallback pass
- sort by score or by recent modification time

This is the discovery tool you use before opening/moving when the exact path isn’t known.

### 10.4 moveFile

File: [src/tools/moveFile.ts](src/tools/moveFile.ts)

- Uses `fs.promises.rename`
- Checks source exists (`access`)
- Never silently overwrites existing destinations
- Can create parent directories (`mkdir(..., { recursive: true })`)

The engine wraps this tool with undo/redo by recording the inverse rename.

### 10.5 createFile / writeFile / readFile / renameFile

Files:

- [src/tools/createFile.ts](src/tools/createFile.ts)
- [src/tools/writeFile.ts](src/tools/writeFile.ts)
- [src/tools/readFile.ts](src/tools/readFile.ts)
- [src/tools/renameFile.ts](src/tools/renameFile.ts)

These use Node’s `fs/promises` APIs and exist for two reasons:

- they give the model a safe, limited vocabulary
- they support verification (readFile) after mutation

### 10.6 deleteFile (and why it’s “soft delete” in practice)

File tool: [src/tools/deleteFile.ts](src/tools/deleteFile.ts) is a hard delete (`rm -r`).

But the engine intercepts `deleteFile` and performs a “trash move” instead (when possible) using:

- `rename(source → %TEMP%/.fella-trash/<timestamp>_<name>)`

That makes deletion undoable.

---

## 11) Organise Tool (Bulk file organization)

File: [src/tools/organiseByRule.ts](src/tools/organiseByRule.ts)

Key idea: two-phase execution.

1) `dry_run: true` returns a preview summary (grouping + counts + size totals)
2) `dry_run: false` performs the renames

Rules supported:

- `by_type` (Images, Videos, Audio, Documents, Code, …)
- `by_category` (Images / Videos / PDFs / Other)
- `by_date` (Year/Month)
- `by_size` (Small/Medium/Large/Huge)
- `by_extension` (PDF/PNG/…)

The engine adds undo support by capturing the list of “actual moves” done during execution.

---

## 12) Settings Tool (Windows Settings, Control Panel, and real system queries)

File: [src/tools/openSettings.ts](src/tools/openSettings.ts)

### 12.1 What it does

- Opens Windows Settings pages using `ms-settings:` URIs (e.g. `ms-settings:network-wifi`)
- Opens Control Panel applets (e.g. `appwiz.cpl`, `ncpa.cpl`)
- Can fetch “available Wi‑Fi networks” via `netsh wlan show networks` and include it in the response
- Implements best-effort macOS/Linux mappings

### 12.2 Node / OS APIs used

- `execa('cmd', ['/c','start', '', 'ms-settings:...'])` on Windows
- `netsh`, `nmcli`, `networksetup` as platform-specific helpers
- Battery status uses PowerShell CIM on Windows, `pmset` on macOS, `upower`/`acpi` on Linux

---

## 13) Screen Automation (Visible automation)

File: [src/tools/screenAutomation.ts](src/tools/screenAutomation.ts)

This tool has two “modes” internally:

1) Launching apps via PowerShell/Start Menu/Win+R (no nut-js required)
2) OCR/mouse/keyboard automation via nut-js (lazy-loaded)

### 13.1 App launching (Windows)

Launch flow:

- Guard against system directories masquerading as “apps”
- Search Start Menu `.lnk` shortcuts (user + system Start Menu paths)
- If found: `Start-Process` the shortcut
- Else: open Win+R dialog via COM (`Shell.Application`) and type a mapped command (e.g. `calc`, `msedge`, `code`)

### 13.2 Navigation

`action: 'navigate'` opens a folder (or a virtual folder like Recycle Bin) using:

- `cmd /c start "" <pathOrUri>` on Windows
- `open` on macOS
- `xdg-open` on Linux

If a full file path is provided, it opens the file directly with the OS default handler.

### 13.3 OCR + input automation

`@nut-tree-fork/nut-js` provides:

- OCR-based “find text on screen”
- mouse movement/click
- keyboard typing, hotkeys

It’s loaded lazily to reduce startup cost and to avoid packaging failures when native addons are unavailable.

---

## 14) Browser Automation (Playwright)

File: [src/tools/browserAutomation.ts](src/tools/browserAutomation.ts)

### 14.1 What it is

Playwright runs a real browser (Chromium here) with a controllable API.

FELLA keeps a persistent browser/context/page in module-level variables for speed:

- first call launches Chromium and opens a page
- later calls reuse the same page unless closed

### 14.2 Supported actions

- `navigate` (URL)
- `search` (Google)
- `click` (by selector or visible text)
- `type` (into selector or active field)
- `get_text` (selector or body fallback; special handling for npm weekly downloads)
- `scroll`, `wait`, `screenshot`, `close`

### 14.3 Safety policy

The tool refuses to automate obvious login/payment domains by string hinting (defense-in-depth). This is deliberately conservative.

### 14.4 Installing Playwright browsers

If Playwright is installed but browsers aren’t, run:

```bat
npx playwright install chromium
```

---

## 15) Security Model (Path Guard)

File: [src/security/pathGuard.ts](src/security/pathGuard.ts)

### 15.1 Why this exists

When you give an LLM tools, it can attempt to access any path you let it. A path guard is the main line of defense that keeps the agent in user-space.

### 15.2 Aliases

Aliases map friendly names to real directories:

- `downloads`, `documents`, `desktop`, `pictures`, `music`, `videos`, `temp`, `home`
- `appdata`, `localappdata` (Windows)
- `d:` and `droot` (Windows)

On Windows it also queries shell folder paths via PowerShell so OneDrive redirects still work.

Related helper: [src/platform/runtime.ts](src/platform/runtime.ts)

- Defines the cross-platform “default navigate aliases” and “default search roots”.
- Adds Windows-only helpers like `d:` and virtual folders (Recycle Bin / This PC / Control Panel).

### 15.3 Allowed vs blocked zones

On Windows:

- Allowed: `C:\Users\...` and `D:\...`
- Blocked: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`, etc.

On macOS/Linux, a similar “user-space only” policy is enforced.

---

## 16) Persistence (SQLite) + Session Semantics

File: [src/memory/store.ts](src/memory/store.ts)

### 16.1 Why SQLite

SQLite is a great fit for a single-user local CLI:

- no server to run
- transactional
- fast reads/writes

### 16.2 Database location

- `%USERPROFILE%\.fella\memory.db`

### 16.3 Tables (and what they mean)

- `sessions`: session metadata (`id`, `started_at`, `last_at`)
- `session_turns`: each message turn (role/content/timestamp/visible)
- `memory`: run traces (goal/steps/timestamp)
- `facts`: user facts (fact/source/timestamp)

### 16.4 “Visible turns” concept

The engine stores both user-visible chat and internal tool messages. To keep `resume` clean, it marks turns as visible or not.

### 16.5 Empty session avoidance

Sessions are created lazily: the engine doesn’t insert a `sessions` row until there is at least one persisted turn. This prevents the session list from filling with 0-message sessions.

---

## 17) Context Loading (Lightweight RAG)

File: [src/memory/context.ts](src/memory/context.ts)

Every agent run can include extra context:

- a snippet of `GUIDE.md` from the repo
- “facts” saved into SQLite
- a small set of recalled past goals

That context is injected as a temporary system message at the start of the run.

This is not a vector database; it’s a simple, effective “cheap RAG” strategy.

---

## 18) Authentication (Supabase)

Files:

- [src/auth/client.ts](src/auth/client.ts)
- [src/auth/commands.ts](src/auth/commands.ts)

### 18.1 Supabase client initialization

Supabase client is created lazily because env vars might not be ready at module import time.

Auth config:

- `flowType: 'pkce'` for OAuth code exchange
- no implicit session persistence (FELLA stores tokens itself)

### 18.2 Token storage

- `%USERPROFILE%\.fella\auth.json`

Stored fields include access token, refresh token, user id/email, and an expiry timestamp.

### 18.3 Google OAuth flow

- starts a local HTTP server on port `54321`
- opens the Supabase OAuth URL
- receives `?code=...`
- exchanges code for session
- stores tokens

---

## 19) Build, Bundle, and Packaging

### 19.1 Typechecking

`npm run typecheck` runs `tsc --noEmit`.

This is a deliberate pattern: esbuild does output; TypeScript checks types.

### 19.2 Bundling

Script: [scripts/bundle.mjs](scripts/bundle.mjs)

- bundles `src/index.tsx` to `dist/index.js`
- injects build-time env values using esbuild `define`

Important detail: runtime env variables can still override bundled values because code reads `process.env['KEY']` first.

### 19.3 caxa packaging

`npm run dist` creates `bin/fella-win.exe` using caxa with a stub exe.

### 19.4 SEA packaging

Script: [scripts/sea.mjs](scripts/sea.mjs)

This is a more advanced packaging method using Node SEA blobs, blob injection via `postject`, icon setting (rcedit), and optional signing.

Notes:

- The script runs `npx postject ...` (so `postject` is fetched on demand if it isn’t already present).
- On Windows it generates `assets/FELLA_CAT.ico` by running `scripts/gen-ico.mjs` (this is why `canvas` exists in `devDependencies`).

---

## 20) npm Packages Map (What each dependency is for)

This section is intentionally explicit so you can learn the stack.

### Runtime dependencies

- `ink`, `react`: terminal UI framework (React renderer)
- `ink-text-input`: editable input field used in InputBar
- `ink-spinner`: “thinking…” spinner
- `openai`: OpenAI-compatible client used for Groq LLM calls
- `@supabase/supabase-js`: auth flows and token refresh
- `zod`: schemas for tool-call payloads + message validation
- `better-sqlite3`: synchronous SQLite driver (local persistence)
- `execa`: child process spawning wrapper for OS commands
- `playwright`: browser automation (Chromium)
- `dotenv`: load `.env` files
- `@nut-tree-fork/nut-js`: screen automation (OCR, mouse, keyboard)

### Dev/build dependencies

- `typescript`: type checking
- `tsx`: run TS/TSX directly in dev (`npx tsx src/index.tsx`)
- `esbuild`: bundling
- `caxa`: packaging dist into an executable
- `canvas`: used by scripts that generate logos/icons (not used at runtime)
- `rcedit`: Windows exe icon editing for SEA builds

### Present but currently unused in `src/`

- `chalk`: not imported in current `src/` (could be used for colored logs later)
- `env-paths`: not imported in current `src/` (paths are currently built via `os.homedir()`)
- `trash`: not imported in current `src/` (engine implements its own trash staging)

If you want, you can remove unused deps to reduce install size.

---

## 21) How to Add a New Tool (Implementation Checklist)

To add a new tool safely, follow this order:

1) Implement the tool in `src/tools/<toolName>.ts`.
   - Always call `resolvePath()` on any user-provided path.
2) Register it in [src/tools/registry.ts](src/tools/registry.ts).
3) Add the tool name to the `TOOL_NAMES` enum in [src/llm/schema.ts](src/llm/schema.ts).
4) Update the system prompt in [src/llm/ollama.ts](src/llm/ollama.ts) with:
   - what the tool does
   - exact arg schema
   - examples
5) Decide whether the engine should add deterministic routing or confirmation gating.
6) If it mutates state, ensure the agent loop can verify it with a read-only tool.

---

## 22) Glossary (Terms used in this repo)

- **Agent loop / ReAct loop**: iterative pattern “think → tool call → observe result → next step”.
- **Tool call**: the model emits a structured `{tool,args}` object that the program can execute.
- **Deterministic shortcut**: direct code path that bypasses the model for simple intents.
- **Confirmation gate**: the engine requires an explicit “yes” before executing a destructive action.
- **RAG**: retrieval-augmented generation; here it’s lightweight (guide snippet + recall + facts).
- **PKCE**: OAuth security mechanism used by Supabase for the Google login flow.
- **ESM**: JavaScript module system used by this project (`type: module`).
- **SEA**: Node Single Executable Application (blob injected into node binary).
- **Path guard**: safety layer that limits what filesystem paths tools can touch.

---

## 23) Practical Debugging Checklist

When something behaves unexpectedly, debug in this order:

1) Does [src/index.tsx](src/index.tsx) load the correct `.env` file?
2) Did the engine handle the request via a shortcut? (If yes, the LLM isn’t involved.)
3) If it hit the agent loop: did the model emit valid JSON?
4) Did the registry recognize the tool name (or alias)?
5) Did `resolvePath()` block the requested path?
6) Did the engine persist visible turns and update `sessions.last_at`?


### 6.2 Token storage

Tokens are stored at:

- `%USERPROFILE%\.fella\auth.json`

Stored fields include:

- access token
- refresh token
- user email
- user id
- expiry timestamp

refreshIfNeeded() refreshes the session if the token is near expiry.

### 6.3 Email login and signup

src/auth/commands.ts implements:

- signup
- login
- logout
- whoami

Email/password input is collected through readline, with masked password entry for terminal usage.

### 6.4 Google OAuth login

Google login uses a temporary localhost callback server on port 54321.

Flow:

1. Start HTTP server.
2. Ask Supabase for OAuth URL.
3. Open browser.
4. Receive callback with auth code.
5. Exchange code for session.
6. Save auth token locally.
7. Close callback server.

PKCE mode is required for this flow.

---

## 7. UI Layer

The terminal UI is implemented with Ink and React.

### 7.1 App state

src/ui/App.tsx owns:

- current screen (`login`, `welcome`, `chat`)
- rendered messages
- text input state
- thinking state
- expand/collapse state for long messages
- command history navigation state
- one long-lived Engine instance

### 7.2 Screen modes

There are three screens:

1. `login`
2. `welcome`
3. `chat`

Login screen renders auth guidance.

Welcome screen appears after successful auth and waits for Enter.

Chat screen renders:

- conversation
- input bar
- status bar

### 7.3 Keyboard behavior

Current shortcuts include:

- `Ctrl+C` exit
- `Ctrl+L` clear conversation and reset engine state
- `Ctrl+M` expand/collapse long messages
- `Up` and `Down` navigate command history

### 7.4 Message rendering

src/ui/components/MessageList.tsx renders messages by role:

- `user`
- `assistant`
- `system`
- `error`

Long assistant/system messages are collapsed by default. Expansion is controlled globally for the view.

Important detail:

- the `show more` / `show less` text is not a mouse-click button
- expansion works through the command text or `Ctrl+M`

### 7.5 Step streaming

When the agent loop executes tools, intermediate tool results are rendered as `system` messages in real time through the `onStep` callback.

---

## 8. Execution Engine

The central runtime logic is in src/execution/engine.ts.

Engine responsibilities:

- own the conversation history for the current session
- handle deterministic command bypasses
- mediate confirmation flows
- maintain undo/redo history
- call the agent loop for multi-step reasoning
- persist visible turns into SQLite

### 8.1 Engine state

Important fields:

- `history`: rolling LLM conversation state
- `pendingConfirmation`: destructive action waiting for yes/no
- `pendingSelection`: disambiguation state for folder choices
- `undoStack`: reversible action history
- `sessionStore`: SQLite persistence layer
- `_sessionId`: current session id
- `sessionCreated`: whether this session has been persisted yet
- `lastSavedIdx`: last persisted history index

### 8.2 Session creation behavior

Sessions are created lazily.

This is important because older behavior created empty session rows on startup. Now a session row is only created once there is at least one turn to persist.

Only sessions with visible turns are considered resumable and shown in `fella sessions`.

### 8.3 send() flow

Engine.send() wraps sendInner() and always persists history delta afterward.

sendInner() processes requests in this order:

1. undo/redo bypass
2. bare acknowledgement bypass
3. pending selection handling
4. folder navigation shortcut
5. folder deletion shortcut
6. folder creation shortcut
7. simple navigation shortcut
8. latest-download shortcut
9. settings/control-panel shortcut
10. generic app-launch shortcut
11. confirmation gate
12. mock mode
13. agent loop

That ordering is intentional. For example, settings phrases must be intercepted before the generic `open <something>` app launcher.

### 8.4 Acknowledgement handling

Simple acknowledgements like `ok`, `okay`, `got it`, `thanks` are handled directly so the LLM does not repeat previous explanations unnecessarily.

If a confirmation is pending, `okay` is treated as confirmation.

### 8.5 Confirmation handling

Destructive actions are not executed immediately without a confirmation path.

Current confirmation words include values like:

- yes
- y
- confirm
- do it
- proceed
- ok
- okay
- sure

Cancel words include:

- no
- cancel
- stop
- abort

### 8.6 Undo/redo implementation

The undo stack is in src/execution/history.ts.

It stores reversible entries with:

- description
- undo function
- redo function

The engine records undo information for:

- file moves and renames
- folder creation
- file organization moves
- file deletion through its trash-move strategy

### 8.7 Persistence of visible history

When history changes, the engine stores new turns in SQLite and marks whether each turn is visible.

The UI reconstructs resumed sessions from visible turns only.

---

## 9. Agent Loop

The multi-step planner is in src/agent/loop.ts.

### 9.1 Purpose

It is responsible for repeated reasoning cycles until the model reaches a final response or step limit.

### 9.2 Loop state

State includes:

- goal
- messages
- steps
- stepCount
- maxSteps
- finished flag
- final response

### 9.3 Run flow

For each run:

1. Merge prior session history with the new user turn.
2. Load optional context from GUIDE.md and memory.
3. Call the LLM.
4. If the LLM returns a normal response, finish.
5. If it returns a tool call, execute the tool.
6. Append a synthetic assistant tool-call message and a synthetic user tool-result message.
7. Continue until finished or step limit.

### 9.4 Memory writeback

Every finished run is stored in the `memory` table with the goal, step list, and timestamp.

---

## 10. LLM Layer

The Groq integration lives in src/llm/ollama.ts even though the file still uses historical `Ollama*` naming in types.

### 10.1 Request configuration

Current runtime configuration:

- model: `llama-3.3-70b-versatile`
- base URL: `https://api.groq.com/openai/v1`
- response format: JSON object
- temperature: `0.1`
- retries for temporary errors

### 10.2 Runtime API key resolution

The API key is resolved lazily from:

- `process.env['GROQ_API_KEY']`
- fallback bundled define value if present

This means runtime environment values can override build-time bundled secrets.

### 10.3 System prompt

The system prompt is long and operationally important. It documents:

- allowed tools and their args
- path rules
- search-first behavior for fuzzy file requests
- refusal behavior for blocked system directories
- example JSON outputs
- response formatting contract

The current prompt includes these major tools:

- `findFile`
- `listFiles`
- `deleteFile`
- `moveFile`
- `screenAutomation`
- `openApplication`
- `createDirectory`
- `organiseByRule`
- `openSettings`

### 10.4 Tool validation

src/llm/schema.ts uses Zod to define:

- message schema
- chat request schema
- chat response schema
- JSON payload schema
- allowed tool name enum

Tool calls are validated against `TOOL_NAMES` before dispatch.

---

## 11. Persistence Layer

Persistence is in src/memory/store.ts and uses SQLite via better-sqlite3.

Database location:

- `%USERPROFILE%\.fella\memory.db`

### 11.1 Tables

Current tables are:

- `memory`
- `facts`
- `sessions`
- `session_turns`

### 11.2 memory table

Stores completed agent runs:

- goal
- serialized steps
- timestamp

### 11.3 facts table

Stores persistent facts for future context injection.

### 11.4 sessions table

Stores session metadata:

- id
- started_at
- last_at

### 11.5 session_turns table

Stores individual conversation turns:

- session_id
- role
- content
- timestamp
- visible flag

### 11.6 Session listing behavior

`listSessions()` only returns sessions with at least one visible turn.

`sessionExists()` also only treats non-empty sessions as resumable.

---

## 12. Context Loading

src/memory/context.ts loads extra context for each agent run.

It tries to read guide files in this order:

- `FELLA.md`
- `GUIDE.md`
- parent-folder variants of those files

Then it combines:

- guide snippet
- relevant recalled past actions
- persistent facts

This string is injected as a temporary system message for the run.

---

## 13. Security Model

The key safety layer is src/security/pathGuard.ts.

### 13.1 Allowed zones

Allowed file access is limited to:

- `C:\Users\...`
- `D:\...`

### 13.2 Blocked zones

Hard-blocked examples:

- `C:\Windows`
- `C:\Program Files`
- `C:\Program Files (x86)`
- `C:\ProgramData`
- `C:\System Volume Information`
- recovery and boot style system locations

### 13.3 Alias resolution

Common aliases resolve to real user folders:

- desktop
- documents
- downloads
- pictures
- music
- videos
- temp
- appdata
- localappdata
- home
- d:

The resolver is also aware of OneDrive-redirected Windows shell folders.

---

## 14. Tool Registry

The registry is in src/tools/registry.ts.

It maps canonical tool names to implementations and also accepts aliases the model may emit.

Examples of alias normalization:

- `mkdir` -> `createDirectory`
- `rm` -> `deleteFile`
- `rename` -> `moveFile`
- `settings` -> `openSettings`
- `open` -> `screenAutomation`

Dispatch goes through `executeTool(tool, args)`.

---

## 15. Tool Implementations

### 15.1 listFiles

Simple directory listing under the path-guard policy.

### 15.2 findFile

Fuzzy recursive search with:

- tokenized matching
- optional extension filters
- optional folder hint filtering
- score or recency sorting
- junk-directory avoidance
- fallback second pass if the clean pass finds nothing

This is the main discovery tool used before file opening, moving, or deleting when the exact filename is unknown.

### 15.3 deleteFile

Deletes a file or directory under policy constraints.

Engine-level handling wraps deletion in undo support by moving the item to a temporary trash area when possible.

### 15.4 moveFile

Moves or renames files and folders. Undo support records the inverse rename.

### 15.5 createDirectory

Creates directories recursively. Undo removes the folder only if it remains empty.

### 15.6 organiseByRule

Plans and optionally executes bulk file organization.

Supported rules:

- by_type
- by_category
- by_date
- by_size
- by_extension

The LLM is instructed to run this tool with `dry_run: true` first so users see a preview before execution.

### 15.7 openSettings

This tool opens:

- Windows Settings pages via `ms-settings:` URIs
- common Control Panel applets via `control.exe` or `.cpl` targets

Examples it supports:

- wifi
- bluetooth
- battery
- display
- updates
- control panel
- programs and features
- network connections

For Wi-Fi and network-related requests, it also returns the current `netsh wlan show networks` output when available.

### 15.8 openApplication

Legacy launcher for app opening. In practice, direct user-facing launches usually go through `screenAutomation` so the launch is visible.

### 15.9 screenAutomation

This tool handles:

- visible app launch
- Explorer navigation
- file opening through Explorer or default app
- screenshot
- OCR text search
- mouse move, click, and double-click
- keyboard typing and hotkeys
- scroll

Important distinction:

- `launch` uses visible Windows behavior
- `navigate` opens Explorer or a file
- advanced OCR, mouse, and keyboard features depend on nut-js availability

The tool also knows some virtual Windows folders such as:

- recycle bin
- this pc
- control panel
- network

---

## 16. Deterministic Shortcut Paths

Some requests bypass the LLM entirely because they are simpler and safer to route directly.

Current notable bypasses in the engine:

- undo and redo
- acknowledgements like `okay`
- folder navigation by name
- folder deletion by name
- create-folder phrasing
- simple `navigate to X`
- open latest downloaded file by type
- open settings and control-panel phrases
- short direct app-launch phrases

This reduces model dependency for obvious actions and improves reliability.

---

## 17. Session Semantics

Session ids look like:

```text
sess-YYYYMMDD-HHMM-rand
```

Behavior:

- a new engine gets a generated id immediately
- SQLite session row is created only on first persisted turn
- only visible turns are shown when resuming in the UI
- empty sessions are excluded from `fella sessions`

This was changed specifically to prevent large numbers of useless zero-message sessions.

---

## 18. Build and Packaging Pipeline

Defined in package.json.

### 18.1 `npm run typecheck`

Runs:

```text
tsc --noEmit
```

This checks types only and emits no files.

### 18.2 `npm run build`

Runs:

1. `npm run typecheck`
2. `npm run bundle`

`bundle` runs scripts/bundle.mjs, which bundles the app into dist/ with esbuild.

### 18.3 `npm run dist`

Runs the Windows distribution path.

Effects:

- runs `predist`
- kills any running `fella-win.exe`
- runs `build`
- packages the app into `bin/fella-win.exe` using caxa

### 18.4 `npm run sea`

Alternative packaging path using Node SEA artifacts.

---

## 19. Build Scripts

### scripts/bundle.mjs

Bundles src/index.tsx into dist/index.js.

It also injects env-backed define values for:

- `GROQ_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### scripts/postbundle.mjs

Adds runtime wrapper and shebang support and writes dist/run.cjs.

### scripts/predist.mjs

Prepares native pieces for Windows packaging and stub/icon work.

### scripts/sea.mjs

Builds the Node SEA path.

---

## 20. Environment Variables

Required for normal operation:

```env
GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Optional:

```env
FELLA_MOCK=1
FELLA_HOME=D:\path\to\install
```

Meaning:

- `GROQ_API_KEY`: required for LLM calls
- `SUPABASE_URL`: required for auth
- `SUPABASE_ANON_KEY`: required for auth
- `FELLA_MOCK=1`: bypasses the model and echoes mock responses
- `FELLA_HOME`: lets packaged launchers resolve a fixed `.env`

---

## 21. Known Behavioral Limits

Current limits to keep in mind:

- opening a settings page is supported; changing the actual setting is usually not implemented unless a dedicated action exists
- advanced screen automation depends on nut-js and native support
- long-message expansion is keyboard or command driven, not mouse-click driven
- the system is Windows-first; several behaviors are intentionally Windows-specific

---

## 22. Practical Mental Model

When debugging FELLA, think in this order:

1. Did index.tsx load the correct environment?
2. Is the request handled by an engine shortcut path?
3. If not, did the model emit a valid tool call?
4. Did the registry map the tool name correctly?
5. Did the tool hit a path-policy restriction?
6. Did the engine persist the resulting visible turns?

That is the real runtime chain for almost every user-visible behavior in the current implementation.

**`action: "launch"`**

1. Searches the user Start Menu (`%APPDATA%\Microsoft\Windows\Start Menu`) and system Start Menu (`%ProgramData%\Microsoft\Windows\Start Menu`) for a `.lnk` shortcut whose name matches the requested app — handles apps like "PC Remote Receiver" that have no `PATH` entry
2. If a shortcut is found → `Start-Process` the `.lnk` file directly
3. Otherwise → falls back to the Win+R `Shell.FileRun()` dialog using `RUN_DIALOG_MAP` (notepad, calc, code, wt, msedge, etc.)

**System directory guard:** before any of the above, `BLOCKED_SYSTEM_APPS` is checked. Attempting to launch `"program files"`, `"windows"`, `"system32"`, etc. throws `⛔ Access denied: Cannot open or launch system directories.`

**`action: "navigate"`**

1. System directory guard — rejects paths matching `C:\Windows`, `C:\Program Files`, `C:\ProgramData`, etc.
2. If `path` has a file extension (`.pdf`, `.mp4`, `.docx`, etc.) → opens directly with `cmd /c start "" <path>` (Windows shell default-app association)
3. Otherwise → resolves `path` via `pathGuard.resolvePath()` (supports aliases and virtual shell folders like `Recycle Bin`, `This PC`, `Control Panel`)
4. Opens Explorer to the folder with `cmd /c start "" <folderPath>`
5. If `file` is also given → waits 600ms for Explorer to open, then opens the file with `cmd /c start "" <filePath>`

**Other actions:** `screenshot`, `find_text` (OCR), `click`, `double_click`, `move`, `type`, `key`, `hotkey`, `scroll` — all delegate to `@nut-tree-fork/nut-js` loaded lazily on first use.

#### `organiseByRule` — File Organiser

Two-phase execution for safety:

**Phase 1 — `dry_run: true`** (default): calls `buildPlan()` which scans the source directory and groups files according to the rule, then `formatPreview()` prints a grouped summary (folder name, file count, total size). The engine stores a `pendingConfirmation` so the user must type "yes" to proceed.

**Phase 2 — `dry_run: false`** (after confirmation): `executePlan()` performs `fs.renameSync` for each planned move, skips destinations that already exist, collects errors, and returns a summary.

**Rules:**

| Rule | Logic |
|---|---|
| `by_type` | Broad category groups: Images, Videos, Audio, Documents, Spreadsheets, Presentations, Archives, Code, Installers, Other (60+ extension map) |
| `by_extension` | One folder per raw extension uppercased (e.g. `PNG`, `PDF`) |
| `by_date` | `YYYY/Month Name` folders by file modification time |
| `by_size` | Small (< 1 MB), Medium (1–100 MB), Large (100 MB–1 GB), Huge (> 1 GB) |
| `by_category` | Similar to `by_type` but coarser grouping |

`since` parameter filters to only include files modified on or after a cut-off: `"last_week"`, `"last_month"`, `"last_3_months"`, `"last_year"`, or an ISO date string.

#### `deleteFile`

Soft-delete: moves the file to `%TEMP%/.fella-trash/<timestamp>_<name>` instead of permanent deletion. The engine's undo stack records the reverse `rename`. The file is only permanently gone after the session ends or the user manually empties the trash folder.

**Delete confirmation gate:** the engine never calls `deleteFile` directly from the agentic loop. Instead, encountering `deleteFile` in a tool-call sets `pendingConfirmation` and replies with *"Are you sure you want to delete '...'? Type 'yes' to confirm or 'no' to cancel."*

#### `moveFile`

`fs.rename` with safety guarantees:
- Throws if source does not exist (`access()` check)
- Throws if destination already exists (no silent overwrites)
- Creates parent directories when `create_parent: true` (default)

#### `listFiles`

`readdirSync` with `withFileTypes: true`. Prefixes each entry with `[DIR]` or `[FILE]`.

#### `createDirectory`

`fs.mkdir` with `{ recursive: true }` — equivalent to `mkdir -p`.

---

### Security (Path Guard)

**`src/security/pathGuard.ts`**

`resolvePath(raw)` is called by every tool before touching the file system. `assertAllowed(absPath)` is called after resolution to enforce the access policy.

#### Resolution Order

1. **Alias match** — the input is lowercased with spaces/hyphens/underscores collapsed, looked up in `KNOWN_FOLDERS`
2. **Alias prefix** — `"desktop/Test"` → resolve `desktop` alias then join `Test`
3. **Absolute path** — passed through `path.resolve()` for normalisation
4. **Relative path** — resolved relative to the user's home directory

**Windows Shell special folders** (`Desktop`, `Documents`, `Pictures`, `Music`, `Videos`, `Downloads`) are resolved at startup via PowerShell `[Environment]::GetFolderPath()` and the Shell.Application COM object — this correctly handles OneDrive-redirected paths.

#### Access Policy

```
HARD BLOCK — system directories (checked first):
  C:\Windows\          C:\Program Files\
  C:\Program Files (x86)\   C:\ProgramData\
  C:\System Volume Information\   C:\Recovery\   C:\Boot\   C:\EFI\

Error: ⛔ Access denied: Cannot access system files or directories.
       "..." is a protected system path.
       Modifying system files could break your computer's configuration.

ALLOWED ZONES:
  C:\Users\   — the current user's home tree (Documents, Desktop, Downloads, etc.)
  D:\         — entire D drive, any folder or file

BLOCKED (all else on C:\, and any other drive):
  Error: Access denied: "..." is outside the allowed zones.
```

This three-layer system means a request to touch system files is refused at:
1. **LLM level** — the system prompt instructs the model to refuse and not call any tool
2. **Tool level** — `actionLaunch` and `actionNavigate` in `screenAutomation.ts` check `BLOCKED_SYSTEM_APPS` before executing
3. **Path guard level** — `assertAllowed()` in `pathGuard.ts` blocks all other tools from resolving system paths

---

## Build System

### Bundler: esbuild

`scripts/bundle.mjs` runs:

```
esbuild src/index.tsx
  --bundle
  --platform=node
  --format=esm
  --outfile=dist/index.js
  --external:@nut-tree-fork/nut-js    # native addon — bundled separately via predist
  --external:better-sqlite3           # native addon — bundled separately via predist
  --external:trash                    # native ESM — bundled separately via predist
  --alias:react-devtools-core=./src/stubs/devtools-stub.js
  --define:process.env.GROQ_API_KEY="<key>"   # inlined from .env at build time
  --define:process.env.SUPABASE_URL="<url>"
  --define:process.env.SUPABASE_ANON_KEY="<key>"
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
```

The `--banner` injects a CJS `require` shim so native modules loaded via `require()` work inside an ESM bundle. The `--define` flags inline secrets at bundle time so the distributed exe does not need a `.env` file to access the API.

**TypeScript** is used for type-checking only (`tsc --noEmit`). esbuild strips types without type-checking.

**`scripts/postbundle.mjs`:**
1. Prepends a `#!/usr/bin/env node` shebang to `dist/index.js` (needed for `npx fella` from npm)
2. Writes `dist/run.cjs` — a tiny CJS wrapper that `require()`s `dist/index.js`; caxa uses this as the entry point because caxa's bundled Node.js launches via `node {{caxa}}/run.cjs`

---

## Distribution & Icon Stamping

### `npm run dist` — Full Build Pipeline

The complete pipeline that produces `bin/fella-win.exe`:

```
predist → typecheck → bundle → postbundle → caxa
```

#### `predist` (`scripts/predist.mjs`)

1. Writes a minimal `dist/package.json` with `type: "module"`
2. Runs `npm install --prefix dist --omit=dev --no-save @nut-tree-fork/nut-js better-sqlite3 trash` — installs native packages with their compiled `.node` addons into `dist/node_modules/` so caxa bundles them inside the exe
3. Copies `assets/` → `dist/assets/`
4. **Icon stamping on the caxa stub** (Windows only):
   - Copies `node_modules/caxa/stubs/stub--win32--x64` → `dist/fella-stub.exe`
   - Runs `rcedit.exe dist/fella-stub.exe --set-icon assets/FELLA_CAT.ico`
   - **Re-appends `\nCAXACAXACAXA\n`** to restore the caxa archive separator

> **Why re-append the separator?**
> The caxa Go stub uses `bytes.Index(executable, "\nCAXACAXACAXA\n")` at runtime to find the boundary between the PE stub and the appended tar archive. rcedit rewrites the PE resource section and in doing so strips the last 14 bytes of the file — which happen to be exactly this separator. Without them the exe launches and immediately prints "Failed to find archive". Stamping the _stub_ (before caxa appends anything) and then re-appending the separator solves the problem: the stub stays valid, caxa appends the tar archive after the separator as normal, and the resulting exe works correctly.

#### `caxa` invocation

```
caxa --input dist --output bin/fella-win.exe --stub dist/fella-stub.exe -- node "{{caxa}}/run.cjs"
```

caxa copies the entire `dist/` folder into a temporary build directory, tar-gzips it, appends the archive to the stub exe, appends a JSON footer with the command and a random identifier, and writes the result to `bin/fella-win.exe`.

At runtime, the stub extracts the archive to `%LOCALAPPDATA%\Temp\caxa\applications\fella-win\<id>\` on first launch and caches it for subsequent launches.

### `npm run sea` — Node.js SEA (Alternative)

An alternative build path using Node.js Single Executable Applications (`node --experimental-sea-config`). Downloads the official `node.exe` from nodejs.org (to guarantee the SEA fuse is present), injects the blob via `postject`, and stamps the icon with rcedit. See `scripts/sea.mjs` for details.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | (inlined at build) | Groq API key — bundled via esbuild `--define` |
| `SUPABASE_URL` | (inlined at build) | Supabase project URL |
| `SUPABASE_ANON_KEY` | (inlined at build) | Supabase anonymous (public) key |
| `FELLA_HOME` | `""` | Set by `fella.bat` to the install directory; used as the first `.env` candidate path |
| `FELLA_MOCK` | `""` | Set to `1` to bypass Groq entirely and echo input as mock responses; useful for UI testing |
| `TEMP` | `%LOCALAPPDATA%\Temp` | Used by `pathGuard` to resolve the `temp`/`tmp` alias, and as the soft-delete trash location |

---

## Available npm Scripts

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — type-check without emitting files |
| `npm run bundle` | Bundles `src/index.tsx` → `dist/index.js` with esbuild |
| `npm run build` | `typecheck` + `bundle` |
| `npm run dist` | Full pipeline: `predist` → `build` → `caxa` → `bin/fella-win.exe` |
| `npm run sea` | SEA pipeline: `build` → `scripts/sea.mjs` → `bin/fella-win.exe` |

---

## Keyboard Shortcuts

| Keys | Action |
|---|---|
| `Enter` | Send message / confirm welcome screen |
| `ctrl+c` | Exit the application |
| `ctrl+l` | Clear conversation and reset engine history |

---

## Common Queries the Engine Handles

| User says | What happens |
|---|---|
| `"open Unit 2.pdf"` | `findFile` searches for "Unit 2" with `.pdf` extension → model confirms → `navigate` opens file with default app |
| `"open the recent pdf in the OOSE folder somewhere in D drive"` | `findFile` with `folder_hint="OOSE"`, `sort_by="recent"`, `dir="d:"` — skips `$RECYCLE.BIN` and `node_modules`; finds `D:\College\...\OOSE\*.pdf` |
| `"organise my downloads by file type"` | `organiseByRule` with `dry_run=true` shows preview → user types "yes" → files moved |
| `"delete old notes.txt from desktop"` | Engine intercepts `deleteFile`, asks for confirmation → user types "yes" → soft-deleted to `.fella-trash` |
| `"undo"` | `UndoStack.undo()` reverses the last file operation |
| `"open program files"` | Blocked at LLM, `actionLaunch`, and `pathGuard` — all three layers refuse |
| `"navigate to downloads"` | Keyword bypass — opens Explorer directly without calling the LLM |
| `"open notepad"` | Keyword bypass attempts Start Menu search; falls back to Win+R `notepad` |


Implemented. FELLA now has a cross-platform runtime path for Windows, macOS, and Linux, while keeping the same agent loop, tool registry, persistence, auth, and UI layers intact.

What I changed

Platform abstraction helpers
Added runtime.ts to centralize OS detection and default roots/aliases used by engine and tools.
Cross-platform safe path policy
Replaced Windows-only guard with OS-aware policies in pathGuard.ts.
Windows: keeps existing C:\Users + D:\ model and blocks system folders.
macOS: allows user home, /Volumes, temp; blocks system roots.
Linux: allows user home, /media, /mnt, temp; blocks system roots.
Kept alias resolution behavior (downloads/documents/desktop/etc.) across all OSes.
Engine + search default roots now OS-aware
Updated engine.ts to use platform-aware search roots and folder alias matching.
Updated findFile.ts to use platform-aware default search directories.
Settings support across platforms
Reworked openSettings.ts:
Windows keeps existing ms-settings/control panel behavior.
macOS opens System Settings with per-setting URI mapping + fallback.
Linux opens desktop settings via gnome-control-center/systemsettings/xfce/xdg-open fallbacks.
Battery status now supports Windows, macOS (pmset), and Linux (upower/acpi).
Screen automation launch/navigation portability
Updated screenAutomation.ts:
launch now works on macOS/Linux (mapped app names + launcher fallbacks) while preserving Windows launch flow.
navigate now opens folders/files with OS default opener on all platforms.
Open application fallback on Linux
Updated openApplication.ts to launch executable names directly on Linux fallback.
LLM prompt made platform-aware
Updated ollama.ts so planning and safety instructions are no longer Windows-only.
Validation performed

Ran TypeScript compile check: npm run typecheck
Result: passes with no errors.
Important note on “no compromise” requirement

Core FELLA architecture and features are preserved across platforms.
A few OS-level actions depend on what is installed on the host (example: Linux settings frontends, app command availability), so behavior uses robust fallbacks rather than hard failure.
This is the practical way to keep feature parity while remaining platform-independent.
Next step I recommend

I can now add a CI OS matrix (Windows/macOS/Linux) with smoke tests for tool actions so cross-platform behavior is continuously verified.
GPT-5.3-Codex • 1x