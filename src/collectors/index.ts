import { collectApi } from './api.js';
import { collectBrowser } from './browser.js';
import { collectGraphql } from './graphql.js';
import { collectHtml } from './html.js';
import { collectRss } from './rss.js';
import type { CollectorResult, SourceEntry } from './types.js';

export async function collectSources(sources: SourceEntry[]): Promise<CollectorResult[]> {
  const results = await Promise.allSettled(
    sources.map(({ name, config }) => {
      switch (config.type) {
        case 'api':      return collectApi(config, name);
        case 'rss':      return collectRss(config, name);
        case 'html':     return collectHtml(config, name);
        case 'browser':  return collectBrowser(config, name);
        case 'graphql':  return collectGraphql(config, name);
      }
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const source = sources[i].name ?? (sources[i].config as { url: string }).url ?? 'unknown';
    return { source, data: null, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  });
}
