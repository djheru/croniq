#!/usr/bin/env node
/**
 * Export all jobs from Croniq to a JSON file for backup
 *
 * Usage:
 *   npm run db:export                                    # exports to backups/{timestamp}.json
 *   npm run db:export backups/custom-name.json           # exports to custom file
 */

import 'dotenv/config';
import fs from "fs";
import path from "path";

const BASE = process.env.CRONIQ_URL ?? "http://localhost:3001/api";
const ADMIN_KEY = process.env.SESSION_SECRET;
if (!ADMIN_KEY) { console.error('[export] SESSION_SECRET env var is required'); process.exit(1); }
const adminHeaders = { 'X-Admin-Key': ADMIN_KEY };

async function exportJobs() {
  const outputFile = process.argv[2] ?? `backups/${Math.floor(Date.now() / 1000)}.json`;
  const outputPath = path.resolve(outputFile);

  console.log(`Exporting jobs from ${BASE}...`);

  try {
    const res = await fetch(`${BASE}/jobs`, { headers: adminHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const jobs = data.data ?? data;

    if (!Array.isArray(jobs)) {
      throw new Error("Expected jobs array from API");
    }

    // Transform jobs to seed format (strip runtime fields, convert null to undefined)
    const exportedJobs = jobs.map((job: any) => ({
      name: job.name,
      description: job.description,
      schedule: job.schedule,
      sources: job.sources,
      outputFormat: job.outputFormat,
      tags: job.tags,
      notifyOnChange: job.notifyOnChange,
      webhookUrl: job.webhookUrl || undefined,
      retries: job.retries,
      timeoutMs: job.timeoutMs,
      jobPrompt: job.jobPrompt,
      jobParams: job.jobParams,
    }));

    // Write to file with pretty formatting
    fs.writeFileSync(
      outputPath,
      JSON.stringify(exportedJobs, null, 2),
      "utf-8"
    );

    console.log(`\n✓ Exported ${exportedJobs.length} jobs to ${outputPath}`);
    console.log(`\nTo import on another machine:`);
    console.log(`  npx tsx scripts/seed.ts ${outputFile}`);
  } catch (err) {
    console.error(`\n✗ Export failed:`, err);
    process.exit(1);
  }
}

exportJobs();
