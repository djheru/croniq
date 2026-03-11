import { runPipeline } from '../agents/pipeline.js';
import {
  createRun, finishRun, getLastRun, setJobLastRun, setJobStatus, hashResult,
} from '../db/queries.js';
import type { Job } from '../types/index.js';

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function runJob(job: Job, nextRunAt?: string): Promise<void> {
  const { id: runId, startedAt } = createRun(job.id);
  const start = Date.now();

  try {
    const { stages, report } = await withTimeout(runPipeline(job, runId), job.timeoutMs);
    const durationMs = Date.now() - start;

    // Check if collector stage succeeded
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

async function fireWebhook(job: Job, result: unknown): Promise<void> {
  if (!job.webhookUrl) return;
  await fetch(job.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() }),
  });
}
