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

  // Runs
  getRuns: (jobId: string) => request<{ data: Run[]; stats: RunStats }>(`/jobs/${jobId}/runs`),
  getLatestRun: (jobId: string) => request<{ data: Run }>(`/jobs/${jobId}/runs/latest`),
};

export interface Job {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  collectorConfig: { type: string; url: string; [k: string]: unknown };
  outputFormat: string;
  tags: string[];
  notifyOnChange: boolean;
  webhookUrl?: string;
  retries: number;
  timeoutMs: number;
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

export interface RunStats {
  total: number;
  success: number;
  failure: number;
  avgDurationMs: number;
}
