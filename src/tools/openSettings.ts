import { execa } from 'execa';

type OpenTarget = {
  kind: 'uri' | 'control';
  target: string;
  args?: string[];
  summary: string;
  includeNetworks?: boolean;
};

const SETTINGS_MAP: Record<string, OpenTarget> = {
  // Network
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

  // Devices
  bluetooth: { kind: 'uri', target: 'ms-settings:bluetooth', summary: 'Opened Bluetooth settings' },
  printers: { kind: 'uri', target: 'ms-settings:printers', summary: 'Opened Printers settings' },
  mouse: { kind: 'uri', target: 'ms-settings:mousetouchpad', summary: 'Opened Mouse settings' },
  touchpad: { kind: 'uri', target: 'ms-settings:devices-touchpad', summary: 'Opened Touchpad settings' },
  typing: { kind: 'uri', target: 'ms-settings:typing', summary: 'Opened Typing settings' },
  usb: { kind: 'uri', target: 'ms-settings:usb', summary: 'Opened USB settings' },

  // Display and sound
  display: { kind: 'uri', target: 'ms-settings:display', summary: 'Opened Display settings' },
  brightness: { kind: 'uri', target: 'ms-settings:display', summary: 'Opened Display settings' },
  'night light': { kind: 'uri', target: 'ms-settings:nightlight', summary: 'Opened Night light settings' },
  sound: { kind: 'uri', target: 'ms-settings:sound', summary: 'Opened Sound settings' },
  volume: { kind: 'uri', target: 'ms-settings:sound', summary: 'Opened Sound settings' },
  notifications: { kind: 'uri', target: 'ms-settings:notifications', summary: 'Opened Notifications settings' },
  'focus assist': { kind: 'uri', target: 'ms-settings:quiethours', summary: 'Opened Focus assist settings' },

  // Power
  battery: { kind: 'uri', target: 'ms-settings:battery', summary: 'Opened Battery settings' },
  power: { kind: 'uri', target: 'ms-settings:powersleep', summary: 'Opened Power and sleep settings' },
  sleep: { kind: 'uri', target: 'ms-settings:powersleep', summary: 'Opened Power and sleep settings' },

  // Accounts
  accounts: { kind: 'uri', target: 'ms-settings:accounts', summary: 'Opened Accounts settings' },
  'sign in': { kind: 'uri', target: 'ms-settings:signinoptions', summary: 'Opened Sign-in options' },
  'sign-in': { kind: 'uri', target: 'ms-settings:signinoptions', summary: 'Opened Sign-in options' },
  'lock screen': { kind: 'uri', target: 'ms-settings:lockscreen', summary: 'Opened Lock screen settings' },
  'email accounts': { kind: 'uri', target: 'ms-settings:emailandaccounts', summary: 'Opened Email and accounts settings' },

  // System
  storage: { kind: 'uri', target: 'ms-settings:storagesense', summary: 'Opened Storage settings' },
  apps: { kind: 'uri', target: 'ms-settings:appsfeatures', summary: 'Opened Apps settings' },
  'default apps': { kind: 'uri', target: 'ms-settings:defaultapps', summary: 'Opened Default apps settings' },
  'startup apps': { kind: 'uri', target: 'ms-settings:startupapps', summary: 'Opened Startup apps settings' },
  clipboard: { kind: 'uri', target: 'ms-settings:clipboard', summary: 'Opened Clipboard settings' },
  about: { kind: 'uri', target: 'ms-settings:about', summary: 'Opened About settings' },
  updates: { kind: 'uri', target: 'ms-settings:windowsupdate', summary: 'Opened Windows Update' },
  'windows update': { kind: 'uri', target: 'ms-settings:windowsupdate', summary: 'Opened Windows Update' },

  // Personalization
  background: { kind: 'uri', target: 'ms-settings:personalization-background', summary: 'Opened Background settings' },
  themes: { kind: 'uri', target: 'ms-settings:themes', summary: 'Opened Themes settings' },
  taskbar: { kind: 'uri', target: 'ms-settings:taskbar', summary: 'Opened Taskbar settings' },
  'start menu': { kind: 'uri', target: 'ms-settings:personalization-start', summary: 'Opened Start settings' },
  colours: { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },
  colors: { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },
  'dark mode': { kind: 'uri', target: 'ms-settings:colors', summary: 'Opened Colors settings' },

  // Privacy
  privacy: { kind: 'uri', target: 'ms-settings:privacy', summary: 'Opened Privacy settings' },
  location: { kind: 'uri', target: 'ms-settings:privacy-location', summary: 'Opened Location privacy settings' },
  camera: { kind: 'uri', target: 'ms-settings:privacy-webcam', summary: 'Opened Camera privacy settings' },
  'camera privacy': { kind: 'uri', target: 'ms-settings:privacy-webcam', summary: 'Opened Camera privacy settings' },
  microphone: { kind: 'uri', target: 'ms-settings:privacy-microphone', summary: 'Opened Microphone privacy settings' },
  'microphone privacy': { kind: 'uri', target: 'ms-settings:privacy-microphone', summary: 'Opened Microphone privacy settings' },

  // Time and language
  time: { kind: 'uri', target: 'ms-settings:dateandtime', summary: 'Opened Date and time settings' },
  date: { kind: 'uri', target: 'ms-settings:dateandtime', summary: 'Opened Date and time settings' },
  language: { kind: 'uri', target: 'ms-settings:regionlanguage', summary: 'Opened Language settings' },
  region: { kind: 'uri', target: 'ms-settings:regionlanguage', summary: 'Opened Region settings' },

  // Legacy Control Panel and applets
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

function resolveSetting(setting: string): OpenTarget | undefined {
  const key = normalizeSetting(setting);
  if (!key) return undefined;

  return SETTINGS_MAP[key]
    ?? Object.entries(SETTINGS_MAP).find(([candidate]) => candidate.includes(key))?.[1]
    ?? Object.entries(SETTINGS_MAP).find(([candidate]) => key.includes(candidate))?.[1];
}

export function extractSettingRequest(userMessage: string): string | null {
  const match = userMessage
    .trim()
    .match(/^(?:open|show(?:\s+me)?|go\s+to|check(?:\s+for)?)\s+(?:the\s+)?(.+?)\s*\??$/i);
  if (!match) return null;

  const candidate = normalizeSetting(match[1]!);
  if (!candidate) return null;

  if (resolveSetting(candidate)) return candidate;

  const withoutSuffix = candidate.replace(/\s+settings?$/i, '').trim();
  if (withoutSuffix && resolveSetting(withoutSuffix)) return withoutSuffix;

  return null;
}

async function openTarget(target: OpenTarget): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('openSettings is only supported on Windows');
  }

  if (target.kind === 'uri') {
    await execa('cmd', ['/c', 'start', '', target.target], { reject: false, windowsHide: false });
    return;
  }

  await execa('cmd', ['/c', 'start', '', target.target, ...(target.args ?? [])], {
    reject: false,
    windowsHide: false,
  });
}

async function getAvailableNetworks(): Promise<string> {
  try {
    const { stdout } = await execa('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : 'No Wi-Fi networks found.';
  } catch {
    return 'Could not retrieve available networks. Make sure Wi-Fi is turned on.';
  }
}

export async function openSettings(args: Record<string, unknown>): Promise<string> {
  const rawSetting = String(args['setting'] ?? '').trim();
  if (!rawSetting) {
    throw new Error('openSettings: "setting" argument is required');
  }

  const target = resolveSetting(rawSetting);
  if (!target) {
    throw new Error(
      `Unknown setting: "${rawSetting}". Try wifi, bluetooth, display, sound, battery, updates, control panel, or programs and features.`,
    );
  }

  await openTarget(target);

  if (target.includeNetworks) {
    const networks = await getAvailableNetworks();
    return `${target.summary}\n\nAvailable networks:\n${networks}`;
  }

  return target.summary;
}

export async function getBatteryStatus(): Promise<string> {
  if (process.platform !== 'win32') {
    return 'Battery status is only supported on Windows.';
  }

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