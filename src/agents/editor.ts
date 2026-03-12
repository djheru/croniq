import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { editorSystemPrompt } from './prompts.js';

const EDITOR_MODEL_ID = process.env.EDITOR_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1:0';

export const createEditorAgent = (job: Job) => {
  const model = new ChatBedrockConverse({
    model: EDITOR_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  return {
    invoke: async (input: string): Promise<string> => {
      const response = await model.invoke([
        new SystemMessage(editorSystemPrompt(job)),
        new HumanMessage(input),
      ]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    },
  };
};
