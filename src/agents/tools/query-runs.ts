import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { listRuns, listRunStages } from '../../db/queries.js';

export const queryRuns: StructuredToolInterface = tool(
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
