import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { extractSelectors } from './selectors.js';
import type { SelectorMap } from '../../types/index.js';

export const htmlScrape = tool(
  async ({ url, selectors, headers }) => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Croniq/1.0)',
        ...headers,
      },
    });

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const data = extractSelectors($, selectors as SelectorMap);
    return JSON.stringify(data);
  },
  {
    name: 'html_scrape',
    description: 'Scrape data from a static HTML page using CSS selectors. Uses cheerio for parsing.',
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
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
    }),
  }
);
