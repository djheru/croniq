import RssParser from 'rss-parser';
import type { CollectorResult } from './types.js';

const parser = new RssParser();
type RssSourceConfig = { type: 'rss'; url: string; maxItems?: number };

export async function collectRss(config: RssSourceConfig, name?: string): Promise<CollectorResult> {
  const source = name ?? config.url;
  try {
    const feed = await parser.parseURL(config.url);
    const maxItems = config.maxItems ?? 20;
    return {
      source,
      data: {
        title: feed.title,
        feedUrl: feed.feedUrl ?? config.url,
        items: feed.items.slice(0, maxItems).map(item => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet,
          isoDate: item.isoDate,
        })),
      },
    };
  } catch (err) {
    return { source, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
