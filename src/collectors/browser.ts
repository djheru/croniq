import * as cheerio from 'cheerio';
import type { BrowserConfig } from '../types/index.js';
import type { Collector, CollectorResult } from './base.js';
import { extractSelectors } from './selectors.js';

export class BrowserCollector implements Collector {
  constructor(private config: BrowserConfig) {}

  async collect(): Promise<CollectorResult> {
    // Lazy-import playwright so it doesn't break startup if not installed
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (this.config.waitFor) {
        await page.waitForSelector(this.config.waitFor, { timeout: 15000 });
      }

      if (this.config.clickBefore?.length) {
        for (const selector of this.config.clickBefore) {
          await page.click(selector).catch(() => { /* ignore if not found */ });
          await page.waitForTimeout(500);
        }
      }

      if (this.config.scrollToBottom) {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const data = extractSelectors($, this.config.selectors);

      return {
        data,
        meta: { url: this.config.url, collector: 'browser' },
      };
    } finally {
      await browser.close();
    }
  }
}
