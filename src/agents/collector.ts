import { ChatBedrockConverse } from '@langchain/aws';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { Job } from '../types/index.js';
import { collectorSystemPrompt } from './prompts.js';
import { rssFetch } from './tools/rss-fetch.js';
import { apiFetch } from './tools/api-fetch.js';
import { htmlScrape } from './tools/html-scrape.js';
import { browserScrape } from './tools/browser-scrape.js';
import { graphqlFetch } from './tools/graphql-fetch.js';

const COLLECTOR_MODEL_ID = process.env.COLLECTOR_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const tools = [rssFetch, apiFetch, htmlScrape, browserScrape, graphqlFetch];

interface ReactAgentLike {
  invoke: (input: { messages: BaseMessage[] }) => Promise<{ messages?: BaseMessage[] }>;
}

export const createCollectorAgent = (job: Job): ReactAgentLike => {
  const model = new ChatBedrockConverse({
    model: COLLECTOR_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  return createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(collectorSystemPrompt(job)),
  }) as unknown as ReactAgentLike;
};
