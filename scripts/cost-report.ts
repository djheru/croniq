/**
 * Per-run cost report — ground truth for cost analysis.
 *
 * This script hits /api/stats with a configurable time window and prints a
 * breakdown of cost by job for that window. Unlike the Croniq Stats job's
 * AI-generated report, this reads the raw numbers so there's no chance of
 * misinterpretation.
 *
 * Usage:
 *   npx tsx scripts/cost-report.ts              # last 24h
 *   npx tsx scripts/cost-report.ts 6            # last 6h
 *   npx tsx scripts/cost-report.ts 1            # last 1h  (post-deploy check)
 *   npx tsx scripts/cost-report.ts lifetime     # lifetime totals
 */

import 'dotenv/config';
import type { Job, Run } from '../src/types/index.js';

const CRONIQ_URL = process.env.CRONIQ_URL ?? 'http://localhost:3001/api';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('[cost-report] SESSION_SECRET env var is required');
  process.exit(1);
}

const adminHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Admin-Key': SESSION_SECRET,
};

// Haiku 4.5 pricing (matches the main API calculation)
const INPUT_PRICE_PER_M = 0.80;
const OUTPUT_PRICE_PER_M = 4.00;

interface StatsResponse {
  totalRuns: number;
  successRate: number;
  skippedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
  periodHours: number;
  estimatedCostUsd: number;
  recentRuns: Run[];
}

const formatCost = (dollars: number): string => `$${dollars.toFixed(4)}`;

const period = process.argv[2] ?? '24h';

const main = async (): Promise<void> => {
  const statsUrl = `${CRONIQ_URL}/stats?period=${encodeURIComponent(period)}`;
  console.log(`\n[cost-report] Fetching ${statsUrl}\n`);

  const statsRes = await fetch(statsUrl, { headers: adminHeaders });
  if (!statsRes.ok) {
    console.error(`[cost-report] /stats failed: ${statsRes.status} ${await statsRes.text()}`);
    process.exit(1);
  }
  const stats = (await statsRes.json()) as StatsResponse;

  const periodLabel = stats.periodHours === 0 ? 'LIFETIME' : `last ${stats.periodHours}h`;

  console.log(`─── Aggregate Stats (${periodLabel}) ───`);
  console.log(`  Total runs:          ${stats.totalRuns}`);
  console.log(`  Success rate:        ${stats.successRate}%`);
  console.log(`  Skipped (hash-gate): ${stats.skippedRuns}`);
  console.log(`  Input tokens:        ${stats.totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens:       ${stats.totalOutputTokens.toLocaleString()}`);
  console.log(`  Avg duration:        ${stats.avgDurationMs}ms`);
  console.log(`  Estimated cost:      ${formatCost(stats.estimatedCostUsd)}`);

  if (stats.totalRuns > 0) {
    const bedrockRuns = Math.max(1, stats.totalRuns - stats.skippedRuns);
    console.log(`  Cost per run:        ${formatCost(stats.estimatedCostUsd / stats.totalRuns)}`);
    console.log(`  Cost per Bedrock:    ${formatCost(stats.estimatedCostUsd / bedrockRuns)}`);
    console.log(`  Avg tokens/Bedrock:  ${Math.round(stats.totalInputTokens / bedrockRuns)} in / ${Math.round(stats.totalOutputTokens / bedrockRuns)} out`);
  }

  if (stats.recentRuns.length === 0) {
    console.log(`\n[cost-report] No recent runs to display.`);
    return;
  }

  // Fetch job list so we can resolve job IDs to names
  const jobsRes = await fetch(`${CRONIQ_URL}/jobs`, { headers: adminHeaders });
  const jobsWrap = (await jobsRes.json()) as { data: Job[] };
  const jobNameById = new Map<string, string>(jobsWrap.data.map((j) => [j.id, j.name]));

  console.log(`\n─── Recent Runs (${stats.recentRuns.length}) ───`);
  console.log('  status     tokens(in/out)       cost       job');
  console.log('  ─────────  ────────────────     ─────────  ─────────────────');

  for (const run of stats.recentRuns) {
    const cost =
      (run.inputTokens / 1_000_000) * INPUT_PRICE_PER_M +
      (run.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M;
    const tokenStr = `${run.inputTokens.toLocaleString().padStart(6)} / ${run.outputTokens.toLocaleString().padStart(5)}`;
    const jobName = (jobNameById.get(run.jobId) ?? '(unknown)').slice(0, 40);
    console.log(`  ${run.status.padEnd(9)}  ${tokenStr.padEnd(20)} ${formatCost(cost).padEnd(10)} ${jobName}`);
  }

  console.log('');
};

main().catch((err) => {
  console.error('[cost-report] Error:', err);
  process.exit(1);
});
