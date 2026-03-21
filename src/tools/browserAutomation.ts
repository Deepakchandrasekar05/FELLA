// browserAutomation.ts - Playwright-backed browser control for web tasks
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
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

type BrowserAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'search'
  | 'screenshot'
  | 'get_text'
  | 'scroll'
  | 'wait'
  | 'close';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

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

async function getPage(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: false });
  }
  if (!context) {
    context = await browser.newContext();
  }
  if (!page || page.isClosed()) {
    page = await context.newPage();
    page.setDefaultTimeout(12000);
  }
  return page;
}

async function closeBrowser(): Promise<void> {
  if (page && !page.isClosed()) {
    await page.close();
  }
  page = null;
  if (context) {
    await context.close();
  }
  context = null;
  if (browser && browser.isConnected()) {
    await browser.close();
  }
  browser = null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function readBodyText(currentPage: Page): Promise<string> {
  const body = currentPage.locator('body');
  await body.first().waitFor({ state: 'attached', timeout: 8000 });
  const text = await body.innerText();
  return text;
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
    // Fall back to body-level parse below.
  }

  try {
    const bodyText = await readBodyText(currentPage);
    return extractWeeklyDownloadsFromText(bodyText);
  } catch {
    return null;
  }
}

export async function browserAutomation(args: Record<string, unknown>): Promise<string> {
  const action = asString(args['action']) as BrowserAction;

  if (!action) {
    throw new Error('browserAutomation: "action" argument is required');
  }

  if (action === 'close') {
    await closeBrowser();
    return 'Browser closed.';
  }

  const currentPage = await getPage();

  switch (action) {
    case 'navigate': {
      const rawUrl = asString(args['url']);
      if (!rawUrl) throw new Error('browserAutomation.navigate: "url" is required');
      if (isDomainBlocked(rawUrl)) {
        return 'Domain blocked for safety. I do not automate login or payment pages.';
      }
      const url = normaliseUrl(rawUrl);
      await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
      try {
        await currentPage.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // Some pages keep long-lived connections; domcontentloaded is enough.
      }
      const title = await currentPage.title();
      return `Navigated to ${url} - ${title}`;
    }

    case 'click': {
      const selector = asString(args['selector']);
      const text = asString(args['text']);
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
      const text = asString(args['text']);
      const selector = asString(args['selector']);
      if (!text) throw new Error('browserAutomation.type: "text" is required');
      if (selector) {
        await currentPage.locator(selector).first().fill(text);
      } else {
        await currentPage.keyboard.type(text);
      }
      return `Typed "${text}"`;
    }

    case 'search': {
      const query = asString(args['query']);
      if (!query) throw new Error('browserAutomation.search: "query" is required');
      await currentPage.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      await currentPage.locator('textarea[name="q"]').fill(query);
      await currentPage.keyboard.press('Enter');
      await currentPage.waitForLoadState('domcontentloaded');
      const title = await currentPage.title();
      return `Searched Google for "${query}" - ${title}`;
    }

    case 'screenshot': {
      const folder = join(homedir(), '.fella', 'screenshots');
      await mkdir(folder, { recursive: true });
      const filePath = join(folder, `shot-${Date.now()}.png`);
      await currentPage.screenshot({ path: filePath, fullPage: false });
      return `Screenshot saved: ${filePath}`;
    }

    case 'get_text': {
      const selector = asString(args['selector']);
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

          // Fallback to body text so scraping still succeeds on selector drift.
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
      const direction = asString(args['direction']).toLowerCase();
      const amount = asNumber(args['amount'], 500);
      const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
      await currentPage.mouse.wheel(0, delta);
      return `Scrolled ${direction === 'up' ? 'up' : 'down'} by ${Math.abs(amount)}px`;
    }

    case 'wait': {
      const selector = asString(args['selector']);
      if (selector) {
        await currentPage.waitForSelector(selector, { timeout: 10000 });
        return `Element appeared: ${selector}`;
      }
      const ms = asNumber(args['amount'], 1000);
      await currentPage.waitForTimeout(ms);
      return `Waited ${ms}ms`;
    }

    default:
      throw new Error(`Unknown browserAutomation action: ${action}`);
  }
}
