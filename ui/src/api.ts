const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? json.error ?? 'Request failed');
  return json;
}

export const api = {
  // Jobs
  getJobs: () => request<{ data: Job[] }>('/jobs'),
  getJob: (id: string) => request<{ data: Job }>(`/jobs/${id}`),
  createJob: (body: unknown) => request<{ data: Job }>('/jobs', {
    method: 'POST', body: JSON.stringify(body),
  }),
  updateJob: (id: string, body: unknown) => request<{ data: Job }>(`/jobs/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  }),
  deleteJob: (id: string) => request(`/jobs/${id}`, { method: 'DELETE' }),
  pauseJob: (id: string) => request<{ data: Job }>(`/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id: string) => request<{ data: Job }>(`/jobs/${id}/resume`, { method: 'POST' }),
  runJob: (id: string) => request(`/jobs/${id}/run`, { method: 'POST' }),
  reorderJobs: (orderedIds: string[]) => request('/jobs/reorder', {
    method: 'PUT', body: JSON.stringify({ orderedIds }),
  }),

  // Runs
  getRuns: (jobId: string) => request<{ data: Run[]; stats: RunStats }>(`/jobs/${jobId}/runs`),
  getLatestRun: (jobId: string) => request<{ data: Run }>(`/jobs/${jobId}/runs/latest`),
  getRunStages: (jobId: string, runId: string) =>
    request<{ data: RunStage[] }>(`/jobs/${jobId}/runs/${runId}/stages`),
};

export interface DataSource {
  name?: string;
  config: { type: string; url?: string; [k: string]: unknown };
}

export interface Job {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  sources: DataSource[];
  outputFormat: string;
  tags: string[];
  notifyOnChange: boolean;
  webhookUrl?: string;
  retries: number;
  timeoutMs: number;
  jobPrompt?: string;
  jobParams?: Record<string, string>;
  sortOrder: number;
  status: 'active' | 'paused' | 'error';
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  isScheduled?: boolean;
}

export interface Run {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome: 'success' | 'failure' | 'timeout';
  result?: unknown;
  error?: string;
  changed: boolean;
  resultHash?: string;
}

export type PipelineStage = 'collector' | 'summarizer' | 'researcher' | 'editor';

export interface RunStage {
  id: string;
  runId: string;
  stage: PipelineStage;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  errorType?: string;
  diagnostics?: string;
  durationMs?: number;
  modelId?: string;
  tokenCount?: number;
  createdAt: string;
}

export interface RunStats {
  total: number;
  success: number;
  failure: number;
  avgDurationMs: number;
}
