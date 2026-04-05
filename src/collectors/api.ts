import type { CollectorResult } from './types.js';
import { extractByPath } from './utils.js';

type ApiSourceConfig = { type: 'api'; url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; extract?: string };

function localhostAdminHeader(url: string): Record<string, string> {
  try {
    const { hostname } = new URL(url);
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '::ffff:127.0.0.1';
    if (isLocal && process.env.SESSION_SECRET) return { 'X-Admin-Key': process.env.SESSION_SECRET };
  } catch { /* invalid URL — no header */ }
  return {};
}

export async function collectApi(config: ApiSourceConfig, name?: string): Promise<CollectorResult> {
  const source = name ?? config.url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...localhostAdminHeader(config.url), ...config.headers },
      body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
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
