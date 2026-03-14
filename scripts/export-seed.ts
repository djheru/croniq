/**
 * Export current DB jobs as a seed file.
 * Run: npx tsx scripts/export-seed.ts > scripts/seed-exported.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'croniq.db');
const db = new Database(dbPath, { readonly: true });

interface JobRow {
  name: string;
  description: string | null;
  schedule: string;
  tags: string;
  notify_on_change: number;
  retries: number;
  timeout_ms: number;
  output_format: string;
  collector_config: string;
  job_prompt: string | null;
  job_params: string | null;
  sort_order: number;
}

const rows = db.prepare(
  'SELECT name, description, schedule, tags, notify_on_change, retries, timeout_ms, output_format, collector_config, job_prompt, job_params, sort_order FROM jobs ORDER BY sort_order ASC'
).all() as JobRow[];

const jobs = rows.map((r) => ({
  name: r.name,
  description: r.description ?? undefined,
  schedule: r.schedule,
  tags: JSON.parse(r.tags),
  notifyOnChange: Boolean(r.notify_on_change),
  retries: r.retries,
  timeoutMs: r.timeout_ms,
  outputFormat: r.output_format,
  collectorConfig: JSON.parse(r.collector_config),
  jobPrompt: r.job_prompt ?? undefined,
  ...(r.job_params && r.job_params !== '{}' ? { jobParams: JSON.parse(r.job_params) } : {}),
}));

// Generate seed file
const output = `/**
 * Seed jobs for the agent pipeline.
 * Exported from local DB on ${new Date().toISOString().split('T')[0]}.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";

const jobs = ${JSON.stringify(jobs, null, 2)};

async function seed() {
  // Clear existing jobs
  console.log(\`Clearing existing jobs from \${BASE}...\`);
  const existing = await fetch(\`\${BASE}/jobs\`).then((r) => r.json());
  for (const job of existing.data ?? existing) {
    await fetch(\`\${BASE}/jobs/\${job.id}\`, { method: "DELETE" });
  }
  console.log(\`  Cleared \${(existing.data ?? existing).length} jobs.\\n\`);

  console.log(\`Seeding jobs to \${BASE}...\\n\`);

  for (const job of jobs) {
    const res = await fetch(\`\${BASE}/jobs\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(\`  ✓ \${job.name} (\${job.collectorConfig.type})\`);
    } else {
      console.error(\`  ✗ \${job.name}:\`, data.error);
    }
  }

  console.log("\\nDone.");
}

seed().catch(console.error);
`;

console.log(output);

db.close();
