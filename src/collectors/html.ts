import * as cheerio from 'cheerio';
import type { CollectorResult, SelectorSpec } from './types.js';

type HtmlSourceConfig = { type: 'html'; url: string; selectors: Record<string, SelectorSpec>; headers?: Record<string, string> };

function applyTransform(value: string, transform?: SelectorSpec['transform']): string | number {
  if (!transform) return value.trim();
  switch (transform) {
    case 'trim':      return value.trim();
    case 'number':    return parseFloat(value.replace(/[^0-9.-]/g, ''));
    case 'lowercase': return value.toLowerCase().trim();
    case 'uppercase': return value.toUpperCase().trim();
  }
}

export async function collectHtml(config: HtmlSourceConfig, name?: string): Promise<CollectorResult> {
  const source = name ?? config.url;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(config.url, {
      headers: config.headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    const data: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(config.selectors)) {
      if (spec.multiple) {
        data[key] = $(spec.selector).map((_, el) => {
          const raw = spec.attribute ? $(el).attr(spec.attribute) ?? '' : $(el).text();
          return applyTransform(raw, spec.transform);
        }).get();
      } else {
        const el = $(spec.selector).first();
        const raw = spec.attribute ? el.attr(spec.attribute) ?? '' : el.text();
        data[key] = applyTransform(raw, spec.transform);
      }
    }
    return { source, data };
  } catch (err) {
    return { source, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
