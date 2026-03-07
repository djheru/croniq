import { HtmlCollector } from '../collectors/html.js';
import { BrowserCollector } from '../collectors/browser.js';
import { ApiCollector } from '../collectors/api.js';
import { RssCollector } from '../collectors/rss.js';
import { GraphQLCollector } from '../collectors/graphql.js';
import type { Collector } from '../collectors/base.js';
import {
  createRun, finishRun, getLastRun, setJobLastRun, setJobStatus, hashResult,
} from '../db/queries.js';
import type { Job } from '../types/index.js';

function getCollector(job: Job): Collector {
  const cfg = job.collectorConfig;
  switch (cfg.type) {
    case 'html':    return new HtmlCollector(cfg);
    case 'browser': return new BrowserCollector(cfg);
    case 'api':     return new ApiCollector(cfg);
    case 'rss':     return new RssCollector(cfg);
    case 'graphql': return new GraphQLCollector(cfg);
    default:        throw new Error(`Unknown collector type`);
  }
}

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

  let attempt = 0;
  let lastError: Error | null = null;
  let result: unknown;

  while (attempt <= job.retries) {
    try {
      const collector = getCollector(job);
      const { data } = await withTimeout(collector.collect(), job.timeoutMs);
      result = data;
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      attempt++;
      if (attempt <= job.retries) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // backoff
      }
    }
  }

  const durationMs = Date.now() - start;
  const isTimeout = lastError?.message.includes('Timeout');

  if (lastError) {
    finishRun({
      id: runId,
      outcome: isTimeout ? 'timeout' : 'failure',
      error: lastError.message,
      durationMs,
      changed: false,
    });
    setJobStatus(job.id, 'error');
    console.error(`[runner] Job "${job.name}" failed: ${lastError.message}`);
    return;
  }

  // Detect changes vs last successful run
  const newHash = hashResult(result);
  const lastRun = getLastRun(job.id);
  const changed = !lastRun?.resultHash || lastRun.resultHash !== newHash;

  finishRun({
    id: runId,
    outcome: 'success',
    result,
    durationMs,
    changed,
    resultHash: newHash,
  });

  setJobLastRun(job.id, startedAt, nextRunAt);
  if (job.status === 'error') setJobStatus(job.id, 'active');

  // Fire webhook if configured and data changed
  if (changed && job.webhookUrl) {
    fireWebhook(job, result).catch(console.error);
  }

  console.log(
    `[runner] Job "${job.name}" ✓ (${durationMs}ms)${changed ? ' [CHANGED]' : ''}`
  );
}

async function fireWebhook(job: Job, result: unknown): Promise<void> {
  if (!job.webhookUrl) return;
  await fetch(job.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, jobName: job.name, result, timestamp: new Date().toISOString() }),
  });
}
