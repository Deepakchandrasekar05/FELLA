// desktop/main.ts — Electron main process for the FELLA floating avatar
import {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  screen,
} from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { realpathSync, existsSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';

// ── Resolve .env (mirrors src/index.tsx logic) ─────────────────────────────
const thisDir = (() => {
  try { return realpathSync(dirname(fileURLToPath(import.meta.url))); }
  catch { return dirname(fileURLToPath(import.meta.url)); }
})();

const envCandidates = [
  process.env['FELLA_HOME'] ? resolve(process.env['FELLA_HOME'], '.env') : null,
  resolve(thisDir, '..', '.env'),
  resolve(process.cwd(), '.env'),
].filter((p): p is string => Boolean(p));

for (const envPath of envCandidates) {
  const result = config({ path: envPath });
  if (!result.error) break;
}

let avatarWindow: BrowserWindow | null = null;
let inputWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

import { Engine } from '../src/execution/engine.js';

/** Instantiated Engine */
let engine: Engine | null = null;

async function loadEngine() {
  if (!engine) {
    engine = new Engine();
  }
}

// ── Avatar window ────────────────────────────────────────────────────────────
function createAvatarWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  avatarWindow = new BrowserWindow({
    x: width - 130,
    y: height - 130,
    width:  110,
    height: 110,

    alwaysOnTop:     true,
    frame:           false,
    transparent:     true,
    skipTaskbar:     true,
    resizable:       false,
    hasShadow:       false,
    focusable:       true,

    webPreferences: {
      preload:          join(thisDir, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  avatarWindow.setAlwaysOnTop(true, 'floating');
  avatarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  avatarWindow.loadFile(join(thisDir, 'renderer', 'index.html'));
  avatarWindow.setMovable(true);

  // Ignore mouse events on transparent regions so clicks pass through
  avatarWindow.setIgnoreMouseEvents(false);
}

// ── Input window (pops up above the avatar) ──────────────────────────────────
function createInputWindow(): void {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.show();
    inputWindow.focus();
    return;
  }

  const avatarBounds = avatarWindow?.getBounds();
  const x = (avatarBounds?.x ?? 800) - 250;
  const y = (avatarBounds?.y ?? 600) - 420;

  inputWindow = new BrowserWindow({
    x,
    y,
    width:  400,
    height: 460,

    alwaysOnTop:     true,
    frame:           false,
    transparent:     true,
    skipTaskbar:     true,
    resizable:       false,
    hasShadow:       false,

    webPreferences: {
      preload:          join(thisDir, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  inputWindow.setAlwaysOnTop(true, 'floating');
  inputWindow.loadFile(join(thisDir, 'renderer', 'input.html'));

  inputWindow.on('blur', () => {
    // Don't auto-hide — user may switch to check something
  });
}

function toggleInputWindow(): void {
  if (inputWindow && !inputWindow.isDestroyed() && inputWindow.isVisible()) {
    inputWindow.hide();
  } else {
    createInputWindow();
  }
}

// ── System tray ──────────────────────────────────────────────────────────────
function createTray(): void {
  const iconPath = join(thisDir, '..', 'assets', 'FELLA_CAT.ico');
  const fallbackPath = join(thisDir, '..', 'assets', 'FELLA_CAT.png');
  const icon = nativeImage.createFromPath(
    existsSync(iconPath) ? iconPath : fallbackPath,
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const menu = Menu.buildFromTemplate([
    { label: 'Show FELLA',    click: () => avatarWindow?.show() },
    { label: 'Hide FELLA',    click: () => avatarWindow?.hide() },
    { label: 'Open Input',    click: () => toggleInputWindow() },
    { label: 'Open Terminal', click: () => {
      try { execSync('start cmd /k fella', { detached: true } as any); } catch {}
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip('FELLA — AI Agent');
  tray.on('click', () => toggleInputWindow());
}

// ── Global hotkey ────────────────────────────────────────────────────────────
function registerHotkey(): void {
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (!avatarWindow?.isVisible()) avatarWindow?.show();
    toggleInputWindow();
  });
}

// ── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('fella:command', async (_event, command: string) => {
  try {
    await loadEngine();
    if (!engine) return { success: false, response: 'Engine not loaded.' };

    // Notify avatar that we are thinking
    avatarWindow?.webContents.send('fella:state', 'thinking');

    const steps: Array<{ tool: string; success: boolean }> = [];
    const reply = await engine.send(command, (step) => {
      steps.push({ tool: step.tool, success: step.success });
      avatarWindow?.webContents.send('fella:step', {
        tool: step.tool,
        success: step.success,
      });
    });

    avatarWindow?.webContents.send('fella:state', 'responding');
    return { success: true, response: reply, steps };
  } catch (err) {
    avatarWindow?.webContents.send('fella:state', 'idle');
    return { success: false, response: String(err) };
  }
});

ipcMain.handle('fella:toggle-input', () => {
  toggleInputWindow();
});

ipcMain.handle('fella:close-input', () => {
  if (inputWindow && !inputWindow.isDestroyed()) inputWindow.hide();
});

ipcMain.handle('fella:get-state', () => {
  return { engineReady: !!engine };
});

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createAvatarWindow();
  createTray();
  registerHotkey();
  // Pre-warm the engine in the background
  loadEngine().catch(() => {});
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
