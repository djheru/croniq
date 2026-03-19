import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'croniq.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      schedule      TEXT NOT NULL,
      collector_config TEXT NOT NULL,   -- JSON
      output_format TEXT NOT NULL DEFAULT 'json',
      tags          TEXT NOT NULL DEFAULT '[]', -- JSON array
      notify_on_change INTEGER NOT NULL DEFAULT 0,
      webhook_url   TEXT,
      retries       INTEGER NOT NULL DEFAULT 2,
      timeout_ms    INTEGER NOT NULL DEFAULT 30000,
      status        TEXT NOT NULL DEFAULT 'active',
      last_run_at   TEXT,
      next_run_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      duration_ms   INTEGER,
      outcome       TEXT NOT NULL,       -- success | failure | timeout
      result        TEXT,                -- JSON
      error         TEXT,
      changed       INTEGER NOT NULL DEFAULT 0,
      result_hash   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_job_id ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);

  const cols = db.pragma('table_info(jobs)') as Array<{ name: string }>;
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('analysis_prompt')) {
    db.exec('ALTER TABLE jobs ADD COLUMN analysis_prompt TEXT');
  }
  if (!colNames.includes('analysis_schedule')) {
    db.exec("ALTER TABLE jobs ADD COLUMN analysis_schedule TEXT DEFAULT '0 * * * *'");
  }
  if (!colNames.includes('sort_order')) {
    db.exec('ALTER TABLE jobs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    // Initialize sort_order based on existing creation order
    db.exec(`
      UPDATE jobs SET sort_order = (
        SELECT COUNT(*) FROM jobs AS j2 WHERE j2.created_at <= jobs.created_at
      )
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      prompt        TEXT NOT NULL,
      response      TEXT NOT NULL,
      run_ids       TEXT NOT NULL,
      duration_ms   INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_job_id ON analyses(job_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
  `);

  // --- Agent pipeline migration ---
  // Create run_stages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_stages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      error_type TEXT,
      diagnostics TEXT,
      duration_ms INTEGER,
      model_id TEXT,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_run_stages_run_id ON run_stages(run_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_run_stages_run_stage ON run_stages(run_id, stage)');

  // Add job_prompt and job_params columns
  const jobCols = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  const jobColNames = jobCols.map(c => c.name);
  if (!jobColNames.includes('job_prompt')) {
    db.exec('ALTER TABLE jobs ADD COLUMN job_prompt TEXT');
  }
  if (!jobColNames.includes('job_params')) {
    db.exec("ALTER TABLE jobs ADD COLUMN job_params TEXT DEFAULT '{}'");
  }

  // Drop analyses table (data is being discarded)
  db.exec('DROP TABLE IF EXISTS analyses');

  // --- Multi-source migration ---
  // Add sources column and migrate collector_config to sources array
  if (!jobColNames.includes('sources')) {
    console.log('[db] Migrating collector_config to sources array...');
    db.exec('ALTER TABLE jobs ADD COLUMN sources TEXT');

    // Wrap each existing collector_config in a sources array
    const jobs = db.prepare('SELECT id, collector_config FROM jobs').all() as Array<{ id: string; collector_config: string }>;
    const updateStmt = db.prepare('UPDATE jobs SET sources = ? WHERE id = ?');

    for (const job of jobs) {
      try {
        const config = JSON.parse(job.collector_config);
        // Wrap single config in array with no name (can be named manually later)
        const sources = [{ config }];
        updateStmt.run(JSON.stringify(sources), job.id);
      } catch (err) {
        console.error(`[db] Failed to migrate job ${job.id}:`, err);
      }
    }

    console.log(`[db] Migrated ${jobs.length} jobs to multi-source format`);
  }

  // Note: analysis_prompt and analysis_schedule columns remain in schema but are ignored
  // SQLite on the Pi may be pre-3.35, so DROP COLUMN is not safe
  // collector_config column also remains but is no longer used (sources is authoritative)

  console.log('[db] Migrations applied ✓');
}

// Run migrations immediately so tables exist before queries.ts prepares statements
migrate();

export { migrate };
