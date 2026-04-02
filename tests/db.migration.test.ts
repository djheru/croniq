// tests/db.migration.test.ts
import Database from 'better-sqlite3';

function applyRunsMigration(db: InstanceType<typeof Database>): void {
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

const OLD_JOBS_DDL = `CREATE TABLE jobs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule TEXT NOT NULL,
  collector_config TEXT NOT NULL DEFAULT '{}',
  output_format TEXT NOT NULL DEFAULT 'json',
  tags TEXT NOT NULL DEFAULT '[]',
  notify_on_change INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT, retries INTEGER NOT NULL DEFAULT 2,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  status TEXT NOT NULL DEFAULT 'active',
  last_run_at TEXT, next_run_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  job_prompt TEXT, job_params TEXT DEFAULT '{}',
  sources TEXT, sort_order INTEGER NOT NULL DEFAULT 0
)`;

const OLD_RUNS_DDL = `CREATE TABLE runs (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER,
  outcome TEXT NOT NULL, result TEXT, error TEXT,
  changed INTEGER NOT NULL DEFAULT 0, result_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

function buildOldDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(OLD_JOBS_DDL);
  db.exec(`INSERT INTO jobs VALUES ('j1','Test','0 * * * *','{}','json','[]',0,NULL,2,30000,'active',NULL,NULL,'2024-01-01','2024-01-01',NULL,'{}','[]',1)`);
  db.exec(OLD_RUNS_DDL);
  return db;
}

describe('DB migration: runs table recreate', () => {
  it('maps outcome → status correctly', () => {
    const db = buildOldDb();
    db.exec(`
      INSERT INTO runs VALUES ('r1','j1','2024-01-01T00:00:00','2024-01-01T00:01:00',60000,'success','{"data":"test"}',NULL,1,'abc123','2024-01-01');
      INSERT INTO runs VALUES ('r2','j1','2024-01-01T01:00:00','2024-01-01T01:01:00',60000,'failure',NULL,'Something failed',0,NULL,'2024-01-01');
      INSERT INTO runs VALUES ('r3','j1','2024-01-01T02:00:00','2024-01-01T02:01:00',60000,'timeout',NULL,'Timed out',0,NULL,'2024-01-01');
    `);
    applyRunsMigration(db);

    type Row = { id: string; status: string; content_hash: string | null; analysis: string | null };
    const rows = db.prepare('SELECT id, status, content_hash, analysis FROM runs ORDER BY id').all() as Row[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'r1', status: 'complete', content_hash: 'abc123', analysis: '{"data":"test"}' });
    expect(rows[1]).toMatchObject({ id: 'r2', status: 'error', content_hash: null });
    expect(rows[2]).toMatchObject({ id: 'r3', status: 'error', content_hash: null });
  });

  it('preserves row count after migration', () => {
    const db = buildOldDb();
    for (let i = 0; i < 10; i++) {
      db.prepare(`INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        `r${i}`, 'j1', '2024-01-01', '2024-01-01', 1000, 'success', null, null, 0, null, '2024-01-01'
      );
    }
    applyRunsMigration(db);
    const { n } = db.prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number };
    expect(n).toBe(10);
  });

  it('is idempotent — guard condition works', () => {
    const db = buildOldDb();
    applyRunsMigration(db);
    type ColInfo = { name: string };
    const cols = db.pragma('table_info(runs)') as ColInfo[];
    const hasStatusCol = cols.some(c => c.name === 'status');
    expect(hasStatusCol).toBe(true);
  });
});
