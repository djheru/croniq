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

// A source adds an optional name field to a collector config
export interface DataSource {
  name?: string;  // Display name for this source (e.g., "Washington Post", "The Guardian")
  config: CollectorConfig;
}

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
  sources: DataSource[];      // Array of data sources to collect from
  outputFormat: OutputFormat;
  tags: string[];
  notifyOnChange: boolean;
  webhookUrl?: string;
  retries: number;
  timeoutMs: number;
  status: JobStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  jobPrompt?: string;
  jobParams?: Record<string, string>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateJobInput = Omit<Job,
  'id' | 'status' | 'lastRunAt' | 'nextRunAt' | 'sortOrder' | 'createdAt' | 'updatedAt'
>;

export type UpdateJobInput = Partial<CreateJobInput>;

// ─── Run ──────────────────────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'collecting' | 'analyzing' | 'complete' | 'error' | 'skipped';

export interface Run {
  id: string;
  jobId: string;
  status: RunStatus;
  contentHash?: string;
  rawData?: unknown;       // CollectorResult[]
  analysis?: string;       // markdown
  bedrockInvoked: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  changed: boolean;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
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

export type { PipelineStage, StageStatus, StageErrorType, RunStage } from '../agents/types.js';
