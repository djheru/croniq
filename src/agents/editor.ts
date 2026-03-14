import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { editorSystemPrompt } from './prompts.js';

const EDITOR_MODEL_ID = process.env.EDITOR_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const createEditorAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: EDITOR_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  return {
    invoke: async (input: string): Promise<{ data: string; tokenCount: number }> => {
      const response = await model.invoke([
        new SystemMessage(editorSystemPrompt(job)),
        new HumanMessage(input),
      ]);
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const usage = (response as unknown as Record<string, unknown>).usage_metadata as
        { input_tokens?: number; output_tokens?: number } | undefined;
      const tokenCount = usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : 0;
      return { data: content, tokenCount };
    },
  };
};
