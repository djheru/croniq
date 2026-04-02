import * as cheerio from 'cheerio';
import type { CollectorResult, SelectorSpec } from './types.js';

type BrowserSourceConfig = {
  type: 'browser';
  url: string;
  selectors: Record<string, SelectorSpec>;
  waitFor?: string;
  clickBefore?: string[];
  scrollToBottom?: boolean;
};

function applyTransform(value: string, transform?: SelectorSpec['transform']): string | number {
  if (!transform) return value.trim();
  switch (transform) {
    case 'trim':      return value.trim();
    case 'number':    return parseFloat(value);
    case 'lowercase': return value.toLowerCase();
    case 'uppercase': return value.toUpperCase();
    default:          return value.trim();
  }
}

export async function collectBrowser(config: BrowserSourceConfig, name?: string): Promise<CollectorResult> {
  const source = name ?? config.url;
  let browser;
  try {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      return { source, data: null, error: 'Playwright not available' };
    }

    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (config.waitFor) {
      await page.waitForSelector(config.waitFor, { timeout: 10_000 });
    }

    if (config.clickBefore) {
      for (const selector of config.clickBefore) {
        await page.click(selector).catch(() => {});
      }
    }

    if (config.scrollToBottom) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.waitForTimeout(1000);
    }

    const html = await page.content();
    const $ = cheerio.load(html);

    const data: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(config.selectors)) {
      if (spec.multiple) {
        data[key] = $(spec.selector).map((_, el) => {
          const raw = spec.attribute ? $(el).attr(spec.attribute) ?? '' : $(el).text();
          return applyTransform(raw, spec.transform);
        }).get();
      } else {
        const el = $(spec.selector).first();
        const raw = spec.attribute ? el.attr(spec.attribute) ?? '' : el.text();
        data[key] = applyTransform(raw, spec.transform);
      }
    }

    return { source, data };
  } catch (err) {
    return { source, data: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await browser?.close();
  }
}
