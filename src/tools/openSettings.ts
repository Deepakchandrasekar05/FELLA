import { execa } from 'execa';

type WindowsTarget = {
  kind: 'uri' | 'control';
  target: string;
  args?: string[];
  summary: string;
  includeNetworks?: boolean;
};

const WINDOWS_SETTINGS_MAP: Record<string, WindowsTarget> = {
  wifi: { kind: 'uri', target: 'ms-settings:network-wifi', summary: 'Opened Wi-Fi settings', includeNetworks: true },
  'wifi settings': { kind: 'uri', target: 'ms-settings:network-wifi', summary: 'Opened Wi-Fi settings', includeNetworks: true },
  'available networks': { kind: 'uri', target: 'ms-settings:network-wifi', summary: 'Opened Wi-Fi settings', includeNetworks: true },
  ethernet: { kind: 'uri', target: 'ms-settings:network-ethernet', summary: 'Opened Ethernet settings' },
  vpn: { kind: 'uri', target: 'ms-settings:network-vpn', summary: 'Opened VPN settings' },
  'airplane mode': { kind: 'uri', target: 'ms-settings:network-airplanemode', summary: 'Opened Airplane mode settings' },
  hotspot: { kind: 'uri', target: 'ms-settings:network-mobilehotspot', summary: 'Opened Mobile hotspot settings' },
  'mobile hotspot': { kind: 'uri', target: 'ms-settings:network-mobilehotspot', summary: 'Opened Mobile hotspot settings' },
  proxy: { kind: 'uri', target: 'ms-settings:network-proxy', summary: 'Opened Proxy settings' },
  network: { kind: 'uri', target: 'ms-settings:network', summary: 'Opened Network settings', includeNetworks: true },
  bluetooth: { kind: 'uri', target: 'ms-settings:bluetooth', summary: 'Opened Bluetooth settings' },
  printers: { kind: 'uri', target: 'ms-settings:printers', summary: 'Opened Printers settings' },
  mouse: { kind: 'uri', target: 'ms-settings:mousetouchpad', summary: 'Opened Mouse settings' },
  touchpad: { kind: 'uri', target: 'ms-settings:devices-touchpad', summary: 'Opened Touchpad settings' },
  typing: { kind: 'uri', target: 'ms-settings:typing', summary: 'Opened Typing settings' },
  usb: { kind: 'uri', target: 'ms-settings:usb', summary: 'Opened USB settings' },
  display: { kind: 'uri', target: 'ms-settings:display', summary: 'Opened Display settings' },
  brightness: { kind: 'uri', target: 'ms-settings:display', summary: 'Opened Display settings' },
  'night light': { kind: 'uri', target: 'ms-settings:nightlight', summary: 'Opened Night light settings' },
  sound: { kind: 'uri', target: 'ms-settings:sound', summary: 'Opened Sound settings' },
  volume: { kind: 'uri', target: 'ms-settings:sound', summary: 'Opened Sound settings' },
  notifications: { kind: 'uri', target: 'ms-settings:notifications', summary: 'Opened Notifications settings' },
  'focus assist': { kind: 'uri', target: 'ms-settings:quiethours', summary: 'Opened Focus assist settings' },
  battery: { kind: 'uri', target: 'ms-settings:battery', summary: 'Opened Battery settings' },
  power: { kind: 'uri', target: 'ms-settings:powersleep', summary: 'Opened Power and sleep settings' },
  sleep: { kind: 'uri', target: 'ms-settings:powersleep', summary: 'Opened Power and sleep settings' },
  accounts: { kind: 'uri', target: 'ms-settings:accounts', summary: 'Opened Accounts settings' },
  'sign in': { kind: 'uri', target: 'ms-settings:signinoptions', summary: 'Opened Sign-in options' },
  'sign-in': { kind: 'uri', target: 'ms-settings:signinoptions', summary: 'Opened Sign-in options' },
  'lock screen': { kind: 'uri', target: 'ms-settings:lockscreen', summary: 'Opened Lock screen settings' },
  'email accounts': { kind: 'uri', target: 'ms-settings:emailandaccounts', summary: 'Opened Email and accounts settings' },
  storage: { kind: 'uri', target: 'ms-settings:storagesense', summary: 'Opened Storage settings' },
  apps: { kind: 'uri', target: 'ms-settings:appsfeatures', summary: 'Opened Apps settings' },
  'default apps': { kind: 'uri', target: 'ms-settings:defaultapps', summary: 'Opened Default apps settings' },
  'startup apps': { kind: 'uri', target: 'ms-settings:startupapps', summary: 'Opened Startup apps settings' },
  clipboard: { kind: 'uri', target: 'ms-settings:clipboard', summary: 'Opened Clipboard settings' },
  about: { kind: 'uri', target: 'ms-settings:about', summary: 'Opened About settings' },
  updates: { kind: 'uri', target: 'ms-settings:windowsupdate', summary: 'Opened Windows Update' },
  'windows update': { kind: 'uri', target: 'ms-settings:windowsupdate', summary: 'Opened Windows Update' },
  background: { kind: 'uri', target: 'ms-settings:personalization-background', summary: 'Opened Background settings' },
  themes: { kind: 'uri', target: 'ms-settings:themes', summary: 'Opened Themes settings' },
  taskbar: { kind: 'uri', target: 'ms-settings:taskbar', summary: 'Opened Taskbar settings' },
  'start menu': { kind: 'uri', target: 'ms-settings:personalization-start', summary: 'Opened Start settings' },
  colours: { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },
  colors: { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },
  'dark mode': { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },
  privacy: { kind: 'uri', target: 'ms-settings:privacy', summary: 'Opened Privacy settings' },
  location: { kind: 'uri', target: 'ms-settings:privacy-location', summary: 'Opened Location privacy settings' },
  camera: { kind: 'uri', target: 'ms-settings:privacy-webcam', summary: 'Opened Camera privacy settings' },
  'camera privacy': { kind: 'uri', target: 'ms-settings:privacy-webcam', summary: 'Opened Camera privacy settings' },
  microphone: { kind: 'uri', target: 'ms-settings:privacy-microphone', summary: 'Opened Microphone privacy settings' },
  'microphone privacy': { kind: 'uri', target: 'ms-settings:privacy-microphone', summary: 'Opened Microphone privacy settings' },
  time: { kind: 'uri', target: 'ms-settings:dateandtime', summary: 'Opened Date and time settings' },
  date: { kind: 'uri', target: 'ms-settings:dateandtime', summary: 'Opened Date and time settings' },
  language: { kind: 'uri', target: 'ms-settings:regionlanguage', summary: 'Opened Language settings' },
  region: { kind: 'uri', target: 'ms-settings:regionlanguage', summary: 'Opened Region settings' },
  'control panel': { kind: 'control', target: 'control.exe', summary: 'Opened Control Panel' },
  'network connections': { kind: 'control', target: 'ncpa.cpl', summary: 'Opened Network Connections' },
  'programs and features': { kind: 'control', target: 'appwiz.cpl', summary: 'Opened Programs and Features' },
  'internet options': { kind: 'control', target: 'inetcpl.cpl', summary: 'Opened Internet Options' },
  'mouse properties': { kind: 'control', target: 'main.cpl', summary: 'Opened Mouse Properties' },
  keyboard: { kind: 'control', target: 'control.exe', args: ['keyboard'], summary: 'Opened Keyboard Properties' },
  'sound control panel': { kind: 'control', target: 'mmsys.cpl', summary: 'Opened Sound Control Panel' },
  'power options': { kind: 'control', target: 'control.exe', args: ['/name', 'Microsoft.PowerOptions'], summary: 'Opened Power Options' },
  'user accounts': { kind: 'control', target: 'control.exe', args: ['/name', 'Microsoft.UserAccounts'], summary: 'Opened User Accounts' },
};

function normalizeSetting(input: string): string {
  return input.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function resolveWindowsSetting(setting: string): WindowsTarget | undefined {
  const key = normalizeSetting(setting);
  if (!key) return undefined;
  return WINDOWS_SETTINGS_MAP[key]
    ?? Object.entries(WINDOWS_SETTINGS_MAP).find(([candidate]) => candidate.includes(key))?.[1]
    ?? Object.entries(WINDOWS_SETTINGS_MAP).find(([candidate]) => key.includes(candidate))?.[1];
}

export function extractSettingRequest(userMessage: string): string | null {
  const match = userMessage
    .trim()
    .match(/^(?:open|show(?:\s+me)?|go\s+to|check(?:\s+for)?)\s+(?:the\s+)?(.+?)\s*\??$/i);
  if (!match) return null;

  const candidate = normalizeSetting(match[1]!);
  if (!candidate) return null;

  if (resolveWindowsSetting(candidate)) return candidate;

  const withoutSuffix = candidate.replace(/\s+settings?$/i, '').trim();
  if (withoutSuffix && resolveWindowsSetting(withoutSuffix)) return withoutSuffix;

  const explicitSettingsWords = /\b(settings?|control panel|system preferences|system settings)\b/i;
  if (!explicitSettingsWords.test(candidate)) return null;

  return withoutSuffix || candidate;
}

async function tryCommands(commands: Array<{ bin: string; args: string[] }>): Promise<boolean> {
  for (const cmd of commands) {
    try {
      const result = await execa(cmd.bin, cmd.args, {
        reject: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      if (result.exitCode === 0) return true;
    } catch {
      // try next command
    }
  }
  return false;
}

async function openWindowsSetting(setting: string): Promise<string> {
  const target = resolveWindowsSetting(setting);
  if (!target) {
    throw new Error(
      `Unknown setting: "${setting}". Try wifi, bluetooth, display, sound, battery, updates, or control panel.`,
    );
  }

  if (target.kind === 'uri') {
    await execa('cmd', ['/c', 'start', '', target.target], { reject: false, windowsHide: false });
  } else {
    await execa('cmd', ['/c', 'start', '', target.target, ...(target.args ?? [])], {
      reject: false,
      windowsHide: false,
    });
  }

  if (target.includeNetworks) {
    const networks = await getAvailableNetworks();
    return `${target.summary}\n\nAvailable networks:\n${networks}`;
  }

  return target.summary;
}

async function openMacSetting(setting: string): Promise<string> {
  const key = normalizeSetting(setting);
  const paneMap: Record<string, string> = {
    wifi: 'x-apple.systempreferences:com.apple.NetworkSettings',
    network: 'x-apple.systempreferences:com.apple.NetworkSettings',
    bluetooth: 'x-apple.systempreferences:com.apple.BluetoothSettings',
    display: 'x-apple.systempreferences:com.apple.Displays-Settings.extension',
    sound: 'x-apple.systempreferences:com.apple.Sound-Settings.extension',
    battery: 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
    power: 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
    privacy: 'x-apple.systempreferences:com.apple.PrivacySecurity.extension',
    notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    updates: 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension',
    language: 'x-apple.systempreferences:com.apple.Localization-Settings.extension',
    region: 'x-apple.systempreferences:com.apple.Localization-Settings.extension',
    time: 'x-apple.systempreferences:com.apple.Date-Time-Settings.extension',
  };

  const uri = paneMap[key] ?? 'x-apple.systempreferences:';
  const opened = await tryCommands([
    { bin: 'open', args: [uri] },
    { bin: 'open', args: ['-a', 'System Settings'] },
  ]);

  if (!opened) throw new Error('Could not open System Settings on macOS.');
  return `Opened macOS System Settings (${key || 'general'}).`;
}

async function openLinuxSetting(setting: string): Promise<string> {
  const key = normalizeSetting(setting);
  const gnomeMap: Record<string, string[]> = {
    wifi: ['wifi'],
    network: ['network'],
    bluetooth: ['bluetooth'],
    display: ['display'],
    sound: ['sound'],
    battery: ['power'],
    power: ['power'],
    privacy: ['privacy'],
    notifications: ['notifications'],
    updates: ['updates'],
    language: ['region'],
    region: ['region'],
    time: ['datetime'],
  };

  const panel = gnomeMap[key] ?? [];
  const opened = await tryCommands([
    { bin: 'gnome-control-center', args: panel },
    { bin: 'systemsettings', args: [] },
    { bin: 'systemsettings5', args: [] },
    { bin: 'xfce4-settings-manager', args: [] },
    { bin: 'xdg-open', args: ['settings://'] },
  ]);

  if (!opened) throw new Error('Could not find a supported Linux settings app on this system.');
  return `Opened Linux settings (${key || 'general'}).`;
}

async function getAvailableNetworks(): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execa('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
      const trimmed = stdout.trim();
      return trimmed.length > 0 ? trimmed : 'No Wi-Fi networks found.';
    } catch {
      return 'Could not retrieve available networks. Make sure Wi-Fi is turned on.';
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execa('networksetup', ['-listpreferredwirelessnetworks', 'en0'], { reject: false });
      return stdout.trim() || 'Could not retrieve available networks on macOS.';
    } catch {
      return 'Could not retrieve available networks on macOS.';
    }
  }

  try {
    const { stdout } = await execa('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list'], { reject: false });
    return stdout.trim() || 'Could not retrieve available networks on Linux.';
  } catch {
    return 'Could not retrieve available networks on Linux.';
  }
}

export async function openSettings(args: Record<string, unknown>): Promise<string> {
  const rawSetting = String(args['setting'] ?? '').trim();
  if (!rawSetting) {
    throw new Error('openSettings: "setting" argument is required');
  }

  if (process.platform === 'win32') {
    return openWindowsSetting(rawSetting);
  }
  if (process.platform === 'darwin') {
    return openMacSetting(rawSetting);
  }
  return openLinuxSetting(rawSetting);
}

export async function getBatteryStatus(): Promise<string> {
  if (process.platform === 'win32') {
    const script = [
      '$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus',
      'if (-not $b) { Write-Output "Battery status unavailable on this device."; exit 0 }',
      '$status = switch ([int]$b.BatteryStatus) {',
      '  1 { "Discharging" }',
      '  2 { "Connected, not charging" }',
      '  3 { "Fully charged" }',
      '  4 { "Low" }',
      '  5 { "Critical" }',
      '  6 { "Charging" }',
      '  7 { "Charging (high)" }',
      '  8 { "Charging (low)" }',
      '  9 { "Charging (critical)" }',
      '  11 { "Partially charged" }',
      '  default { "Unknown" }',
      '}',
      'Write-Output ("{0}% ({1})" -f $b.EstimatedChargeRemaining, $status)',
    ].join('; ');

    try {
      const { stdout } = await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      const reading = stdout.trim();
      if (!reading) return 'Battery status unavailable on this device.';
      return `Battery is currently at ${reading}.`;
    } catch {
      return 'Could not read battery status from Windows.';
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execa('pmset', ['-g', 'batt'], { reject: false });
      const firstLine = stdout.split(/\r?\n/).find((line) => line.includes('%'))?.trim();
      if (!firstLine) return 'Battery status unavailable on this device.';
      return `Battery status: ${firstLine}`;
    } catch {
      return 'Could not read battery status from macOS.';
    }
  }

  try {
    const upower = await execa('upower', ['-e'], { reject: false });
    const batteryDevice = upower.stdout
      .split(/\r?\n/)
      .find((line) => /battery/i.test(line));

    if (batteryDevice) {
      const detail = await execa('upower', ['-i', batteryDevice], { reject: false });
      const percent = detail.stdout.split(/\r?\n/).find((line) => line.includes('percentage'))?.trim();
      const state = detail.stdout.split(/\r?\n/).find((line) => line.includes('state'))?.trim();
      if (percent || state) {
        return `Battery status: ${[percent, state].filter(Boolean).join(', ')}`;
      }
    }
  } catch {
    // fall through to ACPI fallback
  }

  try {
    const { stdout } = await execa('acpi', ['-b'], { reject: false });
    if (stdout.trim()) return `Battery status: ${stdout.trim()}`;
  } catch {
    // ignore
  }

  return 'Battery status unavailable on this Linux device.';
}
