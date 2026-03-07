import type { SelectorMap, SelectorSpec } from '../types/index.js';

type CheerioRoot = ReturnType<typeof import('cheerio').load>;

function applyTransform(value: string, transform?: SelectorSpec['transform']): string | number {
  switch (transform) {
    case 'trim':      return value.trim();
    case 'number':    return parseFloat(value.replace(/[^0-9.-]/g, ''));
    case 'lowercase': return value.toLowerCase().trim();
    case 'uppercase': return value.toUpperCase().trim();
    default:          return value.trim();
  }
}

export function extractSelectors(
  $: CheerioRoot,
  selectors: SelectorMap
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(selectors)) {
    const s: SelectorSpec = typeof spec === 'string'
      ? { selector: spec }
      : spec;

    const els = $(s.selector);

    if (s.multiple) {
      result[key] = els.map((_, el) => {
        const raw = s.attribute
          ? $(el).attr(s.attribute) ?? ''
          : $(el).text();
        return applyTransform(raw, s.transform);
      }).get();
    } else {
      const el = els.first();
      if (el.length === 0) {
        result[key] = null;
      } else {
        const raw = s.attribute ? el.attr(s.attribute) ?? '' : el.text();
        result[key] = applyTransform(raw, s.transform);
      }
    }
  }

  return result;
}
