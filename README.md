<p align="center">
  <img src="https://raw.githubusercontent.com/Deepakchandrasekar05/FELLA/main/assets/logo.png" alt="FELLA" width="487"/>
</p>

<p align="center">
  <b>File Exploration and Local Logic Automation</b><br/>
  Agentic terminal assistant for Windows file workflows.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square"/>
  <img src="https://img.shields.io/badge/version-1.0.1-49b9ff?style=flat-square"/>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white"/>
</p>

---

## What FELLA Does

FELLA is a chat-first CLI for Windows that turns natural language into file and desktop actions.

Examples:

```text
organise downloads by type
open the latest pdf from downloads
move report.pdf from desktop to documents
create a folder on desktop called Projects
open notepad
undo
```

Under the hood, FELLA runs a multi-step agent loop:

1. Reads your prompt
2. Plans tool calls (search, list, move, organise, launch, screen automation)
3. Executes tools with path guards and action policies
4. Feeds results back to the model for next-step planning
5. Returns a final response in the terminal

Destructive operations are confirmation-gated. Organise operations run as preview-first and apply only after explicit confirmation.

---

## Core Capabilities

### File and folder operations

- List files and folders
- Find files by fuzzy title/name
- Move and rename files
- Create folders
- Delete files/folders (with confirmation)

### Organise mode

Organise a directory by:

- `by_type`
- `by_category`
- `by_date`
- `by_size`
- `by_extension`

Optional filters include:

- `last_week`
- `last_month`
- `last_3_months`
- `last_year`
- ISO date (for example `2026-02-01`)

### Undo and redo

- `undo`
- `redo`

Reversible operations are tracked per live session.

### App launch and screen automation

- Launch applications (for example Notepad, Chrome)
- Navigate Explorer to folders/files
- Optional UI automation actions (click/type/scroll/find text/screenshot)

---

## Path Safety Model

FELLA enforces strict path access:

- Allowed: `C:\Users\...`
- Allowed: `D:\...`
- Blocked: system locations such as `C:\Windows`, `C:\Program Files`, `C:\ProgramData`

Friendly aliases are supported, for example:

- `desktop`
- `documents`
- `downloads`
- `pictures`
- `music`
- `videos`
- `temp`
- `appdata`
- `localappdata`
- `d:`

---

## Sessions and Memory

FELLA persists sessions and memory to SQLite:

- Database: `%USERPROFILE%\.fella\memory.db`
- Auth token file: `%USERPROFILE%\.fella\auth.json`

Session commands:

```bat
fella sessions
fella resume --session_id <id>
fella resume <id>
```

Only sessions with visible messages are shown in `fella sessions`.

---

## Install and Run

### Option 1: npm global install

Requires [Node.js 18+](https://nodejs.org).

```bat
npm install -g fella-cli
fella
```

### Option 2: Windows executable

Download `fella-win.exe` from [Releases](../../releases) and run it.

```bat
fella-win.exe
```

SmartScreen may appear on first run if the binary is unsigned.

---

## Authentication

FELLA supports:

- Email/password sign-up and login
- Google OAuth login

Useful commands:

```bat
fella signup
fella login
fella login --google
fella whoami
fella logout
```

---

## .env Configuration

FELLA reads `.env` from these locations (first match wins):

1. `%FELLA_HOME%\.env`
2. `<runtime_dir>\..\.env`
3. `<current_working_directory>\.env`

### Required keys

```env
GROQ_API_KEY=your_groq_api_key
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
```

What each key is used for:

- `GROQ_API_KEY`: LLM chat completions via Groq OpenAI-compatible API
- `SUPABASE_URL`: Supabase project URL for auth
- `SUPABASE_ANON_KEY`: Supabase public anon key for auth flows

### Optional keys

```env
FELLA_MOCK=1
FELLA_HOME=D:\path\to\fella
```

- `FELLA_MOCK=1`: bypasses model calls and returns mock responses for testing
- `FELLA_HOME`: helps packaged launchers resolve a fixed `.env` location

Notes:

- Secrets are loaded at runtime only; build scripts do not inject API keys into bundles.
- Never commit `.env` or paste real keys into tracked files.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message |
| `Up` / `Down` | Browse previous commands |
| `Ctrl + L` | Clear conversation |
| `Ctrl + C` | Exit |

---

## Development

```bat
npm install
npm run typecheck
npm run build
```

Selected scripts:

- `npm run typecheck` - TypeScript type check
- `npm run build` - typecheck + bundle
- `npm run sea` - build SEA artifact path
- `npm run dist` - build Windows distribution executable

---

## Troubleshooting

### No sessions shown

- Run `fella sessions`
- A session appears only after visible messages exist

### Login fails immediately

- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`

### Model call fails

- Verify `GROQ_API_KEY`
- Confirm outbound network access to Groq API

### Automation actions fail

- Ensure native dependencies are present for screen automation features
- App launch and Explorer navigation remain available even when advanced UI actions are limited

