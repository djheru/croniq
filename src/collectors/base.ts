import type { CollectorConfig } from '../types/index.js';

export interface CollectorResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export interface Collector {
  collect(): Promise<CollectorResult>;
}

export function createCollector(config: CollectorConfig): Collector {
  switch (config.type) {
    case 'html':    return new (require('./html').HtmlCollector)(config);
    case 'browser': return new (require('./browser').BrowserCollector)(config);
    case 'api':     return new (require('./api').ApiCollector)(config);
    case 'rss':     return new (require('./rss').RssCollector)(config);
    case 'graphql': return new (require('./graphql').GraphQLCollector)(config);
    default:
      throw new Error(`Unknown collector type: ${(config as CollectorConfig).type}`);
  }
}
