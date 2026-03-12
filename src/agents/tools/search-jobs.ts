import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { listJobs, listRunStages, getLastRun } from '../../db/queries.js';

export const searchJobs: StructuredToolInterface = tool(
  async ({ query, limit }) => {
    const allJobs = listJobs();
    const queryLower = query.toLowerCase();

    const matched = allJobs
      .filter((j) => {
        const name = j.name.toLowerCase();
        const desc = (j.description ?? '').toLowerCase();
        return name.includes(queryLower) || desc.includes(queryLower);
      })
      .slice(0, limit);

    const results = matched.map((job) => {
      const lastRun = getLastRun(job.id);
      let latestSummary = null;
      if (lastRun) {
        const stages = listRunStages(lastRun.id);
        const summaryStage = stages.find((s) => s.stage === 'summarizer' && s.status === 'success');
        latestSummary = summaryStage?.output ?? null;
      }
      return {
        jobId: job.id,
        name: job.name,
        description: job.description,
        latestSummary,
      };
    });

    return JSON.stringify(results);
  },
  {
    name: 'search_jobs',
    description: 'Search for related jobs by name or description. Returns matching jobs with their latest summary.',
    schema: z.object({
      query: z.string().describe('Search terms to find related jobs'),
      limit: z.number().default(5).describe('Maximum number of jobs to return'),
    }),
  }
);
