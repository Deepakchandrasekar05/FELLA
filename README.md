<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 172" width="780" height="172">
  <defs>
    <linearGradient id="g" x1="0" y1="28" x2="0" y2="152" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#bbe2fd"/>
      <stop offset="20%"  stop-color="#a9d7fc"/>
      <stop offset="40%"  stop-color="#a0cafd"/>
      <stop offset="60%"  stop-color="#66b9fd"/>
      <stop offset="80%"  stop-color="#49b9ff"/>
      <stop offset="100%" stop-color="#44a8fb"/>
    </linearGradient>
  </defs>
  <rect width="780" height="172" rx="12" fill="#0d1117"/>
  <text x="390" text-anchor="middle" xml:space="preserve"
        font-family="'Courier New',Courier,monospace" font-size="15" font-weight="bold" fill="url(#g)">
    <tspan x="390" y="42">███████╗ ███████╗ ██╗      ██╗       █████╗ </tspan>
    <tspan x="390" y="63">██╔════╝ ██╔════╝ ██║      ██║      ██╔══██╗</tspan>
    <tspan x="390" y="84">█████╗   █████╗   ██║      ██║      ███████║</tspan>
    <tspan x="390" y="105">██╔══╝   ██╔══╝   ██║      ██║      ██╔══██║</tspan>
    <tspan x="390" y="126">██║      ███████╗ ███████╗ ███████╗ ██║  ██║</tspan>
    <tspan x="382" y="145">╚═╝      ╚══════╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝</tspan>
  </text>
</svg>
</p>

<p align="center">
  <b>File Exploration and Local Logic Automation</b><br/>
  An AI-powered terminal assistant — talk to your file system in plain English.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square"/>
  <img src="https://img.shields.io/badge/version-1.0.0-49b9ff?style=flat-square"/>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black"/>
</p>

---

## What can FELLA do?

Just type what you want — no commands to memorise.

```
organise my downloads by file type
move report.pdf from downloads to documents
create a folder on the desktop called Projects
open notepad
delete old notes from desktop
undo
```

FELLA understands you, executes the action, and shows you the result — all inside the terminal.

---

## Getting Started

### Option 1 — Download the .exe (no Node.js required)

1. Go to the [Releases](../../releases) page and download `fella-win.exe`
2. Double-click it, or run it from any terminal:

```bat
fella-win.exe
```

> First launch may show a Windows SmartScreen prompt — click **More info → Run anyway**.

### Option 2 — Install via npm

Requires [Node.js 18+](https://nodejs.org).

```bat
npm install -g fella-cli
fella
```

No API keys or config files needed — everything is bundled.

---

## Login

When you first open FELLA, it will ask how you want to sign in. Just type one of:

| What you type | What it does |
|---|---|
| `signup` | Create a new account with email & password |
| `login` | Sign in with your email & password |
| `google` | Sign in with Google (opens your browser) |

After signing in, FELLA launches automatically.

```bat
fella logout      # sign out
fella whoami      # see who you're logged in as
```

---

## What you can ask

### Files & Folders

```
list my downloads
list files in D:\Projects

create a folder called MyWork on the desktop
move budget.xlsx from desktop to documents
rename D:\Projects\old to D:\Projects\new
delete notes.txt from desktop
```

### Organise files

```
organise my downloads by file type
organise downloads from last week by category
organise D:\Archive by date
```

FELLA always shows a **preview first** — nothing moves until you confirm with `yes`.

**Sort by:** `type` · `category` · `date` · `size` · `extension`  
**Filter by:** `last_week` · `last_month` · `last_3_months` · `last_year`

### Undo anything

```
undo
redo
```

Every file action is fully reversible for the lifetime of your session.

### Launch apps

```
open notepad
launch chrome
start visual studio code
open calculator
```

### Screen automation

```
take a screenshot
click on the Save button
type Hello World
press ctrl+s
scroll down
find the text "OK" on screen
```

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message |
| `↑` / `↓` | Browse previous commands |
| `Ctrl + L` | Clear conversation |
| `Ctrl + C` | Exit |

---

## Folder shortcuts

You can use friendly names instead of full paths:

`desktop` · `documents` · `downloads` · `pictures` · `music` · `videos` · `temp` · `appdata` · `d:`

---

## Troubleshooting

**SmartScreen blocks the .exe**
Click **More info → Run anyway**. This happens because the binary isn't code-signed yet.

**Organise shows "No files found"**
Your folder may be empty, or the time filter is too narrow. Try without a filter: `organise downloads by type`

**Undo says "folder is not empty"**
Add files were added to the folder after it was created. Empty it first, then undo.

**Screen clicks / OCR not working**
App launching and folder navigation always work. Advanced screen features (click, OCR, screenshot) require the native nut-js addon to be present alongside the binary.

