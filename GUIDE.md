# FELLA CLI — Developer Guide

**File Exploration and Local Logic Automation**  
An agentic, AI-powered command-line tool that lets you control the Windows file system using natural language.

---

## Table of Contents

1. [What is Fella?](#what-is-fella)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture Overview](#architecture-overview)
5. [Module-by-Module Implementation](#module-by-module-implementation)
   - [Entry Point](#entry-point)
   - [Authentication](#authentication)
   - [UI Layer (Ink / React)](#ui-layer-ink--react)
  - [Agent Loop & Memory](#agent-loop--memory)
   - [Execution Engine](#execution-engine)
   - [LLM Layer (Groq)](#llm-layer-groq)
   - [Tools](#tools)
   - [Security (Path Guard)](#security-path-guard)
6. [Build System](#build-system)
7. [Distribution & Icon Stamping](#distribution--icon-stamping)
8. [Environment Variables](#environment-variables)
9. [Available npm Scripts](#available-npm-scripts)
10. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## What is Fella?

Fella is a terminal-based AI assistant that accepts natural-language commands and translates them into file-system actions. The user types something like *"open the recent pdf from the OOPS folder in D drive"* and Fella:

1. Sends the message to Groq's API (llama-3.3-70b-versatile)
2. Receives a structured JSON tool-call from the model
3. Executes the appropriate tool (e.g. `findFile` → `screenAutomation`)
4. Injects the tool result back into the conversation so the model can plan the next step
5. Continues up to 8 tool-call iterations until the task is complete
6. Renders the final result back in the terminal

The engine is fully agentic — it plans multi-step tasks, confirms destructive operations, and never guesses file paths.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Language** | TypeScript | `^5.9` | Strict, type-safe source code |
| **Runtime** | Node.js | ≥ 18 | ESM runtime, native `fetch` |
| **Terminal UI** | [Ink](https://github.com/vadimdemedes/ink) | `^6.8` | React-based terminal rendering |
| **UI Framework** | React | `^19.2` | Component model inside Ink |
| **Text Input** | [ink-text-input](https://github.com/vadimdemedes/ink-text-input) | `^6.0` | Controlled input field in the terminal |
| **Spinner** | [ink-spinner](https://github.com/vadimdemedes/ink-spinner) | `^5.0` | Animated thinking indicator |
| **LLM Backend** | [Groq](https://groq.com/) | cloud API | llama-3.3-70b-versatile via OpenAI-compatible API |
| **Auth** | [Supabase](https://supabase.com/) | `^2.98` | Email/password + Google OAuth with PKCE flow |
| **Schema Validation** | [Zod](https://zod.dev/) | `^4.3` | Runtime validation of all API payloads |
| **Process Spawning** | [execa](https://github.com/sindresorhus/execa) | `^9.6` | Safe cross-platform process execution |
| **Database** | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | `^12.6` | Cross-session memory store in `~/.fella/memory.db` |
| **Screen Automation** | [@nut-tree-fork/nut-js](https://nutjs.dev/) | `^4.2` | Mouse, keyboard, OCR-based screen control |
| **Env Loading** | [dotenv](https://github.com/motdotla/dotenv) | `^17.3` | `.env` loading with multiple candidate paths |
| **Safe Delete** | [trash](https://github.com/sindresorhus/trash) | `^10.1` | Sends files to the OS recycle bin |
| **Bundler** | [esbuild](https://esbuild.github.io/) | `^0.25` | Fast ESM bundle for distribution |
| **Type Checker** | TypeScript `tsc` | `^5.9` | Type-check only (`noEmit: true`) |
| **Distribution** | [caxa](https://github.com/nicolo-ribaudo/caxa) | `^3.0` | Self-contained Windows exe (bundles Node.js) |
| **Icon Stamping** | [rcedit](https://github.com/electron/rcedit) | `^1.1` | Embeds `.ico` into the caxa stub PE |
| **Dev Runner** | [tsx](https://github.com/esbuild-kit/tsx) | `^4.21` | Run TypeScript directly for development |

---

## Project Structure

```
fella/
├── assets/
│   ├── FELLA_CAT.png           # Source logo image
│   ├── FELLA_CAT.ico           # Generated .ico (via scripts/gen-ico.mjs)
│   └── logo.png                # README banner
├── bin/
│   └── fella-win.exe           # Built Windows executable (generated, not committed)
├── dist/                       # esbuild + caxa build output (generated)
│   ├── index.js                # Bundled ESM entry
│   ├── run.cjs                 # CJS wrapper for caxa
│   ├── fella-stub.exe          # Icon-stamped caxa stub (generated in predist)
│   └── node_modules/           # Native modules bundled for caxa
├── scripts/
│   ├── bundle.mjs              # esbuild invocation
│   ├── postbundle.mjs          # Writes CJS wrapper + prepends shebang
│   ├── predist.mjs             # Installs native modules, stamps icon on caxa stub
│   ├── postdist.mjs            # Optional post-dist icon/version stamping helper
│   ├── gen-ico.mjs             # Converts FELLA_CAT.png → multi-size .ico
│   └── sea.mjs                 # Node.js SEA binary builder (alternative path)
├── src/
│   ├── index.tsx               # Entry point — dotenv, auth CLI, launches TUI
│   ├── agent/
│   │   └── loop.ts             # ReAct loop state machine (THINK → ACT → OBSERVE)
│   ├── auth/
│   │   ├── client.ts           # Lazy Supabase client (Proxy) + token storage
│   │   ├── commands.ts         # login, logout, signup, whoami, loginWithGoogle CLI commands
│   │   ├── email.ts            # Email/password sign-in and sign-up flows
│   │   ├── google.ts           # Google OAuth with PKCE + local callback server
│   │   ├── session.ts          # Token persistence in ~/.fella/auth.json
│   │   └── supabase.ts         # Lazy getSupabase() helper
│   ├── execution/
│   │   ├── engine.ts           # Stateful agentic conversation engine
│   │   └── history.ts          # Undo/Redo stack
│   ├── llm/
│   │   ├── client.ts           # LLM adapter consumed by AgentLoop
│   │   ├── ollama.ts           # Groq API client + full system prompt
│   │   └── schema.ts           # Zod schemas for all LLM API types + TOOL_NAMES
│   ├── memory/
│   │   ├── context.ts          # Goal-aware context loader (guide + recall + facts)
│   │   └── store.ts            # SQLite memory store (save/recall/facts)
│   ├── persistence/
│   │   └── audit.ts            # Reserved for future audit logging
│   ├── security/
│   │   ├── pathGuard.ts        # Path alias resolution, access policy, system dir block
│   │   └── validator.ts        # Input validation helpers
│   ├── stubs/
│   │   └── devtools-stub.js    # No-op stub replacing react-devtools-core in prod
│   ├── tools/
│   │   ├── registry.ts         # Tool dispatch table + alias resolution
│   │   ├── findFile.ts         # Fuzzy recursive file search with two-pass junk filtering
│   │   ├── createDirectory.ts  # mkdir -p wrapper
│   │   ├── deleteFile.ts       # Soft-delete via trash staging area
│   │   ├── listFiles.ts        # readdir wrapper
│   │   ├── moveFile.ts         # rename wrapper (no silent overwrites)
│   │   ├── openApplication.ts  # Legacy app launcher (delegates to screenAutomation)
│   │   ├── organiseByRule.ts   # Batch file organiser (dry-run + execute)
│   │   └── screenAutomation.ts # Mouse, keyboard, navigate, launch via nut-js + PowerShell
│   └── ui/
│       ├── App.tsx             # Root component — auth gate, screen routing, state
│       └── components/
│           ├── Header.tsx      # ASCII-art FELLA logo + version badges
│           ├── InputBar.tsx    # Prompt glyph + TextInput
│           ├── MessageList.tsx # Scrollable conversation thread
│           └── StatusBar.tsx   # Keyboard shortcut hints
├── sea-config.json             # Node.js SEA blob configuration
├── tsconfig.json               # TypeScript configuration
└── package.json                # Dependencies and npm scripts
```

---

## Architecture Overview

```
User Input (keyboard)
        │
        ▼
  ┌─────────────┐    auth gate    ┌─────────────────────┐
  │  index.tsx  │ ──────────────► │  Supabase Auth       │
  │  (entry)    │                 │  email / Google PKCE │
  └──────┬──────┘                 └─────────────────────┘
         │ render(<App />)
         ▼
  ┌─────────────┐
  │  Ink / React│  src/ui/ — renders to stdout via Ink
  │  App.tsx    │
  └──────┬──────┘
         │ handleSubmit()
         ▼
  ┌──────────────────────────────────────────────────────┐
  │  Engine  (src/execution/engine.ts)                   │
  │                                                      │
  │  ┌─────────────────────────────────────────────────┐ │
  │  │              Agentic Loop (max 8 steps)         │ │
  │  │                                                 │ │
  │  │  history ──► Groq API ──► payload               │ │
  │  │                               │                 │ │
  │  │              tool call?  ◄────┤                 │ │
  │  │                  │            │                 │ │
  │  │           executeTool()   response?             │ │
  │  │                  │            │                 │ │
  │  │        [Tool result] ──►      │                 │ │
  │  │         push to history       │                 │ │
  │  │         continue loop    return to user         │ │
  │  └─────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────────────────────────────────────────┐
  │  Tool Registry  (src/tools/registry.ts)             │
  │                                                     │
  │  findFile | listFiles | deleteFile | moveFile       │
  │  createDirectory | organiseByRule | screenAutomation│
  └──────────────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────────────────────────────────────────┐
  │  pathGuard.ts                                       │
  │  alias → absolute path                              │
  │  system dir block (Windows, Program Files, etc.)    │
  │  zone check (C:\Users\ or D:\ only)                 │
  └─────────────────────────────────────────────────────┘
```

---

## Module-by-Module Implementation

### Entry Point

**`src/index.tsx`**

The entry point loads environment variables, handles auth CLI sub-commands, then either boots the TUI directly (if already authenticated) or shows the auth screen.

**Environment loading — three candidates in priority order:**
1. `$FELLA_HOME/.env` — set by `fella.bat` to point at the install directory; ensures the bundled exe finds its `.env` at runtime regardless of cwd
2. `dist/../.env` — relative to the real script path; works during development
3. `cwd/.env` — last-resort fallback

`dotenv.config({ quiet: true })` is used to suppress the dotenv version banner.

**Auth CLI sub-commands:**

| Argument | Behaviour |
|---|---|
| `signup` | Runs interactive email/password sign-up, then exits |
| `login` | Runs interactive email/password sign-in, then falls through to TUI |
| `login --google` | Runs Google OAuth, then falls through to TUI |
| `logout` | Clears stored token, exits |
| `whoami` | Prints the currently logged-in email, exits |

After `login` or `login --google` the process does **not** exit — it falls through and renders `<App />` immediately so the user lands in the chat screen.

**Auth gate loop:** if no valid token exists at startup, renders the unauthenticated `<App />` which displays login options. Once the user chooses a method and authenticates, the loop re-runs `refreshIfNeeded()` and renders the authenticated TUI.

---

### Authentication

#### `src/auth/client.ts` — Lazy Supabase Client

Supabase reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `process.env`. Because ES module top-level imports are hoisted and run before `dotenv.config()`, a naive `createClient(process.env.SUPABASE_URL, ...)` at module level would always receive `undefined`.

The fix is **lazy initialisation via a `Proxy`**:

```ts
let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!_client) {
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_ANON_KEY'];
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not set');
    _client = createClient(url, key, {
      auth: {
        flowType: 'pkce',        // required for Google OAuth
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) { return Reflect.get(getClient(), prop); },
});
```

`flowType: 'pkce'` is required for Google OAuth to work. Without it the callback URL does not carry an auth code and the sign-in fails with "No auth code received".

#### `src/auth/google.ts` — Google OAuth (PKCE)

1. Generates a Supabase OAuth URL with `redirectTo: 'http://localhost:54321/callback'`
2. Spins up a temporary `http.createServer` on port 54321
3. Opens the URL in the default browser via `execa('cmd', ['/c', 'start', url])`
4. The server captures the callback, exchanges the auth code for a session via Supabase, stores the token in `~/.fella/auth.json`, and tears itself down

#### `src/auth/session.ts` — Token Persistence

Tokens are stored at `~/.fella/auth.json`. `refreshIfNeeded()` reads the file, checks the expiry, calls `supabase.auth.refreshSession()` if within 60 seconds of expiry, and writes the new token back.

---

### UI Layer (Ink / React)

Ink renders React component trees to the terminal using Yoga (flexbox layout engine). All standard React hooks work.

#### `App.tsx` — Root Component

Top-level state:

| State | Type | Purpose |
|---|---|---|
| `screen` | `'welcome' \| 'chat'` | Controls which screen is shown |
| `messages` | `Message[]` | Full conversation history for display |
| `input` | `string` | Current text-input value |
| `isThinking` | `boolean` | Locks input while awaiting the model |
| `engineRef` | `Ref<Engine>` | Single long-lived conversation engine |

**Screen flow:**
- On launch → `welcome` screen (logo + "Press Enter to continue")
- Bare `Enter` → transitions to `chat` screen (handled by `useInput`)
- `ctrl+c` → exits at any time
- `ctrl+l` → clears messages and resets the engine history

`InputBar` and `StatusBar` are only rendered on the `chat` screen — the welcome screen hides the input field so users cannot type before pressing Enter.

**`handleSubmit()`** appends the user message to `messages`, calls `engine.send()`, streams step events in real time, then appends the assistant reply (or an error) when the promise resolves.

The chat now renders live system updates in this format:
- `Step N -> THINK: ...`
- `Step N -> ACT: tool(args)`
- `Step N -> OBSERVE: result`

These messages come from the `onStep` callback emitted by the ReAct loop.

#### `Header.tsx`

Renders the ASCII-art FELLA logo box-drawing art, subtitle, and version/badge pills.

#### `MessageList.tsx`

Renders the conversation thread. Each `Message` has role, content, and timestamp.

| Role | Glyph | Colour |
|---|---|---|
| `user` | `❯` | `#6CB6FF` (blue) |
| `assistant` | `◆` | `#E8865A` (orange) |
| `system` | `·` | `#555555` (dim grey) |
| `error` | `✕` | `#FF6B6B` (red) |

While `isThinking` is true a `<Spinner>` with "thinking…" is appended.

#### `InputBar.tsx`

Renders the `❯` prompt glyph and an `ink-text-input` controlled by `App`'s `input` state. While `isThinking` is true the input is replaced with a greyed-out "waiting for response…" label.

#### `StatusBar.tsx`

Fixed row of keyboard-shortcut hints: `ctrl+c → exit`, `ctrl+l → clear`, `enter → send`.

---

### Agent Loop & Memory

#### `src/agent/loop.ts` — ReAct Orchestrator

`AgentLoop` now owns the tool-use reasoning cycle:

1. Builds state (`goal`, `messages`, `steps`, `stepCount`, `maxSteps`)
2. Injects cross-session context with `ContextLoader.load(userInput)`
3. Repeats THINK → ACT → OBSERVE until completion or step limit
4. Emits each executed step via `onStep(step)` for live UI rendering
5. Persists the run via `MemoryStore.save(...)`

The loop supports pluggable execution policy through `executeTool(...)`, which the engine uses to enforce confirmations for destructive actions.

#### `src/memory/store.ts` — SQLite Memory

Memory is persisted in `~/.fella/memory.db` using two tables:

- `memory`: stores completed runs (`goal`, serialized `steps`, `timestamp`)
- `facts`: stores persistent user facts (`fact`, `source`, `timestamp`)

Implemented methods:

1. `save(entry)` stores each run
2. `recall(currentGoal, limit)` returns relevant past runs using keyword matching
3. `saveFact(fact, source)` stores long-lived facts
4. `getFacts()` returns facts for context injection

#### `src/memory/context.ts` — Goal-Aware Context Loader

`ContextLoader.load(currentGoal)` combines:

1. Project guide context (`FELLA.md`/`GUIDE.md` candidates)
2. Relevant recalled actions from `MemoryStore.recall(...)`
3. Persistent facts from `MemoryStore.getFacts()`

This gives FELLA continuity across app restarts while still using in-session chat history for short-term context.

---

### Execution Engine

**`src/execution/engine.ts`** — `class Engine`

One instance per session, created via `useRef` in `App.tsx`.

#### State

| Field | Type | Purpose |
|---|---|---|
| `history` | `OllamaMessage[]` | Rolling chat history sent to Groq on every turn |
| `pendingConfirmation` | `PendingConfirmation \| null` | Destructive tool call awaiting yes/no |
| `undoStack` | `UndoStack` | Reversible operations for undo/redo |

#### `send(userMessage, onStep?)` — Full Flow

1. **Undo/Redo bypass** — regex matches `"undo"` / `"redo"` variants and delegates to `undoStack` without touching the LLM
2. **Confirmation gate** — if `pendingConfirmation` is set, check whether the message is a confirm or cancel word. If yes → execute the stored tool. If no → cancel with "Cancelled — no changes were made."
3. **Keyword bypasses** — a small set of unambiguous patterns are handled without the LLM:
   - `"create a folder on X called Y"` → directly calls `createDirectory`
   - `"navigate to X"` / `"go to X"` (simple known folder aliases only) → directly calls `screenAutomation navigate`
   - `"open the last downloaded <type>"` → directly scans the Downloads folder sorted by mtime
4. **ReAct delegation** — calls `AgentLoop.run(userMessage, history, onStep)`
   - engine supplies the execution policy hook (`executeAgentTool`)
   - delete/organise confirmations are enforced before destructive actions
   - emitted steps are forwarded to the UI through `onStep`
   - normalized loop messages are written back to `history`
5. **`executeWithHistory()`** wraps every tool call with undo recording:
   - `deleteFile` → soft-delete: moves file to `%TEMP%/.fella-trash/<timestamp>_<name>` and records an undo that moves it back
   - `moveFile` → records inverse rename as undo
   - `createDirectory` → records non-recursive `rmdir` as undo (only succeeds if folder is still empty)
   - `organiseByRule` → captures the exact list of moves made and records them individually

#### `src/execution/history.ts` — Undo/Redo Stack

```ts
interface HistoryEntry {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}
```

`undoStack.undo()` pops the last entry, calls its `undo()` function, and pushes it onto the redo stack. `redo()` reverses this. Both return a human-readable confirmation string.

---

### LLM Layer (Groq)

#### `src/llm/schema.ts`

All API types defined with Zod:

Note: schema/type identifiers keep an `Ollama*` prefix for backward compatibility,
even though runtime requests are sent to Groq.

| Schema | Description |
|---|---|
| `OllamaMessageSchema` | `{ role: 'system'\|'user'\|'assistant', content: string }` |
| `OllamaChatRequestSchema` | Full chat request body |
| `OllamaChatResponseSchema` | Raw HTTP response from Groq |
| `OllamaJsonPayloadSchema` | Parsed model output — `{ tool, args }` or `{ response }` |

`TOOL_NAMES` is a `const` tuple of all registered tool names:
```ts
export const TOOL_NAMES = [
  'findFile', 'listFiles', 'deleteFile', 'moveFile',
  'createDirectory', 'organiseByRule', 'screenAutomation',
] as const;
```

#### `src/llm/ollama.ts` — Groq Client

Configured with:
- **Base URL:** `https://api.groq.com/openai/v1`
- **Model:** `llama-3.3-70b-versatile`
- **API Key:** `GROQ_API_KEY` — injected at bundle time via esbuild `--define`, not read from `.env` at runtime
- **Temperature:** `0.1` — low temperature for deterministic, structured JSON output
- **Format:** `response_format: { type: 'json_object' }` — forces valid JSON output

**System prompt** covers:

1. **Tool documentation** — every tool with its full parameter list and examples:
   - `findFile` — fuzzy recursive search, `folder_hint`, `sort_by`, `extensions`
   - `listFiles`, `deleteFile`, `moveFile`, `createDirectory`, `organiseByRule`
   - `screenAutomation` — all actions: `launch`, `navigate`, `screenshot`, `click`, `type`, `key`, `hotkey`, `scroll`, `find_text`

2. **Path rules** — user aliases, D drive access, never emit raw `C:\Users\<name>` paths

3. **Agentic planning rules:**
   - Use `findFile` first when a file is referred to by description
   - After `findFile` returns candidates, show them and ask the user to confirm
   - Once confirmed, use the exact full path from the result
   - Never guess a filename
   - Confirm destructive actions before calling the tool
   - **Never call any tool with system directory paths** (Windows, Program Files, System32, ProgramData) — respond with a refusal instead

4. **Common task examples** — multi-step walkthroughs showing the exact JSON for movie search, OOPS folder PDF, resume in downloads, etc.

---

### Tools

All tools share the signature: `(args: Record<string, unknown>) => Promise<string>`.

#### `src/tools/registry.ts`

Central dispatch table. Maintains:
- `handlers` — maps each `ToolName` to its implementation function
- `ALIASES` — maps shorthand names the model may emit (`mkdir`, `ls`, `rm`, `rename`, `open`, `click`, etc.) to canonical tool names

#### `findFile` — Fuzzy Recursive Search

The most important tool for agentic operation. Given a query and optional constraints, walks the file system and returns ranked matches.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `query` | `string?` | Words from the filename. Omit or leave empty to match all files |
| `folder_hint` | `string?` | Name of a parent folder to constrain search — only files inside a folder whose name fuzzy-matches this hint are returned |
| `dir` | `string?` | Search root alias or absolute path. Defaults to: Downloads, Documents, Desktop, Videos, Pictures, Music, D:\ |
| `extensions` | `string[]?` | Filter by extension: `[".pdf"]`, `[".mp4", ".mkv"]` |
| `sort_by` | `"score" \| "recent"` | Rank by filename match score (default) or by modification time (newest first) |
| `max_results` | `number?` | Cap on returned results, default 8 |

**Scoring:** `tokenise()` splits filenames on separators, camelCase boundaries, and digit/letter transitions. Each query token is matched against filename tokens using substring matching. Score = fraction of query tokens matched.

**Two-pass junk filtering:**
- **Pass 1 (clean):** walks the directory tree skipping `$RECYCLE.BIN`, `node_modules`, `.git`, `.svn`, `.hg`, `.tmp`, `temp` and any directory starting with `$` or `.`
- **System dirs always skipped:** `Windows`, `System32`, `SysWOW64`, `Program Files`, `Program Files (x86)`, `ProgramData`, `System Volume Information`, `Recovery`, `Boot`, `WinSxS` — never walked in either pass
- **Pass 2 (fallback):** if pass 1 found zero results, re-walks including junk dirs. This means Recycle Bin results are shown only when there is genuinely nothing else

**`folder_hint` behaviour:** the walk propagates an `insideMatchingFolder` flag down the tree. A file is only collected if the flag is true (i.e., some ancestor directory matched the hint). This correctly handles `D:\College\College\sem 6\OOSE\*.pdf` — the model passes `folder_hint: "OOSE"` and only files under that specific folder are returned.

#### `screenAutomation` — Screen and App Control

A unified tool for all GUI interactions.

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
