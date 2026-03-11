# Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Croniq's five standalone collectors and analyzer with a four-stage LangChain.js agent pipeline (Collector → Summarizer → Researcher → Editor).

**Architecture:** Sequential pipeline where each job run executes four agents in order. Each agent produces structured output passed to the next. Errors degrade gracefully — failed stages pass data through with error metadata. Tiered Bedrock models: Haiku (collector), Sonnet (summarizer/researcher), Opus (editor).

**Tech Stack:** LangChain.js (`langchain`, `@langchain/core`, `@langchain/aws`, `@langchain/langgraph`), Zod structured output, Bedrock Claude models, SQLite (better-sqlite3), Express, React/Vite.

**Spec:** `docs/superpowers/specs/2026-03-10-agent-pipeline-design.md`

---

## File Structure

### New Files

| File | Responsibility |
| --- | --- |
| `src/agents/types.ts` | Zod schemas for CollectorOutput, SummaryOutput, ResearchOutput, StageErrorPayload |
| `src/agents/prompts.ts` | System prompt templates for all four agents |
| `src/agents/tools/rss-fetch.ts` | LangChain tool wrapping rss-parser |
| `src/agents/tools/api-fetch.ts` | LangChain tool wrapping fetch + extract |
| `src/agents/tools/html-scrape.ts` | LangChain tool wrapping cheerio |
| `src/agents/tools/browser-scrape.ts` | LangChain tool wrapping Playwright |
| `src/agents/tools/graphql-fetch.ts` | LangChain tool wrapping GraphQL fetch |
| `src/agents/tools/selectors.ts` | Moved from `src/collectors/selectors.ts` (unchanged) |
| `src/agents/tools/query-runs.ts` | Researcher tool: query historical run summaries |
| `src/agents/tools/search-jobs.ts` | Researcher tool: find related jobs by description |
| `src/agents/collector.ts` | Collector agent factory |
| `src/agents/summarizer.ts` | Summarizer agent factory |
| `src/agents/researcher.ts` | Researcher agent factory |
| `src/agents/editor.ts` | Editor agent factory |
| `src/agents/pipeline.ts` | Orchestrates four-stage pipeline, error pass-through |

### Modified Files

| File | Changes |
| --- | --- |
| `package.json` | Add `langchain`, `@langchain/core`, `@langchain/aws`, `@langchain/langgraph`; remove `@aws-sdk/client-bedrock-runtime` |
| `src/types/index.ts` | Add `RunStage`, `PipelineStage`, `StageStatus`, `StageErrorType`; add `jobPrompt`/`jobParams` to Job; remove `analysisPrompt`/`analysisSchedule`/`Analysis` |
| `src/db/index.ts` | Migration: create `run_stages` table, drop `analyses` table, add `job_prompt`/`job_params` columns, remove `analysis_prompt`/`analysis_schedule` columns |
| `src/db/queries.ts` | Add `createRunStage`/`listRunStages`; remove analysis queries; update `toJob` mapping |
| `src/api/routes.ts` | Remove analysis routes; update job creation/update schemas for `jobPrompt`/`jobParams`; add `GET /jobs/:id/runs/:runId/stages` |
| `src/jobs/runner.ts` | Replace `getCollector().collect()` with `runPipeline(job)`; store stage outputs |
| `src/jobs/scheduler.ts` | Remove `scheduleAnalysis`/`unscheduleAnalysis`/`analysisTasks` |
| `ui/src/api.ts` | Add `RunStage` type; add `getRunStages()` API call; remove `Analysis` type and analysis API calls |
| `ui/src/components/JobDetail.tsx` | Replace analysis section with markdown report view + three collapsible stage panels |
| `ui/src/components/JobForm.tsx` | Replace analysis fields with `jobPrompt` textarea + `jobParams` key-value editor |

### Removed Files

| File | Reason |
| --- | --- |
| `src/jobs/analyzer.ts` | Replaced by pipeline |
| `src/llm/bedrock.ts` | Replaced by `@langchain/aws` |
| `src/collectors/base.ts` | Logic moves to agent tools |
| `src/collectors/html.ts` | Logic moves to `agents/tools/html-scrape.ts` |
| `src/collectors/browser.ts` | Logic moves to `agents/tools/browser-scrape.ts` |
| `src/collectors/api.ts` | Logic moves to `agents/tools/api-fetch.ts` |
| `src/collectors/rss.ts` | Logic moves to `agents/tools/rss-fetch.ts` |
| `src/collectors/graphql.ts` | Logic moves to `agents/tools/graphql-fetch.ts` |

---

## Chunk 1: Foundation — Types, DB Migration, Dependencies

### Task 1: Install LangChain dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install langchain and AWS integration**

```bash
cd /Users/pdamra/Workspace/kali/croniq
npm install langchain @langchain/aws @langchain/core @langchain/langgraph
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('@langchain/core/tools'); console.log('@langchain/core OK')"
node -e "require('@langchain/aws'); console.log('@langchain/aws OK')"
node -e "require('@langchain/langgraph/prebuilt'); console.log('@langchain/langgraph OK')"
```

Expected: All three print OK without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add langchain and @langchain/aws"
```

---

### Task 2: Define pipeline types and Zod schemas

**Files:**
- Create: `src/agents/types.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Create `src/agents/types.ts` with all pipeline schemas**

```typescript
import { z } from 'zod';

// --- Pipeline stage metadata ---

export type PipelineStage = 'collector' | 'summarizer' | 'researcher' | 'editor';
export type StageStatus = 'success' | 'error' | 'skipped';
export type StageErrorType = 'timeout' | 'llm_error' | 'validation_error' | 'tool_error';

export interface RunStage {
  id: string;
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
  createdAt: string;
}

// --- Error pass-through envelope ---

export interface StageErrorPayload {
  passthrough: unknown;
}

// --- Collector output ---

export const CollectorOutputSchema = z.object({
  tool: z.string().describe('Which tool was used: rss_fetch, api_fetch, etc.'),
  sourceUrl: z.string(),
  rawData: z.unknown().describe('The raw data returned by the tool'),
  itemCount: z.number().optional().describe('Number of items if applicable'),
  fetchedAt: z.string().describe('ISO 8601 timestamp'),
});

export type CollectorOutput = z.infer<typeof CollectorOutputSchema>;

// --- Summarizer output ---

export const SummaryItemSchema = z.object({
  headline: z.string(),
  summary: z.string().describe('1-2 sentence summary'),
  url: z.string().optional(),
  relevance: z.enum(['high', 'medium', 'low']),
  metadata: z.record(z.unknown()).optional(),
});

export const SummaryOutputSchema = z.object({
  title: z.string().describe('Brief title for this collection'),
  sourceUrl: z.string(),
  collectedAt: z.string(),
  items: z.array(SummaryItemSchema),
  overallSummary: z.string().describe('2-3 sentence overview of the collection'),
});

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// --- Researcher output ---

export const ResearchOutputSchema = z.object({
  trends: z.array(z.object({
    description: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
    supportingEvidence: z.array(z.string()),
  })),
  relatedFindings: z.array(z.object({
    fromJob: z.string().describe('Job name'),
    connection: z.string().describe('How this relates'),
    items: z.array(z.string()).describe('Key relevant items'),
  })),
  anomalies: z.array(z.object({
    description: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
  })),
});

export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

// --- Pipeline result ---

export interface PipelineResult {
  stages: RunStage[];
  report: string | null;
}
```

- [ ] **Step 2: Update `src/types/index.ts`**

Remove the `Analysis` interface and `analysisPrompt`/`analysisSchedule` from the `Job` interface. Add `jobPrompt` and `jobParams`. Re-export pipeline types.

In the `Job` interface, replace:
```typescript
  analysisPrompt?: string;
  analysisSchedule?: string;
```
with:
```typescript
  jobPrompt?: string;
  jobParams?: Record<string, string>;
```

Remove the `Analysis` interface entirely.

Remove `Analysis` from any exports.

Add at the bottom of the file:
```typescript
export type { PipelineStage, StageStatus, StageErrorType, RunStage } from '../agents/types.js';
```

Also update `CreateJobInput` — ensure `jobPrompt` and `jobParams` are NOT in the Omit list (they should be settable on creation).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/pdamra/Workspace/kali/croniq
npx tsc --noEmit 2>&1 | head -20
```

Expected: Errors related to analyzer/analysis imports (expected at this stage — we haven't removed those files yet). No errors in `types.ts` or `agents/types.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/agents/types.ts src/types/index.ts
git commit -m "feat: add pipeline types and Zod schemas"
```

---

### Task 3: Database migration

**Files:**
- Modify: `src/db/index.ts`
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Add migration to `src/db/index.ts`**

Add after the existing migrations in the `migrate()` function:

```typescript
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

// Remove analysis columns from jobs (SQLite doesn't support DROP COLUMN before 3.35)
// These columns will simply be ignored — they'll stay in the schema but won't be
// read or written by the application. This avoids compatibility issues with older SQLite.
```

Note: SQLite on the Pi may be pre-3.35, so we cannot use `ALTER TABLE ... DROP COLUMN`. The `analysis_prompt` and `analysis_schedule` columns will remain in the schema but be ignored by application code.

- [ ] **Step 2: Add run_stages queries to `src/db/queries.ts`**

Add these functions:

```typescript
import type { RunStage, PipelineStage, StageStatus, StageErrorType } from '../agents/types.js';

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
```

- [ ] **Step 3: Remove analysis queries from `src/db/queries.ts`**

Remove these functions entirely: `createAnalysis`, `listAnalyses`, `getLatestAnalysis`, `toAnalysis`.

- [ ] **Step 4: Update `toJob()` mapping in `src/db/queries.ts`**

In the `toJob` function, replace:
```typescript
    analysisPrompt: row.analysis_prompt as string | undefined,
    analysisSchedule: row.analysis_schedule as string | undefined,
```
with:
```typescript
    jobPrompt: row.job_prompt as string | undefined,
    jobParams: row.job_params ? JSON.parse(row.job_params as string) : undefined,
```

- [ ] **Step 5: Update prepared statements AND function bodies in `src/db/queries.ts`**

**CRITICAL:** The module-level prepared statements `insertJob` and `updateJob` must be updated, not just the function bodies. These are SQL strings prepared at module load time.

In the `insertJob` prepared statement SQL string, replace `analysis_prompt, analysis_schedule` column names with `job_prompt, job_params`, and replace the corresponding `@analysis_prompt, @analysis_schedule` bind parameters with `@job_prompt, @job_params`.

In the `updateJob` prepared statement SQL string, replace `analysis_prompt = @analysis_prompt, analysis_schedule = @analysis_schedule` with `job_prompt = @job_prompt, job_params = @job_params`.

In the `createJob` function body, replace:
```typescript
analysis_prompt: input.analysisPrompt ?? null,
analysis_schedule: input.analysisSchedule ?? '0 * * * *',
```
with:
```typescript
job_prompt: input.jobPrompt ?? null,
job_params: input.jobParams ? JSON.stringify(input.jobParams) : '{}',
```

In `updateJobById`, do the same replacement — map `jobPrompt` → `job_prompt` and `jobParams` → `JSON.stringify(jobParams)` in the parameter object passed to the prepared statement.

- [ ] **Step 6: Verify the migration runs**

```bash
cd /Users/pdamra/Workspace/kali/croniq
rm -f data/croniq.db
npx tsx -e "import './src/db/index.js'; console.log('migration OK')"
```

Expected: No errors. DB file created with `run_stages` table.

- [ ] **Step 7: Commit**

```bash
git add src/db/index.ts src/db/queries.ts
git commit -m "feat: add run_stages table and pipeline DB queries"
```

---

## Chunk 2: Collector Tools

> **Dependency note:** Task 4 (selectors) MUST complete before Tasks 7 (html_scrape) and 8 (browser_scrape), which import from `./selectors.js`. Tasks 5, 6, and 9 are independent and can run in parallel.

### Task 4: Move selectors utility

**Files:**
- Create: `src/agents/tools/selectors.ts`
- Remove: `src/collectors/selectors.ts` (after all references updated)

- [ ] **Step 1: Copy selectors.ts to new location**

```bash
mkdir -p /Users/pdamra/Workspace/kali/croniq/src/agents/tools
cp src/collectors/selectors.ts src/agents/tools/selectors.ts
```

No code changes needed — the file is self-contained. Just update the import path for the `SelectorMap`/`SelectorSpec` type (it imports from `../types`). Change to:

```typescript
import type { SelectorMap, SelectorSpec } from '../../types/index.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/tools/selectors.ts
git commit -m "feat: move selectors utility to agents/tools"
```

---

### Task 5: Create RSS fetch tool

**Files:**
- Create: `src/agents/tools/rss-fetch.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import Parser from 'rss-parser';

const parser = new Parser();

type RssField = 'title' | 'link' | 'pubDate' | 'content' | 'author' | 'categories';

const fieldMap: Record<RssField, (item: Parser.Item) => unknown> = {
  title: (item) => item.title ?? null,
  link: (item) => item.link ?? null,
  pubDate: (item) => item.pubDate ?? item.isoDate ?? null,
  content: (item) => item.contentSnippet ?? item.content ?? null,
  author: (item) => item.creator ?? item.author ?? null,
  categories: (item) => item.categories ?? [],
};

export const rssFetch = tool(
  async ({ url, max_items, fields }) => {
    const feed = await parser.parseURL(url);
    const items = feed.items.slice(0, max_items).map((item) => {
      const extracted: Record<string, unknown> = {};
      for (const f of fields) {
        extracted[f] = fieldMap[f](item);
      }
      return extracted;
    });
    return JSON.stringify(items);
  },
  {
    name: 'rss_fetch',
    description: 'Fetch and parse an RSS or Atom feed. Returns an array of items with the specified fields.',
    schema: z.object({
      url: z.string().describe('The RSS/Atom feed URL'),
      max_items: z.number().default(20).describe('Maximum number of items to return'),
      fields: z.array(
        z.enum(['title', 'link', 'pubDate', 'content', 'author', 'categories'])
      ).describe('Which fields to extract from each feed item'),
    }),
  }
);
```

- [ ] **Step 2: Smoke test**

```bash
npx tsx -e "
import { rssFetch } from './src/agents/tools/rss-fetch.js';
console.log(rssFetch.name, rssFetch.description);
"
```

Expected: Prints tool name and description without errors.

- [ ] **Step 3: Commit**

```bash
git add src/agents/tools/rss-fetch.ts
git commit -m "feat: add rss_fetch LangChain tool"
```

---

### Task 6: Create API fetch tool

**Files:**
- Create: `src/agents/tools/api-fetch.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const getNestedValue = (obj: unknown, path: string): unknown => {
  return path.split('.').reduce((curr: unknown, key: string) => {
    if (curr && typeof curr === 'object' && key in curr) {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

export const apiFetch = tool(
  async ({ url, method, headers, body, extract }) => {
    const options: RequestInit = {
      method,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    let data = await res.json();

    if (extract) {
      data = getNestedValue(data, extract);
    }

    return JSON.stringify(data);
  },
  {
    name: 'api_fetch',
    description: 'Fetch data from a REST/JSON API endpoint. Supports GET, POST, PUT, PATCH with optional dot-path extraction.',
    schema: z.object({
      url: z.string().describe('The API endpoint URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('GET').describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
      body: z.record(z.unknown()).optional().describe('Request body (for POST/PUT/PATCH)'),
      extract: z.string().optional().describe('Dot-path to extract from response, e.g. "data.items"'),
    }),
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/tools/api-fetch.ts
git commit -m "feat: add api_fetch LangChain tool"
```

---

### Task 7: Create HTML scrape tool

**Files:**
- Create: `src/agents/tools/html-scrape.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { extractSelectors } from './selectors.js';
import type { SelectorMap } from '../../types/index.js';

export const htmlScrape = tool(
  async ({ url, selectors, headers }) => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Croniq/1.0)',
        ...headers,
      },
    });

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const data = extractSelectors($, selectors as SelectorMap);
    return JSON.stringify(data);
  },
  {
    name: 'html_scrape',
    description: 'Scrape data from a static HTML page using CSS selectors. Uses cheerio for parsing.',
    schema: z.object({
      url: z.string().describe('The page URL to scrape'),
      selectors: z.record(z.union([
        z.string(),
        z.object({
          selector: z.string(),
          attribute: z.string().optional(),
          multiple: z.boolean().optional(),
          transform: z.enum(['trim', 'number', 'lowercase', 'uppercase']).optional(),
        }),
      ])).describe('Map of field names to CSS selectors or selector specs'),
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
    }),
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/tools/html-scrape.ts
git commit -m "feat: add html_scrape LangChain tool"
```

---

### Task 8: Create browser scrape tool

**Files:**
- Create: `src/agents/tools/browser-scrape.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SelectorMap } from '../../types/index.js';

export const browserScrape = tool(
  async ({ url, selectors, wait_for, scroll_to_bottom }) => {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      return JSON.stringify({ error: 'Playwright is not installed' });
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

      if (wait_for) {
        await page.waitForSelector(wait_for, { timeout: 15000 }).catch(() => {});
      }

      if (scroll_to_bottom) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      const { extractSelectors } = await import('./selectors.js');
      const data = extractSelectors($, selectors as SelectorMap);
      return JSON.stringify(data);
    } finally {
      await browser.close();
    }
  },
  {
    name: 'browser_scrape',
    description: 'Scrape data from a JavaScript-rendered page using Playwright and CSS selectors.',
    schema: z.object({
      url: z.string().describe('The page URL to scrape'),
      selectors: z.record(z.union([
        z.string(),
        z.object({
          selector: z.string(),
          attribute: z.string().optional(),
          multiple: z.boolean().optional(),
          transform: z.enum(['trim', 'number', 'lowercase', 'uppercase']).optional(),
        }),
      ])).describe('Map of field names to CSS selectors or selector specs'),
      wait_for: z.string().optional().describe('CSS selector to wait for before scraping'),
      scroll_to_bottom: z.boolean().optional().describe('Scroll to bottom to trigger lazy loading'),
    }),
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/tools/browser-scrape.ts
git commit -m "feat: add browser_scrape LangChain tool"
```

---

### Task 9: Create GraphQL fetch tool

**Files:**
- Create: `src/agents/tools/graphql-fetch.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const getNestedValue = (obj: unknown, path: string): unknown => {
  return path.split('.').reduce((curr: unknown, key: string) => {
    if (curr && typeof curr === 'object' && key in curr) {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

export const graphqlFetch = tool(
  async ({ url, query, variables, headers, extract }) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    const json = await res.json() as { data?: unknown; errors?: unknown[] };

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      return JSON.stringify({ error: 'GraphQL errors', details: json.errors });
    }

    let data = json.data;
    if (extract && data) {
      data = getNestedValue(data, extract);
    }

    return JSON.stringify(data);
  },
  {
    name: 'graphql_fetch',
    description: 'Execute a GraphQL query against an endpoint. Returns the data field, with optional dot-path extraction.',
    schema: z.object({
      url: z.string().describe('The GraphQL endpoint URL'),
      query: z.string().describe('The GraphQL query string'),
      variables: z.record(z.unknown()).optional().describe('Query variables'),
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
      extract: z.string().optional().describe('Dot-path to extract from response data'),
    }),
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/tools/graphql-fetch.ts
git commit -m "feat: add graphql_fetch LangChain tool"
```

---

### Task 10: Create researcher tools (query_runs, search_jobs)

**Files:**
- Create: `src/agents/tools/query-runs.ts`
- Create: `src/agents/tools/search-jobs.ts`

- [ ] **Step 1: Create query_runs tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listRuns } from '../../db/queries.js';
import { listRunStages } from '../../db/queries.js';

export const queryRuns = tool(
  async ({ job_id, limit, outcome_filter }) => {
    let runs = listRuns(job_id, limit);

    if (outcome_filter === 'success') {
      runs = runs.filter((r) => r.outcome === 'success');
    } else if (outcome_filter === 'changed') {
      runs = runs.filter((r) => r.changed);
    }

    const results = runs.map((run) => {
      const stages = listRunStages(run.id);
      const summaryStage = stages.find((s) => s.stage === 'summarizer' && s.status === 'success');
      return {
        runId: run.id,
        startedAt: run.startedAt,
        outcome: run.outcome,
        changed: run.changed,
        summary: summaryStage?.output ?? null,
      };
    });

    return JSON.stringify(results);
  },
  {
    name: 'query_runs',
    description: 'Query previous runs for a job. Returns run metadata and summarizer output for each run.',
    schema: z.object({
      job_id: z.string().describe('The job ID to query runs for'),
      limit: z.number().default(10).describe('Maximum number of runs to return'),
      outcome_filter: z.enum(['all', 'success', 'changed']).default('all').describe('Filter runs by outcome'),
    }),
  }
);
```

- [ ] **Step 2: Create search_jobs tool**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listJobs } from '../../db/queries.js';
import { listRunStages } from '../../db/queries.js';
import { getLastRun } from '../../db/queries.js';

export const searchJobs = tool(
  async ({ query, limit }) => {
    const allJobs = listJobs();
    const queryLower = query.toLowerCase();

    const matched = allJobs
      .filter((j) => {
        const name = j.name.toLowerCase();
        const desc = (j.description ?? '').toLowerCase();
        return name.includes(queryLower) || desc.includes(queryLower);
      })
      .slice(0, limit);

    const results = matched.map((job) => {
      const lastRun = getLastRun(job.id);
      let latestSummary = null;
      if (lastRun) {
        const stages = listRunStages(lastRun.id);
        const summaryStage = stages.find((s) => s.stage === 'summarizer' && s.status === 'success');
        latestSummary = summaryStage?.output ?? null;
      }
      return {
        jobId: job.id,
        name: job.name,
        description: job.description,
        latestSummary,
      };
    });

    return JSON.stringify(results);
  },
  {
    name: 'search_jobs',
    description: 'Search for related jobs by name or description. Returns matching jobs with their latest summary.',
    schema: z.object({
      query: z.string().describe('Search terms to find related jobs'),
      limit: z.number().default(5).describe('Maximum number of jobs to return'),
    }),
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/tools/query-runs.ts src/agents/tools/search-jobs.ts
git commit -m "feat: add researcher tools (query_runs, search_jobs)"
```

---

## Chunk 3: Agents and Pipeline

### Task 11: Create prompt templates

**Files:**
- Create: `src/agents/prompts.ts`

- [ ] **Step 1: Create the prompts file**

```typescript
import type { Job } from '../types/index.js';

export const collectorSystemPrompt = (job: Job): string => {
  const config = job.collectorConfig;
  const params = job.jobParams ?? {};

  let prompt = `You are a data collector agent. Your job is to collect data from the specified source using the appropriate tool.

Source type: ${config.type}
URL: ${(config as Record<string, unknown>).url ?? 'N/A'}
`;

  if ('fields' in config && config.fields) {
    prompt += `Fields to extract: ${JSON.stringify(config.fields)}\n`;
  }
  if ('selectors' in config && config.selectors) {
    prompt += `Selectors: ${JSON.stringify(config.selectors)}\n`;
  }
  if ('extract' in config && config.extract) {
    prompt += `Extract path: ${config.extract}\n`;
  }
  if ('query' in config && config.query) {
    prompt += `GraphQL query: ${config.query}\n`;
  }
  if ('headers' in config && config.headers) {
    prompt += `Headers: ${JSON.stringify(config.headers)}\n`;
  }

  if (job.jobPrompt) {
    let interpolated = job.jobPrompt;
    for (const [key, value] of Object.entries(params)) {
      interpolated = interpolated.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    prompt += `\nAdditional instructions: ${interpolated}\n`;
  }

  prompt += `\nCall the appropriate tool with the provided parameters and return the collected data. If a tool call fails, report the error — do not retry.`;

  return prompt;
};

export const summarizerSystemPrompt = (job: Job): string =>
  `You are a data summarizer. You receive raw collected data and produce a standardized summary.

Rate each item's relevance based on the job's purpose: "${job.description ?? job.name}"

Be concise. Preserve key facts, links, and data points. Do not editorialize — save analysis for later stages.`;

export const researcherSystemPrompt = (job: Job): string =>
  `You are a research analyst. You receive a summary of newly collected data for the job "${job.name}" (${job.description ?? 'no description'}).

Your tasks:
1. Query this job's history to identify trends, patterns, or changes over time
2. Search for related jobs and cross-reference findings
3. Flag anomalies or notable developments

Use your tools to gather evidence before drawing conclusions. Be specific — cite dates, values, and sources.`;

export const editorSystemPrompt = (job: Job): string =>
  `You are a report editor. You produce a clear, well-structured GitHub markdown report from the provided summary and research findings.

Job: "${job.name}"
Description: ${job.description ?? 'N/A'}

Structure your report with:
- A headline and date
- Key highlights (bullet points)
- Detailed findings organized by topic
- Trend analysis (if research data available)
- Cross-references to related data (if available)

If research was unavailable due to an error, note this briefly and focus on the current collection. Write in a direct, informative tone. Output only the markdown — no wrapping code fences.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/prompts.ts
git commit -m "feat: add agent system prompt templates"
```

---

### Task 12: Create the four agent factories

**Files:**
- Create: `src/agents/collector.ts`
- Create: `src/agents/summarizer.ts`
- Create: `src/agents/researcher.ts`
- Create: `src/agents/editor.ts`

- [ ] **Step 1: Create collector agent**

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { collectorSystemPrompt } from './prompts.js';
import { rssFetch } from './tools/rss-fetch.js';
import { apiFetch } from './tools/api-fetch.js';
import { htmlScrape } from './tools/html-scrape.js';
import { browserScrape } from './tools/browser-scrape.js';
import { graphqlFetch } from './tools/graphql-fetch.js';

const COLLECTOR_MODEL_ID = process.env.COLLECTOR_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const tools = [rssFetch, apiFetch, htmlScrape, browserScrape, graphqlFetch];

export const createCollectorAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: COLLECTOR_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  return createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(collectorSystemPrompt(job)),
  });
};
```

**LangChain.js agent pattern:** We use `createReactAgent` from `@langchain/langgraph/prebuilt` (the standard LangChain.js agent factory). It takes an LLM, tools, and an optional system message. The agent is invoked via `.invoke({ messages: [...] })` and returns `{ messages: [...] }`. Install `@langchain/langgraph` as an additional dependency (see Task 1).

- [ ] **Step 2: Create summarizer agent**

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { summarizerSystemPrompt } from './prompts.js';
import { SummaryOutputSchema, type SummaryOutput } from './types.js';

const SUMMARIZER_MODEL_ID = process.env.SUMMARIZER_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6-v1:0';

export const createSummarizerAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: SUMMARIZER_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  // Use withStructuredOutput to enforce Zod schema on response
  const structuredModel = model.withStructuredOutput(SummaryOutputSchema);

  return {
    invoke: async (input: string): Promise<SummaryOutput> => {
      return await structuredModel.invoke([
        new SystemMessage(summarizerSystemPrompt(job)),
        new HumanMessage(input),
      ]);
    },
  };
};
```

The summarizer has no tools, so instead of `createReactAgent` we use the model directly with `withStructuredOutput()` to enforce the Zod schema on the response.

- [ ] **Step 3: Create researcher agent**

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { researcherSystemPrompt } from './prompts.js';
import { ResearchOutputSchema, type ResearchOutput } from './types.js';
import { queryRuns } from './tools/query-runs.js';
import { searchJobs } from './tools/search-jobs.js';

const RESEARCHER_MODEL_ID = process.env.RESEARCHER_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6-v1:0';

export const createResearcherAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: RESEARCHER_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  // Researcher needs tools (query_runs, search_jobs) so we use createReactAgent
  // After the agent completes tool use, we parse the final response as structured output
  const agent = createReactAgent({
    llm: model,
    tools: [queryRuns, searchJobs],
    messageModifier: new SystemMessage(researcherSystemPrompt(job)),
  });

  return agent;
};
```

Note: The researcher uses tools, so it uses `createReactAgent`. After invocation, the pipeline extracts the final message and parses it against `ResearchOutputSchema` using `ResearchOutputSchema.parse(JSON.parse(finalMessage))`. See the pipeline orchestrator (Task 13) for the parsing logic.

- [ ] **Step 4: Create editor agent**

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { editorSystemPrompt } from './prompts.js';

const EDITOR_MODEL_ID = process.env.EDITOR_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1:0';

export const createEditorAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: EDITOR_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  // Editor has no tools — direct model invocation, returns plain markdown
  return {
    invoke: async (input: string): Promise<string> => {
      const response = await model.invoke([
        new SystemMessage(editorSystemPrompt(job)),
        new HumanMessage(input),
      ]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    },
  };
};
```

- [ ] **Step 5: Commit**

```bash
git add src/agents/collector.ts src/agents/summarizer.ts src/agents/researcher.ts src/agents/editor.ts
git commit -m "feat: add four agent factories"
```

---

### Task 13: Create the pipeline orchestrator

**Files:**
- Create: `src/agents/pipeline.ts`

- [ ] **Step 1: Create the pipeline**

```typescript
import type { Job } from '../types/index.js';
import type {
  PipelineStage,
  RunStage,
  CollectorOutput,
  SummaryOutput,
  ResearchOutput,
  PipelineResult,
  StageErrorPayload,
  StageErrorType,
} from './types.js';
import { createCollectorAgent } from './collector.js';
import { createSummarizerAgent } from './summarizer.js';
import { createResearcherAgent } from './researcher.js';
import { createEditorAgent } from './editor.js';
import { createRunStage } from '../db/queries.js';

interface StageResult<T> {
  stage: RunStage;
  data: T | StageErrorPayload;
  isError: boolean;
}

const classifyError = (err: unknown): StageErrorType => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Timeout') || msg.includes('timeout') || msg.includes('AbortError')) return 'timeout';
  if (msg.includes('validation') || msg.includes('schema') || msg.includes('parse')) return 'validation_error';
  if (msg.includes('tool') || msg.includes('Tool')) return 'tool_error';
  return 'llm_error';
};

const runStage = async <T>(
  stageName: PipelineStage,
  runId: string,
  agentFn: () => Promise<T>,
  previousData: unknown,
  modelId: string,
): Promise<StageResult<T>> => {
  const start = Date.now();
  try {
    const data = await agentFn();
    const durationMs = Date.now() - start;
    const stage = createRunStage({
      runId,
      stage: stageName,
      status: 'success',
      output: data,
      durationMs,
      modelId,
    });
    return { stage, data, isError: false };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    const errorType = classifyError(err);
    const diagnostics = err instanceof Error ? err.stack : undefined;
    const passthrough: StageErrorPayload = { passthrough: previousData };

    const stage = createRunStage({
      runId,
      stage: stageName,
      status: 'error',
      output: passthrough,
      error,
      errorType,
      diagnostics,
      durationMs,
      modelId,
    });
    return { stage, data: passthrough, isError: true };
  }
};

import { HumanMessage } from '@langchain/core/messages';
import { ResearchOutputSchema } from './types.js';

// Invoke a createReactAgent agent (collector, researcher) — returns final message content
const invokeReactAgent = async (agent: Awaited<ReturnType<typeof createCollectorAgent>>, message: string): Promise<string> => {
  const result = await agent.invoke({
    messages: [new HumanMessage(message)],
  });
  const lastMsg = result.messages?.at(-1);
  return typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content);
};

export const runPipeline = async (job: Job, runId: string): Promise<PipelineResult> => {
  const stages: RunStage[] = [];

  // Stage 1: Collector (React agent with tools)
  const collectorAgent = createCollectorAgent(job);
  const collectorMessage = `Collect data from: ${(job.collectorConfig as Record<string, unknown>).url ?? 'configured source'}`;
  const collectorResult = await runStage<CollectorOutput>(
    'collector',
    runId,
    async () => {
      const raw = await invokeReactAgent(collectorAgent, collectorMessage);
      return JSON.parse(raw) as CollectorOutput;
    },
    null,
    process.env.COLLECTOR_MODEL_ID ?? 'haiku',
  );
  stages.push(collectorResult.stage);

  // Stage 2: Summarizer (direct model with withStructuredOutput)
  const summarizerAgent = createSummarizerAgent(job);
  const summarizerMessage = `Summarize this collected data:\n\n${JSON.stringify(collectorResult.data, null, 2)}`;
  const summarizerResult = await runStage<SummaryOutput>(
    'summarizer',
    runId,
    () => summarizerAgent.invoke(summarizerMessage),
    collectorResult.data,
    process.env.SUMMARIZER_MODEL_ID ?? 'sonnet',
  );
  stages.push(summarizerResult.stage);

  // Stage 3: Researcher (React agent with tools, then parse structured output)
  const researcherAgent = createResearcherAgent(job);
  const researcherMessage = `Analyze this summary for trends and cross-references. Current job ID: ${job.id}\n\n${JSON.stringify(summarizerResult.data, null, 2)}`;
  const researcherResult = await runStage<ResearchOutput>(
    'researcher',
    runId,
    async () => {
      const raw = await invokeReactAgent(researcherAgent, researcherMessage);
      return ResearchOutputSchema.parse(JSON.parse(raw));
    },
    summarizerResult.data,
    process.env.RESEARCHER_MODEL_ID ?? 'sonnet',
  );
  stages.push(researcherResult.stage);

  // Stage 4: Editor (direct model, returns markdown string)
  const editorAgent = createEditorAgent(job);
  const editorMessage = `Write a report from this data:

## Summary
${JSON.stringify(summarizerResult.data, null, 2)}

## Research
${JSON.stringify(researcherResult.data, null, 2)}`;
  const editorResult = await runStage<string>(
    'editor',
    runId,
    () => editorAgent.invoke(editorMessage),
    { summary: summarizerResult.data, research: researcherResult.data },
    process.env.EDITOR_MODEL_ID ?? 'opus',
  );
  stages.push(editorResult.stage);

  const report = editorResult.isError ? null : (editorResult.data as string);
  return { stages, report };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/pipeline.ts
git commit -m "feat: add pipeline orchestrator with error pass-through"
```

---

### Task 14: Integrate pipeline into runner

**Files:**
- Modify: `src/jobs/runner.ts`

- [ ] **Step 1: Replace collector invocation with pipeline**

Replace the body of `runJob()`. The new version:
1. Creates a run record (same as before)
2. Calls `runPipeline(job, runId)` instead of the collector retry loop
3. Uses the editor's markdown report as `result` for change detection
4. Stores stages via the pipeline (they're saved inside `runPipeline`)

```typescript
import { runPipeline } from '../agents/pipeline.js';

export async function runJob(job: Job, nextRunAt?: string): Promise<void> {
  const { id: runId, startedAt } = createRun(job.id);
  const start = Date.now();

  try {
    const { stages, report } = await withTimeout(runPipeline(job, runId), job.timeoutMs);
    const durationMs = Date.now() - start;

    // Check if collector stage succeeded (pipeline can't proceed without data)
    const collectorStage = stages.find((s) => s.stage === 'collector');
    if (collectorStage?.status === 'error') {
      finishRun({
        id: runId,
        outcome: 'failure',
        error: collectorStage.error ?? 'Collector failed',
        durationMs,
        changed: false,
      });
      setJobStatus(job.id, 'error');
      console.error(`[runner] Job "${job.name}" collector failed: ${collectorStage.error}`);
      return;
    }

    // Use report for change detection (or summary if editor failed)
    const resultForHash = report ?? JSON.stringify(stages.find((s) => s.stage === 'summarizer')?.output);
    const newHash = hashResult(resultForHash);
    const lastRun = getLastRun(job.id);
    const changed = !lastRun?.resultHash || lastRun.resultHash !== newHash;

    finishRun({
      id: runId,
      outcome: 'success',
      result: report,
      durationMs,
      changed,
      resultHash: newHash,
    });

    setJobLastRun(job.id, startedAt, nextRunAt);
    if (job.status === 'error') setJobStatus(job.id, 'active');

    if (changed && job.webhookUrl) {
      fireWebhook(job, report).catch(console.error);
    }

    console.log(`[runner] Job "${job.name}" ✓ (${durationMs}ms)${changed ? ' [CHANGED]' : ''}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    const isTimeout = error.includes('Timeout');
    finishRun({
      id: runId,
      outcome: isTimeout ? 'timeout' : 'failure',
      error,
      durationMs,
      changed: false,
    });
    setJobStatus(job.id, 'error');
    console.error(`[runner] Job "${job.name}" pipeline ${isTimeout ? 'timeout' : 'error'}: ${error}`);
  }
}
```

Remove the `getCollector` import and the `withTimeout` import if no longer used elsewhere.

- [ ] **Step 2: Commit**

```bash
git add src/jobs/runner.ts
git commit -m "feat: integrate agent pipeline into job runner"
```

---

### Task 15: Update scheduler (remove analysis scheduling)

**Files:**
- Modify: `src/jobs/scheduler.ts`

- [ ] **Step 1: Remove analysis scheduling**

Remove:
- The `analysisTasks` Map
- The `scheduleAnalysis()` function
- The `unscheduleAnalysis()` function
- The call to `scheduleAnalysis(job)` inside `scheduleJob()`
- The import of `runAnalysis`

- [ ] **Step 2: Commit**

```bash
git add src/jobs/scheduler.ts
git commit -m "refactor: remove analysis scheduling from scheduler"
```

---

### Task 16: Update API routes

**Files:**
- Modify: `src/api/routes.ts`

- [ ] **Step 1: Remove analysis routes**

Remove these routes:
- `GET /jobs/:id/analyses`
- `GET /jobs/:id/analyses/latest`
- `POST /jobs/:id/analyze`

Remove imports: `listAnalyses`, `getLatestAnalysis`, `runAnalysis`.

- [ ] **Step 2: Add run stages route**

```typescript
router.get('/jobs/:id/runs/:runId/stages', (req, res) => {
  const stages = listRunStages(req.params.runId);
  res.json({ data: stages });
});
```

Import `listRunStages` from `../db/queries.js`.

- [ ] **Step 3: Update job creation/update schemas**

In `CreateJobSchema`, replace:
```typescript
  analysisPrompt: z.string().optional(),
  analysisSchedule: z.string().default('0 * * * *'),
```
with:
```typescript
  jobPrompt: z.string().optional(),
  jobParams: z.record(z.string()).optional(),
```

Do the same in the update schema.

- [ ] **Step 4: Commit**

```bash
git add src/api/routes.ts
git commit -m "feat: add run stages API, remove analysis routes"
```

---

### Task 17: Remove old files

**Files:**
- Remove: `src/jobs/analyzer.ts`
- Remove: `src/llm/bedrock.ts`
- Remove: `src/collectors/base.ts`
- Remove: `src/collectors/html.ts`
- Remove: `src/collectors/browser.ts`
- Remove: `src/collectors/api.ts`
- Remove: `src/collectors/rss.ts`
- Remove: `src/collectors/graphql.ts`
- Remove: `src/collectors/selectors.ts`

- [ ] **Step 1: Delete old files**

```bash
rm src/jobs/analyzer.ts
rm src/llm/bedrock.ts
rm -rf src/collectors/
```

- [ ] **Step 2: Fix any remaining import references**

Search for any remaining imports from deleted modules and update or remove them:

```bash
grep -r "from.*collectors" src/ --include="*.ts"
grep -r "from.*analyzer" src/ --include="*.ts"
grep -r "from.*llm/bedrock" src/ --include="*.ts"
```

Fix any found references.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old collectors, analyzer, and bedrock client"
```

---

## Chunk 4: Frontend Updates

### Task 18: Update frontend API types and client

**Files:**
- Modify: `ui/src/api.ts`

- [ ] **Step 1: Add RunStage type**

```typescript
export type PipelineStage = 'collector' | 'summarizer' | 'researcher' | 'editor';

export interface RunStage {
  id: string;
  runId: string;
  stage: PipelineStage;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  errorType?: string;
  diagnostics?: string;
  durationMs?: number;
  modelId?: string;
  tokenCount?: number;
  createdAt: string;
}
```

- [ ] **Step 2: Add getRunStages API call**

```typescript
getRunStages: (jobId: string, runId: string) =>
  request<{ data: RunStage[] }>(`/jobs/${jobId}/runs/${runId}/stages`),
```

- [ ] **Step 3: Remove Analysis type and analysis API calls**

Remove the `Analysis` interface and these methods:
- `getAnalyses`
- `getLatestAnalysis`
- `triggerAnalysis`

- [ ] **Step 4: Update Job type**

Replace `analysisPrompt?: string` and `analysisSchedule?: string` with:
```typescript
  jobPrompt?: string;
  jobParams?: Record<string, string>;
```

- [ ] **Step 5: Commit**

```bash
cd /Users/pdamra/Workspace/kali/croniq
git add ui/src/api.ts
git commit -m "feat: update frontend API types for pipeline"
```

---

### Task 19: Update JobDetail component

**Files:**
- Modify: `ui/src/components/JobDetail.tsx`

This is the largest UI change. The run detail view needs to:
1. Show the editor's markdown report as the primary content
2. Add three collapsible stage panels below (Collector, Summary, Research)
3. Remove the old analysis section entirely

- [ ] **Step 1: Remove the analysis section**

Remove all code related to:
- `analyses` state
- `selectedAnalysis` state
- `analyzing` state
- `triggerAnalysis` function
- `loadAnalyses` / `getAnalyses` / `getLatestAnalysis` calls
- The entire analysis card UI block

- [ ] **Step 2: Add stage data loading**

When a run is selected, fetch its stages:

```typescript
const [stages, setStages] = useState<RunStage[]>([]);

useEffect(() => {
  if (!selectedRun) return;
  api.getRunStages(job.id, selectedRun.id).then((res) => setStages(res.data));
}, [selectedRun, job.id]);
```

- [ ] **Step 3: Create StageBadge and StagePanel components**

First, create a `StageBadge` that maps pipeline stage status to appropriate visuals (do NOT reuse `StatusBadge` — that component is for job lifecycle states, not pipeline stages):

```typescript
function StageBadge({ status }: { status: 'success' | 'error' | 'skipped' }) {
  const config = {
    success: { label: 'success', color: 'var(--success)', bg: 'rgba(63,185,80,0.1)' },
    error: { label: 'error', color: 'var(--danger)', bg: 'rgba(248,81,73,0.1)' },
    skipped: { label: 'skipped', color: 'var(--text-2)', bg: 'var(--bg-2)' },
  }[status];

  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)',
      padding: '1px 6px', borderRadius: 3,
      color: config.color, background: config.bg,
    }}>
      {config.label}
    </span>
  );
}
```

Then create the collapsible `StagePanel`:

```typescript
function StagePanel({ stage, children }: {
  stage: RunStage;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ marginBottom: 8 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            {open ? '▾' : '▸'}
          </span>
          <span style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            textTransform: 'capitalize',
          }}>
            {stage.stage}
          </span>
          <StageBadge status={stage.status} />
        </div>
        <span style={{
          fontSize: 10,
          color: 'var(--text-2)',
          fontFamily: 'var(--font-mono)',
        }}>
          {stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : ''}
          {stage.tokenCount ? ` · ${stage.tokenCount} tokens` : ''}
        </span>
      </div>
      {open && (
        <div style={{
          padding: '0 14px 14px',
          borderTop: '1px solid var(--border)',
        }}>
          {stage.status === 'error' && (
            <div style={{
              padding: '8px 10px',
              marginTop: 10,
              background: 'rgba(248,81,73,0.08)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--danger)',
            }}>
              {stage.errorType}: {stage.error}
            </div>
          )}
          <div style={{ marginTop: 10 }}>{children}</div>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Replace run detail content**

When a run is selected, show:
1. The `result` field rendered as markdown (this is the editor's report)
2. Three stage panels below

```typescript
{/* Report (editor output) */}
{selectedRun?.result && (
  <div style={{ marginBottom: 16 }}>
    <div className="analysis-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        ),
      }}>
        {typeof selectedRun.result === 'string'
          ? selectedRun.result
          : JSON.stringify(selectedRun.result, null, 2)}
      </Markdown>
    </div>
  </div>
)}

{/* Stage panels */}
{stages.map((stage) => (
  <StagePanel key={stage.id} stage={stage}>
    {stage.stage === 'collector' ? (
      <CollectorPanel data={stage.output} />
    ) : stage.stage === 'summarizer' ? (
      <SummaryView data={stage.output} />
    ) : stage.stage === 'researcher' ? (
      <ResearchView data={stage.output} />
    ) : null}
  </StagePanel>
))}
```

- [ ] **Step 5: Create CollectorPanel component**

Extract the existing JS console REPL from the current run detail view in `JobDetail.tsx` (the `<input>` element and `evalExpression` logic near line ~371-420 of the current file). Wrap it into a standalone component that receives `data` as a prop:

```typescript
function CollectorPanel({ data }: { data: unknown }) {
  const [expr, setExpr] = useState('');
  const [replOutput, setReplOutput] = useState('');

  const evalExpression = (input: string) => {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('data', `return ${input}`);
      const result = fn(data);
      setReplOutput(JSON.stringify(result, null, 2));
    } catch (e) {
      setReplOutput(String(e));
    }
  };

  return (
    <div>
      <pre style={{
        fontSize: 11, fontFamily: 'var(--font-mono)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 300, overflow: 'auto', marginBottom: 10,
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') evalExpression(expr); }}
          placeholder="data.items[0].title"
          style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }}
        />
      </div>
      {replOutput && (
        <pre style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: 'var(--accent)', marginTop: 6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {replOutput}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create SummaryView component**

Renders the structured summary with relevance badges:

```typescript
function SummaryView({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const summary = data as {
    title?: string;
    overallSummary?: string;
    items?: Array<{ headline: string; summary: string; url?: string; relevance: string }>;
  };

  return (
    <div>
      {summary.overallSummary && (
        <p style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 12 }}>
          {summary.overallSummary}
        </p>
      )}
      {summary.items?.map((item, i) => (
        <div key={i} style={{
          padding: '8px 0',
          borderBottom: i < (summary.items?.length ?? 0) - 1 ? '1px solid var(--border)' : undefined,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Badge variant={item.relevance === 'high' ? 'accent' : 'muted'}>
              {item.relevance}
            </Badge>
            <span style={{ fontSize: 12, fontWeight: 500 }}>
              {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a> : item.headline}
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-2)', margin: 0 }}>{item.summary}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create ResearchView component**

```typescript
function ResearchView({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const research = data as {
    trends?: Array<{ description: string; confidence: string; supportingEvidence: string[] }>;
    relatedFindings?: Array<{ fromJob: string; connection: string; items: string[] }>;
    anomalies?: Array<{ description: string; severity: string }>;
  };

  return (
    <div>
      {research.trends && research.trends.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Trends</div>
          {research.trends.map((t, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Badge variant={t.confidence === 'high' ? 'accent' : 'muted'}>{t.confidence}</Badge>
                <span style={{ fontSize: 12 }}>{t.description}</span>
              </div>
              <ul style={{ fontSize: 11, color: 'var(--text-2)', margin: '4px 0 0 20px', padding: 0 }}>
                {t.supportingEvidence.map((e, j) => <li key={j}>{e}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {research.relatedFindings && research.relatedFindings.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Related</div>
          {research.relatedFindings.map((f, i) => (
            <div key={i} style={{ marginBottom: 6, fontSize: 12 }}>
              <strong>{f.fromJob}</strong>: {f.connection}
            </div>
          ))}
        </div>
      )}
      {research.anomalies && research.anomalies.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Anomalies</div>
          {research.anomalies.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <Badge variant={a.severity === 'high' ? 'danger' : 'muted'}>{a.severity}</Badge>
              <span style={{ fontSize: 12 }}>{a.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/JobDetail.tsx
git commit -m "feat: replace analysis view with pipeline stage panels"
```

---

### Task 20: Update JobForm component

**Files:**
- Modify: `ui/src/components/JobForm.tsx`

- [ ] **Step 1: Replace analysis fields with pipeline fields**

Remove:
- `analysisPrompt` state variable
- `analysisSchedule` state variable
- The analysis section UI (textarea + schedule presets)

Add:
- `jobPrompt` state: `useState(initial?.jobPrompt ?? '')`
- `jobParams` state: `useState<Record<string, string>>(initial?.jobParams ?? {})`

- [ ] **Step 2: Add job prompt textarea**

Replace the old analysis section with:

```typescript
{/* Pipeline Prompt */}
<div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
  <div style={fieldStyle}>
    <label style={labelStyle}>
      Job Prompt (optional — template for collector instructions)
    </label>
    <textarea
      value={jobPrompt}
      onChange={(e) => setJobPrompt(e.target.value)}
      rows={3}
      style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
      placeholder='e.g. Collect weather data for zip code {{zip}}'
    />
    <span style={{ fontSize: 10, color: 'var(--text-2)' }}>
      Use {'{{key}}'} syntax for template variables defined in params below
    </span>
  </div>

  {jobPrompt && (
    <div style={fieldStyle}>
      <label style={labelStyle}>Job Params</label>
      {Object.entries(jobParams).map(([key, value]) => (
        <div key={key} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <input
            value={key}
            onChange={(e) => {
              const newParams = { ...jobParams };
              delete newParams[key];
              newParams[e.target.value] = value;
              setJobParams(newParams);
            }}
            style={{ width: 120, fontSize: 12 }}
            placeholder="key"
          />
          <input
            value={value}
            onChange={(e) => setJobParams({ ...jobParams, [key]: e.target.value })}
            style={{ flex: 1, fontSize: 12 }}
            placeholder="value"
          />
          <Button size="sm" variant="danger" onClick={() => {
            const newParams = { ...jobParams };
            delete newParams[key];
            setJobParams(newParams);
          }}>✕</Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => {
        setJobParams({ ...jobParams, ['']: '' });
      }}>+ Add param</Button>
    </div>
  )}
</div>
```

- [ ] **Step 3: Update form submission**

In the `handleSubmit` function, replace `analysisPrompt`/`analysisSchedule` with:

```typescript
jobPrompt: jobPrompt || undefined,
jobParams: Object.keys(jobParams).length > 0 ? jobParams : undefined,
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/JobForm.tsx
git commit -m "feat: replace analysis fields with job prompt and params in form"
```

---

## Chunk 5: Verification and Cleanup

### Task 21: Verify full build

- [ ] **Step 1: Build backend**

```bash
cd /Users/pdamra/Workspace/kali/croniq
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 2: Build frontend**

```bash
cd ui && npm run build
```

Expected: No errors.

- [ ] **Step 3: Start server and verify**

```bash
cd /Users/pdamra/Workspace/kali/croniq
node dist/server.js &
sleep 2
curl -s http://localhost:3001/api/health | head
curl -s http://localhost:3001/api/jobs | head
kill %1
```

Expected: Health check returns OK, jobs endpoint returns data.

- [ ] **Step 4: Commit any fixes**

If build errors were found and fixed:

```bash
git add -A
git commit -m "fix: resolve build errors from pipeline integration"
```

---

### Task 22: Remove @aws-sdk/client-bedrock-runtime dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check if anything still imports it**

```bash
grep -r "client-bedrock-runtime" src/ --include="*.ts"
```

Expected: No results (all usages removed in earlier tasks).

- [ ] **Step 2: Uninstall**

```bash
npm uninstall @aws-sdk/client-bedrock-runtime
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: remove @aws-sdk/client-bedrock-runtime (replaced by @langchain/aws)"
```

---

### Task 23: Final commit and verification

- [ ] **Step 1: Run final build check**

```bash
npm run build && cd ui && npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 2: Git status check**

```bash
git status
git log --oneline -15
```

Expected: Clean working tree, all changes committed.

---

## Implementation Notes

**LangChain.js API patterns used in this plan:**

1. **Tools:** `import { tool } from '@langchain/core/tools'` — tools return strings (JSON.stringify for structured data).
2. **React agents:** `import { createReactAgent } from '@langchain/langgraph/prebuilt'` — used for collector (5 tools) and researcher (2 tools). Takes `{ llm, tools, messageModifier }`.
3. **Direct model invocation:** Summarizer and editor don't need tools, so they use `ChatBedrockConverse` directly. Summarizer uses `model.withStructuredOutput(ZodSchema)` for enforced structure.
4. **`ChatBedrockConverse`** from `@langchain/aws` — verify the exact constructor params. May need `credentials` config if IAM Roles Anywhere requires explicit credential provider.
5. **Messages:** `import { SystemMessage, HumanMessage } from '@langchain/core/messages'`.
6. **Agent invocation:** `createReactAgent` returns `{ messages: [...] }` — extract final message via `result.messages.at(-1).content`.

**Environment variables for model IDs:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `COLLECTOR_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Collector agent model |
| `SUMMARIZER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0` | Summarizer agent model |
| `RESEARCHER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6-v1:0` | Researcher agent model |
| `EDITOR_MODEL_ID` | `us.anthropic.claude-opus-4-6-v1:0` | Editor agent model |
| `AWS_REGION` | `us-east-1` | Bedrock region |
