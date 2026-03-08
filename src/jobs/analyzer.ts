import { listRuns, createAnalysis, getJob } from '../db/queries.js';
import { analyzeWithLLM } from '../llm/bedrock.js';
import type { Job } from '../types/index.js';

export const runAnalysis = async (job: Job): Promise<void> => {
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
};
