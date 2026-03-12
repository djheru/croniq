import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { db } from './index.js';
import type { Job, Run, CreateJobInput, UpdateJobInput, RunOutcome } from '../types/index.js';
import type { RunStage, PipelineStage, StageStatus, StageErrorType } from '../agents/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    schedule: row.schedule as string,
    collectorConfig: JSON.parse(row.collector_config as string),
    outputFormat: row.output_format as Job['outputFormat'],
    tags: JSON.parse(row.tags as string),
    notifyOnChange: Boolean(row.notify_on_change),
    webhookUrl: row.webhook_url as string | undefined,
    retries: row.retries as number,
    timeoutMs: row.timeout_ms as number,
    status: row.status as Job['status'],
    lastRunAt: row.last_run_at as string | undefined,
    nextRunAt: row.next_run_at as string | undefined,
    jobPrompt: row.job_prompt as string | undefined,
    jobParams: row.job_params ? JSON.parse(row.job_params as string) : undefined,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toRun(row: Record<string, unknown>): Run {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    startedAt: row.started_at as string,
    finishedAt: row.finished_at as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    outcome: row.outcome as RunOutcome,
    result: row.result ? JSON.parse(row.result as string) : undefined,
    error: row.error as string | undefined,
    changed: Boolean(row.changed),
    resultHash: row.result_hash as string | undefined,
  };
}

export function hashResult(result: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(result))
    .digest('hex')
    .slice(0, 16);
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

const insertJob = db.prepare(`
  INSERT INTO jobs (id, name, description, schedule, collector_config, output_format,
    tags, notify_on_change, webhook_url, retries, timeout_ms, job_prompt, job_params,
    sort_order, status, created_at, updated_at)
  VALUES (@id, @name, @description, @schedule, @collector_config, @output_format,
    @tags, @notify_on_change, @webhook_url, @retries, @timeout_ms, @job_prompt, @job_params,
    @sort_order, 'active', @created_at, @updated_at)
`);

const getMaxSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM jobs');

const updateJob = db.prepare(`
  UPDATE jobs SET
    name = @name, description = @description, schedule = @schedule,
    collector_config = @collector_config, output_format = @output_format,
    tags = @tags, notify_on_change = @notify_on_change, webhook_url = @webhook_url,
    retries = @retries, timeout_ms = @timeout_ms,
    job_prompt = @job_prompt, job_params = @job_params,
    updated_at = @updated_at
  WHERE id = @id
`);

export function createJob(input: CreateJobInput): Job {
  const now = new Date().toISOString();
  const id = uuidv4();
  const { max_order } = getMaxSortOrder.get() as { max_order: number };
  insertJob.run({
    id,
    name: input.name,
    description: input.description ?? null,
    schedule: input.schedule,
    collector_config: JSON.stringify(input.collectorConfig),
    output_format: input.outputFormat,
    tags: JSON.stringify(input.tags),
    notify_on_change: input.notifyOnChange ? 1 : 0,
    webhook_url: input.webhookUrl ?? null,
    retries: input.retries,
    timeout_ms: input.timeoutMs,
    job_prompt: input.jobPrompt ?? null,
    job_params: input.jobParams ? JSON.stringify(input.jobParams) : '{}',
    sort_order: max_order + 1,
    created_at: now,
    updated_at: now,
  });
  return getJob(id)!;
}

export function updateJobById(id: string, input: UpdateJobInput): Job | null {
  const existing = getJob(id);
  if (!existing) return null;
  const merged = { ...existing, ...input };
  updateJob.run({
    id,
    name: merged.name,
    description: merged.description ?? null,
    schedule: merged.schedule,
    collector_config: JSON.stringify(merged.collectorConfig),
    output_format: merged.outputFormat,
    tags: JSON.stringify(merged.tags),
    notify_on_change: merged.notifyOnChange ? 1 : 0,
    webhook_url: merged.webhookUrl ?? null,
    retries: merged.retries,
    timeout_ms: merged.timeoutMs,
    job_prompt: merged.jobPrompt ?? null,
    job_params: merged.jobParams ? JSON.stringify(merged.jobParams) : '{}',
    updated_at: new Date().toISOString(),
  });
  return getJob(id);
}

export function setJobStatus(id: string, status: Job['status']): void {
  db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
}

export function setJobLastRun(id: string, lastRunAt: string, nextRunAt?: string): void {
  db.prepare('UPDATE jobs SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
    .run(lastRunAt, nextRunAt ?? null, new Date().toISOString(), id);
}

export function deleteJob(id: string): void {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

export function getJob(id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toJob(row) : null;
}

export function listJobs(): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY sort_order ASC, created_at DESC').all() as Record<string, unknown>[];
  return rows.map(toJob);
}

export function reorderJobs(orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?');
  const reorder = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => stmt.run(index, id));
  });
  reorder(orderedIds);
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export function createRun(jobId: string): { id: string; startedAt: string } {
  const id = uuidv4();
  const startedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO runs (id, job_id, started_at, outcome, changed)
    VALUES (?, ?, ?, 'success', 0)
  `).run(id, jobId, startedAt);
  return { id, startedAt };
}

export function finishRun(params: {
  id: string;
  outcome: RunOutcome;
  result?: unknown;
  error?: string;
  durationMs: number;
  changed: boolean;
  resultHash?: string;
}): void {
  db.prepare(`
    UPDATE runs SET
      finished_at = ?, outcome = ?, result = ?, error = ?,
      duration_ms = ?, changed = ?, result_hash = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    params.outcome,
    params.result !== undefined ? JSON.stringify(params.result) : null,
    params.error ?? null,
    params.durationMs,
    params.changed ? 1 : 0,
    params.resultHash ?? null,
    params.id,
  );
}

export function getLastRun(jobId: string): Run | null {
  const row = db.prepare(`
    SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1
  `).get(jobId) as Record<string, unknown> | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(jobId: string, limit = 50): Run[] {
  const rows = db.prepare(`
    SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?
  `).all(jobId, limit) as Record<string, unknown>[];
  return rows.map(toRun);
}

export function getRunStats(jobId: string): {
  total: number; success: number; failure: number; avgDurationMs: number;
} {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) as failure,
      AVG(duration_ms) as avg_duration_ms
    FROM runs WHERE job_id = ?
  `).get(jobId) as Record<string, number>;
  return {
    total: row.total ?? 0,
    success: row.success ?? 0,
    failure: row.failure ?? 0,
    avgDurationMs: Math.round(row.avg_duration_ms ?? 0),
  };
}

// ─── Run Stages ───────────────────────────────────────────────────────────────

function toRunStage(row: Record<string, unknown>): RunStage {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    stage: row.stage as PipelineStage,
    status: row.status as StageStatus,
    output: row.output ? JSON.parse(row.output as string) : undefined,
    error: row.error as string | undefined,
    errorType: row.error_type as StageErrorType | undefined,
    diagnostics: row.diagnostics as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    modelId: row.model_id as string | undefined,
    tokenCount: row.token_count as number | undefined,
    createdAt: row.created_at as string,
  };
}

export function createRunStage(params: {
  runId: string;
  stage: PipelineStage;
  status: StageStatus;
  output?: unknown;
  error?: string;
  errorType?: StageErrorType;
  diagnostics?: string;
  durationMs?: number;
  modelId?: string;
  tokenCount?: number;
}): RunStage {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO run_stages (id, run_id, stage, status, output, error, error_type, diagnostics, duration_ms, model_id, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.runId,
    params.stage,
    params.status,
    params.output !== undefined ? JSON.stringify(params.output) : null,
    params.error ?? null,
    params.errorType ?? null,
    params.diagnostics ?? null,
    params.durationMs ?? null,
    params.modelId ?? null,
    params.tokenCount ?? null,
    new Date().toISOString(),
  );
  return toRunStage(db.prepare('SELECT * FROM run_stages WHERE id = ?').get(id) as Record<string, unknown>);
}

export function listRunStages(runId: string): RunStage[] {
  const rows = db.prepare(
    'SELECT * FROM run_stages WHERE run_id = ? ORDER BY created_at ASC'
  ).all(runId) as Record<string, unknown>[];
  return rows.map(toRunStage);
}
