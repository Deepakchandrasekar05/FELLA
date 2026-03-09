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
   - [UI Layer (Ink / React)](#ui-layer-ink--react)
   - [Execution Engine](#execution-engine)
   - [LLM Layer (Ollama)](#llm-layer-ollama)
   - [Tools](#tools)
   - [Security (Path Guard)](#security-path-guard)
6. [Build System](#build-system)
7. [Distribution](#distribution)
8. [Environment Variables](#environment-variables)
9. [Available npm Scripts](#available-npm-scripts)
10. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## What is Fella?

Fella is a terminal-based AI assistant that accepts natural-language commands and translates them into file-system actions. The user types something like *"organise my downloads by file type"* and Fella:

1. Sends the message to a locally-running Ollama model
2. Receives a structured JSON tool-call from the model
3. Executes the appropriate tool (e.g. `organiseByRule`)
4. Renders the result back in the terminal

Everything runs locally — no cloud calls, no data leaves the machine.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Language** | TypeScript | `^5.9` | Strict, type-safe source code |
| **Runtime** | Node.js | ≥ 18 | ESM runtime, native `fetch`, SEA support |
| **Terminal UI** | [Ink](https://github.com/vadimdemedes/ink) | `^6.8` | React-based terminal rendering |
| **UI Framework** | React | `^19.2` | Component model inside Ink |
| **Text Input** | [ink-text-input](https://github.com/vadimdemedes/ink-text-input) | `^6.0` | Controlled input field in the terminal |
| **Spinner** | [ink-spinner](https://github.com/vadimdemedes/ink-spinner) | `^5.0` | Animated thinking indicator |
| **LLM Backend** | [Ollama](https://ollama.com/) | local | Runs `gemma:7b-instruct` locally via HTTP |
| **Schema Validation** | [Zod](https://zod.dev/) | `^4.3` | Runtime validation of all API payloads |
| **Process Spawning** | [execa](https://github.com/sindresorhus/execa) | `^9.6` | Safe cross-platform process execution |
| **Database** | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | `^12.6` | Planned persistence / audit log |
| **Styling** | [chalk](https://github.com/chalk/chalk) | `^5.6` | Terminal colour helpers (utility use) |
| **Path Helpers** | [env-paths](https://github.com/sindresorhus/env-paths) | `^4.0` | XDG-compliant data/config directories |
| **Safe Delete** | [trash](https://github.com/sindresorhus/trash) | `^10.1` | Sends files to the OS recycle bin (planned) |
| **Bundler** | [esbuild](https://esbuild.github.io/) | `^0.25` | Fast ESM bundle for distribution |
| **Type Checker** | TypeScript `tsc` | `^5.9` | Type-check only (`noEmit: true`) |
| **Distribution** | Node.js SEA | built-in | Single Executable Application (no Node needed) |
| **Alt Distribution** | [caxa](https://github.com/nicolo-ribaudo/caxa) | `^3.0` | Self-contained binary (bundles Node) |
| **Dev Runner** | [tsx](https://github.com/esbuild-kit/tsx) | `^4.21` | Run TypeScript directly for dev |

---

## Project Structure

```
fella/
├── bin/                        # Compiled platform binaries (generated, not committed)
├── dist/                       # esbuild output (generated)
├── scripts/
│   ├── sea.mjs                 # Node.js SEA binary builder
│   └── postbundle.mjs          # Writes CJS wrapper for pkg (legacy)
├── src/
│   ├── index.tsx               # Entry point — mounts the Ink app
│   ├── execution/
│   │   └── engine.ts           # Stateful conversation + tool dispatch engine
│   ├── llm/
│   │   ├── ollama.ts           # Ollama HTTP client
│   │   └── schema.ts           # Zod schemas for all Ollama API types
│   ├── persistence/
│   │   └── audit.ts            # (Stub) Planned audit log via better-sqlite3
│   ├── security/
│   │   ├── pathGuard.ts        # Path alias resolution & absolute path safety
│   │   └── validator.ts        # (Stub) Planned input validation
│   ├── stubs/
│   │   └── devtools-stub.js    # No-op stub replacing react-devtools-core in prod
│   ├── tools/
│   │   ├── registry.ts         # Tool dispatch table + alias resolution
│   │   ├── createDirectory.ts  # mkdir -p wrapper
│   │   ├── deleteFile.ts       # rm -rf wrapper
│   │   ├── listFiles.ts        # readdir wrapper
│   │   ├── moveFile.ts         # rename wrapper (no silent overwrites)
│   │   ├── openApplication.ts  # Launch allowlisted apps via execa
│   │   └── organiseByRule.ts   # Batch file organiser (dry-run + execute)
│   └── ui/
│       ├── App.tsx             # Root component — screen routing & state
│       └── components/
│           ├── Header.tsx      # Logo + title banner
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
  ┌─────────────┐
  │  Ink / React│  src/ui/  — renders to stdout via Ink
  │  App.tsx    │
  └──────┬──────┘
         │ handleSubmit()
         ▼
  ┌─────────────┐
  │   Engine    │  src/execution/engine.ts
  │  (stateful) │  • Maintains message history
  │             │  • Handles yes/no confirmation gate
  └──────┬──────┘
         │ ollamaClient.chat(history)
         ▼
  ┌─────────────┐
  │ OllamaClient│  src/llm/ollama.ts
  │             │  • POST /api/chat with format:"json"
  │             │  • Validates response with Zod
  └──────┬──────┘
         │
     ┌───┴────────────────────┐
     │                        │
  tool call?              conversation?
     │                        │
     ▼                        ▼
 executeTool()         return payload.response
 src/tools/registry.ts
     │
     ▼
 one of: listFiles | deleteFile | moveFile
         openApplication | createDirectory | organiseByRule
     │
     ▼
 resolvePath()  ←  src/security/pathGuard.ts
 (alias → absolute path)
```

---

## Module-by-Module Implementation

### Entry Point

**`src/index.tsx`**

The entire application is three lines. `render()` from Ink mounts the `<App />` React component and takes over the terminal (raw mode, alternate screen).

```tsx
import { render } from 'ink';
import App from './ui/App.js';
render(<App />);
```

---

### UI Layer (Ink / React)

Ink renders React component trees to the terminal using Yoga (flexbox layout engine). Components use `Box` (layout) and `Text` (output). All standard React hooks work.

#### `App.tsx` — Root Component

Owns all top-level state:

| State | Type | Purpose |
|---|---|---|
| `screen` | `'welcome' \| 'chat'` | Controls which screen is shown |
| `messages` | `Message[]` | Full conversation history for display |
| `input` | `string` | Current text-input value |
| `isThinking` | `boolean` | Locks input while awaiting the model |
| `engineRef` | `Ref<Engine>` | Single long-lived conversation engine |

**Screen flow:**
- On launch → `welcome` screen (logo + "Press Enter to continue")
- First `Enter` → transitions to `chat` screen
- `ctrl+c` → exits at any time
- `ctrl+l` → clears messages and resets the engine history

**`handleSubmit()`** appends the user message to `messages`, calls `engine.send()`, then appends the assistant reply (or an error message) when the promise resolves.

#### `Header.tsx`

Renders the ASCII-art FELLA logo, the "Welcome to FELLA CLI" label, the subtitle *"File Exploration and Local Logic Automation"*, and version/badge pills. The logo is a fixed array of box-drawing character strings coloured with `#3fa5d4`.

#### `MessageList.tsx`

Renders the conversation thread. Each `Message` has:
- `id` — unique string (timestamp-based)
- `role` — `'user' | 'assistant' | 'system' | 'error'`
- `content` — plain string
- `timestamp` — `Date`

Role-specific styles (prefix glyph, prefix colour, text colour):

| Role | Glyph | Colour |
|---|---|---|
| `user` | `❯` | `#6CB6FF` (blue) |
| `assistant` | `◆` | `#E8865A` (orange) |
| `system` | `·` | `#555555` (dim grey) |
| `error` | `✕` | `#FF6B6B` (red) |

While `isThinking` is true a `<Spinner>` with "thinking…" is appended below the last message.

#### `InputBar.tsx`

Renders the `❯` prompt glyph and an `ink-text-input` controlled by `App`'s `input` state. While `isThinking` is true the input is replaced with a greyed-out "waiting for response…" label so the user cannot type.

#### `StatusBar.tsx`

A fixed row of keyboard-shortcut hints rendered as bordered badges:
`ctrl+c → exit`, `ctrl+l → clear`, `enter → send`, `? → help`.

---

### Execution Engine

**`src/execution/engine.ts`** — `class Engine`

The single most important class. One instance is created per app session via `useRef` in `App.tsx`.

**State:**
- `history: OllamaMessage[]` — rolling chat history sent to Ollama on every turn
- `pendingConfirmation: PendingConfirmation | null` — stores a destructive tool call awaiting `yes`/`no`

**`send(userMessage: string): Promise<string>`**

Full flow per call:

1. **Confirmation gate** — if `pendingConfirmation` is set, check whether the message is a confirm or cancel word. If yes → execute the stored tool with `dry_run: false`. If no → cancel. Otherwise clear and fall through.
2. **Append user turn** to `history`.
3. **Mock mode** (`FELLA_MOCK=1`) — echo the input and return early; useful for UI testing without Ollama.
4. **Call Ollama** → `ollamaClient.chat(history)`.
5. **Tool-call path** — if `payload.tool` is set, call `executeTool()`. Special case: `organiseByRule` with `dry_run: true` (the default) stores a `pendingConfirmation` so the user must type "yes" to trigger the actual moves.
6. **Conversational path** — use `payload.response` as the reply string.
7. **Error handling** — removes the last user turn from history if Ollama throws, so history stays consistent.

**`reset()`** clears both `history` and `pendingConfirmation`.

---

### LLM Layer (Ollama)

#### `src/llm/schema.ts`

All Ollama API types are defined with Zod and then inferred as TypeScript types:

| Schema | Description |
|---|---|
| `OllamaMessageSchema` | `{ role: 'system'\|'user'\|'assistant', content: string }` |
| `OllamaChatRequestSchema` | Full chat request body (model, messages, format, stream, options) |
| `OllamaChatResponseSchema` | Raw HTTP response body from Ollama |
| `OllamaJsonPayloadSchema` | The parsed JSON the model returns — either `{ tool, args }` or `{ response }` |

`TOOL_NAMES` is a `const` tuple of all registered tool names used for validation.

#### `src/llm/ollama.ts` — `class OllamaClient`

Configured with:
- **Base URL:** `OLLAMA_HOST` env var, default `http://127.0.0.1:11434`
- **Model:** `gemma:7b-instruct`
- **Format:** always `"json"` — forces the model to return a valid JSON object

**System prompt** (prepended to every request, never stored in engine history) instructs the model to:
- Always return a single JSON object, no markdown
- Use `{ "tool": "...", "args": { ... } }` for file-system actions
- Use `{ "response": "..." }` for conversational replies
- Use well-known path aliases (`downloads`, `desktop`, etc.) instead of guessing absolute paths with usernames

**`chat(messages, options?)`:**
1. Validates the request payload with `OllamaChatRequestSchema.parse()`
2. POSTs to `/api/chat`
3. Validates the HTTP response with `OllamaChatResponseSchema`
4. Parses `message.content` as JSON
5. Validates the result with `OllamaJsonPayloadSchema`
6. Returns the typed `OllamaJsonPayload`

On connection failure throws `OllamaError` with a helpful "is Ollama running?" message.

---

### Tools

All tools share the same signature: `(args: Record<string, unknown>) => Promise<string>`.  
They return a human-readable status string that is shown directly in the chat.

#### `src/tools/registry.ts`

Central dispatch table. Maintains:
- `handlers` — maps each `ToolName` to its implementation
- `ALIASES` — maps shorthand names the model may emit (`mkdir`, `ls`, `rm`, `rename`, etc.) to canonical tool names

**`resolveToolName(tool)`** — returns the canonical name from aliases or the input as-is.  
**`executeTool(tool, args)`** — resolves alias, validates against `TOOL_NAMES`, and calls the handler.

#### `listFiles`

Uses Node.js `readdir` with `withFileTypes: true` to list directory entries. Prefixes each line with `[DIR]` or `[FILE]`. Path resolved via `resolvePath()`.

#### `deleteFile`

Uses `fs.rm` with `{ recursive: true, force: true }`. Calls `access()` first to throw early if the path does not exist. Path resolved via `resolvePath()`.

#### `moveFile`

Uses `fs.rename`. Safety guarantees:
- Throws if source does not exist (`access()` check)
- Throws if destination already exists (no silent overwrites)
- Creates parent directories by default (`create_parent: true`)

#### `createDirectory`

Uses `fs.mkdir` with `{ recursive: true }` — equivalent to `mkdir -p`. Returns the absolute path of the created directory.

#### `openApplication`

Maintains a **strict per-platform allowlist** — the model cannot launch arbitrary executables.

**Windows allowlist:** `notepad`, `explorer`, `calculator`, `vscode` (`code`), `browser`, `chrome`, `terminal` (`wt.exe`), `paint`, `wordpad`, `powershell`  
**macOS allowlist:** `finder`, `vscode`, `browser`, `chrome`, `terminal`, `calculator`, `textedit`  
**Linux allowlist:** `files`, `vscode`, `browser`, `terminal`, `calculator`, `gedit`

Uses `execa` with `detached: true` and `stdio: 'ignore'` so fella does not block waiting for the spawned app.

#### `organiseByRule`

The most complex tool. Organises all files in a directory according to a `rule`:

| Rule | Logic |
|---|---|
| `by_type` | Groups by broad category (Images, Videos, Audio, Documents, Spreadsheets, Presentations, Archives, Code, Installers, Other) using a 60+ extension type map |
| `by_extension` | Groups by raw extension uppercased (e.g. `PNG`, `PDF`) |
| `by_date` | Groups into `YYYY/Month Name` folders by file modification time |
| `by_size` | Groups into Small/Medium/Large/Huge size buckets |

**Two-phase execution (safety):**
1. `dry_run: true` (default) — calls `buildPlan()` then `formatPreview()` which prints a grouped summary (folder name, file count, total size) and prompts *"Type 'yes' to execute or 'no' to cancel"*. The engine stores the confirmed plan in `pendingConfirmation`.
2. `dry_run: false` (after user confirms) — executes `fs.renameSync` for each file; skips if the destination already exists; collects and reports errors.

---

### Security (Path Guard)

**`src/security/pathGuard.ts`**

`resolvePath(raw: string): string` is called by every tool before touching the file system.

**Resolution order:**
1. **Alias match** — the input is normalised to lowercase with spaces/hyphens/underscores collapsed, then looked up in `KNOWN_FOLDERS`. Supported aliases cover all common Windows user folders (`downloads`, `documents`, `desktop`, `pictures`, `music`, `videos`, `temp`, `appdata`, etc.) and `home` / `~`.
2. **Absolute path** — passed through `path.resolve()` for normalisation.
3. **Relative path** — resolved relative to the user's home directory (not the process cwd).

This design means the model never needs to know or guess `C:\Users\<username>\...` — it just says `"downloads"`.

---

## Build System

**Bundler: esbuild**

The bundle command:
```
esbuild src/index.tsx
  --bundle
  --platform=node
  --format=esm
  --outfile=dist/index.js
  --external:better-sqlite3       # native module — bundled separately
  --external:trash                # native ESM — bundled separately
  --alias:react-devtools-core=./src/stubs/devtools-stub.js  # strips devtools
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
```

The `--banner` injects a CJS `require` shim so that native modules loaded via `require()` work inside an ESM bundle.

**TypeScript** is used for type-checking only (`noEmit: true`). esbuild strips types at bundle time — it does not type-check.

**tsconfig highlights:**
- `moduleResolution: "bundler"` — allows bare specifier imports without `.js` extensions in source
- `jsx: "react-jsx"` — automatic JSX transform (no `import React` needed, though files include it for clarity)
- `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` — extra strictness

---

## Distribution

### Node.js SEA (Single Executable Application)

The primary distribution method — produces a native binary with Node.js embedded.

**`scripts/sea.mjs`** orchestrates four steps:
1. Generates a SEA blob from `dist/index.js` using `node --experimental-sea-config sea-config.json`
2. Copies the running `node` binary to `bin/fella-<platform>.exe` (or no extension on Linux/macOS)
3. On macOS: strips the existing code signature before injection
4. Injects the blob into the binary using `npx postject` with the `NODE_SEA_FUSE_*` sentinel

**`sea-config.json`:**
```json
{
  "main": "dist/index.js",
  "output": "dist/sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
```

Run with: `npm run sea`

### caxa (Alternative)

Also supported via `npm run dist` — wraps `dist/` and the current `node` binary into a self-extracting archive. Useful when the SEA approach is not yet stable on a platform.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Base URL of the Ollama HTTP server |
| `FELLA_MOCK` | `""` | Set to `1` to bypass Ollama entirely and echo input as mock responses |
| `TEMP` | `%APPDATA%\..\Local\Temp` | Used by `pathGuard` to resolve the `temp`/`tmp` alias |

---

## Available npm Scripts

| Script | What it does |
|---|---|
| `npm run typecheck` | Runs `tsc --noEmit` — type-check without emitting files |
| `npm run bundle` | Bundles `src/index.tsx` → `dist/index.js` with esbuild |
| `npm run build` | `typecheck` + `bundle` |
| `npm run sea` | `build` + runs `scripts/sea.mjs` → produces `bin/fella-<platform>` |
| `npm run dist` | `build` + caxa → produces `bin/fella-win.exe` |
| `npm run caxa:win` | caxa build for Windows |
| `npm run caxa:linux` | caxa build for Linux |
| `npm run caxa:mac` | caxa build for macOS |

---

## Keyboard Shortcuts

| Keys | Action |
|---|---|
| `Enter` | Send message / confirm welcome screen |
| `ctrl+c` | Exit the application |
| `ctrl+l` | Clear conversation and reset engine history |
