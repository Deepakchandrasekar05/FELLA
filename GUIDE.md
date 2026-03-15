# FELLA CLI — Implementation Guide

File Exploration and Local Logic Automation.

This guide explains how the current codebase works end to end: startup flow, auth, UI, engine, tool routing, persistence, build pipeline, and environment configuration. It documents the implementation that exists now in the repository.

---

## 1. What FELLA Is

FELLA is a Windows-first terminal assistant that accepts natural-language requests and turns them into:

- file-system actions
- Windows Explorer navigation
- app launches
- screen automation actions
- Windows Settings and Control Panel navigation

The app is not a generic shell wrapper. The main behavior is agentic:

1. The user types a request in the Ink terminal UI.
2. The execution engine decides whether the request can be handled by a deterministic shortcut path.
3. If not, the request goes through the LLM agent loop.
4. The model emits either a final response or a structured tool call.
5. Tools execute inside policy constraints.
6. Tool results are fed back into the model until the task is complete.
7. Visible conversation turns are persisted as a resumable session.

---

## 2. Runtime Stack

The current stack is:

- TypeScript for source code
- Node.js 18+ as runtime
- Ink + React for terminal UI
- OpenAI SDK pointed at Groq's OpenAI-compatible endpoint
- Supabase for authentication
- better-sqlite3 for local persistence
- execa for process spawning
- nut-js for OCR, mouse, and keyboard automation
- esbuild for bundling
- caxa for Windows packaging

---

## 3. High-Level Architecture

The main runtime path is:

```text
CLI startup
  -> src/index.tsx
  -> dotenv resolution
  -> auth command handling or TUI launch
  -> src/ui/App.tsx
  -> src/execution/engine.ts
  -> shortcut bypass OR src/agent/loop.ts
  -> src/tools/registry.ts
  -> concrete tool implementation
  -> result back to UI and session storage
```

There are four main layers:

1. Entry and auth layer
2. Terminal UI layer
3. Execution engine and agent loop
4. Tooling, storage, and safety layer

---

## 4. Project Structure

Important files and folders:

```text
src/
  index.tsx                  Entry point and CLI command routing
  sea-entry.cjs              SEA bootstrap entry

  agent/
    loop.ts                  Multi-step agent loop

  auth/
    client.ts                Lazy Supabase client and auth token storage
    commands.ts              signup/login/logout/google/whoami commands
    email.ts                 Email auth helpers
    google.ts                OAuth flow and callback server
    session.ts               Auth-related persistence helpers
    supabase.ts              Alternate lazy client helper

  execution/
    engine.ts                Main conversation engine and shortcut routing
    history.ts               Undo/redo stack

  llm/
    client.ts                Thin adapter around the Groq client
    ollama.ts                Groq request layer and system prompt
    schema.ts                Zod schemas and allowed tool names

  memory/
    context.ts               Loads guide + recall + facts as extra context
    store.ts                 SQLite persistence for memory and sessions

  security/
    pathGuard.ts             Alias resolution and path allow/block policy
    validator.ts             Input validation helpers

  tools/
    registry.ts              Tool registry and alias mapping
    createDirectory.ts       Create folder tool
    deleteFile.ts            Delete tool
    findFile.ts              Fuzzy file search
    listFiles.ts             Directory listing
    moveFile.ts              Move/rename tool
    openApplication.ts       Legacy app launcher
    openSettings.ts          Windows Settings and Control Panel launcher
    organiseByRule.ts        File organisation planner/executor
    screenAutomation.ts      GUI automation and Explorer/app navigation

  ui/
    App.tsx                  Root Ink app
    components/
      Header.tsx             Branding header
      InputBar.tsx           Terminal input
      MessageList.tsx        Message renderer
      StatusBar.tsx          Shortcut hints and session id
```

Generated/runtime outputs:

- dist/ contains bundled app artifacts
- bin/fella-win.exe is the packaged Windows executable
- %USERPROFILE%\.fella\memory.db stores sessions and memory
- %USERPROFILE%\.fella\auth.json stores auth tokens

---

## 5. Startup Flow

The app starts in src/index.tsx.

### 5.1 .env resolution

The app tries these .env locations in order:

1. `%FELLA_HOME%\.env`
2. `<runtime_dir>\..\.env`
3. `<cwd>\.env`

It loads the first one that exists using dotenv with `override: true`.

This supports:

- local source execution
- bundled dist execution
- packaged executable execution

### 5.2 CLI command handling

Before the TUI starts, index.tsx handles these commands directly:

- `fella signup`
- `fella login`
- `fella login --google`
- `fella logout`
- `fella whoami`
- `fella sessions`
- `fella resume --session_id <id>`
- `fella resume <id>`

If the command is `sessions`, the app reads local SQLite session summaries and exits.

If the command is `resume`, it validates that the session exists and contains visible turns before launching the UI with that session id.

### 5.3 Auth gate loop

If no valid token is available, the app renders a login-mode UI first. After successful auth, it re-checks token validity and then renders the main authenticated app.

---

## 6. Authentication Implementation

Auth is implemented with Supabase.

### 6.1 Lazy client initialization

The main client is in src/auth/client.ts.

The Supabase client is created lazily because ESM imports happen before dotenv has loaded environment values. The module exposes a Proxy so callers can still write `supabase.auth...` normally.

Required env keys:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

If either is missing, the process exits with an explicit configuration error.

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
