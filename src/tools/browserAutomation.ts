// browserAutomation.ts - Playwright-backed browser control via Chrome CDP
//
// IMPORTANT: Do not import Playwright at module load time.
// In packaged builds (caxa), extracting large node_modules trees can race with
// Node startup. A top-level `import 'playwright'` can prevent the CLI from
// launching at all. We lazy-load Playwright only when the browser tool is used.
import type { Browser, BrowserContext, Page } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BLOCKED_DOMAIN_HINTS = [
  'paypal.com',
  'stripe.com',
  'accounts.google.com',
  'bank',
  'login',
  'signin',
  'password',
];

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE_DIR = join(homedir(), '.fella', 'chrome-debug-profile');

type BrowserAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'append_text'
  | 'search'
  | 'createDocument'
  | 'screenshot'
  | 'get_text'
  | 'scroll'
  | 'wait'
  | 'rename_document'
  | 'select_all'
  | 'set_font'
  | 'set_font_size'
  | 'set_text_color'
  | 'add_header_footer'
  | 'close_tab'
  | 'close_all_tabs'
  | 'profile_selected'
  | 'close';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

let chromiumLauncher: (typeof import('playwright'))['chromium'] | null = null;

async function getChromium() {
  if (chromiumLauncher) return chromiumLauncher;
  const pw = await import('playwright');
  chromiumLauncher = pw.chromium;
  return chromiumLauncher;
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isDomainBlocked(url: string): boolean {
  try {
    const parsed = new URL(normaliseUrl(url));
    const host = parsed.hostname.toLowerCase();
    return BLOCKED_DOMAIN_HINTS.some((hint) => host.includes(hint) || url.toLowerCase().includes(hint));
  } catch {
    const lower = url.toLowerCase();
    return BLOCKED_DOMAIN_HINTS.some((hint) => lower.includes(hint));
  }
}

function findChromePath(): string | null {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env['LOCALAPPDATA'] ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return paths.find((p) => p.length > 10 && existsSync(p)) ?? null;
}

async function isCDPOpen(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getWsEndpoint(): Promise<string | null> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { webSocketDebuggerUrl?: string };
    return data.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureChromeWithCDP(): Promise<void> {
  if (await isCDPOpen()) return;

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Chrome/Edge not found. Install Google Chrome or Microsoft Edge and retry.');
  }

  mkdirSync(PROFILE_DIR, { recursive: true });

  spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session',
  ], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  for (let i = 0; i < 20; i++) {
    await sleep(750);
    if (await isCDPOpen()) return;
  }

  throw new Error('Chrome launched but debug port did not open.');
}

async function getPage(newTab = false): Promise<Page> {
  if (!browser?.isConnected()) {
    await ensureChromeWithCDP();
    const wsEndpoint = await getWsEndpoint();
    if (!wsEndpoint) throw new Error('Could not get Chrome WebSocket endpoint');

    const chromium = await getChromium();
    browser = await chromium.connectOverCDP(wsEndpoint);
    context = browser.contexts()[0] ?? null;
    page = null;
  }

  if (!context) {
    context = browser?.contexts()[0] ?? null;
  }

  if (!context) {
    throw new Error('No browser context available');
  }

  if (newTab) {
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.bringToFront().catch(() => {});
    return page;
  }

  if (!page || page.isClosed()) {
    const existing = context.pages().find((p) => !p.isClosed() && !p.url().startsWith('devtools://'));
    page = existing ?? await context.newPage();
    page.setDefaultTimeout(12000);
  }

  await page.bringToFront().catch(() => {});
  return page;
}

async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) {
    try {
      await page.close();
    } catch {
      // Ignore close errors.
    }
  }
  page = null;

  if (context) {
    try {
      await context.close();
    } catch {
      // Ignore close errors.
    }
  }
  context = null;

  if (browser?.isConnected()) {
    try {
      await browser.close();
    } catch {
      // Ignore disconnect errors.
    }
  }
  browser = null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function asPositiveNumberString(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return '';
  const parsed = Number.parseFloat(raw.replace(/pt$/i, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function parseCommandFallback(args: Record<string, unknown>): Record<string, unknown> {
  const command = asString(args['command']).trim();
  if (!command) return args;

  const fontSize = command.match(/docs\.setfontsize\(\s*['\"]?([0-9]+(?:\.[0-9]+)?)\s*(?:pt)?['\"]?/i);
  if (fontSize?.[1]) {
    return {
      ...args,
      action: 'set_font_size',
      size: fontSize[1],
    };
  }

  return args;
}

async function readBodyText(currentPage: Page): Promise<string> {
  const body = currentPage.locator('body');
  await body.first().waitFor({ state: 'attached', timeout: 8000 });
  return body.innerText();
}

function extractWeeklyDownloadsFromText(text: string): string | null {
  const compact = text.replace(/\s+/g, ' ').trim();
  const match = compact.match(/weekly downloads\s*([\d,]+(?:\.\d+)?[kKmM]?)/i);
  return match?.[1] ?? null;
}

async function extractNpmWeeklyDownloads(currentPage: Page): Promise<string | null> {
  try {
    const label = currentPage.getByText(/Weekly Downloads/i).first();
    if ((await label.count()) > 0) {
      await label.scrollIntoViewIfNeeded();
      const nearbyText = await label.locator('xpath=ancestor::section[1] | xpath=ancestor::div[1]').innerText();
      const parsed = extractWeeklyDownloadsFromText(nearbyText);
      if (parsed) return parsed;
    }
  } catch {
    // Fall back to body parse.
  }

  try {
    const bodyText = await readBodyText(currentPage);
    return extractWeeklyDownloadsFromText(bodyText);
  } catch {
    return null;
  }
}

async function focusGoogleDocsEditor(currentPage: Page): Promise<void> {
  const url = currentPage.url().toLowerCase();
  if (!url.includes('docs.google.com/document')) return;

  // Give Docs a brief moment to finish bootstrapping the editor runtime.
  await currentPage.waitForTimeout(800);

  const selectors = [
    '.kix-appview-editor',
    'div.kix-appview-editor',
    '.docs-texteventtarget-iframe',
  ];

  for (const selector of selectors) {
    try {
      const locator = currentPage.locator(selector).first();
      if ((await locator.count()) === 0) continue;
      await locator.click({ timeout: 3000, force: true });
      await currentPage.waitForTimeout(150);
      return;
    } catch {
      // Try the next candidate selector.
    }
  }

  try {
    await currentPage.mouse.click(420, 320);
    await currentPage.waitForTimeout(150);
  } catch {
    // If even fallback click fails, keyboard typing may still work on active target.
  }
}

async function appendToGoogleDoc(currentPage: Page, text: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);
  await focusGoogleDocsEditor(currentPage);
  await currentPage.keyboard.press('Control+End');
  await currentPage.keyboard.press('End');
  await currentPage.keyboard.press('Enter');
  await currentPage.keyboard.type(text);
}

function isGoogleDocPage(currentPage: Page): boolean {
  return currentPage.url().toLowerCase().includes('docs.google.com/document');
}

async function ensureGoogleDocPage(currentPage: Page): Promise<void> {
  if (!isGoogleDocPage(currentPage)) {
    throw new Error('Active tab is not a Google Docs document. Open a Google Doc first.');
  }
}

async function renameGoogleDoc(currentPage: Page, title: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);

  const directInput = currentPage.locator('input.docs-title-input').first();
  if ((await directInput.count()) > 0) {
    await directInput.click({ timeout: 3000 });
    await directInput.fill(title);
    await directInput.press('Enter');
    await currentPage.waitForTimeout(400);
    const value = ((await directInput.inputValue().catch(() => '')).trim());
    if (!value.toLowerCase().includes(title.toLowerCase())) {
      throw new Error(`Google Docs title did not update to "${title}".`);
    }
    return;
  }

  const titleLabel = currentPage.locator('.docs-title-input-label-inner, #docs-title-input-label').first();
  if ((await titleLabel.count()) > 0) {
    await titleLabel.click({ timeout: 3000 });
    const inputAfterClick = currentPage.locator('input.docs-title-input').first();
    await inputAfterClick.waitFor({ state: 'visible', timeout: 3000 });
    await inputAfterClick.fill(title);
    await inputAfterClick.press('Enter');
    await currentPage.waitForTimeout(400);
    const value = ((await inputAfterClick.inputValue().catch(() => '')).trim());
    if (!value.toLowerCase().includes(title.toLowerCase())) {
      throw new Error(`Google Docs title did not update to "${title}".`);
    }
    return;
  }

  // Final fallback: click near title region and type.
  await currentPage.mouse.click(220, 32);
  await currentPage.keyboard.press('Control+A');
  await currentPage.keyboard.type(title);
  await currentPage.keyboard.press('Enter');
  await currentPage.waitForTimeout(400);
}

async function setGoogleDocsFont(currentPage: Page, font: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);
  await focusGoogleDocsEditor(currentPage);

  const fontControl = currentPage.locator('[aria-label="Font"], div[role="combobox"][aria-label*="Font"], #fontFamilySelection').first();
  await fontControl.click({ timeout: 4000 });
  await currentPage.keyboard.press('Control+A');
  await currentPage.keyboard.type(font);
  await currentPage.keyboard.press('Enter');
}

async function setGoogleDocsFontSize(currentPage: Page, size: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);
  await focusGoogleDocsEditor(currentPage);

  const normalizedSize = asPositiveNumberString(size);
  if (!normalizedSize) {
    throw new Error(`Invalid font size: "${size}". Provide a positive number like 15.`);
  }

  const sizeInput = currentPage.locator(
    'input[aria-label="Font size"], input.docs-font-size-input, input[aria-label*="font size" i]',
  ).first();

  if ((await sizeInput.count()) === 0) {
    throw new Error('Could not find the Google Docs font size control.');
  }

  await sizeInput.click({ timeout: 4000 });
  await sizeInput.fill(normalizedSize);
  await sizeInput.press('Enter');

  const applied = (await sizeInput.inputValue().catch(() => '')).replace(/\s+/g, '');
  if (applied && !applied.startsWith(normalizedSize)) {
    throw new Error(`Google Docs did not apply font size ${normalizedSize}.`);
  }
}

async function setGoogleDocsTextColor(currentPage: Page, color: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);
  await focusGoogleDocsEditor(currentPage);

  const colorButton = currentPage.locator('[aria-label*="Text color"], [aria-label*="text color"], #textColorButton').first();
  await colorButton.click({ timeout: 4000 });

  const swatch = currentPage.locator(`[aria-label*="${color}" i]`).first();
  if ((await swatch.count()) === 0) {
    throw new Error(`Could not find a text color option named "${color}".`);
  }
  await swatch.click({ timeout: 3000 });
}

async function addGoogleDocsHeaderFooter(currentPage: Page, headerText?: string, footerText?: string): Promise<void> {
  await ensureGoogleDocPage(currentPage);

  const insertMenu = currentPage.getByText('Insert', { exact: true }).first();
  await insertMenu.click({ timeout: 5000 });
  const headersAndFooters = currentPage.getByText(/Headers?\s*&\s*footers?/i).first();
  await headersAndFooters.click({ timeout: 5000 });

  if (headerText) {
    await currentPage.getByText(/^Header$/i).first().click({ timeout: 4000 });
    await currentPage.keyboard.type(headerText);
    await currentPage.keyboard.press('Escape');

    await insertMenu.click({ timeout: 5000 });
    await headersAndFooters.click({ timeout: 5000 });
  }

  if (footerText) {
    await currentPage.getByText(/^Footer$/i).first().click({ timeout: 4000 });
    await currentPage.keyboard.type(footerText);
    await currentPage.keyboard.press('Escape');
  }
}

export async function browserAutomation(args: Record<string, unknown>): Promise<string> {
  const normalizedArgs = parseCommandFallback(args);
  const action = asString(normalizedArgs['action']).toLowerCase() as BrowserAction;

  if (!action) {
    throw new Error('browserAutomation: "action" argument is required');
  }

  if (action === 'close') {
    await closeBrowser();
    return 'Browser closed.';
  }

  if (action === 'close_tab') {
    const currentPage = await getPage();
    if (!currentPage.isClosed()) {
      await currentPage.close();
    }
    page = null;
    return 'Closed current browser tab.';
  }

  if (action === 'close_all_tabs') {
    const currentPage = await getPage();
    const currentContext = currentPage.context();
    const pages = currentContext.pages().filter((p) => !p.isClosed() && !p.url().startsWith('devtools://'));
    let closed = 0;
    for (const p of pages) {
      try {
        await p.close();
        closed += 1;
      } catch {
        // Ignore individual tab close failures.
      }
    }
    page = null;
    return closed > 0 ? `Closed ${closed} browser tab(s).` : 'No open browser tabs to close.';
  }

  if (action === 'profile_selected') {
    await ensureChromeWithCDP();
    browser = null;
    context = null;
    page = null;
    await getPage();
    return 'Browser profile acknowledged. Connected to Chrome session.';
  }

  const currentPage = await getPage(action === 'navigate' && asBoolean(normalizedArgs['newTab']));

  switch (action) {
    case 'navigate': {
      const rawUrl = asString(normalizedArgs['url']);
      if (!rawUrl) throw new Error('browserAutomation.navigate: "url" is required');
      if (isDomainBlocked(rawUrl)) {
        return 'Domain blocked for safety. I do not automate login or payment pages.';
      }
      const url = normaliseUrl(rawUrl);
      await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
      try {
        await currentPage.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // Some pages keep long-lived connections.
      }
      const title = await currentPage.title();
      return `Navigated to ${url} - ${title}`;
    }

    case 'click': {
      const selector = asString(normalizedArgs['selector']);
      const text = asString(normalizedArgs['text']);
      if (!selector && !text) {
        throw new Error('browserAutomation.click: provide "selector" or "text"');
      }
      if (text) {
        await currentPage.getByText(text).first().click();
      } else {
        await currentPage.locator(selector).first().click();
      }
      return `Clicked ${text || selector}`;
    }

    case 'type': {
      const text = asString(normalizedArgs['text']);
      const selector = asString(normalizedArgs['selector']);
      if (!text) throw new Error('browserAutomation.type: "text" is required');

      const pageUrl = currentPage.url().toLowerCase();
      if (!selector && pageUrl.includes('accounts.google.com')) {
        throw new Error('Google account sign-in page is active. Complete sign-in first, then ask me to write in the document.');
      }

      if (selector) {
        await currentPage.locator(selector).first().fill(text);
      } else {
        const pageUrl = currentPage.url().toLowerCase();
        if (pageUrl.includes('docs.google.com/document')) {
          await appendToGoogleDoc(currentPage, text);
        } else {
          await focusGoogleDocsEditor(currentPage);
          await currentPage.keyboard.type(text);
        }
      }
      return `Typed "${text}"`;
    }

    case 'append_text': {
      const text = asString(normalizedArgs['text']);
      if (!text) throw new Error('browserAutomation.append_text: "text" is required');
      await appendToGoogleDoc(currentPage, text);
      return `Appended text to Google Doc (${text.length} chars).`;
    }

    case 'search': {
      const query = asString(normalizedArgs['query']);
      if (!query) throw new Error('browserAutomation.search: "query" is required');
      await currentPage.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      await currentPage.locator('textarea[name="q"]').fill(query);
      await currentPage.keyboard.press('Enter');
      await currentPage.waitForLoadState('domcontentloaded');
      const title = await currentPage.title();
      return `Searched Google for "${query}" - ${title}`;
    }

    case 'createDocument': {
      const title = asString(normalizedArgs['title']).trim();
      await currentPage.goto('https://docs.new', { waitUntil: 'domcontentloaded' });
      if (title) {
        await currentPage.keyboard.type(title);
        return `Opened Google Doc and typed title text: "${title}"`;
      }
      return 'Created new Google Doc.';
    }

    case 'screenshot': {
      const folder = join(homedir(), '.fella', 'screenshots');
      await mkdir(folder, { recursive: true });
      const filePath = join(folder, `shot-${Date.now()}.png`);
      await currentPage.screenshot({ path: filePath, fullPage: false });
      return `Screenshot saved: ${filePath}`;
    }

    case 'get_text': {
      const selector = asString(normalizedArgs['selector']);
      let text = '';
      if (selector) {
        try {
          const locator = currentPage.locator(selector).first();
          await locator.waitFor({ state: 'visible', timeout: 6000 });
          text = await locator.innerText();
        } catch {
          const pageUrl = currentPage.url().toLowerCase();
          if (pageUrl.includes('npmjs.com/package') || selector.toLowerCase().includes('week')) {
            const weekly = await extractNpmWeeklyDownloads(currentPage);
            if (weekly) {
              return `Weekly downloads: ${weekly}`;
            }
          }

          text = await readBodyText(currentPage);
          return `Selector not found (${selector}). Fallback page text:\n${text.slice(0, 2000)}`;
        }
      } else {
        text = await readBodyText(currentPage);
        const pageUrl = currentPage.url().toLowerCase();
        if (pageUrl.includes('npmjs.com/package')) {
          const weekly = extractWeeklyDownloadsFromText(text);
          if (weekly) {
            return `Weekly downloads: ${weekly}`;
          }
        }
      }
      return `Text retrieved:\n${text.slice(0, 2000)}`;
    }

    case 'scroll': {
      const direction = asString(normalizedArgs['direction']).toLowerCase();
      const amount = asNumber(normalizedArgs['amount'], 500);
      const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
      await currentPage.mouse.wheel(0, delta);
      return `Scrolled ${direction === 'up' ? 'up' : 'down'} by ${Math.abs(amount)}px`;
    }

    case 'wait': {
      const selector = asString(normalizedArgs['selector']);
      if (selector) {
        await currentPage.waitForSelector(selector, { timeout: 10000 });
        return `Element appeared: ${selector}`;
      }
      const ms = asNumber(normalizedArgs['amount'], 1000);
      await currentPage.waitForTimeout(ms);
      return `Waited ${ms}ms`;
    }

    case 'rename_document': {
      const title = asString(normalizedArgs['title']).trim();
      if (!title) throw new Error('browserAutomation.rename_document: "title" is required');
      await renameGoogleDoc(currentPage, title);
      return `Renamed the Google Docs document to '${title}'.`;
    }

    case 'select_all': {
      await ensureGoogleDocPage(currentPage);
      await focusGoogleDocsEditor(currentPage);
      await currentPage.keyboard.press('Control+A');
      return 'Selected all document content.';
    }

    case 'set_font': {
      const font = asString(normalizedArgs['font']).trim();
      if (!font) throw new Error('browserAutomation.set_font: "font" is required');
      await setGoogleDocsFont(currentPage, font);
      return `Changed document font to ${font}.`;
    }

    case 'set_font_size': {
      const size = asString(normalizedArgs['size']).trim() || asString(normalizedArgs['fontSize']).trim();
      if (!size) throw new Error('browserAutomation.set_font_size: "size" is required');
      await setGoogleDocsFontSize(currentPage, size);
      return `Changed document font size to ${asPositiveNumberString(size)}.`;
    }

    case 'set_text_color': {
      const color = asString(normalizedArgs['color']).trim();
      if (!color) throw new Error('browserAutomation.set_text_color: "color" is required');
      await setGoogleDocsTextColor(currentPage, color);
      return `Changed text color to ${color}.`;
    }

    case 'add_header_footer': {
      const headerText = asString(normalizedArgs['headerText']).trim();
      const footerText = asString(normalizedArgs['footerText']).trim();
      if (!headerText && !footerText) {
        throw new Error('browserAutomation.add_header_footer: provide "headerText" and/or "footerText"');
      }
      await addGoogleDocsHeaderFooter(
        currentPage,
        headerText || undefined,
        footerText || undefined,
      );
      if (headerText && footerText) return 'Added header and footer text in the Google Doc.';
      if (headerText) return 'Added header text in the Google Doc.';
      return 'Added footer text in the Google Doc.';
    }

    default:
      throw new Error(`Unknown browserAutomation action: ${action}`);
  }
}
