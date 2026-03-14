import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { summarizerSystemPrompt } from './prompts.js';
import { SummaryOutputSchema, type SummaryOutput } from './types.js';

const SUMMARIZER_MODEL_ID = process.env.SUMMARIZER_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const createSummarizerAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: SUMMARIZER_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  const structuredModel = model.withStructuredOutput(SummaryOutputSchema, { includeRaw: true }) as unknown as {
    invoke: (messages: BaseMessage[]) => Promise<{ raw: BaseMessage; parsed: SummaryOutput }>;
  };

  return {
    invoke: async (input: string): Promise<{ data: SummaryOutput; tokenCount: number }> => {
      const result = await structuredModel.invoke([
        new SystemMessage(summarizerSystemPrompt(job)),
        new HumanMessage(input),
      ]);
      const usage = (result.raw as unknown as Record<string, unknown>).usage_metadata as
        { input_tokens?: number; output_tokens?: number } | undefined;
      const tokenCount = usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : 0;
      return { data: result.parsed, tokenCount };
    },
  };
};
