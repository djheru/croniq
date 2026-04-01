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
├── server.ts              # Express app: session, CSRF, rate-limit, routes
├── db.ts                  # SQLite schema, migrations, all prepared statements
├── auth/
│   └── routes.ts          # WebAuthn register/login/recover/passkey management
├── collectors/
│   ├── index.ts           # Orchestrator — Promise.allSettled over sources
│   ├── types.ts           # SourceConfig discriminated union + CollectorResult
│   ├── rss.ts             # rss-parser, 15s timeout, maxItems cap
│   ├── api.ts             # native fetch, dot-path extraction, custom headers
│   ├── html.ts            # cheerio CSS selectors, transforms, multi-select
│   ├── browser.ts         # Playwright, same interface as html.ts
│   └── graphql.ts         # native fetch POST, variables support
├── bedrock/
│   └── client.ts          # ConverseCommand, returns { analysis, inputTokens, outputTokens }
├── scheduler/
│   └── index.ts           # Map<jobId, ScheduledTask>, reload-before-execute
├── runner.ts              # Pipeline: collect → hash → analyze
└── api/
    └── routes.ts          # Jobs + runs CRUD (unchanged logic)
```

**Removed:** `src/agents/`, `src/jobs/runner.ts`, `src/jobs/scheduler.ts`, `src/db/queries.ts` (merged into `db.ts`)
**Removed packages:** `@langchain/core`, `@langchain/langgraph`, `@langchain/aws`

### Frontend (`ui/src/`)

```
ui/src/
├── main.tsx
├── App.tsx                # AuthContext, routing (/ · /auth · /app/*)
├── api.ts                 # CSRF-aware apiFetch(), authApi, api object
├── pages/
│   ├── Landing.tsx        # Public landing page — Croniq dark aesthetic
│   └── Auth.tsx           # Register / Sign in / Recover tabs
└── components/
    ├── Nav.tsx            # Top nav + user menu (passkeys, sign out)
    ├── PasskeyManager.tsx # Modal: list, rename, delete, add passkey
    └── ui.tsx             # Existing shared components (unchanged)
```

**Existing components preserved:** `JobForm.tsx`, `JobDetail.tsx`, `ui.tsx`
**Navigation structure:** Option A — auth pages added, existing job list/detail app kept intact behind auth guard

---

## Database Schema

### New tables

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  recovery_code_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,          -- JSON array
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  purpose TEXT NOT NULL,    -- 'registration' | 'authentication'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  event TEXT NOT NULL,      -- 'registered' | 'logged_in' | 'passkey_deleted' | 'recovered' | 'passkey_added' | 'passkey_renamed'
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified table: `runs`

The `run_stages` table is removed. Token counts, timing, and status progression are consolidated onto a single `runs` row.

```sql
-- runs table gets these new/changed columns:
status TEXT NOT NULL DEFAULT 'pending',  -- pending | collecting | analyzing | complete | failed | skipped
content_hash TEXT,
raw_data TEXT,       -- JSON: CollectorResult[]
analysis TEXT,       -- markdown report from Bedrock
bedrock_invoked INTEGER NOT NULL DEFAULT 0,
input_tokens INTEGER NOT NULL DEFAULT 0,
output_tokens INTEGER NOT NULL DEFAULT 0,
-- existing: id, job_id, started_at, finished_at, duration_ms, error, changed
-- removed: outcome (replaced by status), result (renamed to analysis), result_hash (renamed to content_hash)
```

### Unchanged: `jobs`

No changes to the `jobs` table schema.

---

## Auth System

### Middleware stack (server.ts)

```
cookieParser()
express-session({ secret: SESSION_SECRET, httpOnly, sameSite: lax, 30-day maxAge })
doubleCsrfProtection (csrf-csrf)
express-rate-limit — global: 200/15min, auth routes: 10/min
requireSession middleware — protects /api/* except auth + csrf-token endpoints
```

### Auth routes (`src/auth/routes.ts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register/options | Generate WebAuthn registration options + store challenge |
| POST | /api/auth/register/verify | Verify attestation, create user + passkey, issue recovery code, create session |
| POST | /api/auth/login/options | Generate WebAuthn authentication options |
| POST | /api/auth/login/verify | Verify assertion, update counter, create session |
| POST | /api/auth/recover | Verify email + recovery code (bcrypt), create session, issue new recovery code |
| POST | /api/auth/logout | Destroy session |
| GET | /api/me | Return current user (email, passkey count) |
| GET | /api/csrf-token | Return CSRF token for frontend |
| PATCH | /api/passkeys/:id | Rename passkey (label) |
| DELETE | /api/passkeys/:id | Delete passkey (must keep ≥1) |

### Registration flow

1. Client POSTs email → server generates WebAuthn options, stores challenge (5-min TTL)
2. Browser ceremony (Touch ID / Face ID / security key)
3. Server verifies attestation → creates `users` + `passkeys` rows
4. Recovery code generated, bcrypt-hashed, stored in `users.recovery_code_hash`; plaintext returned once to client
5. Session created → client redirected to app
6. Audit event: `registered`

### Authentication flow

1. Client POSTs email → server generates auth options (allowCredentials from DB)
2. Browser ceremony
3. Server verifies assertion → updates `passkeys.counter` + `last_used_at`
4. Session created
5. Audit event: `logged_in`

### Recovery flow

1. Client POSTs email + recovery code
2. Server verifies bcrypt hash against `users.recovery_code_hash`
3. Session created, new recovery code issued and returned once
4. User prompted immediately to register a new passkey
5. Audit event: `recovered`

### Session configuration

- **Store:** In-memory (sufficient for single-user Pi)
- **Secret:** `SESSION_SECRET` env var (required, server refuses to start without it)
- **MaxAge:** 30 days (Pi is always-on)
- **Secure:** Only in production (`NODE_ENV=production`)

---

## Collectors

### Interface

Each collector exports a single async function with this shape:

```typescript
async function collectX(config: XSourceConfig, name?: string): Promise<CollectorResult>

interface CollectorResult {
  source: string;       // source name
  data: unknown;        // collected payload
  error?: string;       // present only on failure
}
```

### Orchestrator (`src/collectors/index.ts`)

```typescript
async function collectSources(sources: SourceEntry[]): Promise<CollectorResult[]>
```

Dispatches to the correct collector by `config.type` using a switch. Wraps all calls in `Promise.allSettled()` — a single source failure returns an error result for that source without failing the whole run.

### Collector details

| Module | Key behavior |
|--------|-------------|
| `rss.ts` | rss-parser, 15s timeout, `maxItems` cap (default 20) |
| `api.ts` | native fetch, GET/POST, custom headers, dot-path extraction via `extract` field |
| `html.ts` | cheerio, CSS selectors, `multiple` mode, transforms (trim, number, lowercase, uppercase), `attribute` extraction |
| `browser.ts` | Playwright/Chromium, same selector interface as `html.ts`, `waitFor` selector support |
| `graphql.ts` | native fetch POST to GraphQL endpoint, `variables` support, `extract` for response drilling |

### Source config types

```typescript
type SourceConfig =
  | { type: 'rss';      url: string; maxItems?: number }
  | { type: 'api';      url: string; method?: 'GET'|'POST'; headers?: Record<string,string>; body?: unknown; extract?: string }
  | { type: 'html';     url: string; selectors: Record<string, SelectorSpec>; headers?: Record<string,string> }
  | { type: 'browser';  url: string; selectors: Record<string, SelectorSpec>; waitFor?: string }
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
- **Temperature:** 0.3 (factual, consistent)
- **Max tokens:** 4096
- **System prompt:** Markdown report writer — same intent as Croniq's existing editor prompt
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

**Error handling:**
- Collection errors stored per-source in `raw_data` — partial results are valid
- Bedrock failure → `failed` status, error stored, job.status set to `error` on persistent failures
- Timeout → `failed` status, does NOT set job.status to error (transient)

---

## Scheduler (`src/scheduler/index.ts`)

```typescript
const activeTasks = new Map<string, ScheduledTask>();

function scheduleJob(job: DbJob): void
function unscheduleJob(jobId: string): void
function initScheduler(): void   // called on server start, loads all active jobs
```

**Reload-before-execute pattern:** The cron callback calls `getJobById(job.id)` before running. If the job has been paused or deleted since scheduling, it unschedules itself and returns. This means UI edits take effect on the next cron tick without a server restart.

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
interface AuthUser { email: string; passkeyCount: number }
interface AuthContextValue { user: AuthUser | null; loading: boolean; refresh: () => Promise<void> }
```

On mount: `GET /api/me`. If 401, user = null. Unauthenticated routes render normally; `/app/*` redirects to `/auth`.

### `apiFetch()` (`api.ts`)

Replaces the current `request()` helper. Fetches CSRF token on first call (cached), injects `X-CSRF-Token` header on all mutating requests. On 401 response, redirects to `/auth`.

### Landing page (`pages/Landing.tsx`)

Croniq's dark terminal aesthetic. Headline, tagline, brief feature bullets (RSS, API, HTML, Browser, GraphQL), single CTA button → `/auth`. No authentication state on this page.

### Auth page (`pages/Auth.tsx`)

Three tabs: **Register**, **Sign in**, **Recover**.

- **Register:** Email input → `POST /api/auth/register/options` → browser ceremony → success shows recovery code modal (displayed once, user must acknowledge)
- **Sign in:** Email input → `POST /api/auth/login/options` → browser ceremony → redirect to `/app`
- **Recover:** Email + recovery code inputs → `POST /api/auth/recover` → on success, redirect to `/app` and immediately prompt to add a new passkey

Uses `@simplewebauthn/browser` for browser-side ceremonies.

### Nav (`components/Nav.tsx`)

Top bar: Croniq logo (left), user email with dropdown (right). Dropdown contains: **Manage passkeys** (opens `PasskeyManager` modal) and **Sign out**.

### PasskeyManager (`components/PasskeyManager.tsx`)

Modal component in Croniq's dark style.

- Lists all passkeys with label, creation date, last used date
- Inline rename (click to edit label, save on blur/enter)
- Delete button (disabled if only one passkey remains)
- "Add another passkey" button (triggers registration ceremony without email step — user is already authed)
- "View recovery code" — triggers `POST /api/auth/recover-code/regenerate`, shows new code in modal with copy button and acknowledgement

---

## Dependencies

### Added

```json
{
  "dependencies": {
    "@simplewebauthn/server": "^13",
    "express-session": "^1",
    "csrf-csrf": "^3",
    "express-rate-limit": "^7",
    "bcrypt": "^5"
  },
  "devDependencies": {
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
| `SESSION_SECRET` | Yes | express-session secret — server refuses to start without it |
| `BEDROCK_MODEL_ID` | No | Override Haiku model ID (default: `us.anthropic.claude-haiku-4-5-20251001-v1:0`) |
| `AWS_REGION` | No | Bedrock region (default: `us-east-1`) |
| `PORT` | No | HTTP port (default: `3001`) |
| `NODE_ENV` | No | `production` enables secure cookies + `https://croniq.local` CORS origin |
| `CORS_ORIGIN` | No | Override CORS origin for dev |

`SESSION_SECRET` must be added to `.env` (gitignored). Server logs a clear error and exits if missing.

---

## Migration Notes

- Existing `jobs` data is fully preserved — no changes to the `jobs` table
- `runs` table requires a migration: add new columns, rename `outcome`→`status`, rename `result`→`analysis`, rename `result_hash`→`content_hash`; `run_stages` table dropped
- First user to open the app after deployment registers via the Auth page (no credentials in DB → register tab shown by default)
- LangChain packages can be removed from `package.json` after the migration is complete

---

## Testing

- Auth routes: supertest integration tests for each flow (register, login, recover, passkey CRUD)
- Collectors: unit tests per module with mocked network (nock or msw)
- Pipeline: unit test the hash-skip optimization and error handling paths
- Scheduler: test reload-before-execute (mock `getJobById` returning updated job)
