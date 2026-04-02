import { createHash } from 'node:crypto';
import { collectSources } from './collectors/index.js';
import type { SourceEntry } from './collectors/types.js';
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

  // Hoisted so the catch block can include them if Bedrock fails after collection succeeds.
  let rawDataStr: string | null = null;
  let contentHash: string | null = null;

  try {
    setRunStatus(run.id, 'collecting');
    const results = await collectSources(job.sources as SourceEntry[]);

    const allFailed = results.every(r => r.error !== undefined);
    if (allFailed) {
      const error = `all sources failed: ${results.map(r => r.error).join(', ')}`;
      completeRun(run.id, 'error', null, null, null, false, 0, 0, Date.now() - startTime, error);
      return;
    }

    rawDataStr = JSON.stringify(results);
    contentHash = createHash('sha256').update(rawDataStr).digest('hex');
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

    completeRun(run.id, 'complete', contentHash, rawDataStr, analysis, true, inputTokens, outputTokens, Date.now() - startTime, null);
    setJobLastRun(jobId, new Date().toISOString());

    if (job.notifyOnChange && previousRun?.contentHash !== contentHash && job.webhookUrl) {
      fireWebhook(job.webhookUrl, { jobId, jobName: job.name, runId: run.id, analysis }).catch(() => {});
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    completeRun(run.id, 'error', contentHash, rawDataStr, null, false, 0, 0, Date.now() - startTime, error);
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
