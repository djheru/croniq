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
      const response = await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const statusCode = response?.status() ?? 0;
      const pageTitle = await page.title().catch(() => '');

      if (this.config.waitFor) {
        try {
          await page.waitForSelector(this.config.waitFor, { timeout: 15000 });
        } catch (err) {
          // Capture diagnostic context before re-throwing
          const bodyPreview = await page.evaluate(
            'document.body?.innerText?.slice(0, 300) ?? ""'
          ).catch(() => '') as string;
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `${msg}\n` +
            `[diag] status=${statusCode}, title="${pageTitle}"\n` +
            `[diag] body preview: ${bodyPreview.replace(/\n/g, ' ').slice(0, 200)}`
          );
        }
      }

      if (this.config.clickBefore?.length) {
        for (const selector of this.config.clickBefore) {
          await page.click(selector).catch(() => { /* ignore if not found */ });
          await page.waitForTimeout(500);
        }
      }

      if (this.config.scrollToBottom) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const data = extractSelectors($, this.config.selectors);

      return {
        data,
        meta: { url: this.config.url, collector: 'browser', statusCode, pageTitle },
      };
    } finally {
      await browser.close();
    }
  }
}
