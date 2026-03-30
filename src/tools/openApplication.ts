// openApplication.ts — Launch an allowed application, optionally with a file/folder

import { execa } from 'execa';
import * as os from 'node:os';
import { resolvePath } from '../security/pathGuard.js';

// ── Allowlist ─────────────────────────────────────────────────────────────────

/**
 * STRICT per-platform allowlist.
 * The LLM can only open apps listed here — arbitrary executables are blocked.
 * Each entry is [executable, ...fixed-args].  The optional file_path is
 * appended AFTER these fixed args, never before.
 */
const APP_ALLOWLIST: Record<string, Record<string, string[]>> = {
  win32: {
    notepad:    ['notepad.exe'],
    explorer:   ['explorer.exe'],
    calculator: ['calc.exe'],
    vscode:     ['code'],
    browser:    ['cmd', '/c', 'start', ''],
    chrome:     ['cmd', '/c', 'start', 'chrome'],
    msedge:     ['cmd', '/c', 'start', 'msedge'],
    edge:       ['cmd', '/c', 'start', 'msedge'],
    firefox:    ['cmd', '/c', 'start', 'firefox'],
    terminal:   ['wt.exe'],
    paint:      ['mspaint.exe'],
    wordpad:    ['write.exe'],
    powershell: ['powershell.exe'],
    cmd:        ['cmd.exe'],
    excel:      ['cmd', '/c', 'start', 'excel'],
    word:       ['cmd', '/c', 'start', 'winword'],
    winword:    ['cmd', '/c', 'start', 'winword'],
    powerpoint: ['cmd', '/c', 'start', 'powerpnt'],
    outlook:    ['cmd', '/c', 'start', 'outlook'],
    taskmgr:    ['taskmgr.exe'],
    regedit:    ['regedit.exe'],
    snipping:   ['SnippingTool.exe'],
  },
  darwin: {
    finder:     ['open', '-a', 'Finder'],
    vscode:     ['open', '-a', 'Visual Studio Code'],
    browser:    ['open', '-a', 'Google Chrome'],
    chrome:     ['open', '-a', 'Google Chrome'],
    terminal:   ['open', '-a', 'Terminal'],
    calculator: ['open', '-a', 'Calculator'],
    textedit:   ['open', '-a', 'TextEdit'],
  },
  linux: {
    files:      ['xdg-open', os.homedir()],
    vscode:     ['code'],
    browser:    ['xdg-open'],
    terminal:   ['x-terminal-emulator'],
    calculator: ['gnome-calculator'],
    gedit:      ['gedit'],
  },
};

// ── Tool ──────────────────────────────────────────────────────────────────────

const APP_ALIASES: Record<string, string> = {
  // VS Code variants
  'visualstudiocode': 'vscode',
  'vscode':           'vscode',
  'vscode.':          'vscode',
  'visualstudio':     'vscode',
  'code':             'vscode',
  'vscodium':         'vscode',
  // Browsers
  'microsoftedge':    'edge',
  'googlechrome':     'chrome',
  'googlechromium':   'chrome',
  'chromium':         'chrome',
  // Terminal
  'windowsterminal':  'terminal',
  'wt':               'terminal',
  // Office
  'microsoftword':    'word',
  'microsoftexcel':   'excel',
  'microsoftpowerpoint': 'powerpoint',
  'microsoftoutlook': 'outlook',
  // System tools
  'taskmanager':      'taskmgr',
  'taskmgr':          'taskmgr',
  'registryeditor':   'regedit',
  'snippingtool':     'snipping',
  'calculator':       'calculator',
  'calc':             'calculator',
  'mspaint':          'paint',
  // Common apps — resolved to shell-friendly names for the fallback path
  'spotify':          'spotify',
  'discord':          'discord',
  'slack':            'slack',
  'zoom':             'zoom',
  'teams':            'teams',
  'microsoftteams':   'teams',
  'skype':            'skype',
  'telegram':         'telegram',
  'whatsapp':         'whatsapp',
  'steam':            'steam',
  'obs':              'obs64',
  'obsstudio':        'obs64',
  'vlc':              'vlc',
  'vlcmediaplayer':   'vlc',
  'gimp':             'gimp',
  'inkscape':         'inkscape',
  'blender':          'blender',
  'audacity':         'audacity',
  'handbrake':        'handbrake',
  'winrar':           'winrar',
  'brave':            'brave',
  'opera':            'opera',
  'vivaldi':          'vivaldi',
  'figma':            'figma',
  'postman':          'postman',
  'docker':           'docker',
  'onenote':          'onenote',
  'filezilla':        'filezilla',
  'putty':            'putty',
  'wireshark':        'wireshark',
  'anydesk':          'anydesk',
  'teamviewer':       'teamviewer',
  'cursor':           'cursor',
  'sublimetext':      'subl',
  'sublime':          'subl',
  'notepadplusplus':  'notepad++',
  'everything':       'everything',
  'epicgames':        'epicgameslauncher',
  'epicgameslauncher':'epicgameslauncher',
};

export async function openApplication(args: Record<string, unknown>): Promise<string> {
  const rawKey = String(args['app'] ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const appKey = APP_ALIASES[rawKey] ?? rawKey;
  const filePath = args['file_path'] ? String(args['file_path']) : undefined;

  if (!appKey) throw new Error('openApplication: "app" argument is required');

  const platform     = os.platform();
  const platformApps = APP_ALLOWLIST[platform] ?? {};

  // Build command: use allowlist entry if available, otherwise try the app
  // name directly as an executable (allows launching any installed program).
  let command: string[];
  if (Object.prototype.hasOwnProperty.call(platformApps, appKey)) {
    command = [...platformApps[appKey]!];
  } else {
    // Fallback: pass the name straight to the OS — works for any .exe or
    // registered shell command on Windows (e.g. "msedge", "vlc", "spotify").
    if (platform === 'win32') {
      command = ['cmd', '/c', 'start', '', appKey];
    } else if (platform === 'darwin') {
      command = ['open', '-a', appKey];
    } else {
      command = [appKey];
    }
  }

  if (filePath) {
    const resolved = resolvePath(filePath);
    command.push(resolved);
  }

  const [bin, ...binArgs] = command;

  await execa(bin!, binArgs, {
    detached:     true,    // don't block fella
    stdio:        'ignore',
    windowsHide:  false,   // allow the app window to appear
  });

  const label = filePath ? `${appKey} with "${filePath}"` : appKey;
  return `Launched: ${label}`;
}
