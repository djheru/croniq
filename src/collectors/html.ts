import * as cheerio from 'cheerio';
import type { HtmlConfig } from '../types/index.js';
import type { Collector, CollectorResult } from './base.js';
import { extractSelectors } from './selectors.js';

export class HtmlCollector implements Collector {
  constructor(private config: HtmlConfig) {}

  async collect(): Promise<CollectorResult> {
    const res = await fetch(this.config.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Croniq/1.0)',
        ...this.config.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${this.config.url}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const data = extractSelectors($, this.config.selectors);

    return {
      data,
      meta: {
        url: this.config.url,
        statusCode: res.status,
        contentType: res.headers.get('content-type') ?? 'unknown',
      },
    };
  }
}
