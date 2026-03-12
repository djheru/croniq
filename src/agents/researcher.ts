import { ChatBedrockConverse } from '@langchain/aws';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import type { ReactAgentLike } from './types.js';
import { researcherSystemPrompt } from './prompts.js';
import { queryRuns } from './tools/query-runs.js';
import { searchJobs } from './tools/search-jobs.js';

const RESEARCHER_MODEL_ID = process.env.RESEARCHER_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6-v1:0';

export const createResearcherAgent = (job: Job): ReactAgentLike => {
  const model = new ChatBedrockConverse({
    model: RESEARCHER_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  return createReactAgent({
    llm: model,
    tools: [queryRuns, searchJobs],
    messageModifier: new SystemMessage(researcherSystemPrompt(job)),
  }) as unknown as ReactAgentLike;
};
