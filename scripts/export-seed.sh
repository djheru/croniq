#!/bin/bash
# Export current DB jobs to seed.ts
# Usage: bash scripts/export-seed.sh > scripts/seed.ts

DB="data/croniq.db"

# Get jobs as JSON array
JOBS=$(sqlite3 "$DB" --json "SELECT name, description, schedule, tags, notify_on_change, retries, timeout_ms, output_format, collector_config, job_prompt, job_params FROM jobs ORDER BY sort_order ASC")

# Transform with node (no native modules needed)
node --input-type=module -e "
const rows = JSON.parse(process.argv[1]);
const jobs = rows.map(r => ({
  name: r.name,
  description: r.description || undefined,
  schedule: r.schedule,
  tags: JSON.parse(r.tags),
  notifyOnChange: Boolean(r.notify_on_change),
  retries: r.retries,
  timeoutMs: r.timeout_ms,
  outputFormat: r.output_format,
  collectorConfig: JSON.parse(r.collector_config),
  jobPrompt: r.job_prompt || undefined,
  ...(r.job_params && r.job_params !== '{}' ? { jobParams: JSON.parse(r.job_params) } : {}),
}));

console.log(\`/**
 * Seed jobs for the agent pipeline.
 * Exported from local DB on \${new Date().toISOString().split('T')[0]}.
 * Run: npx tsx scripts/seed.ts
 */

const BASE = process.env.CRONIQ_URL ?? \"http://localhost:3001/api\";

const jobs = \${JSON.stringify(jobs, null, 2)};

async function seed() {
  // Clear existing jobs
  console.log(\\\`Clearing existing jobs from \\\${BASE}...\\\`);
  const existing = await fetch(\\\`\\\${BASE}/jobs\\\`).then((r) => r.json());
  for (const job of existing.data ?? existing) {
    await fetch(\\\`\\\${BASE}/jobs/\\\${job.id}\\\`, { method: \"DELETE\" });
  }
  console.log(\\\`  Cleared \\\${(existing.data ?? existing).length} jobs.\\\\n\\\`);

  console.log(\\\`Seeding jobs to \\\${BASE}...\\\\n\\\`);

  for (const job of jobs) {
    const res = await fetch(\\\`\\\${BASE}/jobs\\\`, {
      method: \"POST\",
      headers: { \"Content-Type\": \"application/json\" },
      body: JSON.stringify(job),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(\\\`  ✓ \\\${job.name} (\\\${job.collectorConfig.type})\\\`);
    } else {
      console.error(\\\`  ✗ \\\${job.name}:\\\`, data.error);
    }
  }

  console.log(\"\\\\nDone.\");
}

seed().catch(console.error);
\`);
" "$JOBS"
