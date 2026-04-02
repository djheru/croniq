export interface SelectorSpec {
  selector: string;
  attribute?: string;
  multiple?: boolean;
  transform?: 'trim' | 'number' | 'lowercase' | 'uppercase';
}

export type SourceConfig =
  | { type: 'rss';      url: string; maxItems?: number }
  | { type: 'api';      url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; extract?: string }
  | { type: 'html';     url: string; selectors: Record<string, SelectorSpec>; headers?: Record<string, string> }
  | { type: 'browser';  url: string; selectors: Record<string, SelectorSpec>; waitFor?: string; clickBefore?: string[]; scrollToBottom?: boolean }
  | { type: 'graphql';  url: string; query: string; variables?: Record<string, unknown>; headers?: Record<string, string>; extract?: string }

export interface CollectorResult {
  source: string;
  data: unknown;
  error?: string;
}

export interface SourceEntry {
  name?: string;
  config: SourceConfig;
}
