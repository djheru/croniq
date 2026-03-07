import type { ApiConfig, FieldTransform } from '../types/index.js';
import type { Collector, CollectorResult } from './base.js';

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyTransforms(
  items: unknown[],
  transforms: FieldTransform[]
): Record<string, unknown>[] {
  return items.map((item) => {
    const result: Record<string, unknown> = {};
    for (const t of transforms) {
      let value = getPath(item, t.from);
      if (t.transform === 'number' && typeof value === 'string') {
        value = parseFloat(value);
      } else if (t.transform === 'date' && value) {
        value = new Date(String(value)).toISOString();
      } else if (t.transform === 'trim' && typeof value === 'string') {
        value = value.trim();
      }
      result[t.to] = value;
    }
    return result;
  });
}

export class ApiCollector implements Collector {
  constructor(private config: ApiConfig) {}

  async collect(): Promise<CollectorResult> {
    const res = await fetch(this.config.url, {
      method: this.config.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Croniq/1.0',
        ...this.config.headers,
      },
      body: this.config.body ? JSON.stringify(this.config.body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${this.config.url}`);
    }

    let data: unknown = await res.json();

    // Drill into nested path if specified
    if (this.config.extract) {
      data = getPath(data, this.config.extract);
    }

    // Apply field transforms if specified
    if (this.config.transform?.length && Array.isArray(data)) {
      data = applyTransforms(data, this.config.transform);
    }

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
