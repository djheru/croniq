# Agent Pipeline Design

**Date:** 2026-03-10
**Scope:** Replace collectors and analyzer with a four-stage LangChain.js agent pipeline

---

## Summary

Replace Croniq's five standalone collectors and separate analyzer with a unified agent pipeline. Each job run executes four sequential agents: Collector, Summarizer, Researcher, and Editor. Agents use tiered LLM models via Bedrock, communicate through standardized data structures, and degrade gracefully on failure.

---

## Pipeline Architecture

### Sequential Flow

```
Schedule triggers job run
        |
        v
+-------------------+
| COLLECTOR AGENT   |  Model: Haiku
| Tools: rss_fetch, |  Input: job.collectorConfig + job_prompt + job_params
| api_fetch,        |  Output: CollectorOutput (raw data)
| html_scrape,      |
| browser_scrape,   |
| graphql_fetch     |
+--------+----------+
         | saved to run_stages
         v
+-------------------+
| SUMMARIZER AGENT  |  Model: Sonnet
| Tools: none       |  Input: CollectorOutput
|                   |  Output: SummaryOutput (standardized items)
+--------+----------+
         | saved to run_stages
         v
+-------------------+
| RESEARCHER AGENT  |  Model: Sonnet
| Tools: query_runs,|  Input: SummaryOutput + job context
| search_jobs       |  Output: ResearchOutput (trends, connections)
+--------+----------+
         | saved to run_stages
         v
+-------------------+
| EDITOR AGENT      |  Model: Opus
| Tools: none       |  Input: SummaryOutput + ResearchOutput
|                   |  Output: GitHub-flavored markdown report
+--------+----------+
         | saved to run_stages + run.result
         v
      Run complete
```

### Model Tiers

| Agent      | Model  | Reasoning                                           |
| ---------- | ------ | --------------------------------------------------- |
| Collector  | Haiku  | Mechanical tool orchestration, no reasoning needed   |
| Summarizer | Sonnet | Understands content, produces structured output      |
| Researcher | Sonnet | Reasons across historical data, spots trends         |
| Editor     | Opus   | Writes polished, insightful markdown reports         |

All models via Bedrock (authenticated on Pi via IAM Roles Anywhere).

### Error Pass-Through

If any stage fails, the pipeline continues. The `RunStage` record is saved with `status: 'error'`, the error message in `error`, and the error classification in `errorType`. The failed stage's `output` column stores a pass-through envelope so downstream agents still receive data:

```typescript
interface StageErrorPayload {
  passthrough: unknown;  // previous stage's output, forwarded as-is
}
```

The `error`, `errorType`, and `diagnostics` fields live on the `RunStage` record itself (not inside the output). Downstream agents receive the passthrough data along with context that the stage failed, and adapt accordingly. The editor always produces something, even if upstream stages failed.

---

## Collector Agent & Tools

The collector agent replaces the five collector classes. Existing collector logic becomes LangChain tools.

### Tools

**rss_fetch** -- wraps existing rss-parser logic:

```typescript
schema: z.object({
  url: z.string(),
  max_items: z.number().default(20),
  fields: z.array(z.enum(["title", "link", "pubDate", "content", "author", "categories"]))
})
```

**api_fetch** -- wraps existing fetch + extract logic:

```typescript
schema: z.object({
  url: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.record(z.unknown()).optional(),
  extract: z.string().optional()
})
```

**html_scrape** -- wraps existing cheerio logic:

```typescript
schema: z.object({
  url: z.string(),
  selectors: z.record(z.union([z.string(), z.object({
    selector: z.string(),
    attribute: z.string().optional(),
    multiple: z.boolean().optional(),
    transform: z.enum(["trim", "number", "lowercase", "uppercase"]).optional()
  })])),
  headers: z.record(z.string()).optional()
})
```

**browser_scrape** -- wraps existing Playwright logic:

```typescript
schema: z.object({
  url: z.string(),
  selectors: z.record(z.union([z.string(), z.object({
    selector: z.string(),
    attribute: z.string().optional(),
    multiple: z.boolean().optional(),
    transform: z.enum(["trim", "number", "lowercase", "uppercase"]).optional()
  })])),
  wait_for: z.string().optional(),
  scroll_to_bottom: z.boolean().optional()
})
```

**graphql_fetch** -- wraps existing GraphQL fetch logic:

```typescript
schema: z.object({
  url: z.string(),
  query: z.string(),
  variables: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  extract: z.string().optional()
})
```

### Job Config

Existing `collectorConfig` shape stays as-is (same discriminated union). New fields added to jobs:

- `job_prompt` -- template string with `{{placeholder}}` syntax for collector instructions
- `job_params` -- JSON key-value pairs that fill the template

The prompt template maps the config into the agent's system prompt so the agent knows which tool to call and with what parameters.

### Collector Output

The collector agent returns a generic envelope wrapping whatever the tool produced:

```typescript
const CollectorOutput = z.object({
  tool: z.string().describe("Which tool was used: rss_fetch, api_fetch, etc."),
  sourceUrl: z.string(),
  rawData: z.unknown().describe("The raw data returned by the tool"),
  itemCount: z.number().optional().describe("Number of items if applicable"),
  fetchedAt: z.string().describe("ISO 8601 timestamp")
});
```

This gives the summarizer a consistent shape regardless of which tool the collector called.

---

## Summarizer Agent

No tools. Pure LLM transformation with structured output enforced via Zod:

```typescript
const SummaryOutput = z.object({
  title: z.string(),
  sourceUrl: z.string(),
  collectedAt: z.string(),
  items: z.array(z.object({
    headline: z.string(),
    summary: z.string(),
    url: z.string().optional(),
    relevance: z.enum(["high", "medium", "low"]),
    metadata: z.record(z.unknown()).optional()
  })),
  overallSummary: z.string()
});
```

System prompt instructs it to rate item relevance based on the job's description, be concise, and preserve key facts without editorializing.

---

## Researcher Agent

Two tools for querying historical data:

**query_runs** -- search previous runs for a given job:

```typescript
schema: z.object({
  job_id: z.string(),
  limit: z.number().default(10),
  outcome_filter: z.enum(["all", "success", "changed"]).default("all")
})
```

Returns deserialized summarizer outputs from historical run stages.

**search_jobs** -- find related jobs by description:

```typescript
schema: z.object({
  query: z.string(),
  limit: z.number().default(5)
})
```

Returns matching job IDs, names, descriptions, and their latest summary. Each job has a short description that enables cross-job discovery. Search uses SQLite `LIKE '%term%'` on `name` and `description` columns — acceptable for the small dataset (~20-60 jobs).

### Structured Output

```typescript
const ResearchOutput = z.object({
  trends: z.array(z.object({
    description: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    supportingEvidence: z.array(z.string())
  })),
  relatedFindings: z.array(z.object({
    fromJob: z.string(),
    connection: z.string(),
    items: z.array(z.string())
  })),
  anomalies: z.array(z.object({
    description: z.string(),
    severity: z.enum(["high", "medium", "low"])
  }))
});
```

---

## Editor Agent

No tools. Receives summary and research outputs, produces a GitHub-flavored markdown report.

Report structure:

- Headline and date
- Key highlights (bullet points)
- Detailed findings organized by topic
- Trend analysis (if research data available)
- Cross-references to related data (if available)

If research was unavailable due to error, the editor notes this and focuses on the current collection.

Output is a plain markdown string -- no structured output schema needed.

---

## Data Model Changes

### New Table: `run_stages`

```sql
CREATE TABLE run_stages (
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
);

CREATE INDEX idx_run_stages_run_id ON run_stages(run_id);
CREATE INDEX idx_run_stages_run_stage ON run_stages(run_id, stage);
```

### Jobs Table Changes

- Remove: `analysis_prompt`, `analysis_schedule`
- Add: `job_prompt` (TEXT), `job_params` (TEXT, JSON)
- Keep: `collectorConfig` as-is

### Remove

- `analyses` table (functionality subsumed by researcher + editor)
- Existing data can be dropped -- clean slate

### Runs Table

- `result` holds the final editor markdown report
- `result_hash` computed from editor output for change detection
- `outcome`: `success` if editor produced output (even with upstream errors), `failure` only if collector fails entirely, `timeout` if the overall pipeline exceeds the job's `timeoutMs`

### TypeScript Types

```typescript
type PipelineStage = 'collector' | 'summarizer' | 'researcher' | 'editor';

interface RunStage {
  id: string;
  runId: string;
  stage: PipelineStage;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  errorType?: 'timeout' | 'llm_error' | 'validation_error' | 'tool_error';
  diagnostics?: string;
  durationMs?: number;
  modelId?: string;
  tokenCount?: number;
  createdAt: string;
}
```

---

## UI Changes

### Run Detail View

**Primary area:** Editor's markdown report rendered as GitHub-flavored markdown.

**Below the report:** Three collapsible panels, all collapsed by default:

| Panel     | Content                                       | JS Console |
| --------- | --------------------------------------------- | ---------- |
| Collector | Raw JSON data + interactive REPL              | Yes        |
| Summary   | Formatted items with relevance badges         | No         |
| Research  | Trends, related findings, anomalies           | No         |

Each panel header shows stage name, status badge (success/error/skipped), duration, and token count.

### Job Form

- Remove: `analysisPrompt` and `analysisSchedule` fields
- Add: `job_prompt` textarea with helper text explaining template variables
- Add: `job_params` key-value editor (add/remove rows)

---

## File Structure

### New Files

```
src/agents/
  pipeline.ts            # orchestrates the 4-stage pipeline
  collector.ts           # collector agent factory + system prompt
  summarizer.ts          # summarizer agent factory + system prompt
  researcher.ts          # researcher agent factory + system prompt
  editor.ts              # editor agent factory + system prompt
  tools/
    rss-fetch.ts         # wraps existing rss-parser logic
    api-fetch.ts         # wraps existing fetch + extract logic
    html-scrape.ts       # wraps existing cheerio logic
    browser-scrape.ts    # wraps existing Playwright logic
    graphql-fetch.ts     # wraps existing GraphQL fetch logic
    query-runs.ts        # researcher tool: query historical runs
    search-jobs.ts       # researcher tool: find related jobs
    selectors.ts         # moved from src/collectors/selectors.ts
  types.ts               # CollectorOutput, SummaryOutput, ResearchOutput schemas
  prompts.ts             # system prompt templates for all agents
```

### Modified Files

```
src/jobs/runner.ts       # replace collector.collect() with pipeline.run()
src/jobs/scheduler.ts    # remove analysis scheduling
src/types/index.ts       # add RunStage, PipelineStage, job_prompt/job_params
src/db/index.ts          # migration: run_stages table, drop analyses, schema changes
src/db/queries.ts        # add run_stages CRUD, remove analysis queries
src/api/routes.ts        # remove analysis endpoints, update job validation
ui/src/api.ts            # update types, remove analysis API calls
ui/src/components/
  JobDetail.tsx           # new run detail with stage panels
  JobForm.tsx             # replace analysis fields with prompt/params
```

### Removed Files

```
src/jobs/analyzer.ts     # replaced by pipeline
src/llm/bedrock.ts       # replaced by @langchain/aws
src/collectors/          # logic moves to agents/tools/
  base.ts
  html.ts
  browser.ts
  api.ts
  rss.ts
  graphql.ts
```

### Moved Files

```
src/collectors/selectors.ts  →  src/agents/tools/selectors.ts
```

### Dependencies

```
# Add
langchain
@langchain/aws

# Remove
@aws-sdk/client-bedrock-runtime
```

---

## What Stays the Same

- Job scheduling via node-cron
- SQLite database (better-sqlite3, WAL mode)
- Express API server
- React/Vite frontend
- Drag-and-drop job reordering
- Job CRUD, pause/resume
- Change detection via result hash
- Webhook notifications
