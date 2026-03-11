import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { summarizerSystemPrompt } from './prompts.js';
import { SummaryOutputSchema, type SummaryOutput } from './types.js';

const SUMMARIZER_MODEL_ID = process.env.SUMMARIZER_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6-v1:0';

export const createSummarizerAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: SUMMARIZER_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  const structuredModel = model.withStructuredOutput(SummaryOutputSchema);

  return {
    invoke: async (input: string): Promise<SummaryOutput> => {
      return await structuredModel.invoke([
        new SystemMessage(summarizerSystemPrompt(job)),
        new HumanMessage(input),
      ]);
    },
  };
};
