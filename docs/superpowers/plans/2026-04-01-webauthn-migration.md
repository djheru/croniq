# Croniq WebAuthn Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Croniq's LangChain agent pipeline with direct TypeScript collectors + AWS Bedrock ConverseCommand, and add WebAuthn passkey authentication.

**Architecture:** Backend restructured to `src/db.ts` (merged DB layer), `src/collectors/` (5 modules + orchestrator), `src/bedrock/client.ts`, `src/scheduler/`, `src/runner.ts`, and `src/auth/routes.ts`. Frontend gains `AuthContext`, landing page, auth page, `Nav`, and `PasskeyManager`. Existing Croniq dark terminal design system is preserved throughout.

**Tech Stack:** Node.js 22 / TypeScript 5 / Express 4 / better-sqlite3 / @simplewebauthn/server v13 / bcrypt / csrf-csrf / express-session / express-rate-limit / @aws-sdk/client-bedrock-runtime / cheerio / Playwright / rss-parser / React 18 / @simplewebauthn/browser v13 / Jest + ts-jest + supertest / nock

**Reference:** `/Users/pdamra/Workspace/croniq2/webauthn-demo/` is a working prototype. Port from it, adapting per the "Critical divergences" noted in each task.

---

## Critical Divergences from the Demo

Read these before writing any code. The demo deviates from the spec in key ways:

| Topic | Demo | Croniq spec |
|-------|------|-------------|
| Recovery code hash | `createHash("sha256")` | `bcrypt.hash()` (cost 10) |
| Jobs `user_id` | Present | **Absent** — single-user, no ownership |
| Jobs `enabled` flag | `enabled INTEGER` | **`status TEXT`** (`active\|paused\|error`) |
| Jobs cron field | `cron_expression` | **`schedule`** |
| Jobs prompt field | `prompt` | **`job_prompt`** |
| Runs timestamp | `created_at` only | **`started_at` + `finished_at`** |
| Step-up auth | Present | **Absent** — not in spec |
| Auth challenge purposes | includes `'step-up'` | `'registration'\|'authentication'` only |
| Frontend routes | `/dashboard`, `/jobs`, `/feed` | **`/`, `/auth`, `/app/*`** |
| App name | "Pulse" | "Croniq" |

---

## File Map

### Created
```
src/db.ts                          Merged DB + queries + migrations (replaces src/db/)
src/auth/routes.ts                 WebAuthn register/login/recover/passkeys/me
src/collectors/types.ts            SourceConfig discriminated union + CollectorResult
src/collectors/index.ts            Orchestrator — Promise.allSettled over sources
src/collectors/utils.ts            Shared helpers (extractByPath dot-notation)
src/collectors/api.ts              REST/JSON fetch collector
src/collectors/rss.ts              RSS/Atom feed collector
src/collectors/html.ts             Cheerio CSS selector collector
src/collectors/browser.ts          Playwright browser collector
src/collectors/graphql.ts          GraphQL POST collector
src/bedrock/client.ts              Direct ConverseCommand (no LangChain)
src/scheduler/index.ts             Cron task map + reload-before-execute
src/runner.ts                      Pipeline: collect → hash → analyze
tests/db.migration.test.ts         Migration SQL correctness (standalone, no db.ts import)
tests/db.smoke.test.ts             Query function smoke tests (requires db.ts)
tests/collectors/api.test.ts       API collector unit tests
tests/collectors/rss.test.ts       RSS collector unit tests
tests/collectors/html.test.ts      HTML collector unit tests
tests/collectors/graphql.test.ts   GraphQL collector unit tests
tests/collectors/index.test.ts     Orchestrator unit tests
tests/bedrock.test.ts              Bedrock client unit tests
tests/runner.test.ts               Pipeline unit tests
tests/auth.test.ts                 Auth routes integration tests
tests/setup.ts                     Jest global setup (test DB)
tsconfig.test.json                 Jest override: module commonjs
jest.config.ts                     Jest configuration
ui/src/pages/Landing.tsx           Public landing page
ui/src/pages/Auth.tsx              Register / Sign in / Recover tabs
ui/src/components/Nav.tsx          Top nav bar + user dropdown
ui/src/components/PasskeyManager.tsx  Passkey list/add/rename/delete modal
```

### Modified
```
package.json                       Add auth/session deps, remove LangChain, add Jest
ui/package.json                    Add @simplewebauthn/browser
src/types/index.ts                 Update Run interface, add auth types, collector types
src/server.ts                      Add session/CSRF/rate-limit middleware, mount auth routes
src/api/routes.ts                  Remove stage queries, protect all routes, update Run shape
ui/src/api.ts                      CSRF-aware apiFetch(), updated Run type, auth API
ui/src/App.tsx                     AuthContext, route guard, mount Landing/Auth/app pages
ui/src/components/JobDetail.tsx    Remove StagePanel, show analysis + rawData
```

### Deleted
```
src/agents/           (entire directory — LangChain agent code)
src/jobs/scheduler.ts
src/jobs/runner.ts
src/db/index.ts
src/db/queries.ts
```

---

## Chunk 1: Dependencies, Test Setup, and DB Layer

### Task 1: Update dependencies

**Files:**
- Modify: `package.json`
- Modify: `ui/package.json`
- Create: `tsconfig.test.json`
- Create: `jest.config.ts`

- [ ] **Step 1.1: Update backend package.json**

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:ui\"",
    "dev:server": "tsx watch src/server.ts",
    "dev:ui": "cd ui && npm run dev",
    "build": "tsc && cd ui && npm run build",
    "start": "node dist/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "db:export": "tsx scripts/export.ts",
    "db:import": "tsx scripts/import.ts",
    "db:seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3",
    "@simplewebauthn/server": "^13",
    "bcrypt": "^5",
    "better-sqlite3": "^9.4.3",
    "cheerio": "^1.0.0",
    "cookie-parser": "^1",
    "cors": "^2.8.5",
    "csrf-csrf": "^3",
    "express": "^4.18.3",
    "express-rate-limit": "^7",
    "express-session": "^1",
    "node-cron": "^3.0.3",
    "playwright": "^1.42.1",
    "rss-parser": "^3.13.0",
    "uuid": "^9.0.1",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/bcrypt": "^5",
    "@types/better-sqlite3": "^7.6.8",
    "@types/cookie-parser": "^1",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/express-session": "^1",
    "@types/node": "^20",
    "@types/node-cron": "^3.0.11",
    "@types/supertest": "^6",
    "@types/uuid": "^9.0.8",
    "concurrently": "^8.2.2",
    "aws-sdk-client-mock": "^4",
    "aws-sdk-client-mock-jest": "^4",
    "jest": "^29",
    "nock": "^13",
    "supertest": "^6",
    "ts-jest": "^29",
    "tsx": "^4.7.1",
    "typescript": "^5.4.2"
  }
}
```

Note: Remove all `@langchain/*` and `langchain` entries.

- [ ] **Step 1.2: Add @simplewebauthn/browser to ui/package.json**

Add to `ui/package.json` dependencies:
```json
"@simplewebauthn/browser": "^13"
```

- [ ] **Step 1.3: Create tsconfig.test.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": ".",
    "outDir": "./dist-test"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 1.4: Create jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.test.json',
    },
  },
  testTimeout: 30000,
  setupFilesAfterEnv: ['./tests/setup.ts'],
  collectCoverage: false,  // run with --coverage flag when needed
};

export default config;
```

- [ ] **Step 1.5: Create tests/setup.ts**

```typescript
// Global setup for test suite
// Ensures test DB is in-memory and does not touch production data
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-tests-only';
```

- [ ] **Step 1.6: Install dependencies**

```bash
cd /Users/pdamra/Workspace/kali/croniq
npm install
cd ui && npm install && cd ..
```

---

### Task 2: New unified db.ts

**Purpose:** Single file replaces `src/db/index.ts` + `src/db/queries.ts`. Contains schema creation, all migrations, and all prepared statement query functions.

**Files:**
- Create: `src/db.ts`
- Test: `tests/db.migration.test.ts` — migration SQL correctness (standalone, no db.ts import)
- Test: `tests/db.smoke.test.ts` — query function smoke tests (requires db.ts)

The two test files are intentionally separate: migration tests use standalone in-memory DBs and can be written/run before `src/db.ts` exists; smoke tests import from `src/db.ts` and run after it is created.

- [ ] **Step 2.1: Write migration SQL test (no db.ts import)**

```typescript
// tests/db.migration.test.ts
// Tests the migration SQL in isolation — no import of src/db.ts.
// Uses its own in-memory DB instances with the OLD schema pre-populated.
import Database from 'better-sqlite3';

// Helper: apply the runs migration SQL to a db instance
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

  it('is idempotent — does not fail if already migrated', () => {
    // After migration, the old `outcome` column is gone; running again on an already-migrated DB
    // must not fail. The guard in db.ts (PRAGMA table_info check) prevents re-running. Test the guard SQL:
    const db = buildOldDb();
    applyRunsMigration(db);

    // Check that the guard condition would evaluate to "already migrated"
    type ColInfo = { name: string };
    const cols = db.pragma('table_info(runs)') as ColInfo[];
    const hasStatusCol = cols.some(c => c.name === 'status');
    expect(hasStatusCol).toBe(true); // guard: if status col exists, skip migration
  });
});

describe('DB migration: runs table recreate', () => {
  it('maps outcome success → status complete', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create old schema
    db.exec(`
      CREATE TABLE jobs (
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
      );
      INSERT INTO jobs VALUES ('j1','Test','0 * * * *','{}','json','[]',0,NULL,2,30000,'active',NULL,NULL,'2024-01-01','2024-01-01',NULL,'{}','[]',1);

      CREATE TABLE runs (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER,
        outcome TEXT NOT NULL, result TEXT, error TEXT,
        changed INTEGER NOT NULL DEFAULT 0, result_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO runs VALUES ('r1','j1','2024-01-01T00:00:00','2024-01-01T00:01:00',60000,'success','{"data":"test"}',NULL,1,'abc123','2024-01-01T00:00:00');
      INSERT INTO runs VALUES ('r2','j1','2024-01-01T01:00:00','2024-01-01T01:01:00',60000,'failure',NULL,'Something failed',0,NULL,'2024-01-01T01:00:00');
      INSERT INTO runs VALUES ('r3','j1','2024-01-01T02:00:00','2024-01-01T02:01:00',60000,'timeout',NULL,'Timed out',0,NULL,'2024-01-01T02:00:00');
    `);

    // Apply the migration (inline here to test the logic)
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

    const rows = db.prepare('SELECT id, status, content_hash, analysis FROM runs ORDER BY id').all() as any[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'r1', status: 'complete', content_hash: 'abc123', analysis: '{"data":"test"}' });
    expect(rows[1]).toMatchObject({ id: 'r2', status: 'error', content_hash: null });
    expect(rows[2]).toMatchObject({ id: 'r3', status: 'error', content_hash: null });
  });

  it('preserves row count after migration', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, schedule TEXT NOT NULL, collector_config TEXT NOT NULL DEFAULT '{}', output_format TEXT NOT NULL DEFAULT 'json', tags TEXT NOT NULL DEFAULT '[]', notify_on_change INTEGER NOT NULL DEFAULT 0, webhook_url TEXT, retries INTEGER NOT NULL DEFAULT 2, timeout_ms INTEGER NOT NULL DEFAULT 30000, status TEXT NOT NULL DEFAULT 'active', last_run_at TEXT, next_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, job_prompt TEXT, job_params TEXT DEFAULT '{}', sources TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
      INSERT INTO jobs VALUES ('j1','Test','0 * * * *','{}','json','[]',0,NULL,2,30000,'active',NULL,NULL,'2024-01-01','2024-01-01',NULL,'{}','[]',1);
      CREATE TABLE runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, outcome TEXT NOT NULL, result TEXT, error TEXT, changed INTEGER NOT NULL DEFAULT 0, result_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    for (let i = 0; i < 10; i++) {
      db.prepare(`INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        `r${i}`, 'j1', '2024-01-01', '2024-01-01', 1000, 'success', null, null, 0, null, '2024-01-01'
      );
    }
    db.exec(`
      CREATE TABLE runs_new (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', content_hash TEXT, raw_data TEXT, analysis TEXT, bedrock_invoked INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, error TEXT, changed INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
      INSERT INTO runs_new SELECT id, job_id, CASE outcome WHEN 'success' THEN 'complete' ELSE 'error' END, result_hash, NULL, result, 0, 0, 0, error, changed, duration_ms, started_at, finished_at FROM runs;
      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
    `);
    const count = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as any).n;
    expect(count).toBe(10);
  });
});
```

- [ ] **Step 2.2: Run the migration test (no db.ts needed yet)**

```bash
cd /Users/pdamra/Workspace/kali/croniq
npx jest tests/db.migration.test.ts --no-coverage
```
Expected: all 3 tests pass. These test migration SQL only — no db.ts import.

- [ ] **Step 2.3: Create src/db.ts**

Port from `webauthn-demo/server/src/db.ts`, with these adaptations:

**Schema adaptations:**
- Jobs table: use `CREATE TABLE IF NOT EXISTS` — existing data is preserved. Keep ALL existing Croniq columns: `schedule`, `status`, `webhook_url`, `job_prompt`, `job_params`, `sources`, `sort_order`, `retries`, `timeout_ms`, `tags`, `output_format`, `notify_on_change`, `collector_config`, `analysis_prompt`, `analysis_schedule`.
- Auth tables: Add users, passkeys, challenges, audit_log with `CREATE TABLE IF NOT EXISTS`.
- Challenges table: `purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication'))` — NO 'step-up'.
- **Runs migration guard** — must be idempotent. Use `PRAGMA table_info(runs)` to check if `status` column exists before running the recreate:
  ```typescript
  const runsCols = (db.pragma('table_info(runs)') as Array<{name: string}>).map(c => c.name);
  if (!runsCols.includes('status')) {
    db.exec(`/* runs_new CREATE + INSERT + DROP + RENAME SQL from Step 2.1 */`);
  }
  ```
- Drop run_stages after migration: `db.exec('DROP TABLE IF EXISTS run_stages')`.

**Query adaptations:**
- **Jobs queries:** Port all functions from `src/db/queries.ts` into `src/db.ts`. Do NOT re-export from the old file (it is being deleted). Copy the prepared statement logic directly.
- Runs queries: use new schema field names (`status`, `content_hash`, `raw_data`, `analysis`, `bedrock_invoked`, `input_tokens`, `output_tokens`, `started_at`, `finished_at`).
- Auth queries: port directly from demo (same schema).
- **Recovery code hash: use bcrypt (NOT sha256 like the demo).** The bcrypt calls are in `src/auth/routes.ts`, not in `db.ts` — `db.ts` just stores and retrieves the hash string via `setRecoveryCodeHash`.

**`deletePasskey` note:** The "only passkey" guard is a **route-layer concern**, not a DB concern. `db.ts`'s `deletePasskey(id, userId)` simply runs `DELETE WHERE id=? AND user_id=?` and returns `true` if a row was deleted. The route checks `getPasskeysByUser(userId).length > 1` before calling `deletePasskey`, returning 400 if only one remains.

Key query functions:
```typescript
// Auth
export function createUser(id: string, email: string, webauthnUserId: Buffer): DbUser
export function findUserByEmail(email: string): DbUser | undefined
export function findUserById(id: string): DbUser | undefined
export function getPasskeysByUser(userId: string): DbPasskey[]
export function getPasskeyById(id: string): DbPasskey | undefined
export function savePasskey(id: string, userId: string, publicKey: Buffer, counter: number, deviceType: string, backedUp: boolean, transports: string[] | undefined): void
export function updatePasskeyCounter(id: string, counter: number, lastUsedAt: string): void
export function renamePasskey(id: string, userId: string, label: string): void
export function deletePasskey(id: string, userId: string): boolean  // true if deleted, false if not found/wrong user
export function storeChallenge(challenge: string, userId: string, purpose: 'registration' | 'authentication'): void
export function consumeChallenge(challenge: string, purpose: 'registration' | 'authentication'): DbChallenge | undefined
export function setRecoveryCodeHash(userId: string, hash: string): void
export function logAuditEvent(userId: string | null, event: string, detail: string, ip: string): void
export function hasUsers(): boolean  // for GET /api/auth/status

// Jobs (port all functions from src/db/queries.ts — that file is deleted)
export function listJobs(): Job[]
export function getJob(id: string): Job | undefined
export function createJob(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Job
export function updateJobById(id: string, updates: Partial<Job>): Job | undefined
export function deleteJob(id: string): void
export function setJobStatus(id: string, status: Job['status']): void
export function setJobLastRun(id: string, lastRunAt: string): void
export function reorderJobs(orderedIds: string[]): void

// Runs (updated schema — note: getLatestRun excludes the current pending run by status)
export function createRun(jobId: string): DbRun
export function setRunStatus(runId: string, status: DbRun['status']): void
export function completeRun(runId: string, status: DbRun['status'], contentHash: string | null, rawData: string | null, analysis: string | null, bedrockInvoked: boolean, inputTokens: number, outputTokens: number, durationMs: number, error: string | null): void
export function getLatestCompletedRun(jobId: string): DbRun | undefined  // WHERE status IN ('complete','skipped') ORDER BY started_at DESC LIMIT 1
export function listRuns(jobId: string, limit?: number): DbRun[]
export function getRunById(id: string): DbRun | undefined
export function getStats(): StatsRow

// Test helpers (only compiled when NODE_ENV=test)
export function resetForTesting(): void  // drops and recreates all tables; see implementation note below
```

**`resetForTesting()` implementation:** Add at end of `db.ts`:
```typescript
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
```

**`getLatestCompletedRun` note:** Renamed from `getLatestRun` to `getLatestCompletedRun` to clarify it returns only completed/skipped runs. This prevents the runner from treating the just-created `pending` run as the "previous" run for hash comparison.

**`StatsRow` type:**
```typescript
export interface StatsRow {
  totalRuns: number;
  successRate: number;
  skippedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
}
```

- [ ] **Step 2.4: Create tests/db.smoke.test.ts**

```typescript
// tests/db.smoke.test.ts
// Imports from src/db.ts — run AFTER db.ts is created.
import { createUser, findUserByEmail, hasUsers, resetForTesting } from '../src/db';

// tests/setup.ts sets NODE_ENV=test → db.ts opens ':memory:' DB
// resetForTesting() DELETEs all rows between tests (same in-memory DB instance)
beforeEach(() => resetForTesting());

describe('DB query smoke tests', () => {
  it('hasUsers returns false on empty DB', () => {
    expect(hasUsers()).toBe(false);
  });

  it('createUser + findUserByEmail round-trips', () => {
    createUser('u1', 'test@example.com', Buffer.from('webauthn-id'));
    const user = findUserByEmail('test@example.com');
    expect(user).toBeDefined();
    expect(user!.email).toBe('test@example.com');
    expect(hasUsers()).toBe(true);
  });

  it('second test still sees empty DB (resetForTesting works)', () => {
    expect(hasUsers()).toBe(false);  // Would fail if beforeEach reset didn't work
  });
});
```

- [ ] **Step 2.5: Run both db test files**

```bash
npx jest tests/db.migration.test.ts tests/db.smoke.test.ts --no-coverage
```
Expected: all pass

- [ ] **Step 2.6: Commit**

```bash
git add package.json tsconfig.test.json jest.config.ts tests/ src/db.ts
git commit -m "feat: add unified db.ts with auth tables, runs migration, and Jest setup"
```

---

## Chunk 2: Collectors and Bedrock Client

### Task 3: Collector types

**Files:**
- Create: `src/collectors/types.ts`

- [ ] **Step 3.1: Create src/collectors/types.ts**

Port directly from `webauthn-demo/server/src/collectors/types.ts`. Verify it matches the spec:

```typescript
export interface SelectorSpec {
  selector: string;
  attribute?: string;
  multiple?: boolean;
  transform?: 'trim' | 'number' | 'lowercase' | 'uppercase';
}

export type SourceConfig =
  | { type: 'rss';      url: string; maxItems?: number }
  | { type: 'api';      url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; extract?: string }
  | { type: 'html';     url: string; selectors: Record<string, SelectorSpec>; headers?: Record<string, string> }
  | { type: 'browser';  url: string; selectors: Record<string, SelectorSpec>; waitFor?: string; clickBefore?: string[]; scrollToBottom?: boolean }
  | { type: 'graphql';  url: string; query: string; variables?: Record<string, unknown>; headers?: Record<string, string>; extract?: string }

export interface CollectorResult {
  source: string;
  data: unknown;
  error?: string;
}

export interface SourceEntry {
  name?: string;
  config: SourceConfig;
}
```

No test needed for a pure types file. This is referenced by all collectors.

---

### Task 3a: Shared collector utility

**Files:**
- Create: `src/collectors/utils.ts`

Prerequisite for Tasks 4 and 7 (both use dot-path extraction). Create before implementing any collector.

- [ ] **Step 3a.1: Create src/collectors/utils.ts**

```typescript
// src/collectors/utils.ts

/**
 * Extracts a nested value from an object using a dot-separated path.
 * extractByPath({ a: { b: [1,2] } }, 'a.b') → [1,2]
 * Returns the original data if path is empty/undefined.
 */
export function extractByPath(data: unknown, path: string | undefined): unknown {
  if (!path) return data;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return acc;
  }, data);
}
```

Tested indirectly via api.test.ts and graphql.test.ts (both test dot-path extraction).

---

### Task 4: API collector

**Files:**
- Create: `src/collectors/api.ts`
- Test: `tests/collectors/api.test.ts`

- [ ] **Step 4.1: Write failing test**

```typescript
// tests/collectors/api.test.ts
import nock from 'nock';
import { collectApi } from '../../src/collectors/api';

beforeEach(() => nock.cleanAll());
afterAll(() => nock.restore());

describe('collectApi', () => {
  it('fetches JSON and returns data', async () => {
    nock('https://api.example.com').get('/data').reply(200, { items: [1, 2, 3] });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/data' }, 'test-source');
    expect(result.source).toBe('test-source');
    expect(result.data).toEqual({ items: [1, 2, 3] });
    expect(result.error).toBeUndefined();
  });

  it('uses dot-path extraction when extract is set', async () => {
    nock('https://api.example.com').get('/data').reply(200, { results: { items: [1, 2, 3] } });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/data', extract: 'results.items' }, 'src');
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('returns error result on network failure', async () => {
    nock('https://api.example.com').get('/fail').replyWithError('connection refused');
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/fail' }, 'src');
    expect(result.error).toBeDefined();
    expect(result.data).toBeNull();
  });

  it('sends POST with body', async () => {
    nock('https://api.example.com').post('/submit', { foo: 'bar' }).reply(200, { ok: true });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/submit', method: 'POST', body: { foo: 'bar' } }, 'src');
    expect(result.data).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4.2: Run test (expect FAIL — module not found)**

```bash
npx jest tests/collectors/api.test.ts --no-coverage
```

- [ ] **Step 4.3: Create src/collectors/api.ts**

Port from `webauthn-demo/server/src/collectors/api.ts`. The function signature should be:

```typescript
export async function collectApi(config: ApiSourceConfig, name?: string): Promise<CollectorResult>
```

Key behaviors:
- 15s timeout via `AbortController`
- dot-path extraction: walk `config.extract` as dot-separated path into response JSON
- Custom headers support
- On error: return `{ source: name ?? config.url, data: null, error: errorMessage }`

- [ ] **Step 4.4: Run test (expect PASS)**

```bash
npx jest tests/collectors/api.test.ts --no-coverage
```

---

### Task 5: RSS collector

**Files:**
- Create: `src/collectors/rss.ts`
- Test: `tests/collectors/rss.test.ts`

- [ ] **Step 5.1: Write failing test**

```typescript
// tests/collectors/rss.test.ts
import nock from 'nock';
import { collectRss } from '../../src/collectors/rss';

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item><title>Item 1</title><link>https://example.com/1</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  <item><title>Item 2</title><link>https://example.com/2</link><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(() => nock.cleanAll());

describe('collectRss', () => {
  it('parses RSS feed and returns items', async () => {
    nock('https://feeds.example.com').get('/rss').reply(200, SAMPLE_RSS, { 'Content-Type': 'application/rss+xml' });
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss' }, 'feed');
    expect(result.error).toBeUndefined();
    const data = result.data as any;
    expect(data.items).toHaveLength(2);
    expect(data.items[0].title).toBe('Item 1');
  });

  it('respects maxItems cap', async () => {
    nock('https://feeds.example.com').get('/rss').reply(200, SAMPLE_RSS, { 'Content-Type': 'application/rss+xml' });
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss', maxItems: 1 }, 'feed');
    const data = result.data as any;
    expect(data.items).toHaveLength(1);
  });

  it('returns error on bad URL', async () => {
    nock('https://feeds.example.com').get('/rss').replyWithError('network error');
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss' }, 'feed');
    expect(result.error).toBeDefined();
    expect(result.data).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run test (expect FAIL)**

```bash
npx jest tests/collectors/rss.test.ts --no-coverage
```

- [ ] **Step 5.3: Create src/collectors/rss.ts**

Port from `webauthn-demo/server/src/collectors/rss.ts`. Key behaviors:
- 15s timeout
- `maxItems` default: 20
- Return `{ source, data: { title, feedUrl, items: [...] }, error? }`

- [ ] **Step 5.4: Run test (expect PASS)**

```bash
npx jest tests/collectors/rss.test.ts --no-coverage
```

---

### Task 6: HTML collector

**Files:**
- Create: `src/collectors/html.ts`
- Test: `tests/collectors/html.test.ts`

- [ ] **Step 6.1: Write failing test**

```typescript
// tests/collectors/html.test.ts
import nock from 'nock';
import { collectHtml } from '../../src/collectors/html';

const SAMPLE_HTML = `<html><body>
  <h1 class="title">Hello World</h1>
  <ul class="items"><li>A</li><li>B</li><li>C</li></ul>
  <span data-price="42.5">Price</span>
</body></html>`;

beforeEach(() => nock.cleanAll());

describe('collectHtml', () => {
  it('extracts single element by selector', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { title: { selector: 'h1.title' } }
    }, 'src');
    expect(result.error).toBeUndefined();
    expect((result.data as any).title).toBe('Hello World');
  });

  it('extracts multiple elements with multiple: true', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { items: { selector: 'ul.items li', multiple: true } }
    }, 'src');
    expect((result.data as any).items).toEqual(['A', 'B', 'C']);
  });

  it('extracts attribute value', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { price: { selector: '[data-price]', attribute: 'data-price', transform: 'number' } }
    }, 'src');
    expect((result.data as any).price).toBe(42.5);
  });

  it('returns error on network failure', async () => {
    nock('https://example.com').get('/').replyWithError('timeout');
    const result = await collectHtml({ type: 'html', url: 'https://example.com/', selectors: {} }, 'src');
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 6.2: Run test (expect FAIL)**

```bash
npx jest tests/collectors/html.test.ts --no-coverage
```

- [ ] **Step 6.3: Create src/collectors/html.ts**

Port from `webauthn-demo/server/src/collectors/html.ts`. Existing Croniq code has similar logic in `src/agents/tools/html-scrape.ts` and `src/agents/tools/selectors.ts` — reference those for the transform/multi-select patterns but implement as a standalone collector function (not a LangChain tool).

Key behaviors:
- `fetch(url, { headers, signal })` with 15s timeout
- Load HTML with `cheerio.load()`
- Per selector: if `attribute` set, get `$(...).attr(attribute)`; otherwise `$(...).text()`
- If `multiple: true`, collect array; else first match only
- Transforms: `trim` → `.trim()`, `number` → `parseFloat()`, `lowercase` → `.toLowerCase()`, `uppercase` → `.toUpperCase()`

- [ ] **Step 6.4: Run test (expect PASS)**

```bash
npx jest tests/collectors/html.test.ts --no-coverage
```

---

### Task 7: GraphQL collector

**Files:**
- Create: `src/collectors/graphql.ts`
- Test: `tests/collectors/graphql.test.ts`

- [ ] **Step 7.1: Write failing test**

```typescript
// tests/collectors/graphql.test.ts
import nock from 'nock';
import { collectGraphql } from '../../src/collectors/graphql';

beforeEach(() => nock.cleanAll());

describe('collectGraphql', () => {
  it('sends POST query and returns data', async () => {
    nock('https://api.example.com')
      .post('/graphql', body => body.query === '{ users { id } }')
      .reply(200, { data: { users: [{ id: '1' }] } });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: '{ users { id } }' }, 'src');
    expect(result.error).toBeUndefined();
    expect((result.data as any).data.users).toHaveLength(1);
  });

  it('applies dot-path extract', async () => {
    nock('https://api.example.com').post('/graphql').reply(200, { data: { users: [{ id: '1' }] } });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: '{ users { id } }', extract: 'data.users' }, 'src');
    expect(result.data).toEqual([{ id: '1' }]);
  });

  it('returns error on 4xx', async () => {
    nock('https://api.example.com').post('/graphql').reply(400, { errors: [{ message: 'bad query' }] });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: 'bad' }, 'src');
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 7.2: Run test (expect FAIL)**

```bash
npx jest tests/collectors/graphql.test.ts --no-coverage
```

- [ ] **Step 7.3: Create src/collectors/graphql.ts**

Reference `src/agents/tools/graphql-fetch.ts` for the old LangChain implementation. New version is a plain async function:

```typescript
export async function collectGraphql(config: GraphqlSourceConfig, name?: string): Promise<CollectorResult>
```

Key behaviors:
- POST to `config.url` with `{ query, variables }` as JSON body
- Custom headers support
- 15s timeout
- Error on non-2xx response
- Dot-path extraction if `config.extract` set — import `extractByPath` from `./utils.js`

- [ ] **Step 7.4: Run test (expect PASS)**

```bash
npx jest tests/collectors/graphql.test.ts --no-coverage
```

---

### Task 8: Browser collector

**Files:**
- Create: `src/collectors/browser.ts`

No unit test — Playwright requires a browser binary. The browser collector gracefully errors if Playwright is unavailable.

- [ ] **Step 8.1: Create src/collectors/browser.ts**

Port the logic from `src/agents/tools/browser-scrape.ts` (existing LangChain tool). New version is a plain async function matching the `html.ts` interface but using Playwright instead of `fetch` + cheerio.

```typescript
export async function collectBrowser(config: BrowserSourceConfig, name?: string): Promise<CollectorResult>
```

Key behaviors (same as html.ts selectors but with Playwright):
- `playwright.chromium.launch({ headless: true })`
- Navigate to URL, optionally `page.waitForSelector(config.waitFor)`
- If `config.clickBefore`: click each selector in sequence
- If `config.scrollToBottom`: scroll to bottom and wait
- Get page HTML, load with cheerio, apply same selector/transform logic as `html.ts`
- On `playwright` import error (module not installed): return `{ source, data: null, error: 'Playwright not available' }`
- Close browser in finally block

- [ ] **Step 8.2: Manual verification**

```bash
# Start dev server (after all backend pieces are wired) and trigger a job with a browser source.
# Or run directly: npx tsx -e "import('./src/collectors/browser.js').then(m => m.collectBrowser({ type:'browser', url:'https://example.com', selectors:{ title:{ selector:'h1' } } },'test').then(r => console.log(r)))"
```
Expected: `{ source: 'test', data: { title: 'Example Domain' }, error: undefined }`

---

### Task 9: Collector orchestrator

**Files:**
- Create: `src/collectors/index.ts`
- Test: `tests/collectors/index.test.ts`

- [ ] **Step 9.1: Write failing test**

```typescript
// tests/collectors/index.test.ts
import { collectSources } from '../../src/collectors/index';
import * as apiCollector from '../../src/collectors/api';
import * as rssCollector from '../../src/collectors/rss';

jest.mock('../../src/collectors/api');
jest.mock('../../src/collectors/rss');
jest.mock('../../src/collectors/html');
jest.mock('../../src/collectors/browser');
jest.mock('../../src/collectors/graphql');

const mockCollectApi = jest.mocked(apiCollector.collectApi);
const mockCollectRss = jest.mocked(rssCollector.collectRss);

describe('collectSources', () => {
  it('dispatches to correct collector by type', async () => {
    mockCollectApi.mockResolvedValueOnce({ source: 'api-src', data: { ok: true } });
    const results = await collectSources([{ name: 'api-src', config: { type: 'api', url: 'https://example.com' } }]);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('api-src');
    expect(mockCollectApi).toHaveBeenCalledWith({ type: 'api', url: 'https://example.com' }, 'api-src');
  });

  it('continues collecting when one source fails', async () => {
    mockCollectApi.mockRejectedValueOnce(new Error('network down'));
    mockCollectRss.mockResolvedValueOnce({ source: 'rss-src', data: { items: [] } });
    const results = await collectSources([
      { name: 'broken', config: { type: 'api', url: 'https://fail.example.com' } },
      { name: 'rss-src', config: { type: 'rss', url: 'https://feeds.example.com/rss' } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].error).toBeDefined();  // api failure wrapped as error result
    expect(results[1].error).toBeUndefined(); // rss succeeded
  });

  it('uses config.url as fallback source name', async () => {
    mockCollectApi.mockResolvedValueOnce({ source: 'https://example.com', data: {} });
    const results = await collectSources([{ config: { type: 'api', url: 'https://example.com' } }]);
    expect(mockCollectApi).toHaveBeenCalledWith({ type: 'api', url: 'https://example.com' }, undefined);
  });
});
```

- [ ] **Step 9.2: Run test (expect FAIL)**

```bash
npx jest tests/collectors/index.test.ts --no-coverage
```

- [ ] **Step 9.3: Create src/collectors/index.ts**

```typescript
import { collectApi } from './api.js';
import { collectBrowser } from './browser.js';
import { collectGraphql } from './graphql.js';
import { collectHtml } from './html.js';
import { collectRss } from './rss.js';
import type { CollectorResult, SourceEntry } from './types.js';

export async function collectSources(sources: SourceEntry[]): Promise<CollectorResult[]> {
  const results = await Promise.allSettled(
    sources.map(({ name, config }) => {
      switch (config.type) {
        case 'api':      return collectApi(config, name);
        case 'rss':      return collectRss(config, name);
        case 'html':     return collectHtml(config, name);
        case 'browser':  return collectBrowser(config, name);
        case 'graphql':  return collectGraphql(config, name);
      }
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    // Unexpected throw (not caught inside collector) — wrap as error result
    const source = sources[i].name ?? (sources[i].config as any).url ?? 'unknown';
    return { source, data: null, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  });
}
```

- [ ] **Step 9.4: Run test (expect PASS)**

```bash
npx jest tests/collectors/index.test.ts --no-coverage
```

- [ ] **Step 9.5: Commit collectors**

```bash
git add src/collectors/ tests/collectors/
git commit -m "feat: add direct TypeScript collectors (api, rss, html, browser, graphql)"
```

---

### Task 10: Bedrock client

**Files:**
- Create: `src/bedrock/client.ts`
- Test: `tests/bedrock.test.ts`

- [ ] **Step 10.1: Write failing test**

```typescript
// tests/bedrock.test.ts
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { analyzeWithBedrock } from '../src/bedrock/client';

const bedrockMock = mockClient(BedrockRuntimeClient);

beforeEach(() => bedrockMock.reset());

describe('analyzeWithBedrock', () => {
  it('returns analysis and token counts', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# Report\n\nSome analysis.' }] } },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await analyzeWithBedrock('{"items":[1,2]}', 'Summarize this data', 'Test Job');
    expect(result.analysis).toBe('# Report\n\nSome analysis.');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('throws on empty response', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [] } },
      usage: { inputTokens: 10, outputTokens: 0 },
    });

    await expect(analyzeWithBedrock('{}', 'prompt', 'job')).rejects.toThrow();
  });
});
```

Note: `aws-sdk-client-mock` is already in devDependencies (added in Task 1).

- [ ] **Step 10.2: Run test (expect FAIL)**

```bash
npx jest tests/bedrock.test.ts --no-coverage
```

- [ ] **Step 10.3: Create src/bedrock/client.ts**

```typescript
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

export async function analyzeWithBedrock(
  rawData: string,
  jobPrompt: string,
  jobName: string,
): Promise<{ analysis: string; inputTokens: number; outputTokens: number }> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  const response = await client.send(new ConverseCommand({
    modelId,
    system: [{ text: `You are writing a scheduled intelligence report for the job: ${jobName}. Write a concise markdown report analyzing the data provided. Use headers, bullet points, and clear language. Focus on patterns, changes, and key insights.` }],
    messages: [{
      role: 'user',
      content: [{ text: `Data collected:\n\`\`\`json\n${rawData}\n\`\`\`\n\nAdditional instructions: ${jobPrompt}` }],
    }],
    inferenceConfig: { temperature: 0.3, maxTokens: 4096 },
  }));

  const textBlock = response.output?.message?.content?.find(b => 'text' in b);
  if (!textBlock || !('text' in textBlock) || !textBlock.text) {
    throw new Error('Bedrock returned no text content');
  }

  return {
    analysis: textBlock.text,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
  };
}
```

- [ ] **Step 10.4: Run test (expect PASS)**

```bash
npx jest tests/bedrock.test.ts --no-coverage
```

- [ ] **Step 10.6: Commit**

```bash
git add src/bedrock/ tests/bedrock.test.ts package.json package-lock.json
git commit -m "feat: add Bedrock client with direct ConverseCommand"
```

---

## Chunk 3: Runner and Scheduler

### Task 11: Runner (pipeline)

**Files:**
- Create: `src/runner.ts`
- Test: `tests/runner.test.ts`

- [ ] **Step 11.1: Write failing tests**

```typescript
// tests/runner.test.ts
import { runJob } from '../src/runner';
import * as collectors from '../src/collectors/index';
import * as bedrock from '../src/bedrock/client';
import * as db from '../src/db';

jest.mock('../src/collectors/index');
jest.mock('../src/bedrock/client');
jest.mock('../src/db');

const mockCollectSources = jest.mocked(collectors.collectSources);
const mockAnalyze = jest.mocked(bedrock.analyzeWithBedrock);
const mockGetJob = jest.mocked(db.getJob);
const mockCreateRun = jest.mocked(db.createRun);
const mockSetRunStatus = jest.mocked(db.setRunStatus);
const mockCompleteRun = jest.mocked(db.completeRun);
const mockGetLatestCompletedRun = jest.mocked(db.getLatestCompletedRun);
const mockSetJobLastRun = jest.mocked(db.setJobLastRun);

const MOCK_JOB = {
  id: 'j1', name: 'Test Job', schedule: '0 * * * *',
  sources: [{ name: 'src', config: { type: 'api' as const, url: 'https://api.example.com' } }],
  jobPrompt: 'Summarize this', status: 'active' as const,
} as any;

const MOCK_RUN = { id: 'run1', jobId: 'j1', status: 'pending', contentHash: null } as any;

describe('runJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetJob.mockReturnValue(MOCK_JOB);
    mockCreateRun.mockReturnValue(MOCK_RUN);
    mockGetLatestCompletedRun.mockReturnValue(undefined);
  });

  it('calls Bedrock and marks run complete on success', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: { items: [1, 2] } }]);
    mockAnalyze.mockResolvedValue({ analysis: '# Report', inputTokens: 100, outputTokens: 50 });

    await runJob('j1');

    expect(mockSetRunStatus).toHaveBeenCalledWith('run1', 'collecting');
    expect(mockSetRunStatus).toHaveBeenCalledWith('run1', 'analyzing');
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'complete', expect.any(String), expect.any(String),
      '# Report', true, 100, 50, expect.any(Number), null
    );
  });

  it('skips Bedrock when content hash matches previous run', async () => {
    const rawData = [{ source: 'src', data: { same: true } }];
    mockCollectSources.mockResolvedValue(rawData);

    // Simulate previous completed run with same hash
    // Note: getLatestCompletedRun is called BEFORE createRun to avoid the race condition
    // where createRun's pending row would be returned as "the previous run"
    import { createHash } from 'node:crypto';
    const hash = createHash('sha256').update(JSON.stringify(rawData)).digest('hex');
    mockGetLatestCompletedRun.mockReturnValue({ id: 'prev', status: 'complete', contentHash: hash, analysis: '# Old report' } as any);

    await runJob('j1');

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'skipped', hash, expect.any(String),
      '# Old report', false, 0, 0, expect.any(Number), null
    );
  });

  it('marks run as error when all collectors fail', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: null, error: 'network down' }]);

    await runJob('j1');

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'error', null, null, null, false, 0, 0, expect.any(Number), expect.stringContaining('all sources failed')
    );
  });

  it('marks run as error when Bedrock fails', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: { ok: true } }]);
    mockAnalyze.mockRejectedValue(new Error('throttled'));

    await runJob('j1');

    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'error', expect.any(String), expect.any(String),
      null, false, 0, 0, expect.any(Number), 'throttled'
    );
  });
});
```

- [ ] **Step 11.2: Run test (expect FAIL)**

```bash
npx jest tests/runner.test.ts --no-coverage
```

- [ ] **Step 11.3: Create src/runner.ts**

```typescript
import { createHash } from 'node:crypto';
import { collectSources } from './collectors/index.js';
import { analyzeWithBedrock } from './bedrock/client.js';
import { getJob, createRun, setRunStatus, completeRun, getLatestCompletedRun, setJobLastRun } from './db.js';

export async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  // IMPORTANT: fetch previousRun BEFORE createRun to avoid race condition.
  // createRun inserts a 'pending' row; getLatestCompletedRun must not return it.
  const previousRun = getLatestCompletedRun(jobId);
  const run = createRun(jobId);
  const startTime = Date.now();

  try {
    setRunStatus(run.id, 'collecting');
    const results = await collectSources(job.sources);

    const allFailed = results.every(r => r.error !== undefined);
    if (allFailed) {
      const error = `all sources failed: ${results.map(r => r.error).join(', ')}`;
      completeRun(run.id, 'error', null, null, null, false, 0, 0, Date.now() - startTime, error);
      return;
    }

    const rawDataStr = JSON.stringify(results);
    const contentHash = createHash('sha256').update(rawDataStr).digest('hex');
    if (previousRun?.status === 'complete' && previousRun.contentHash === contentHash) {
      completeRun(run.id, 'skipped', contentHash, rawDataStr, previousRun.analysis ?? null, false, 0, 0, Date.now() - startTime, null);
      setJobLastRun(jobId, new Date().toISOString());
      return;
    }

    setRunStatus(run.id, 'analyzing');
    const { analysis, inputTokens, outputTokens } = await analyzeWithBedrock(
      rawDataStr,
      job.jobPrompt ?? 'Summarize the collected data.',
      job.name,
    );

    const changed = previousRun?.contentHash !== contentHash;
    completeRun(run.id, 'complete', contentHash, rawDataStr, analysis, true, inputTokens, outputTokens, Date.now() - startTime, null);
    setJobLastRun(jobId, new Date().toISOString());

    if (job.notifyOnChange && changed && job.webhookUrl) {
      fireWebhook(job.webhookUrl, { jobId, jobName: job.name, runId: run.id, analysis }).catch(() => {});
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    completeRun(run.id, 'error', null, null, null, false, 0, 0, Date.now() - startTime, error);
  }
}

async function fireWebhook(url: string, payload: unknown): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
}
```

- [ ] **Step 11.4: Run tests (expect PASS)**

```bash
npx jest tests/runner.test.ts --no-coverage
```

- [ ] **Step 11.5: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: add pipeline runner (collect → hash → analyze)"
```

---

### Task 12: Scheduler

**Files:**
- Create: `src/scheduler/index.ts`
- Test: `tests/scheduler.test.ts`

- [ ] **Step 12.1: Write tests/scheduler.test.ts**

```typescript
// tests/scheduler.test.ts
// Tests the exported createJobCallback function in isolation.
// node-cron tasks fire asynchronously and are hard to unit-test directly;
// createJobCallback is the pure logic that wraps each cron tick.
import { createJobCallback } from '../src/scheduler/index';
import * as db from '../src/db';
import * as runner from '../src/runner';

jest.mock('../src/db');
jest.mock('../src/runner');

const mockGetJob = jest.mocked(db.getJob);
const mockRunJob = jest.mocked(runner.runJob);

describe('createJobCallback (reload-before-execute)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs job when status is active', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', status: 'active' } as any);
    mockRunJob.mockResolvedValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).toHaveBeenCalledWith('j1');
  });

  it('does not run when job is paused', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', status: 'paused' } as any);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('does not run when job is deleted (undefined)', async () => {
    mockGetJob.mockReturnValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 12.2: Run test (expect FAIL — module not found)**

```bash
npx jest tests/scheduler.test.ts --no-coverage
```

- [ ] **Step 12.3: Create src/scheduler/index.ts**

Port from `webauthn-demo/server/src/scheduler/index.ts` (or old `src/jobs/scheduler.ts`). Key behaviors:

```typescript
import cron, { type ScheduledTask } from 'node-cron';
import { getJob } from '../db.js';
import { runJob } from '../runner.js';

const activeTasks = new Map<string, ScheduledTask>();

// Exported for testing
export function createJobCallback(jobId: string): () => Promise<void> {
  return async () => {
    const job = getJob(jobId);
    if (!job || job.status !== 'active') {
      unscheduleJob(jobId);
      return;
    }
    await runJob(jobId).catch(err => console.error(`[scheduler] Job ${jobId} error:`, err));
  };
}

export function scheduleJob(job: { id: string; schedule: string }): void {
  unscheduleJob(job.id);
  const task = cron.schedule(job.schedule, createJobCallback(job.id));
  activeTasks.set(job.id, task);
}

export function unscheduleJob(jobId: string): void {
  const task = activeTasks.get(jobId);
  if (task) {
    task.stop();
    activeTasks.delete(jobId);
  }
}

export function initScheduler(): void {
  // Import listJobs lazily to avoid circular dep
  const { listJobs } = require('../db.js');
  const jobs = listJobs() as Array<{ id: string; schedule: string; status: string }>;
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  console.log(`[scheduler] Initialized ${activeTasks.size} jobs`);
}
```

- [ ] **Step 12.4: Run test (expect PASS)**

```bash
npx jest tests/scheduler.test.ts --no-coverage
```

- [ ] **Step 12.4: Commit**

```bash
git add src/scheduler/ tests/scheduler.test.ts
git commit -m "feat: add scheduler with reload-before-execute pattern"
```

---

## Chunk 4: Auth Routes and Server

### Task 13: Auth routes

**Files:**
- Create: `src/auth/routes.ts`
- Test: `tests/auth.test.ts`

- [ ] **Step 13.1: Review the demo's app.ts auth section**

The demo's auth code lives in `webauthn-demo/server/src/app.ts` lines 90–319. Key adaptations for Croniq:

1. **bcrypt instead of sha256** — recovery codes are hashed with `bcrypt.hash(code, 10)` and verified with `bcrypt.compare()`
2. **No step-up auth** — remove `POST /api/auth/step-up/options` and `POST /api/auth/step-up/verify`
3. **Add `GET /api/auth/status`** returning `{ hasUsers: boolean }` — needed by Auth page to default to Register tab
4. **RP ID** from `process.env.RP_ID ?? 'localhost'`; origin from `process.env.ORIGIN ?? 'http://localhost:5173'`
5. **Add `POST /api/passkeys`** (add passkey while authenticated — not in demo, specified in spec)
6. **Add `POST /api/passkeys/recovery-code/regenerate`** (not in demo, specified in spec)

- [ ] **Step 13.2: Write failing auth integration tests**

```typescript
// tests/auth.test.ts
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { doubleCsrf } from 'csrf-csrf';
import { authRouter } from '../src/auth/routes';
import * as db from '../src/db';

jest.mock('../src/db');
jest.mock('@simplewebauthn/server');

const mockHasUsers = jest.mocked(db.hasUsers);
const mockFindUserByEmail = jest.mocked(db.findUserByEmail);
const mockCreateUser = jest.mocked(db.createUser);
const mockStoreChallenge = jest.mocked(db.storeChallenge);
const mockGenerateRegistrationOptions = jest.mocked(
  require('@simplewebauthn/server').generateRegistrationOptions
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser('test'));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  const { doubleCsrfProtection, generateToken } = doubleCsrf({
    getSecret: () => 'test-csrf', cookieName: '__csrf',
    cookieOptions: { sameSite: 'lax', secure: false },
    getTokenFromRequest: r => r.headers['x-csrf-token'] as string,
  });
  app.get('/api/csrf-token', (req, res) => res.json({ token: generateToken(req, res) }));
  app.use(doubleCsrfProtection);
  app.use(authRouter);
  return app;
}

describe('GET /api/auth/status', () => {
  it('returns hasUsers: false when no users exist', async () => {
    mockHasUsers.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasUsers: false });
  });

  it('returns hasUsers: true when users exist', async () => {
    mockHasUsers.mockReturnValue(true);
    const app = buildApp();
    const res = await request(app).get('/api/auth/status');
    expect(res.body).toEqual({ hasUsers: true });
  });
});

describe('POST /api/auth/register/options', () => {
  it('rejects missing email', async () => {
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/register/options')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/recover', () => {
  it('rejects missing fields', async () => {
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/recover')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({ email: 'test@example.com' }); // missing recoveryCode
    expect(res.status).toBe(400);
  });

  it('rejects wrong recovery code', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('correct-code', 10);
    mockFindUserByEmail.mockReturnValue({ id: 'u1', email: 'test@example.com', recovery_code_hash: hash } as any);
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/recover')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({ email: 'test@example.com', recoveryCode: 'wrong-code' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 13.3: Run tests (expect FAIL)**

```bash
npx jest tests/auth.test.ts --no-coverage
```

- [ ] **Step 13.4: Create src/auth/routes.ts**

Port from `webauthn-demo/server/src/app.ts` (auth section only), extracting into an Express Router. Adaptations:

```typescript
import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse, type WebAuthnCredential } from '@simplewebauthn/server';
import {
  createUser, findUserByEmail, findUserById,
  getPasskeysByUser, getPasskeyById, savePasskey, updatePasskeyCounter,
  renamePasskey, deletePasskey, storeChallenge, consumeChallenge,
  setRecoveryCodeHash, logAuditEvent, hasUsers,
} from '../db.js';

const RP_NAME = 'Croniq';
const RP_ID = process.env.RP_ID ?? 'localhost';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';

export const authRouter = Router();

function getClientIp(req: express.Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

// GET /api/auth/status — unauthenticated
authRouter.get('/api/auth/status', (req, res) => {
  res.json({ hasUsers: hasUsers() });
});

// ===== REGISTRATION =====
// POST /api/auth/register/options
authRouter.post('/api/auth/register/options', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Valid email required' });
  const normalizedEmail = email.toLowerCase().trim();
  let user = findUserByEmail(normalizedEmail);
  if (!user) {
    user = createUser(randomUUID(), normalizedEmail, randomBytes(32));
  }
  const existingPasskeys = getPasskeysByUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: user.email, userDisplayName: user.email,
    userID: user.webauthn_user_id,  // Buffer → passed as-is (better-sqlite3 returns Buffer)
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({ id: pk.id, transports: pk.transports ? JSON.parse(pk.transports) : undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  storeChallenge(options.challenge, user.id, 'registration');
  res.json(options);
});

// POST /api/auth/register/verify
authRouter.post('/api/auth/register/verify', authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'registration');
    if (!challengeRecord) return res.status(400).json({ verified: false, error: 'Invalid or expired challenge' });
    const user = findUserById(challengeRecord.user_id);
    if (!user) return res.status(400).json({ verified: false });

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: clientDataJSON.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ verified: false });

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    savePasskey(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credentialDeviceType, credentialBackedUp, credential.transports);
    logAuditEvent(user.id, 'registered', `passkey: ${credential.id.substring(0, 16)}…`, getClientIp(req));

    const allPasskeys = getPasskeysByUser(user.id);
    let recoveryCode: string | undefined;
    if (allPasskeys.length === 1) {
      // First passkey — issue recovery code (bcrypt hash, NOT sha256)
      recoveryCode = randomBytes(32).toString('base64url');
      const hash = await bcrypt.hash(recoveryCode, 10);
      setRecoveryCodeHash(user.id, hash);
    }

    (req.session as any).userId = user.id;
    res.json({ verified: true, recoveryCode });
  } catch (err) {
    logAuditEvent(null, 'registration.error', String(err), getClientIp(req));
    return res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

// ===== LOGIN =====
// POST /api/auth/login/options
authRouter.post('/api/auth/login/options', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Valid email required' });
  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) {
    // User enumeration protection: return dummy options
    const dummy = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: [], userVerification: 'required' });
    storeChallenge(dummy.challenge, 'nonexistent-user', 'authentication');
    return res.json(dummy);
  }
  const passkeys = getPasskeysByUser(user.id);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: passkeys.map(pk => ({ id: pk.id, transports: pk.transports ? JSON.parse(pk.transports) : undefined })),
    userVerification: 'required',
  });
  storeChallenge(options.challenge, user.id, 'authentication');
  res.json(options);
});

// POST /api/auth/login/verify
authRouter.post('/api/auth/login/verify', authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'authentication');
    if (!challengeRecord) return res.status(400).json({ verified: false, error: 'Invalid or expired challenge' });
    const user = findUserById(challengeRecord.user_id);
    if (!user) return res.status(400).json({ verified: false });
    const passkey = getPasskeyById(req.body.id);
    if (!passkey || passkey.user_id !== user.id) return res.status(400).json({ verified: false });

    const credential: WebAuthnCredential = {
      id: passkey.id, publicKey: passkey.public_key as Buffer,
      counter: passkey.counter, transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    };
    const verification = await verifyAuthenticationResponse({
      response: req.body, expectedChallenge: clientDataJSON.challenge,
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential, requireUserVerification: true,
    });
    if (!verification.verified) return res.status(400).json({ verified: false });
    updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter, new Date().toISOString());
    (req.session as any).userId = user.id;
    logAuditEvent(user.id, 'logged_in', `passkey: ${passkey.id.substring(0, 16)}…`, getClientIp(req));
    res.json({ verified: true });
  } catch (err) {
    return res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Authentication failed' });
  }
});

// ===== RECOVERY =====
// POST /api/auth/recover
authRouter.post('/api/auth/recover', authLimiter, async (req, res) => {
  const { email, recoveryCode } = req.body;
  if (!email || !recoveryCode) return res.status(400).json({ error: 'Email and recovery code required' });
  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user || !user.recovery_code_hash) return res.status(400).json({ error: 'Recovery failed.' });
  // bcrypt.compare (NOT sha256 like demo)
  const valid = await bcrypt.compare(recoveryCode, user.recovery_code_hash);
  if (!valid) return res.status(400).json({ error: 'Recovery failed.' });

  // Issue new recovery code immediately (old one is now consumed)
  const newCode = randomBytes(32).toString('base64url');
  const newHash = await bcrypt.hash(newCode, 10);
  setRecoveryCodeHash(user.id, newHash);
  (req.session as any).userId = user.id;
  logAuditEvent(user.id, 'recovered', '', getClientIp(req));
  res.json({ ok: true, newRecoveryCode: newCode });
});

// ===== SESSION / ME =====
// POST /api/auth/logout
authRouter.post('/api/auth/logout', (req, res) => {
  const userId = (req.session as any).userId;
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    logAuditEvent(userId ?? null, 'logged_in', 'logout', getClientIp(req));  // reuse event type
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/me
authRouter.get('/api/me', (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const passkeys = getPasskeysByUser(user.id);
  res.json({
    id: user.id, email: user.email,
    passkeys: passkeys.map(pk => ({
      id: pk.id, label: pk.label, deviceType: pk.device_type,
      backedUp: pk.backed_up === 1, createdAt: pk.created_at, lastUsedAt: pk.last_used_at,
    })),
  });
});

// ===== PASSKEY MANAGEMENT (session required — enforced by server.ts requireSession middleware) =====
// GET /api/passkeys
authRouter.get('/api/passkeys', (req, res) => {
  const passkeys = getPasskeysByUser((req.session as any).userId);
  res.json(passkeys.map(pk => ({ id: pk.id, label: pk.label, deviceType: pk.device_type, backedUp: pk.backed_up === 1, createdAt: pk.created_at, lastUsedAt: pk.last_used_at })));
});

// POST /api/passkeys — add a passkey to current authenticated user
authRouter.post('/api/passkeys', async (req, res) => {
  // Phase 1: generate options (no email input — identity from session)
  const user = findUserById((req.session as any).userId)!;
  const existingPasskeys = getPasskeysByUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: user.email, userDisplayName: user.email,
    userID: user.webauthn_user_id,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({ id: pk.id })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  storeChallenge(options.challenge, user.id, 'registration');
  res.json(options);
});

// POST /api/passkeys/verify — verify after browser ceremony for add-passkey flow
authRouter.post('/api/passkeys/verify', async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'registration');
    if (!challengeRecord || challengeRecord.user_id !== (req.session as any).userId) return res.status(400).json({ verified: false });
    const user = findUserById(challengeRecord.user_id)!;
    const verification = await verifyRegistrationResponse({ response: req.body, expectedChallenge: clientDataJSON.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ verified: false });
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    savePasskey(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credentialDeviceType, credentialBackedUp, credential.transports);
    logAuditEvent(user.id, 'passkey_added', credential.id.substring(0, 16), getClientIp(req));
    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Failed' });
  }
});

// PATCH /api/passkeys/:id — rename
authRouter.patch('/api/passkeys/:id', (req, res) => {
  const { label } = req.body;
  if (!label || typeof label !== 'string' || label.length > 64) return res.status(400).json({ error: 'Label required (max 64 chars)' });
  renamePasskey(req.params.id, (req.session as any).userId, label.trim());
  logAuditEvent((req.session as any).userId, 'passkey_renamed', req.params.id.substring(0, 16), getClientIp(req));
  res.json({ ok: true });
});

// DELETE /api/passkeys/:id
authRouter.delete('/api/passkeys/:id', (req, res) => {
  const userId = (req.session as any).userId;
  const existing = getPasskeysByUser(userId);
  if (existing.length <= 1) return res.status(400).json({ error: 'Cannot delete your only passkey' });
  const deleted = deletePasskey(req.params.id, userId);
  if (!deleted) return res.status(404).json({ error: 'Passkey not found' });
  logAuditEvent(userId, 'passkey_deleted', req.params.id.substring(0, 16), getClientIp(req));
  res.json({ ok: true });
});

// POST /api/passkeys/recovery-code/regenerate
authRouter.post('/api/passkeys/recovery-code/regenerate', async (req, res) => {
  const userId = (req.session as any).userId;
  const newCode = randomBytes(32).toString('base64url');
  const hash = await bcrypt.hash(newCode, 10);
  setRecoveryCodeHash(userId, hash);
  logAuditEvent(userId, 'recovery_code_regenerated', '', getClientIp(req));
  res.json({ recoveryCode: newCode });
});
```

**Missing helper `authLimiter` and `getClientIp`:** define at top of `src/auth/routes.ts`:
```typescript
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}
```

- [ ] **Step 13.5: Run auth tests (expect PASS)**

```bash
npx jest tests/auth.test.ts --no-coverage
```

- [ ] **Step 13.6: Commit**

```bash
git add src/auth/ tests/auth.test.ts
git commit -m "feat: add WebAuthn auth routes (register/login/recover/passkeys)"
```

---

### Task 14: Rewrite server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 14.1: Read current src/server.ts**

Note what to preserve: static UI serving in production, `/api/system/metrics` endpoint, port config, DATA_DIR env handling.

- [ ] **Step 14.2: Rewrite src/server.ts**

Structure:
```typescript
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { doubleCsrf } from 'csrf-csrf';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';           // call on startup
import { initScheduler } from './scheduler/index.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './api/routes.js';

// --- Validate required env ---
if (!process.env.SESSION_SECRET) {
  console.error('[server] SESSION_SECRET env var is required');
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (IS_PROD ? 'https://croniq.local' : 'http://localhost:5173');

// --- Middleware ---
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET ?? 'dev-secret'));

app.use(session({
  secret: process.env.SESSION_SECRET ?? 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET ?? 'dev-secret',
  cookieName: '__csrf',
  cookieOptions: { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD },
  getTokenFromRequest: req => req.headers['x-csrf-token'] as string,
});

app.get('/api/csrf-token', (req, res) => res.json({ token: generateToken(req, res) }));
app.use(doubleCsrfProtection);

// --- Rate limiting ---
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

// --- Session guard for /api/* except public routes ---
const PUBLIC_PATHS = ['/api/auth/', '/api/csrf-token', '/api/health'];
app.use('/api', (req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p.replace('/api', '')))) return next();
  if (!(req.session as any).userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// --- Routes ---
app.use(authRouter);
app.use(apiRouter);

// --- System metrics (Pi-specific) ---
// ... port existing /api/system/metrics from current server.ts

// --- Health ---
app.get('/api/health', (_, res) => res.json({ ok: true }));

// --- Static UI (production) ---
if (IS_PROD) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, '..', 'ui', 'dist')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'ui', 'dist', 'index.html')));
}

// --- Start ---
initDb();
initScheduler();
app.listen(PORT, () => console.log(`✦ Croniq running on http://localhost:${PORT}`));
```

Add to `src/db.ts`:
```typescript
export function initDb(): void {
  // Already runs on module load (db.exec schema + migrate())
  // This is a no-op but provides an explicit call site
}
```

- [ ] **Step 14.3: Add session type augmentation to src/auth/routes.ts or a types file**

```typescript
// In src/server.ts or src/types/session.d.ts
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}
```

- [ ] **Step 14.4: Run full test suite to check nothing broken**

```bash
npx jest --no-coverage
```

- [ ] **Step 14.5: Commit**

```bash
git add src/server.ts
git commit -m "feat: rewrite server.ts with session, CSRF, rate-limit, and auth middleware"
```

---

## Chunk 5: API Routes Update

### Task 15: Update src/api/routes.ts

**Files:**
- Modify: `src/api/routes.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 15.1: Update Run interface in src/types/index.ts**

Replace the `Run` interface:

```typescript
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
```

- [ ] **Step 15.2: Read current src/api/routes.ts**

Note everything it currently does: jobs CRUD, runs, stats, reorder, pause/resume, run trigger, system metrics.

- [ ] **Step 15.3: Rewrite src/api/routes.ts**

Key changes:
- Import from `../db.js` (not `../db/queries.js`)
- Import `scheduleJob`, `unscheduleJob` from `../scheduler/index.js`
- Import `runJob` from `../runner.js`
- All routes already protected by session guard in server.ts — no need to add `requireSession` per-route
- Remove all `run_stages` / `getRunStages` references
- Update run response shape to use new field names (`status`, `analysis`, `contentHash`, `rawData`, `bedrockInvoked`, `inputTokens`, `outputTokens`, `startedAt`, `finishedAt`)
- Keep all existing Croniq-specific routes: `PUT /api/jobs/reorder`, `POST /api/jobs/:id/pause`, `POST /api/jobs/:id/resume`
- Keep `/api/stats` endpoint (rewritten to use new runs schema)
- Keep `/api/system/metrics` endpoint (port from current server.ts)

Stats response (from spec):
```typescript
{
  totalRuns: number;
  successRate: number;          // (complete + skipped) / total
  skippedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;     // Haiku 4.5 pricing
  avgDurationMs: number;
  recentRuns: Array<{ id, jobId, jobName, status, durationMs, startedAt }>;
}
```

- [ ] **Step 15.4: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all pass

- [ ] **Step 15.5: Start the dev server and do a quick manual check**

```bash
npm run dev:server
curl http://localhost:3001/api/health
curl http://localhost:3001/api/auth/status
```
Expected: both return JSON without errors

- [ ] **Step 15.6: Commit**

```bash
git add src/api/routes.ts src/types/index.ts
git commit -m "feat: update API routes — remove stage queries, new run schema, session-protected"
```

---

## Chunk 6: Frontend

### Task 16: Update ui/src/api.ts

**Files:**
- Modify: `ui/src/api.ts`

- [ ] **Step 16.1: Read current ui/src/api.ts**

Note all existing functions and types.

- [ ] **Step 16.2: Rewrite ui/src/api.ts**

Key changes:
1. **CSRF token:** fetch once on first non-GET request, cache in module scope
2. **`apiFetch()`:** inject `X-CSRF-Token` header on non-GET, handle 401 (redirect to /auth)
3. **Updated `Run` type:** matches new backend schema
4. **Auth API functions:** `fetchMe()`, `authRegisterOptions()`, `authRegisterVerify()`, `authLoginOptions()`, `authLoginVerify()`, `authRecover()`, `authLogout()`, `fetchPasskeys()`, `addPasskey()`, `renamePasskey()`, `deletePasskey()`, `regenerateRecoveryCode()`

```typescript
// ui/src/api.ts

let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/csrf-token', { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.token;
  return csrfToken!;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers as Record<string, string> };

  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await getCsrfToken();
  }

  const res = await fetch(path, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    csrfToken = null;
    // Only redirect if not a bootstrap auth-check (fetchMe handles 401 by returning null)
    if (!(options as { skipRedirectOn401?: boolean }).skipRedirectOn401) {
      window.location.href = '/auth';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

// Updated Run type
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

// Auth API
export interface AuthPasskey { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean }
export interface AuthUser { id: string; email: string; passkeys: AuthPasskey[] }

export async function fetchMe(): Promise<AuthUser | null> {
  // skipRedirectOn401: true — 401 means "not logged in", not an error requiring redirect
  try { return await apiFetch<AuthUser>('/api/me', { skipRedirectOn401: true } as RequestInit); }
  catch { return null; }
}

// ... auth functions, passkey management functions
// ... existing job/run API functions (updated to use new Run type)
```

- [ ] **Step 16.3: Commit**

```bash
git add ui/src/api.ts
git commit -m "feat: CSRF-aware apiFetch, updated Run type, auth API functions"
```

---

### Task 17: Update ui/src/App.tsx

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 17.1: Rewrite App.tsx**

Port `AuthContext` pattern from `webauthn-demo/client/src/App.tsx`. Adapt routing:

```typescript
// Routes:
// / → Landing (public)
// /auth → Auth page (redirects to /app if already authed)
// /app/* → existing Croniq app (protected — redirect to /auth if not authed)
```

```typescript
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { fetchMe, type AuthUser } from './api';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Nav from './components/Nav';
// existing components...

interface AuthContextValue { user: AuthUser | null; loading: boolean; refresh: () => Promise<void> }
export const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

function AppShell() {
  // Existing Croniq app (jobs list + detail) wrapped in Nav.
  // Note: AppShell is mounted at /app/* so child routes are relative: "/" = "/app", "/jobs/:id" = "/app/jobs/:id"
  // All navigate() calls within the app that previously went to "/" should now go to "/app"
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Nav />
      <Routes>
        <Route path="/" element={/* job list (was the main App view) */} />
        <Route path="/jobs/new" element={/* new job form */} />
        <Route path="/jobs/:id" element={/* job detail */} />
        <Route path="/jobs/:id/edit" element={/* edit job form */} />
      </Routes>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setUser(await fetchMe());
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-[#4ade80]">Loading…</div>;

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={user ? <Navigate to="/app" replace /> : <Auth />} />
        <Route path="/app/*" element={user ? <AppShell /> : <Navigate to="/auth" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 17.2: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat: add AuthContext, route guard (/app/* protected, /auth redirects if authed)"
```

---

### Task 18: Landing page

**Files:**
- Create: `ui/src/pages/Landing.tsx`

- [ ] **Step 18.1: Create Landing.tsx**

Port from `webauthn-demo/client/src/pages/Landing.tsx`, replacing "Pulse" branding with Croniq design system. The landing page must use the same design tokens as the rest of the app:
- **Fonts:** same Google Fonts loaded in `ui/index.html` (check the `<head>` there for the current font pair)
- **Colors:** same custom palette from `ui/tailwind.config.ts` (check the `theme.extend.colors` block)
- **Dark terminal aesthetic**: `bg-[#0a0a0a]` background, green `#4ade80` accents

Key elements per spec:
- Croniq logo/wordmark
- Tagline: "Scheduled intelligence for your Pi"
- Feature bullets (RSS, API, HTML, Browser, GraphQL)
- Single CTA → `/auth`

Consult the tailwindplus MCP server for layout patterns if needed.

- [ ] **Step 18.2: Commit**

```bash
git add ui/src/pages/Landing.tsx
git commit -m "feat: add Landing page with Croniq branding and auth CTA"
```

---

### Task 19: Auth page

**Files:**
- Create: `ui/src/pages/Auth.tsx`

- [ ] **Step 19.1: Create Auth.tsx**

Port from `webauthn-demo/client/src/pages/Auth.tsx`. Three tabs: Register, Sign in, Recover.

Use `@simplewebauthn/browser`:
```typescript
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
```

Registration flow:
1. POST `/api/auth/register/options` with email
2. `startRegistration(options)` — browser ceremony
3. POST `/api/auth/register/verify` with result
4. If response has `recoveryCode`: show modal (must acknowledge before continuing)
5. On success: call `auth.refresh()` → redirect to `/app`

Sign in flow:
1. POST `/api/auth/login/options` with email
2. `startAuthentication(options)` — browser ceremony
3. POST `/api/auth/login/verify` with result
4. On success: call `auth.refresh()` → redirect to `/app`

Recover flow:
1. POST `/api/auth/recover` with email + recoveryCode
2. On success: call `auth.refresh()` → navigate to `/app?openPasskeys=1`

**PasskeyManager auto-open mechanism:** Use a URL query param. `Auth.tsx` navigates to `/app?openPasskeys=1`. `AppShell` (in `App.tsx`) reads this on mount:
```typescript
import { useLocation, useNavigate } from 'react-router-dom';
// In AppShell:
const location = useLocation();
const navigate = useNavigate();
const [passkeyManagerOpen, setPasskeyManagerOpen] = useState(false);
useEffect(() => {
  if (new URLSearchParams(location.search).get('openPasskeys') === '1') {
    setPasskeyManagerOpen(true);
    navigate('/app', { replace: true }); // clean URL
  }
}, [location.search]);
// Pass passkeyManagerOpen + setPasskeyManagerOpen to Nav or render PasskeyManager directly in AppShell
```

On mount: GET `/api/auth/status` → if `{ hasUsers: false }`, default to Register tab; otherwise Sign in.

Apply Croniq dark terminal aesthetic.

- [ ] **Step 19.2: Commit**

```bash
git add ui/src/pages/Auth.tsx
git commit -m "feat: add Auth page (register/sign-in/recover with WebAuthn ceremonies)"
```

---

### Task 20: Nav and PasskeyManager

**Files:**
- Create: `ui/src/components/Nav.tsx`
- Create: `ui/src/components/PasskeyManager.tsx`

- [ ] **Step 20.1: Create Nav.tsx**

Port from `webauthn-demo/client/src/components/Nav.tsx`. Croniq branding.

Left: Croniq logo. Right: user email with dropdown.
Dropdown items: "Manage passkeys" (opens PasskeyManager modal), "Sign out" (POST `/api/auth/logout` → `auth.refresh()` → navigate to `/`).

- [ ] **Step 20.2: Create PasskeyManager.tsx**

Modal component. Actions per spec:
- List passkeys: label, created at, last used
- Inline rename: click label → edit input → save on blur/Enter (PATCH `/api/passkeys/:id`)
- Delete button (disabled if only one passkey; confirmation dialog before DELETE `/api/passkeys/:id`)
- **Add another passkey:** POST `/api/passkeys` → browser ceremony → refresh list
- **Regenerate recovery code:** POST `/api/passkeys/recovery-code/regenerate` → show code in modal with copy button → user must click "I have saved this code" to dismiss

Apply Croniq dark terminal aesthetic. Use `Modal` from `ui/src/components/ui.tsx` as the container.

- [ ] **Step 20.3: Commit**

```bash
git add ui/src/components/Nav.tsx ui/src/components/PasskeyManager.tsx
git commit -m "feat: add Nav with user dropdown and PasskeyManager modal"
```

---

### Task 21: Update JobDetail

**Files:**
- Modify: `ui/src/components/JobDetail.tsx`

- [ ] **Step 21.1: Read current JobDetail.tsx**

Note where `getRunStages`, `StagePanel`, `run.outcome`, `run.result`, `run.resultHash` are used.

- [ ] **Step 21.2: Update JobDetail.tsx**

Remove:
- `getRunStages()` call and `StagePanel` component rendering
- References to `run.outcome`, `run.result`, `run.resultHash`

Add:
- `run.status` badge (use existing `Badge` from `ui.tsx` — map `complete`→green, `error`→red, `skipped`→yellow, `collecting`/`analyzing`→blue, `pending`→gray)
- `run.analysis` rendered as markdown using `react-markdown` with `remark-gfm` — both are already installed in `ui/package.json` (v9.0.1 / v4.x). Import: `import ReactMarkdown from 'react-markdown'; import remarkGfm from 'remark-gfm';`
- `run.rawData` shown as collapsible JSON (expandable pre block)
- Token usage: `run.inputTokens`, `run.outputTokens`, `run.bedrockInvoked`
- Timing: `run.durationMs`, `run.startedAt`, `run.finishedAt`

- [ ] **Step 21.3: Commit**

```bash
git add ui/src/components/JobDetail.tsx
git commit -m "feat: update JobDetail — remove stage panels, show analysis + rawData + token usage"
```

---

## Chunk 7: Cleanup and Wiring

### Task 22: Delete old files, run full build

**Files:**
- Delete: `src/agents/` (entire directory)
- Delete: `src/jobs/scheduler.ts`, `src/jobs/runner.ts`
- Delete: `src/db/index.ts`, `src/db/queries.ts`
- (Optional) Delete `src/db/` directory if empty after above

- [ ] **Step 22.1: Delete old LangChain and DB files**

```bash
rm -rf src/agents src/jobs src/db
```

Verify no remaining imports reference these paths:
```bash
grep -r "from.*agents/" src/ ui/src/
grep -r "from.*jobs/" src/
grep -r "from.*db/index" src/
grep -r "from.*db/queries" src/
```
Expected: no matches

- [ ] **Step 22.2: Update scripts/seed.ts and scripts/export.ts**

These import from `../src/db/queries`. Update to import from `../src/db`.

- [ ] **Step 22.3: Run TypeScript build**

```bash
npm run build 2>&1 | head -50
```
Fix any type errors. Common issues:
- Import paths need `.js` extensions for Node16 module resolution
- `session.userId` needs type assertion — use `(req.session as any).userId` or proper augmentation
- `better-sqlite3` `.get()` / `.all()` return `unknown` — add type assertions

- [ ] **Step 22.4: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all pass

- [ ] **Step 22.5: Smoke test the dev server**

```bash
npm run dev:server &
sleep 3
curl http://localhost:3001/api/health
curl http://localhost:3001/api/auth/status
curl -c /tmp/cookies.txt http://localhost:3001/api/csrf-token
# Should get 401 for protected routes without session
curl -b /tmp/cookies.txt http://localhost:3001/api/jobs
kill %1
```
Expected: health → `{ok:true}`, auth/status → `{hasUsers:false}`, jobs → 401

- [ ] **Step 22.6: Final commit**

```bash
git add -A
git commit -m "feat: complete WebAuthn migration — remove LangChain, add auth, direct collectors"
```

---

## Environment Variables (updated)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Prod only | `dev-secret` | Session + CSRF secret |
| `RP_ID` | No | `localhost` | WebAuthn Relying Party ID (set to Pi hostname in prod) |
| `ORIGIN` | No | `http://localhost:5173` | WebAuthn expected origin |
| `BEDROCK_MODEL_ID` | No | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Bedrock model |
| `AWS_REGION` | No | `us-east-1` | Bedrock region |
| `PORT` | No | `3001` | HTTP port |
| `NODE_ENV` | No | — | `production` enables secure cookies |
| `CORS_ORIGIN` | No | `http://localhost:5173` | CORS origin |
| `DATA_DIR` | No | `./data` | SQLite directory |

For Pi production, add to `.env` or PM2 ecosystem:
```
SESSION_SECRET=<32+ random bytes>
RP_ID=croniq.local
ORIGIN=http://croniq.local
NODE_ENV=production
```

---

## Quick Reference: Demo → Croniq Mapping

| webauthn-demo location | Croniq target | Notes |
|------------------------|---------------|-------|
| `server/src/app.ts` (auth section) | `src/auth/routes.ts` | bcrypt not sha256; no step-up |
| `server/src/app.ts` (jobs/runs) | `src/api/routes.ts` | No user_id on jobs |
| `server/src/db.ts` | `src/db.ts` | Keep all existing Croniq jobs columns |
| `server/src/collectors/api.ts` | `src/collectors/api.ts` | Direct port |
| `server/src/collectors/rss.ts` | `src/collectors/rss.ts` | Direct port |
| `server/src/collectors/html.ts` | `src/collectors/html.ts` | Direct port |
| `server/src/collectors/types.ts` | `src/collectors/types.ts` | Direct port |
| `server/src/collectors/index.ts` | `src/collectors/index.ts` | Direct port |
| *(missing)* | `src/collectors/browser.ts` | Port from old `src/agents/tools/browser-scrape.ts` |
| *(missing)* | `src/collectors/graphql.ts` | Port from old `src/agents/tools/graphql-fetch.ts` |
| `server/src/bedrock/client.ts` | `src/bedrock/client.ts` | Direct port |
| `server/src/scheduler/index.ts` | `src/scheduler/index.ts` | Export `createJobCallback` for testing |
| `client/src/App.tsx` | `ui/src/App.tsx` | Routes: `/`, `/auth`, `/app/*` |
| `client/src/pages/Landing.tsx` | `ui/src/pages/Landing.tsx` | Croniq branding |
| `client/src/pages/Auth.tsx` | `ui/src/pages/Auth.tsx` | Add `/api/auth/status` check |
| `client/src/components/Nav.tsx` | `ui/src/components/Nav.tsx` | Croniq branding |
| *(missing)* | `ui/src/components/PasskeyManager.tsx` | Per spec |
