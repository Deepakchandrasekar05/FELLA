<p align="center">
  <img src="https://raw.githubusercontent.com/Deepakchandrasekar05/FELLA/main/assets/logo.png" alt="FELLA" width="487"/>
</p>

<p align="center">
  <b>File Exploration and Local Logic Automation</b><br/>
  An agentic AI terminal assistant for Windows file workflows, intelligent organisation, and automation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square"/>
  <img src="https://img.shields.io/badge/version-2.0.0-49b9ff?style=flat-square"/>
  <img src="https://img.shields.io/badge/UI-React%20%2B%20Ink-green?style=flat-square&logo=react"/>
  <img src="https://img.shields.io/badge/Runtime-Node.js%20(ESM)-339933?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Database-SQLite%20(better--sqlite3)-003b57?style=flat-square"/>
</p>

---

## What FELLA Does

FELLA is an interactive chat-first CLI for Windows that turns natural language into file operations, desktop actions, and browser automation:

```text
organise downloads by type
open the latest pdf from downloads
move report.pdf from desktop to documents
create a folder on desktop called Projects
open notepad
undo
```

Under the hood, FELLA runs an agentic loop:
1. Reads your natural-language intent.
2. Formulates tool calls (search, list, move, organise, launch, screen automation).
3. Executes with security path guards and action policies.
4. Feeds tool results back to the model for next-step planning.
5. Returns formatted responses directly in your terminal.

Destructive operations are confirmation-gated. Organise operations run as preview-first and apply only after explicit confirmation.

---

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/Deepakchandrasekar05/FELLA.git
cd FELLA

# Install dependencies
npm install
```

### 2. Configuration

Create or update `.env` in the project root or `%USERPROFILE%\.fella\.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### 3. Running FELLA CLI

Launch the interactive terminal interface directly:

```bash
# Via npm script:
npm run cli

# Or directly:
node bin/fella.js

# On Windows:
bin\fella.bat
```

---

## Available Commands

| Command | Description |
|---|---|
| `npm run cli` | Launch interactive FELLA terminal interface |
| `fella sessions` | List previous saved chat sessions |
| `fella resume <id>` | Resume a saved session conversation |
| `fella delete sessions <id>` | Delete a session from SQLite database |
| `fella login` | Sign in with email and password |
| `fella login --google` | Sign in with Google account in browser |
| `fella signup` | Create a new account |
| `fella logout` | Clear saved credentials |
| `fella whoami` | Show currently signed-in user |
| `npm test` | Run the comprehensive test suite (45 assertions) |

---

## Security Policy

- `PathGuard` strictly enforces system folder access restrictions:
  - System directories (`C:\Windows`, `C:\Program Files`, `C:\ProgramData`) are blocked.
  - Directory traversal (`../`, `..\`) is rejected.
- Mutating operations (`deleteFile`, `organiseByRule`, `moveFile`) trigger interactive confirmation prompts before execution.
