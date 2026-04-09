import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Job } from './types/index.js';

// ─── Database Singleton ────────────────────────────────────────────────────────

function openDatabase(): InstanceType<typeof Database> {
  if (process.env.NODE_ENV === 'test') {
    return new Database(':memory:');
  }
  const dataDir = process.env.DATA_DIR ?? './data';
  fs.mkdirSync(dataDir, { recursive: true });
  return new Database(path.join(dataDir, 'croniq.db'));
}

const db = openDatabase();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  email: string;
  webauthn_user_id: Buffer;
  recovery_code_hash: string | null;
  created_at: string;
}

export interface DbPasskey {
  id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  device_type: string;
  backed_up: number;  // 0 or 1
  transports: string | null;  // JSON string
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface DbChallenge {
  challenge: string;
  user_id: string;
  purpose: 'registration' | 'authentication';
  created_at: string;
}

export interface DbRun {
  id: string;
  jobId: string;
  status: 'pending' | 'collecting' | 'analyzing' | 'complete' | 'error' | 'skipped';
  contentHash: string | null;
  rawData: string | null;
  analysis: string | null;
  bedrockInvoked: boolean;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  changed: boolean;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface StatsRow {
  totalRuns: number;
  successRate: number;
  skippedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
  /** Hours of history covered by this stats snapshot. 0 = lifetime. */
  periodHours: number;
}

// ─── Init / Migrations ────────────────────────────────────────────────────────

export function initDb(): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Jobs table — preserve all existing Croniq columns
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schedule TEXT NOT NULL,
      collector_config TEXT NOT NULL DEFAULT '{}',
      output_format TEXT NOT NULL DEFAULT 'json',
      tags TEXT NOT NULL DEFAULT '[]',
      notify_on_change INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT,
      retries INTEGER NOT NULL DEFAULT 2,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      status TEXT NOT NULL DEFAULT 'active',
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      job_prompt TEXT,
      job_params TEXT DEFAULT '{}',
      sources TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Runs table (new schema — only created fresh in new DBs; existing DBs are migrated below)
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','collecting','analyzing','complete','error','skipped')),
      content_hash TEXT,
      raw_data TEXT,
      analysis TEXT,
      bedrock_invoked INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      changed INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )
  `);

  // Auth tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      webauthn_user_id BLOB NOT NULL,
      recovery_code_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL DEFAULT 'singleDevice',
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      label TEXT NOT NULL DEFAULT 'Passkey',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS challenges (
      challenge TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      event TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS device_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Jobs migrations (idempotency guards)
  const jobsCols = (db.pragma('table_info(jobs)') as Array<{ name: string }>).map(c => c.name);
  if (!jobsCols.includes('description')) {
    db.exec('ALTER TABLE jobs ADD COLUMN description TEXT');
  }

  // Runs migration (idempotency guard): upgrade existing runs tables that use old schema
  const runsCols = (db.pragma('table_info(runs)') as Array<{ name: string }>).map(c => c.name);
  if (!runsCols.includes('status')) {
    db.exec(`
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','collecting','analyzing','complete','error','skipped')),
        content_hash TEXT,
        raw_data TEXT,
        analysis TEXT,
        bedrock_invoked INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        changed INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      INSERT INTO runs_new SELECT
        id, job_id,
        CASE outcome WHEN 'success' THEN 'complete' WHEN 'failure' THEN 'error' WHEN 'timeout' THEN 'error' ELSE 'complete' END,
        result_hash, NULL, result, 0, 0, 0, error, changed, duration_ms, started_at, finished_at
      FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
    `);
  }

  db.exec('DROP TABLE IF EXISTS run_stages');
}

// Auto-initialize on module load so query functions work immediately on import.
initDb();

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    schedule: row.schedule as string,
    sources: row.sources ? JSON.parse(row.sources as string) : [],
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

function toRun(row: Record<string, unknown>): DbRun {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    status: row.status as DbRun['status'],
    contentHash: row.content_hash as string | null,
    rawData: row.raw_data as string | null,
    analysis: row.analysis as string | null,
    bedrockInvoked: row.bedrock_invoked === 1,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    error: row.error as string | null,
    changed: row.changed === 1,
    durationMs: row.duration_ms as number | null,
    startedAt: row.started_at as string,
    finishedAt: row.finished_at as string | null,
  };
}

// ─── Auth: Users ──────────────────────────────────────────────────────────────

export function createUser(id: string, email: string, webauthnUserId: Buffer): DbUser {
  db.prepare('INSERT INTO users (id, email, webauthn_user_id) VALUES (?, ?, ?)').run(id, email, webauthnUserId);
  return findUserById(id)!;
}

export function findUserByEmail(email: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as DbUser | undefined;
}

export function findUserById(id: string): DbUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined;
}

export function setRecoveryCodeHash(userId: string, hash: string): void {
  db.prepare('UPDATE users SET recovery_code_hash = ? WHERE id = ?').run(hash, userId);
}

export function hasUsers(): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  return row.n > 0;
}

// ─── Auth: Passkeys ───────────────────────────────────────────────────────────

export function getPasskeysByUser(userId: string): DbPasskey[] {
  return db.prepare('SELECT * FROM passkeys WHERE user_id = ?').all(userId) as DbPasskey[];
}

export function getPasskeyById(id: string): DbPasskey | undefined {
  return db.prepare('SELECT * FROM passkeys WHERE id = ?').get(id) as DbPasskey | undefined;
}

export function savePasskey(
  id: string,
  userId: string,
  publicKey: Buffer,
  counter: number,
  deviceType: string,
  backedUp: boolean,
  transports: string[] | undefined,
): void {
  db.prepare(`
    INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    publicKey,
    counter,
    deviceType,
    backedUp ? 1 : 0,
    transports ? JSON.stringify(transports) : null,
  );
}

export function updatePasskeyCounter(id: string, counter: number, lastUsedAt: string): void {
  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(counter, lastUsedAt, id);
}

export function renamePasskey(id: string, userId: string, label: string): void {
  db.prepare('UPDATE passkeys SET label = ? WHERE id = ? AND user_id = ?').run(label, id, userId);
}

export function deletePasskey(id: string, userId: string): boolean {
  const info = db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(id, userId);
  return info.changes > 0;
}

// ─── Auth: Challenges ─────────────────────────────────────────────────────────

export function storeChallenge(challenge: string, userId: string, purpose: 'registration' | 'authentication'): void {
  db.prepare('INSERT INTO challenges (challenge, user_id, purpose) VALUES (?, ?, ?)').run(challenge, userId, purpose);
}

export function consumeChallenge(challenge: string, purpose: 'registration' | 'authentication'): DbChallenge | undefined {
  const consume = db.transaction(() => {
    const row = db.prepare('SELECT * FROM challenges WHERE challenge = ? AND purpose = ?').get(challenge, purpose) as DbChallenge | undefined;
    if (!row) return undefined;
    db.prepare('DELETE FROM challenges WHERE challenge = ?').run(challenge);
    return row;
  });
  return consume() as DbChallenge | undefined;
}

// ─── Auth: Audit Log ──────────────────────────────────────────────────────────

export function logAuditEvent(userId: string | null, event: string, detail: string, ip: string): void {
  db.prepare('INSERT INTO audit_log (user_id, event, detail, ip) VALUES (?, ?, ?, ?)').run(userId, event, detail, ip);
}

// ─── Auth: Device Codes ───────────────────────────────────────────────────────

export interface DbDeviceCode {
  code: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used: number;
}

export function createDeviceCode(userId: string, code: string, expiresAt: string): void {
  // Clean up expired codes first
  db.prepare("DELETE FROM device_codes WHERE expires_at < datetime('now')").run();
  db.prepare('INSERT INTO device_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, userId, expiresAt);
}

export function consumeDeviceCode(code: string): string | null {
  const consume = db.transaction(() => {
    const row = db.prepare("SELECT * FROM device_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')").get(code) as DbDeviceCode | undefined;
    if (!row) return null;
    db.prepare('UPDATE device_codes SET used = 1 WHERE code = ?').run(code);
    return row.user_id;
  });
  return consume() as string | null;
}

export function getActiveDeviceCode(userId: string): DbDeviceCode | null {
  return db.prepare("SELECT * FROM device_codes WHERE user_id = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1").get(userId) as DbDeviceCode | null;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export function listJobs(): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY sort_order ASC, created_at DESC').all() as Record<string, unknown>[];
  return rows.map(toJob);
}

export function getJob(id: string): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toJob(row) : undefined;
}

export function createJob(input: Omit<Job, 'id' | 'status' | 'lastRunAt' | 'nextRunAt' | 'sortOrder' | 'createdAt' | 'updatedAt'>): Job {
  const now = new Date().toISOString();
  const id = uuidv4();
  const { max_order } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM jobs').get() as { max_order: number };
  const firstSourceConfig = input.sources[0]?.config ?? { type: 'html', url: '' };
  db.prepare(`
    INSERT INTO jobs (id, name, description, schedule, collector_config, sources, output_format,
      tags, notify_on_change, webhook_url, retries, timeout_ms, job_prompt, job_params,
      sort_order, status, created_at, updated_at)
    VALUES (@id, @name, @description, @schedule, @collector_config, @sources, @output_format,
      @tags, @notify_on_change, @webhook_url, @retries, @timeout_ms, @job_prompt, @job_params,
      @sort_order, 'active', @created_at, @updated_at)
  `).run({
    id,
    name: input.name,
    description: input.description ?? null,
    schedule: input.schedule,
    collector_config: JSON.stringify(firstSourceConfig),
    sources: JSON.stringify(input.sources),
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

export function updateJobById(id: string, updates: Partial<Job>): Job | undefined {
  const existing = getJob(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...updates };
  const firstSourceConfig = merged.sources[0]?.config ?? { type: 'html', url: '' };
  db.prepare(`
    UPDATE jobs SET
      name = @name, description = @description, schedule = @schedule,
      collector_config = @collector_config, sources = @sources, output_format = @output_format,
      tags = @tags, notify_on_change = @notify_on_change, webhook_url = @webhook_url,
      retries = @retries, timeout_ms = @timeout_ms,
      job_prompt = @job_prompt, job_params = @job_params,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id,
    name: merged.name,
    description: merged.description ?? null,
    schedule: merged.schedule,
    collector_config: JSON.stringify(firstSourceConfig),
    sources: JSON.stringify(merged.sources),
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

export function deleteJob(id: string): void {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

export function setJobStatus(id: string, status: Job['status']): void {
  db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
}

export function setJobLastRun(id: string, lastRunAt: string): void {
  db.prepare('UPDATE jobs SET last_run_at = ?, updated_at = ? WHERE id = ?').run(lastRunAt, new Date().toISOString(), id);
}

export function reorderJobs(orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?');
  const reorder = db.transaction((ids: string[]) => {
    ids.forEach((jobId, index) => stmt.run(index, jobId));
  });
  reorder(orderedIds);
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export function createRun(jobId: string): DbRun {
  const id = uuidv4();
  const startedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO runs (id, job_id, status, started_at)
    VALUES (?, ?, 'pending', ?)
  `).run(id, jobId, startedAt);
  return getRunById(id)!;
}

export function setRunStatus(runId: string, status: DbRun['status']): void {
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
}

export function completeRun(
  runId: string,
  status: DbRun['status'],
  contentHash: string | null,
  rawData: string | null,
  analysis: string | null,
  bedrockInvoked: boolean,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  error: string | null,
): void {
  db.prepare(`
    UPDATE runs SET
      status = ?, content_hash = ?, raw_data = ?, analysis = ?,
      bedrock_invoked = ?, input_tokens = ?, output_tokens = ?,
      duration_ms = ?, error = ?, finished_at = ?
    WHERE id = ?
  `).run(
    status,
    contentHash,
    rawData,
    analysis,
    bedrockInvoked ? 1 : 0,
    inputTokens,
    outputTokens,
    durationMs,
    error,
    new Date().toISOString(),
    runId,
  );
}

export function getLatestCompletedRun(jobId: string): DbRun | undefined {
  const row = db.prepare(`
    SELECT * FROM runs
    WHERE job_id = ? AND status IN ('complete', 'skipped')
    ORDER BY started_at DESC LIMIT 1
  `).get(jobId) as Record<string, unknown> | undefined;
  return row ? toRun(row) : undefined;
}

export function listRuns(jobId: string, limit = 50): DbRun[] {
  const rows = db.prepare(`
    SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?
  `).all(jobId, limit) as Record<string, unknown>[];
  return rows.map(toRun);
}

export function getRunById(id: string): DbRun | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toRun(row) : undefined;
}

export function listRecentRuns(limit = 10): DbRun[] {
  const rows = db.prepare(`
    SELECT * FROM runs ORDER BY started_at DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];
  return rows.map(toRun);
}

/**
 * Aggregate stats over the runs table.
 *
 * @param periodHours  Restrict to runs within the last N hours. Pass 0 for
 *                     lifetime totals. Defaults to 24 so the /api/stats
 *                     endpoint's long-standing "period=24h" contract works.
 *
 * Historical bug: Previously this function returned lifetime totals but the
 * /api/stats endpoint accepted (and ignored) a `period` query parameter,
 * causing the Croniq Stats job to report lifetime cost as "Daily Cost". The
 * periodHours parameter makes the window explicit and bounded.
 */
export function getStats(periodHours: number = 24): StatsRow {
  // SQLite datetime('now', '-N hours') gives UTC; started_at is stored as UTC ISO.
  // When periodHours <= 0, we fall back to lifetime totals for backwards compatibility.
  const whereClause = periodHours > 0
    ? `WHERE started_at >= datetime('now', ?)`
    : '';
  const params = periodHours > 0 ? [`-${periodHours} hours`] : [];

  const row = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      ROUND(100.0 * SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) as success_rate,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_runs,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      ROUND(AVG(duration_ms)) as avg_duration_ms
    FROM runs
    ${whereClause}
  `).get(...params) as Record<string, number>;

  return {
    totalRuns: row.total_runs ?? 0,
    successRate: row.success_rate ?? 0,
    skippedRuns: row.skipped_runs ?? 0,
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    avgDurationMs: row.avg_duration_ms ?? 0,
    periodHours: periodHours > 0 ? periodHours : 0,
  };
}

// ─── Test Utilities ───────────────────────────────────────────────────────────

export function resetForTesting(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('resetForTesting only available in test mode');
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM challenges;
    DELETE FROM passkeys;
    DELETE FROM users;
    DELETE FROM runs;
    DELETE FROM jobs;
  `);
}

/**
 * Test-only helper: override a run's started_at timestamp so we can test
 * time-window filtering in getStats without racing real clocks.
 *
 * Pass an ISO 8601 string (e.g. `new Date(Date.now() - 48 * 3600 * 1000).toISOString()`).
 */
export function setRunStartedAtForTesting(runId: string, startedAt: string): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setRunStartedAtForTesting only available in test mode');
  db.prepare('UPDATE runs SET started_at = ? WHERE id = ?').run(startedAt, runId);
}
