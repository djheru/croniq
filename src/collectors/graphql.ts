import type { CollectorResult } from './types.js';
import { extractByPath } from './utils.js';

type GraphqlSourceConfig = { type: 'graphql'; url: string; query: string; variables?: Record<string, unknown>; headers?: Record<string, string>; extract?: string };

export async function collectGraphql(config: GraphqlSourceConfig, name?: string): Promise<CollectorResult> {
  const source = name ?? config.url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...config.headers },
      body: JSON.stringify({ query: config.query, variables: config.variables }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const json = await response.json();
    return { source, data: extractByPath(json, config.extract) };
  } catch (err) {
    return { source, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
