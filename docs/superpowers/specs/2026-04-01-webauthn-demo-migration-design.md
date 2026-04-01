# Croniq — webauthn-demo Architecture Migration

**Date:** 2026-04-01
**Status:** Approved for implementation

## Overview

Migrate Croniq from its current LangChain-agent-based architecture to the simpler, more predictable architecture used in the webauthn-demo project. This covers:

1. **Auth system** — WebAuthn passkeys, express-session, CSRF, recovery codes, audit log
2. **Collectors** — Replace LangChain `createReactAgent` with direct TypeScript collector modules
3. **Bedrock client** — Direct `ConverseCommand` instead of LangChain wrappers
4. **Pipeline** — collect → hash → analyze (skip Bedrock if unchanged)
5. **Scheduler** — reload-before-execute pattern
6. **Frontend** — Landing page, Auth page, PasskeyManager, CSRF-aware API client

LangChain packages are removed entirely. The existing Croniq visual design system (dark terminal aesthetic, Tailwind, fonts) is preserved throughout.

---

## Source Structure

The new layout mirrors the webauthn-demo. Files are reorganized, not just refactored in place.

### Backend (`src/`)

```
src/
├── server.ts              # Express app: CORS, session, CSRF, rate-limit, routes
├── db.ts                  # SQLite schema, migrations, all prepared statements
├── auth/
│   └── routes.ts          # WebAuthn register/login/recover/passkey management
├── collectors/
│   ├── index.ts           # Orchestrator — Promise.allSettled over sources
│   ├── types.ts           # SourceConfig discriminated union + CollectorResult
│   ├── rss.ts             # rss-parser, 15s timeout, maxItems cap
│   ├── api.ts             # native fetch, dot-path extraction, custom headers
│   ├── html.ts            # cheerio CSS selectors, transforms, multi-select
│   ├── browser.ts         # Playwright, same interface as html.ts + clickBefore/scrollToBottom
│   └── graphql.ts         # native fetch POST, variables support
├── bedrock/
│   └── client.ts          # ConverseCommand, returns { analysis, inputTokens, outputTokens }
├── scheduler/
│   └── index.ts           # Map<jobId, ScheduledTask>, reload-before-execute
├── runner.ts              # Pipeline: collect → hash → analyze
└── api/
    └── routes.ts          # Jobs + runs CRUD + /api/stats
```

**Removed:** `src/agents/`, `src/jobs/runner.ts`, `src/jobs/scheduler.ts`, `src/db/queries.ts` (merged into `db.ts`)
**Removed packages:** `@langchain/core`, `@langchain/langgraph`, `@langchain/aws`

### Frontend (`ui/src/`)

```
ui/src/
├── main.tsx
├── App.tsx                # AuthContext, routing (/ · /auth · /app/*)
├── api.ts                 # CSRF-aware apiFetch(), authApi, api object, updated Run type
├── pages/
│   ├── Landing.tsx        # Public landing page — Croniq dark aesthetic
│   └── Auth.tsx           # Register / Sign in / Recover tabs
└── components/
    ├── Nav.tsx            # Top nav + user menu (passkeys, sign out)
    ├── PasskeyManager.tsx # Modal: list, rename, delete, add passkey, regenerate recovery code
    ├── JobForm.tsx        # Unchanged
    ├── JobDetail.tsx      # Updated: removes stage fetch, reads analysis from run directly
    └── ui.tsx             # Unchanged shared components
```

**Navigation structure:** Option A — auth pages added, existing job list/detail app kept intact behind auth guard.

`JobDetail.tsx` is updated (not preserved unchanged): the `GET /api/jobs/:id/runs/:runId/stages` call and `StagePanel` rendering are removed. The run's `analysis` field (markdown) and `raw_data` (JSON) replace per-stage display.

---

## Database Schema

### New tables

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- crypto.randomUUID()
  email TEXT UNIQUE NOT NULL,
  -- BLOB: raw random bytes (e.g. crypto.getRandomValues(new Uint8Array(16))), stored as Buffer in better-sqlite3.
  -- Passed directly to generateRegistrationOptions as Uint8Array. Never exposed to client.
  webauthn_user_id BLOB NOT NULL,
  recovery_code_hash TEXT,           -- bcrypt hash of plaintext recovery code
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,               -- base64url credential ID from WebAuthn
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,          -- raw bytes from verifyRegistrationResponse
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,                  -- 'platform' | 'cross-platform'
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                   -- JSON array e.g. '["internal"]'
  label TEXT,                        -- user-editable display name
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- challenges.user_id is NOT NULL: the user row is created speculatively at /register/options time
-- (before the ceremony completes), so a real user_id is always available when the challenge is stored.
-- If /register/verify fails, the orphaned user row is cleaned up.
CREATE TABLE challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  event TEXT NOT NULL CHECK(event IN (
    'registered','logged_in','passkey_added','passkey_renamed',
    'passkey_deleted','recovery_code_regenerated','recovered'
  )),
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified table: `runs`

The `run_stages` table is removed. Token counts, timing, and status progression are consolidated onto a single `runs` row.

The migration recreates the `runs` table (safe on all SQLite versions, including pre-3.25) rather than using `ALTER TABLE ... RENAME COLUMN`. See Migration Notes for the step-by-step SQL.

**New `runs` schema:**

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','collecting','analyzing','complete','error','skipped')),
  content_hash TEXT,
  raw_data TEXT,                     -- JSON: CollectorResult[]
  analysis TEXT,                     -- markdown report from Bedrock
  bedrock_invoked INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  changed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
```

**Status values:**
- `pending` — created, not yet started
- `collecting` — collector running
- `analyzing` — Bedrock call in progress
- `complete` — finished successfully, Bedrock was invoked
- `skipped` — finished successfully, content unchanged so Bedrock was skipped
- `error` — run failed (collection fatal error, Bedrock error, or timeout)

### Unchanged: `jobs`

No changes to the `jobs` table schema.

---

## Auth System

### Middleware stack (server.ts)

Applied in this order:

```
cors({ origin: CORS_ORIGIN, credentials: true })
  — dev default: 'http://localhost:5173'; prod: 'https://croniq.local'; override via CORS_ORIGIN env
express.json({ limit: '1mb' })
cookieParser()
express-session({ secret: SESSION_SECRET, httpOnly: true, sameSite: 'lax', maxAge: 30d })
  — secure: true only when NODE_ENV === 'production'
doubleCsrfProtection (csrf-csrf)
  — applied to all state-mutating routes; GET /api/csrf-token is unprotected
express-rate-limit (global: 200 req/15min)
express-rate-limit (auth routes: 10 req/min — applied only to /api/auth/*)
requireSession middleware — rejects 401 for /api/* except: /api/auth/*, /api/csrf-token, /api/health
```

### Auth routes (`src/auth/routes.ts`)

| Method | Path | Auth required | Description |
|--------|------|---------------|-------------|
| POST | /api/auth/register/options | No | Generate WebAuthn registration options + store challenge (user_id: null) |
| POST | /api/auth/register/verify | No | Verify attestation, create user + passkey, issue recovery code, create session |
| POST | /api/auth/login/options | No | Generate WebAuthn authentication options |
| POST | /api/auth/login/verify | No | Verify assertion, update counter, create session |
| POST | /api/auth/recover | No | Verify email + recovery code (bcrypt), create session, issue new recovery code |
| POST | /api/auth/logout | Yes | Destroy session |
| GET | /api/auth/status | No | Returns `{ hasUsers: boolean }` — used by Auth page to show Register tab by default when no users exist |
| GET | /api/me | Yes | Return `{ id, email, passkeys: Array<{ id, label, createdAt, lastUsedAt, deviceType, backedUp }> }` |
| GET | /api/csrf-token | No | Return CSRF token |
| GET | /api/passkeys | Yes | List passkeys for current user (same data as `/api/me` passkeys array — convenience endpoint for PasskeyManager) |
| POST | /api/passkeys | Yes | Add a new passkey (authenticated user; runs register ceremony, no email step) |
| PATCH | /api/passkeys/:id | Yes | Rename passkey (update label) |
| DELETE | /api/passkeys/:id | Yes | Delete passkey (rejected if only one remains) |
| POST | /api/passkeys/recovery-code/regenerate | Yes | Generate + store new recovery code, return plaintext once |

### Registration flow

1. Client POSTs email → server creates `users` row speculatively (random `id`, random `webauthn_user_id` BLOB) → generates WebAuthn options, stores challenge with `user_id` pointing to the new user (5-min TTL)
2. Browser ceremony (Touch ID / Face ID / security key)
3. Server verifies attestation at `/register/verify` → creates `passkeys` row linked to existing user; if verification fails, the orphaned `users` row is deleted
4. Recovery code (32 random bytes → base64url) generated, bcrypt-hashed, stored in `users.recovery_code_hash`; plaintext returned once to client
5. Session created → client redirected to `/app`
6. Audit event: `registered`

### Authentication flow

1. Client POSTs email → server looks up user's passkeys, generates auth options (`allowCredentials` populated)
2. Browser ceremony
3. Server verifies assertion → updates `passkeys.counter` + `last_used_at`
4. Session created
5. Audit event: `logged_in`

### Add passkey flow (authenticated user)

1. Client calls `POST /api/passkeys` (session required) → server generates registration options using existing `user.webauthn_user_id`, stores challenge with `user_id` populated
2. Browser ceremony (no email input — identity comes from session)
3. Server verifies → creates new `passkeys` row linked to existing user
4. Audit event: `passkey_added`

### Recovery flow

1. Client POSTs email + recovery code
2. Server looks up user by email, verifies bcrypt hash
3. Session created, new recovery code generated and returned once (old hash overwritten)
4. Audit event: `recovered`; client is shown a prompt to immediately add a new passkey

### Session configuration

- **Store:** In-memory (sufficient for single-user Pi; survives normal use, lost on server restart which forces re-login)
- **Secret:** `SESSION_SECRET` env var — server exits on startup if not set
- **MaxAge:** 30 days
- **Secure:** Only when `NODE_ENV=production`

---

## Collectors

### Interface

Each collector exports a single async function:

```typescript
async function collectX(config: XSourceConfig, name?: string): Promise<CollectorResult>

interface CollectorResult {
  source: string;       // source name (from SourceEntry.name or config.url)
  data: unknown;        // collected payload
  error?: string;       // present only on failure; data is null when error is set
}
```

### Orchestrator (`src/collectors/index.ts`)

```typescript
async function collectSources(sources: SourceEntry[]): Promise<CollectorResult[]>
```

Dispatches to the correct collector by `config.type` using a switch. Wraps all calls in `Promise.allSettled()` — a single source failure returns an error result for that source without failing the whole run. Fulfilled results pass through directly; rejected promises (unexpected throws) are caught and converted to error results.

### Collector details

| Module | Key behavior |
|--------|-------------|
| `rss.ts` | rss-parser, 15s timeout, `maxItems` cap (default 20) |
| `api.ts` | native fetch, GET/POST, custom headers, dot-path extraction via `extract` field |
| `html.ts` | cheerio, CSS selectors, `multiple` mode, transforms (trim, number, lowercase, uppercase), `attribute` extraction |
| `browser.ts` | Playwright/Chromium, same selector interface as `html.ts`; supports `waitFor` (wait for selector), `clickBefore` (array of selectors to click before scraping), `scrollToBottom` (scroll before collecting) |
| `graphql.ts` | native fetch POST to GraphQL endpoint, `variables` support, `extract` for response drilling |

### Source config types

```typescript
interface SelectorSpec {
  selector: string;
  attribute?: string;         // extract attr value instead of text
  multiple?: boolean;         // return array
  transform?: 'trim' | 'number' | 'lowercase' | 'uppercase';
}

type SourceConfig =
  | { type: 'rss';      url: string; maxItems?: number }
  | { type: 'api';      url: string; method?: 'GET'|'POST'; headers?: Record<string,string>; body?: unknown; extract?: string }
  | { type: 'html';     url: string; selectors: Record<string, SelectorSpec>; headers?: Record<string,string> }
  | { type: 'browser';  url: string; selectors: Record<string, SelectorSpec>; waitFor?: string; clickBefore?: string[]; scrollToBottom?: boolean }
  | { type: 'graphql';  url: string; query: string; variables?: Record<string,unknown>; headers?: Record<string,string>; extract?: string }
```

---

## Bedrock Client (`src/bedrock/client.ts`)

Direct `@aws-sdk/client-bedrock-runtime` `ConverseCommand`. No LangChain.

```typescript
async function analyzeWithBedrock(
  rawData: string,
  jobPrompt: string,
  jobName: string,
): Promise<{ analysis: string; inputTokens: number; outputTokens: number }>
```

- **Model:** `us.anthropic.claude-haiku-4-5-20251001-v1:0` (configurable via `BEDROCK_MODEL_ID` env)
- **Temperature:** 0.3
- **Max tokens:** 4096
- **System prompt:** Markdown report writer. `jobName` is injected into the system prompt as context: `"You are writing a scheduled intelligence report for the job: ${jobName}. Write a concise markdown report..."`. `jobPrompt` is appended to the user message as additional instructions.
- **Region:** `AWS_REGION` env var (default `us-east-1`)

---

## Pipeline (`src/runner.ts`)

```
createRun(jobId) → status: pending
  ↓
setRunStatus(runId, 'collecting')
collectSources(job.sources) → CollectorResult[]
  ↓
SHA-256 hash of JSON.stringify(results) → contentHash
  ↓
if contentHash === previousRun.content_hash && previousRun.status === 'complete':
  completeRun(runId, 'skipped', contentHash, rawData, previousRun.analysis, false, 0, 0, duration, null)
  return
  ↓
setRunStatus(runId, 'analyzing')
analyzeWithBedrock(rawData, job.jobPrompt, job.name)
  ↓
completeRun(runId, 'complete', contentHash, rawData, analysis, true, inputTokens, outputTokens, duration, null)
  ↓
if job.webhookUrl && changed: fireWebhook() (fire-and-forget)
```

**`changed` flag:**
- `complete` runs: `changed = previousRun?.content_hash !== contentHash` — `true` on first run (no previous) and when hash differs
- `skipped` runs: always `changed = false` (by definition — skip only occurs when hashes match)
- `error` runs: always `changed = false`

Stored on the run row; drives webhook firing (only fire when `changed = true`).

**Error handling:**
- Collector errors stored per-source in `raw_data` — partial results are valid; run can still proceed to analysis
- All collectors erroring → run status = `error`, error stored, no Bedrock call
- Bedrock failure → status = `error`, error stored, job.status set to `error` on persistent failures
- Timeout → status = `error`, does NOT set job.status to `error` (transient)

**Note:** The status value `error` is used consistently throughout (not `failed`). This matches the CHECK constraint in the schema.

---

## Scheduler (`src/scheduler/index.ts`)

```typescript
const activeTasks = new Map<string, ScheduledTask>();

function scheduleJob(job: DbJob): void
function unscheduleJob(jobId: string): void
function initScheduler(): void   // called on server start, loads all active jobs
```

**Reload-before-execute:** The cron callback calls `getJobById(job.id)` before running. If the job has been paused or deleted, it unschedules itself and returns without executing.

---

## Stats Endpoint (`GET /api/stats`)

The existing `/api/stats` endpoint is rewritten to query the new `runs` table directly. `run_stages` is gone.

**Response shape:**

```typescript
{
  totalRuns: number;
  successRate: number;         // (complete + skipped) / total
  skippedRuns: number;         // runs where Bedrock was skipped (cost optimization)
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;    // (inputTokens * $0.00025 + outputTokens * $0.00125) / 1000
  avgDurationMs: number;
  recentRuns: Array<{          // last 10 runs across all jobs
    id: string; jobId: string; jobName: string;
    status: string; durationMs: number; startedAt: string;
  }>;
}
```

Token pricing constants are for Claude Haiku 4.5. Cost estimation is approximate and clearly labeled as such in the UI.

---

## Frontend

### Routing

| Path | Component | Auth required |
|------|-----------|---------------|
| `/` | `Landing.tsx` | No |
| `/auth` | `Auth.tsx` | No (redirects to /app if already authed) |
| `/app/*` | Existing Croniq app | Yes (redirects to /auth if not authed) |

### AuthContext (`App.tsx`)

```typescript
interface AuthPasskey { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; deviceType: string | null; backedUp: boolean }
interface AuthUser { id: string; email: string; passkeys: AuthPasskey[] }
interface AuthContextValue { user: AuthUser | null; loading: boolean; refresh: () => Promise<void> }
```

On mount: `GET /api/me`. If 401, user = null. Loading state prevents flash of unauthenticated content.

### `apiFetch()` and updated types (`api.ts`)

Replaces current `request()` / `apiFetch()` helpers. Fetches CSRF token once via `GET /api/csrf-token` (cached in module scope), injects `X-CSRF-Token` header on all non-GET requests. On 401, clears auth state and redirects to `/auth`.

**Updated `Run` interface** (breaking change — field names change to match new schema):

```typescript
interface Run {
  id: string;
  jobId: string;
  status: 'pending' | 'collecting' | 'analyzing' | 'complete' | 'error' | 'skipped';
  contentHash?: string;
  rawData?: unknown;        // CollectorResult[] — shown in detail view
  analysis?: string;        // markdown — replaces result
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

All callers of the old `run.outcome`, `run.result`, `run.resultHash` fields must be updated.

### `JobDetail.tsx` (updated)

The `getRunStages()` call and `StagePanel` component rendering are removed. The run detail view is updated to display:
- `run.status` badge (replacing `run.outcome`)
- `run.analysis` rendered as markdown (replacing `run.result`)
- `run.rawData` shown as collapsible JSON (replacing per-stage output)
- `run.inputTokens` + `run.outputTokens` + `run.bedrockInvoked` replacing per-stage token display

### Landing page (`pages/Landing.tsx`)

Croniq's dark terminal aesthetic. Logo, tagline, feature bullets (RSS, API, HTML, Browser, GraphQL), single CTA → `/auth`.

### Auth page (`pages/Auth.tsx`)

Three tabs: **Register**, **Sign in**, **Recover**.

- **Register:** Email input → `POST /api/auth/register/options` → browser ceremony → success shows recovery code modal (one-time display, user must acknowledge before continuing)
- **Sign in:** Email input → `POST /api/auth/login/options` → browser ceremony → redirect to `/app`
- **Recover:** Email + recovery code inputs → `POST /api/auth/recover` → on success, redirect to `/app` and immediately open PasskeyManager to add a new passkey

### Nav (`components/Nav.tsx`)

Top bar: Croniq logo (left), user email with dropdown (right). Dropdown: **Manage passkeys** (opens PasskeyManager modal), **Sign out**.

### PasskeyManager (`components/PasskeyManager.tsx`)

Modal in Croniq's dark style. Actions:

- List all passkeys: label, creation date, last used date
- Inline rename: click label to edit, save on blur/Enter
- Delete button (disabled when only one passkey remains; confirmation required)
- **Add another passkey:** calls `POST /api/passkeys` (no email input needed — authed user); triggers browser ceremony; on success, list refreshes
- **Regenerate recovery code:** calls `POST /api/passkeys/recovery-code/regenerate`; shows new code in modal with copy button and explicit "I have saved this code" acknowledgement before dismissing. Button label is "Regenerate recovery code" (not "View") to make clear the action is destructive to the old code.

---

## Dependencies

### Added

```json
{
  "dependencies": {
    "@simplewebauthn/server": "^13",
    "cookie-parser": "^1",
    "express-session": "^1",
    "csrf-csrf": "^3",
    "express-rate-limit": "^7",
    "bcrypt": "^5"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1",
    "@types/express-session": "^1",
    "@types/bcrypt": "^5"
  }
}
```

```json
// ui/package.json
{
  "dependencies": {
    "@simplewebauthn/browser": "^13"
  }
}
```

### Removed

```
@langchain/core
@langchain/langgraph
@langchain/aws
langchain
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | **Yes** | express-session secret — server exits on startup if missing |
| `BEDROCK_MODEL_ID` | No | Override Haiku model ID (default: `us.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| `AWS_REGION` | No | Bedrock region (default: `us-east-1`) |
| `PORT` | No | HTTP port (default: `3001`) |
| `NODE_ENV` | No | `production` enables secure cookies + `https://croniq.local` CORS |
| `CORS_ORIGIN` | No | Override CORS origin (dev default: `http://localhost:5173`) |

---

## Migration Notes

### `runs` table (recreate pattern — safe on all SQLite versions)

SQLite pre-3.25 does not support `ALTER TABLE ... RENAME COLUMN`. The migration must recreate the table. Performed inside a transaction in `db.ts` `migrate()`:

```sql
-- 1. Create new runs table
CREATE TABLE runs_new (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
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

-- 2. Copy existing runs (map old column names to new)
--    'result' was double-JSON-stringified; copy as-is into 'analysis' (clients must handle both)
INSERT INTO runs_new
  SELECT
    id,
    job_id,
    CASE outcome
      WHEN 'success' THEN 'complete'
      WHEN 'failure' THEN 'error'
      WHEN 'timeout' THEN 'error'
      ELSE 'complete'
    END AS status,
    result_hash AS content_hash,
    NULL AS raw_data,
    result AS analysis,   -- kept as-is; may be double-stringified for pre-migration rows
    0 AS bedrock_invoked,
    0 AS input_tokens,
    0 AS output_tokens,
    error,
    changed,
    duration_ms,
    started_at,
    finished_at
  FROM runs;

-- 3. Swap tables
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

-- 4. Drop run_stages
DROP TABLE IF EXISTS run_stages;
```

### Auth tables

New tables (`users`, `passkeys`, `challenges`, `audit_log`) are created with `CREATE TABLE IF NOT EXISTS` — safe to run on an existing DB.

### `jobs` table

No migration needed.

### First-run experience

After deployment, the DB has no users. The Auth page calls `GET /api/auth/status` (unauthenticated) which returns `{ hasUsers: false }` when no users exist; the page defaults to the Register tab. The first user to visit registers and becomes the sole owner.

---

## Testing

- **Auth routes:** supertest integration tests for each flow — register, login, recover, add/rename/delete passkey, regenerate recovery code
- **Collectors:** unit tests per module with mocked network responses (nock)
- **Pipeline:** unit tests for hash-skip path, all-collectors-error path, Bedrock failure path
- **Scheduler:** unit test reload-before-execute by mocking `getJobById` to return a paused job mid-cycle
- **Migration:** test that the `runs` recreate migration preserves row count and maps `outcome` values correctly
