import type { GraphQLConfig } from '../types/index.js';
import type { Collector, CollectorResult } from './base.js';

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export class GraphQLCollector implements Collector {
  constructor(private config: GraphQLConfig) {}

  async collect(): Promise<CollectorResult> {
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Croniq/1.0',
        ...this.config.headers,
      },
      body: JSON.stringify({
        query: this.config.query,
        variables: this.config.variables ?? {},
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json() as { data?: unknown; errors?: unknown[] };

    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    let data: unknown = json.data;
    if (this.config.extract) {
      data = getPath(data, this.config.extract);
    }

    return { data, meta: { url: this.config.url } };
  }
}
