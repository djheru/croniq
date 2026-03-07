import Parser from 'rss-parser';
import type { RssConfig } from '../types/index.js';
import type { Collector, CollectorResult } from './base.js';

const parser = new Parser();

export class RssCollector implements Collector {
  constructor(private config: RssConfig) {}

  async collect(): Promise<CollectorResult> {
    const feed = await parser.parseURL(this.config.url);
    const fields = this.config.fields ?? ['title', 'link', 'pubDate', 'content'];

    const items = (feed.items ?? [])
      .slice(0, this.config.maxItems ?? 20)
      .map((item) => {
        const result: Record<string, unknown> = {};
        for (const field of fields) {
          result[field] = (item as Record<string, unknown>)[field] ?? null;
        }
        return result;
      });

    return {
      data: items,
      meta: {
        feedTitle: feed.title,
        feedLink: feed.link,
        itemCount: items.length,
      },
    };
  }
}
