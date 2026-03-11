import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SelectorMap } from '../../types/index.js';

export const browserScrape = tool(
  async ({ url, selectors, wait_for, scroll_to_bottom }) => {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      return JSON.stringify({ error: 'Playwright is not installed' });
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

      if (wait_for) {
        await page.waitForSelector(wait_for, { timeout: 15000 }).catch(() => {});
      }

      if (scroll_to_bottom) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      const { extractSelectors } = await import('./selectors.js');
      const data = extractSelectors($, selectors as SelectorMap);
      return JSON.stringify(data);
    } finally {
      await browser.close();
    }
  },
  {
    name: 'browser_scrape',
    description: 'Scrape data from a JavaScript-rendered page using Playwright and CSS selectors.',
    schema: z.object({
      url: z.string().describe('The page URL to scrape'),
      selectors: z.record(z.union([
        z.string(),
        z.object({
          selector: z.string(),
          attribute: z.string().optional(),
          multiple: z.boolean().optional(),
          transform: z.enum(['trim', 'number', 'lowercase', 'uppercase']).optional(),
        }),
      ])).describe('Map of field names to CSS selectors or selector specs'),
      wait_for: z.string().optional().describe('CSS selector to wait for before scraping'),
      scroll_to_bottom: z.boolean().optional().describe('Scroll to bottom to trigger lazy loading'),
    }),
  }
);
