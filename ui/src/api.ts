// ─── CSRF ──────────────────────────────────────────────────────────────────────
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/csrf-token', { credentials: 'include' });
  const data = await res.json() as { token: string };
  csrfToken = data.token;
  return csrfToken!;
}

// ─── Core fetch ────────────────────────────────────────────────────────────────
export async function apiFetch<T = unknown>(path: string, options: RequestInit & { skipRedirectOn401?: boolean } = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await getCsrfToken();
  }

  const res = await fetch(path, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    csrfToken = null;
    if (!options.skipRedirectOn401) {
      window.location.href = '/auth';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Auth types ────────────────────────────────────────────────────────────────
export interface AuthPasskey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  passkeys: AuthPasskey[];
}

// ─── Auth API ──────────────────────────────────────────────────────────────────
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    return await apiFetch<AuthUser>('/api/me', { skipRedirectOn401: true } as RequestInit & { skipRedirectOn401: boolean });
  } catch {
    return null;
  }
}

export async function authLogout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  csrfToken = null;
}

export async function getAuthStatus(): Promise<{ hasUsers: boolean }> {
  return fetch('/api/auth/status').then(r => r.json() as Promise<{ hasUsers: boolean }>);
}

export async function fetchPasskeys(): Promise<AuthPasskey[]> {
  const data = await apiFetch<{ passkeys: AuthPasskey[] }>('/api/passkeys');
  return data.passkeys;
}

export async function renamePasskeyApi(id: string, label: string): Promise<void> {
  await apiFetch(`/api/passkeys/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) });
}

export async function deletePasskeyApi(id: string): Promise<void> {
  await apiFetch(`/api/passkeys/${id}`, { method: 'DELETE' });
}

export async function regenerateRecoveryCode(): Promise<{ recoveryCode: string }> {
  return apiFetch('/api/passkeys/recovery-code/regenerate', { method: 'POST' });
}

export async function generateDeviceCode(): Promise<{ code: string; expiresAt: string }> {
  return apiFetch('/api/passkeys/device-code/generate', { method: 'POST' });
}

export async function getActiveDeviceCode(): Promise<{ code: string | null; expiresAt: string | null }> {
  return apiFetch('/api/passkeys/device-code/active');
}

// ─── Job / Run types ───────────────────────────────────────────────────────────
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

// ─── Updated Run type ─────────────────────────────────────────────────────────
export interface Run {
  id: string;
  jobId: string;
  status: 'pending' | 'collecting' | 'analyzing' | 'complete' | 'error' | 'skipped';
  contentHash?: string;
  rawData?: unknown;
  analysis?: string;
  bedrockInvoked: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  changed: boolean;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
}

// ─── API object (updated) ─────────────────────────────────────────────────────
export const api = {
  // Jobs
  getJobs: () => apiFetch<{ data: Job[] }>('/api/jobs'),
  getJob: (id: string) => apiFetch<{ data: Job }>(`/api/jobs/${id}`),
  createJob: (body: unknown) => apiFetch<{ data: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  updateJob: (id: string, body: unknown) => apiFetch<{ data: Job }>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteJob: (id: string) => apiFetch(`/api/jobs/${id}`, { method: 'DELETE' }),
  pauseJob: (id: string) => apiFetch<{ data: Job }>(`/api/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id: string) => apiFetch<{ data: Job }>(`/api/jobs/${id}/resume`, { method: 'POST' }),
  runJob: (id: string) => apiFetch(`/api/jobs/${id}/run`, { method: 'POST' }),
  reorderJobs: (orderedIds: string[]) => apiFetch('/api/jobs/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) }),

  // Runs (no more getRunStages)
  getRuns: (jobId: string) => apiFetch<{ data: Run[] }>(`/api/jobs/${jobId}/runs`),
  getLatestRun: (jobId: string) => apiFetch<{ data: Run }>(`/api/jobs/${jobId}/runs/latest`),
};
