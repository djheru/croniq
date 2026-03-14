import { ChatBedrockConverse } from "@langchain/aws";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { SystemMessage } from "@langchain/core/messages";
import type { Job } from "../types/index.js";
import type { ReactAgentLike } from "./types.js";
import { collectorSystemPrompt } from "./prompts.js";
import { rssFetch } from "./tools/rss-fetch.js";
import { apiFetch } from "./tools/api-fetch.js";
import { htmlScrape } from "./tools/html-scrape.js";
import { browserScrape } from "./tools/browser-scrape.js";
import { graphqlFetch } from "./tools/graphql-fetch.js";

const COLLECTOR_MODEL_ID =
  process.env.COLLECTOR_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6";

const tools = [rssFetch, apiFetch, htmlScrape, browserScrape, graphqlFetch];

export const createCollectorAgent = (job: Job): ReactAgentLike => {
  const model = new ChatBedrockConverse({
    model: COLLECTOR_MODEL_ID,
    region: process.env.AWS_REGION ?? "us-east-1",
  });

  return createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(collectorSystemPrompt(job)),
  }) as unknown as ReactAgentLike;
};
