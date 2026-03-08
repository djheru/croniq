# LLM Analysis Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional per-job LLM analysis that queries Claude 4.6 Opus on AWS Bedrock with the last 5 run results and a user-defined prompt, on a configurable schedule (default hourly).

**Architecture:** Jobs gain two optional fields: `analysis_prompt` and `analysis_schedule`. A new `analyses` table stores results. A separate cron entry per job triggers analysis on its own schedule, independent of collection. A new `src/llm/bedrock.ts` module handles the Bedrock InvokeModel call. The UI adds prompt/schedule fields to JobForm and an analysis section to JobDetail.

**Tech Stack:** `@aws-sdk/client-bedrock-runtime`, Claude `us.anthropic.claude-opus-4-6-20250219-v1:0`, existing node-cron scheduler, better-sqlite3.

---

### Task 1: Add `@aws-sdk/client-bedrock-runtime` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `npm install @aws-sdk/client-bedrock-runtime`

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @aws-sdk/client-bedrock-runtime dependency"
```

---

### Task 2: Update database schema — add analysis columns to jobs and analyses table

**Files:**
- Modify: `src/db/index.ts` (the `migrate()` function)
- Modify: `src/types/index.ts` (Job and Analysis types)

**Step 1: Add columns and table to migration in `src/db/index.ts`**

Add these statements inside the `db.exec()` call in `migrate()`, after the existing CREATE TABLE/INDEX statements:

```sql
ALTER TABLE jobs ADD COLUMN analysis_prompt TEXT;
ALTER TABLE jobs ADD COLUMN analysis_schedule TEXT DEFAULT '0 * * * *';

CREATE TABLE IF NOT EXISTS analyses (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  prompt        TEXT NOT NULL,
  response      TEXT NOT NULL,
  run_ids       TEXT NOT NULL,       -- JSON array of run IDs used
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analyses_job_id ON analyses(job_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
```

**Important:** ALTER TABLE will fail if columns already exist. Wrap each ALTER in a try/catch or use a separate migration step. The recommended approach for better-sqlite3 is to check if the column exists first:

```typescript
// After the main db.exec(...) block, add:
const cols = db.pragma('table_info(jobs)') as Array<{ name: string }>;
const colNames = cols.map(c => c.name);
if (!colNames.includes('analysis_prompt')) {
  db.exec('ALTER TABLE jobs ADD COLUMN analysis_prompt TEXT');
}
if (!colNames.includes('analysis_schedule')) {
  db.exec("ALTER TABLE jobs ADD COLUMN analysis_schedule TEXT DEFAULT '0 * * * *'");
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
```

**Step 2: Add types to `src/types/index.ts`**

Add `analysisPrompt` and `analysisSchedule` to the `Job` interface:

```typescript
export interface Job {
  // ... existing fields ...
  analysisPrompt?: string;
  analysisSchedule?: string;     // cron expression, default '0 * * * *'
}
```

Add new `Analysis` interface after the `Run` interface:

```typescript
export interface Analysis {
  id: string;
  jobId: string;
  prompt: string;
  response: string;
  runIds: string[];
  durationMs?: number;
  createdAt: string;
}
```

Add `analysisPrompt` and `analysisSchedule` to `CreateJobInput` — they should be included via the existing `Omit` pattern (they're already optional on Job, so they'll carry through).

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors (other files will break in later tasks when we wire things up)

**Step 4: Commit**

```bash
git add src/db/index.ts src/types/index.ts
git commit -m "feat: add analysis schema — jobs columns + analyses table"
```

---

### Task 3: Add database queries for analyses

**Files:**
- Modify: `src/db/queries.ts`

**Step 1: Update `toJob()` to include new fields**

Add to the `toJob` function return object:

```typescript
analysisPrompt: row.analysis_prompt as string | undefined,
analysisSchedule: row.analysis_schedule as string | undefined,
```

**Step 2: Update `insertJob` prepared statement**

Add `analysis_prompt` and `analysis_schedule` to the INSERT columns and VALUES:

```typescript
const insertJob = db.prepare(`
  INSERT INTO jobs (id, name, description, schedule, collector_config, output_format,
    tags, notify_on_change, webhook_url, retries, timeout_ms, status,
    analysis_prompt, analysis_schedule, created_at, updated_at)
  VALUES (@id, @name, @description, @schedule, @collector_config, @output_format,
    @tags, @notify_on_change, @webhook_url, @retries, @timeout_ms, 'active',
    @analysis_prompt, @analysis_schedule, @created_at, @updated_at)
`);
```

**Step 3: Update `updateJob` prepared statement**

Add to the SET clause:

```sql
analysis_prompt = @analysis_prompt, analysis_schedule = @analysis_schedule,
```

**Step 4: Update `createJob()` function**

Add to the `insertJob.run()` call:

```typescript
analysis_prompt: input.analysisPrompt ?? null,
analysis_schedule: input.analysisSchedule ?? '0 * * * *',
```

**Step 5: Update `updateJobById()` function**

Add to the `updateJob.run()` call:

```typescript
analysis_prompt: merged.analysisPrompt ?? null,
analysis_schedule: merged.analysisSchedule ?? '0 * * * *',
```

**Step 6: Add analysis CRUD queries**

Add at the bottom of `src/db/queries.ts`:

```typescript
import type { Job, Run, CreateJobInput, UpdateJobInput, RunOutcome, Analysis } from '../types/index.js';

function toAnalysis(row: Record<string, unknown>): Analysis {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    prompt: row.prompt as string,
    response: row.response as string,
    runIds: JSON.parse(row.run_ids as string),
    durationMs: row.duration_ms as number | undefined,
    createdAt: row.created_at as string,
  };
}

export function createAnalysis(params: {
  jobId: string;
  prompt: string;
  response: string;
  runIds: string[];
  durationMs: number;
}): Analysis {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO analyses (id, job_id, prompt, response, run_ids, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.jobId, params.prompt, params.response, JSON.stringify(params.runIds), params.durationMs, new Date().toISOString());
  return listAnalyses(params.jobId, 1)[0];
}

export function listAnalyses(jobId: string, limit = 20): Analysis[] {
  const rows = db.prepare(`
    SELECT * FROM analyses WHERE job_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(jobId, limit) as Record<string, unknown>[];
  return rows.map(toAnalysis);
}

export function getLatestAnalysis(jobId: string): Analysis | null {
  const row = db.prepare(`
    SELECT * FROM analyses WHERE job_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(jobId) as Record<string, unknown> | undefined;
  return row ? toAnalysis(row) : null;
}
```

**Step 7: Update the import of `Analysis` type at the top of the file**

Make sure the import line includes `Analysis`:

```typescript
import type { Job, Run, CreateJobInput, UpdateJobInput, RunOutcome, Analysis } from '../types/index.js';
```

**Step 8: Verify build compiles**

Run: `npx tsc --noEmit`

**Step 9: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: add analysis queries and update job queries for analysis fields"
```

---

### Task 4: Create Bedrock LLM client

**Files:**
- Create: `src/llm/bedrock.ts`

**Step 1: Create the module**

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-20250219-v1:0';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

let client: BedrockRuntimeClient | null = null;

const getClient = (): BedrockRuntimeClient => {
  if (!client) {
    client = new BedrockRuntimeClient({ region: AWS_REGION });
  }
  return client;
};

export interface AnalysisInput {
  jobName: string;
  prompt: string;
  runs: Array<{
    startedAt: string;
    outcome: string;
    result?: unknown;
  }>;
}

export async function analyzeWithLLM(input: AnalysisInput): Promise<string> {
  const runsText = input.runs
    .map((r, i) => `--- Run ${i + 1} (${r.startedAt}, ${r.outcome}) ---\n${JSON.stringify(r.result, null, 2)}`)
    .join('\n\n');

  const userMessage = `Job: "${input.jobName}"

Here are the last ${input.runs.length} collection results:

${runsText}

---

${input.prompt}`;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
    system: 'You are an analyst for a scheduled data collection system called Croniq. The user will provide you with recent collection results and a specific analysis prompt. Provide concise, actionable insights. Use markdown formatting for readability.',
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await getClient().send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text;
}
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/llm/bedrock.ts
git commit -m "feat: add Bedrock LLM client for Claude analysis"
```

---

### Task 5: Create analysis runner

**Files:**
- Create: `src/jobs/analyzer.ts`

**Step 1: Create the analysis runner module**

```typescript
import { listRuns, createAnalysis, getJob } from '../db/queries.js';
import { analyzeWithLLM } from '../llm/bedrock.js';
import type { Job } from '../types/index.js';

export async function runAnalysis(job: Job): Promise<void> {
  if (!job.analysisPrompt) return;

  const runs = listRuns(job.id, 5).filter(r => r.outcome === 'success' && r.result);

  if (runs.length === 0) {
    console.log(`[analyzer] No successful runs for "${job.name}", skipping`);
    return;
  }

  const start = Date.now();

  try {
    const response = await analyzeWithLLM({
      jobName: job.name,
      prompt: job.analysisPrompt,
      runs: runs.map(r => ({
        startedAt: r.startedAt,
        outcome: r.outcome,
        result: r.result,
      })),
    });

    const durationMs = Date.now() - start;

    createAnalysis({
      jobId: job.id,
      prompt: job.analysisPrompt,
      response,
      runIds: runs.map(r => r.id),
      durationMs,
    });

    console.log(`[analyzer] Analysis for "${job.name}" complete (${durationMs}ms)`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[analyzer] Analysis for "${job.name}" failed: ${error}`);
  }
}
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/jobs/analyzer.ts
git commit -m "feat: add analysis runner — queries Bedrock with last 5 runs"
```

---

### Task 6: Wire analysis scheduling into scheduler

**Files:**
- Modify: `src/jobs/scheduler.ts`

**Step 1: Add analysis task tracking and scheduling**

Import the analyzer:

```typescript
import { runAnalysis } from './analyzer.js';
```

Add a second Map for analysis tasks:

```typescript
const analysisTasks = new Map<string, ScheduledTask>();
```

Add functions to schedule/unschedule analysis:

```typescript
function scheduleAnalysis(job: Job): void {
  unscheduleAnalysis(job.id);
  if (!job.analysisPrompt || job.status !== 'active') return;

  const schedule = job.analysisSchedule ?? '0 * * * *';
  if (!cron.validate(schedule)) {
    console.warn(`[scheduler] Invalid analysis schedule "${schedule}" for job "${job.name}"`);
    return;
  }

  const task = cron.schedule(schedule, async () => {
    const fresh = getJob(job.id);
    if (!fresh || fresh.status !== 'active' || !fresh.analysisPrompt) return;
    await runAnalysis(fresh);
  });

  analysisTasks.set(job.id, task);
  console.log(`[scheduler] Analysis for "${job.name}" → ${schedule}`);
}

function unscheduleAnalysis(id: string): void {
  analysisTasks.get(id)?.stop();
  analysisTasks.delete(id);
}
```

**Step 2: Wire into existing lifecycle functions**

Update `scheduleJob()` — add at the end:

```typescript
scheduleAnalysis(job);
```

Update `unscheduleJob()` — add:

```typescript
unscheduleAnalysis(id);
```

Update `rescheduleJob()` — the existing implementation already calls unschedule + schedule, so analysis will be handled automatically.

Update `initScheduler()` — the existing loop already calls `scheduleJob()` for active jobs, so analysis will be scheduled automatically.

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/jobs/scheduler.ts
git commit -m "feat: wire analysis scheduling into job scheduler"
```

---

### Task 7: Add API routes for analyses

**Files:**
- Modify: `src/api/routes.ts`

**Step 1: Add analysis_prompt and analysis_schedule to CreateJobSchema**

Add to `CreateJobSchema`:

```typescript
analysisPrompt: z.string().optional(),
analysisSchedule: z.string().default('0 * * * *'),
```

**Step 2: Import analysis queries**

Update import:

```typescript
import {
  listJobs, getJob, createJob, updateJobById, deleteJob,
  listRuns, getLastRun, getRunStats, setJobStatus,
  listAnalyses, getLatestAnalysis,
} from '../db/queries.js';
```

**Step 3: Add analysis routes**

Add after the runs routes:

```typescript
// ─── Analyses ────────────────────────────────────────────────────────────────

router.get('/jobs/:id/analyses', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const analyses = listAnalyses(req.params.id, limit);
  res.json({ data: analyses });
});

router.get('/jobs/:id/analyses/latest', (req, res) => {
  const analysis = getLatestAnalysis(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'No analyses yet' });
  res.json({ data: analysis });
});
```

**Step 4: Add analysis runner import and manual trigger route**

```typescript
import { runAnalysis } from '../jobs/analyzer.js';

router.post('/jobs/:id/analyze', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (!job.analysisPrompt) return res.status(400).json({ error: 'Job has no analysis prompt' });
  runAnalysis(job).catch(console.error);
  res.json({ data: { triggered: true } });
});
```

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/api/routes.ts
git commit -m "feat: add analysis API routes — list, latest, manual trigger"
```

---

### Task 8: Update frontend API client and types

**Files:**
- Modify: `ui/src/api.ts`

**Step 1: Add Analysis type**

```typescript
export interface Analysis {
  id: string;
  jobId: string;
  prompt: string;
  response: string;
  runIds: string[];
  durationMs?: number;
  createdAt: string;
}
```

**Step 2: Add analysis fields to Job interface**

```typescript
export interface Job {
  // ... existing fields ...
  analysisPrompt?: string;
  analysisSchedule?: string;
}
```

**Step 3: Add API methods**

Add to the `api` object:

```typescript
// Analyses
getAnalyses: (jobId: string) => request<{ data: Analysis[] }>(`/jobs/${jobId}/analyses`),
getLatestAnalysis: (jobId: string) => request<{ data: Analysis }>(`/jobs/${jobId}/analyses/latest`),
triggerAnalysis: (jobId: string) => request(`/jobs/${jobId}/analyze`, { method: 'POST' }),
```

**Step 4: Commit**

```bash
git add ui/src/api.ts
git commit -m "feat: add analysis types and API methods to frontend client"
```

---

### Task 9: Update JobForm — add analysis prompt and schedule fields

**Files:**
- Modify: `ui/src/components/JobForm.tsx`

**Step 1: Add state for analysis fields**

After existing `useState` calls:

```typescript
const [analysisPrompt, setAnalysisPrompt] = useState(initial?.analysisPrompt ?? '');
const [analysisSchedule, setAnalysisSchedule] = useState(initial?.analysisSchedule ?? '0 * * * *');
```

**Step 2: Add to handleSubmit**

Add to the object passed to `onSubmit`:

```typescript
analysisPrompt: analysisPrompt || undefined,
analysisSchedule: analysisSchedule || '0 * * * *',
```

**Step 3: Add analysis section to the form JSX**

Add after the webhook/notify section, before the submit buttons:

```tsx
{/* Analysis */}
<div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
  <div style={{ ...fieldStyle }}>
    <label style={labelStyle}>Analysis Prompt (optional — enables LLM analysis)</label>
    <textarea
      value={analysisPrompt}
      onChange={e => setAnalysisPrompt(e.target.value)}
      rows={3}
      style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
      placeholder="e.g. Summarize the price trend. Is it trending up, down, or sideways?"
    />
  </div>

  {analysisPrompt && (
    <div style={fieldStyle}>
      <label style={labelStyle}>Analysis Schedule (cron)</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {[
          { label: 'Hourly', value: '0 * * * *' },
          { label: 'Every 6h', value: '0 */6 * * *' },
          { label: 'Daily 9am', value: '0 9 * * *' },
        ].map(p => (
          <button key={p.value} onClick={() => setAnalysisSchedule(p.value)} style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
            background: analysisSchedule === p.value ? 'var(--accent-dim)' : 'var(--bg-3)',
            border: `1px solid ${analysisSchedule === p.value ? 'var(--accent)' : 'var(--border)'}`,
            color: analysisSchedule === p.value ? 'var(--accent)' : 'var(--text-1)',
            fontFamily: 'var(--font-mono)',
          }}>
            {p.label}
          </button>
        ))}
      </div>
      <input value={analysisSchedule} onChange={e => setAnalysisSchedule(e.target.value)}
        style={{ width: '100%' }} placeholder="0 * * * *" />
    </div>
  )}
</div>
```

**Step 4: Commit**

```bash
git add ui/src/components/JobForm.tsx
git commit -m "feat: add analysis prompt and schedule fields to JobForm"
```

---

### Task 10: Update JobDetail — add analysis display

**Files:**
- Modify: `ui/src/components/JobDetail.tsx`

**Step 1: Import Analysis type and add state**

Update imports:

```typescript
import { api, type Job, type Run, type RunStats, type Analysis } from '../api';
```

Add state inside `JobDetail`:

```typescript
const [analyses, setAnalyses] = useState<Analysis[]>([]);
const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
const [analyzing, setAnalyzing] = useState(false);
```

**Step 2: Load analyses in the load function**

Add to the `load()` function, after the runs fetch:

```typescript
if (job.analysisPrompt) {
  const analysisRes = await api.getAnalyses(job.id);
  setAnalyses(analysisRes.data);
}
```

**Step 3: Add trigger analysis handler**

```typescript
async function triggerAnalysis() {
  setAnalyzing(true);
  try {
    await api.triggerAnalysis(job.id);
    setTimeout(load, 5000); // analysis takes longer
  } finally {
    setAnalyzing(false);
  }
}
```

**Step 4: Add analysis section to JSX**

Add after the existing two-column grid (runs list + run detail), before the closing `</div>`:

```tsx
{/* Analysis section */}
{job.analysisPrompt && (
  <div style={{ marginTop: 20 }}>
    <Card>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
          LLM Analysis
        </span>
        <Button size="sm" variant="ghost" onClick={triggerAnalysis} disabled={analyzing}>
          {analyzing ? <Spinner /> : '⚡'} Analyze now
        </Button>
      </div>

      {analyses.length === 0 ? (
        <Empty message="No analyses yet — waiting for scheduled run or trigger manually" />
      ) : (
        <div>
          {/* Analysis selector */}
          <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            {analyses.slice(0, 10).map(a => (
              <button key={a.id} onClick={() => setSelectedAnalysis(a)} style={{
                padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                background: selectedAnalysis?.id === a.id ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${selectedAnalysis?.id === a.id ? 'var(--accent)' : 'var(--border)'}`,
                color: selectedAnalysis?.id === a.id ? 'var(--accent)' : 'var(--text-1)',
                fontFamily: 'var(--font-mono)',
              }}>
                {format(new Date(a.createdAt), 'MMM d, HH:mm')}
              </button>
            ))}
          </div>

          {/* Analysis content */}
          <div style={{ padding: 16, maxHeight: 400, overflow: 'auto' }}>
            {(selectedAnalysis ?? analyses[0]) && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                  {(selectedAnalysis ?? analyses[0]).durationMs}ms
                  {' · '}
                  {(selectedAnalysis ?? analyses[0]).runIds.length} runs analyzed
                </div>
                <pre style={{
                  fontSize: 13, color: 'var(--text-0)', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', fontFamily: 'var(--font-sans)', lineHeight: 1.6,
                }}>
                  {(selectedAnalysis ?? analyses[0]).response}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  </div>
)}
```

**Step 5: Commit**

```bash
git add ui/src/components/JobDetail.tsx
git commit -m "feat: add analysis display section to JobDetail"
```

---

### Task 11: Build, deploy, and verify

**Files:**
- No new files

**Step 1: Verify full build locally**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Sync and build on Pi**

```bash
rsync -avz --exclude node_modules --exclude dist --exclude data --exclude '.git' croniq/ kali:~/croniq/
ssh kali "export PATH=/usr/share/nodejs/corepack/shims:\$PATH && cd ~/croniq && npm install && npm run build && pm2 restart croniq"
```

**Step 3: Verify health endpoint**

```bash
ssh kali "curl -s http://localhost:3001/api/health"
```
Expected: `{"status":"ok","scheduledJobs":N}`

**Step 4: Test by creating a job with analysis prompt via the UI**

Open https://croniq.local, create a job (or edit BTC Price) with analysis prompt:
- Prompt: "Summarize the price trend over these samples. Is it trending up, down, or sideways? Any notable volatility?"
- Schedule: hourly (default)

**Step 5: Test manual trigger**

```bash
curl -s -X POST https://croniq.local/api/jobs/<JOB_ID>/analyze
```

**Step 6: Verify analysis appears in UI**

Navigate to job detail, confirm the LLM Analysis section shows the response.

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete LLM analysis feature — Bedrock + scheduling + UI"
```

---

### Environment Setup (prerequisite for runtime)

The Pi needs AWS credentials configured. Either:

1. `~/.aws/credentials` with a profile that has `bedrock:InvokeModel` permission
2. Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

Set via PM2:

```bash
pm2 set croniq:AWS_REGION us-east-1
# Or add to ecosystem.config.js
```

Or export in the shell before PM2 starts:

```bash
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
pm2 restart croniq --update-env
```
