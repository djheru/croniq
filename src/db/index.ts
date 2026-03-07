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

  console.log('[db] Migrations applied ✓');
}

// Run migrations immediately so tables exist before queries.ts prepares statements
migrate();

export { migrate };
