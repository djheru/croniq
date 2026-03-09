// ─── Collector Types ──────────────────────────────────────────────────────────

export type CollectorType = 'html' | 'browser' | 'api' | 'rss' | 'graphql';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

export type OutputFormat = 'json' | 'text' | 'csv' | 'list';

// Config shapes per collector type
export interface HtmlConfig {
  type: 'html';
  url: string;
  selectors: SelectorMap;
  headers?: Record<string, string>;
}

export interface BrowserConfig {
  type: 'browser';
  url: string;
  selectors: SelectorMap;
  waitFor?: string;           // CSS selector to wait for before extracting
  clickBefore?: string[];     // selectors to click before extracting
  scrollToBottom?: boolean;
}

export interface ApiConfig {
  type: 'api';
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  extract?: string;           // dot-path to drill into response e.g. "data.items"
  transform?: FieldTransform[];
}

export interface RssConfig {
  type: 'rss';
  url: string;
  maxItems?: number;
  fields?: ('title' | 'link' | 'pubDate' | 'content' | 'author' | 'categories')[];
}

export interface GraphQLConfig {
  type: 'graphql';
  url: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  extract?: string;
}

export type CollectorConfig =
  | HtmlConfig
  | BrowserConfig
  | ApiConfig
  | RssConfig
  | GraphQLConfig;

// Selectors map: { fieldName: cssSelector | { selector, attribute, transform } }
export type SelectorMap = Record<string, string | SelectorSpec>;

export interface SelectorSpec {
  selector: string;
  attribute?: string;        // e.g. "href", "src", "data-price"
  multiple?: boolean;        // collect array of all matching elements
  transform?: 'trim' | 'number' | 'lowercase' | 'uppercase';
}

export interface FieldTransform {
  from: string;              // dot-path in response
  to: string;                // field name in result
  transform?: 'trim' | 'number' | 'date';
}

// ─── Job ──────────────────────────────────────────────────────────────────────

export type JobStatus = 'active' | 'paused' | 'error';

export interface Job {
  id: string;
  name: string;
  description?: string;
  schedule: string;           // cron expression
  collectorConfig: CollectorConfig;
  outputFormat: OutputFormat;
  tags: string[];
  notifyOnChange: boolean;
  webhookUrl?: string;
  retries: number;
  timeoutMs: number;
  status: JobStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  analysisPrompt?: string;
  analysisSchedule?: string;     // cron expression, default '0 * * * *'
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateJobInput = Omit<Job,
  'id' | 'status' | 'lastRunAt' | 'nextRunAt' | 'createdAt' | 'updatedAt'
>;

export type UpdateJobInput = Partial<CreateJobInput>;

// ─── Run ──────────────────────────────────────────────────────────────────────

export type RunOutcome = 'success' | 'failure' | 'timeout';

export interface Run {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome: RunOutcome;
  result?: unknown;
  error?: string;
  changed: boolean;          // true if result differs from previous run
  resultHash?: string;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

export interface Analysis {
  id: string;
  jobId: string;
  prompt: string;
  response: string;
  runIds: string[];
  durationMs?: number;
  createdAt: string;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
