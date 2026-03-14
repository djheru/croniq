import type { Job } from '../types/index.js';
import type {
  PipelineStage,
  RunStage,
  CollectorOutput,
  SummaryOutput,
  ResearchOutput,
  PipelineResult,
  StageErrorPayload,
  StageErrorType,
} from './types.js';
import { createCollectorAgent } from './collector.js';
import { createSummarizerAgent } from './summarizer.js';
import { createResearcherAgent } from './researcher.js';
import { createEditorAgent } from './editor.js';
import { createRunStage } from '../db/queries.js';

interface StageResult<T> {
  stage: RunStage;
  data: T | StageErrorPayload;
  isError: boolean;
}

const classifyError = (err: unknown): StageErrorType => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ThrottlingException') || msg.includes('Too many requests') || msg.includes('rate') || msg.includes('quota')) return 'llm_error';
  if (msg.includes('Timeout') || msg.includes('timeout') || msg.includes('AbortError')) return 'timeout';
  if (msg.includes('validation') || msg.includes('schema') || msg.includes('parse')) return 'validation_error';
  if (msg.includes('tool') || msg.includes('Tool')) return 'tool_error';
  return 'llm_error';
};

const runStage = async <T>(
  stageName: PipelineStage,
  runId: string,
  agentFn: () => Promise<{ data: T; tokenCount: number }>,
  previousData: unknown,
  modelId: string,
): Promise<StageResult<T>> => {
  console.log(`[pipeline] ${stageName} starting (model: ${modelId})`);
  const start = Date.now();
  try {
    const { data, tokenCount } = await agentFn();
    const durationMs = Date.now() - start;
    console.log(`[pipeline] ${stageName} completed in ${durationMs}ms (${tokenCount.toLocaleString()} tokens)`);
    const stage = createRunStage({
      runId,
      stage: stageName,
      status: 'success',
      output: data,
      durationMs,
      modelId,
      tokenCount,
    });
    return { stage, data, isError: false };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    const errorType = classifyError(err);
    const diagnostics = err instanceof Error ? err.stack : undefined;
    const passthrough: StageErrorPayload = { passthrough: previousData };

    // Log the full error for debugging — includes Bedrock throttling, quota, auth details
    console.error(`[pipeline] ${stageName} FAILED after ${durationMs}ms [${errorType}]`);
    console.error(`[pipeline]   error: ${error}`);
    if (diagnostics) {
      // Log first 5 stack frames
      const frames = diagnostics.split('\n').slice(0, 6).join('\n');
      console.error(`[pipeline]   stack:\n${frames}`);
    }
    // Log the raw error object for Bedrock-specific fields ($metadata, Code, etc.)
    if (err && typeof err === 'object' && '$metadata' in err) {
      const meta = (err as Record<string, unknown>)['$metadata'];
      console.error(`[pipeline]   bedrock metadata:`, JSON.stringify(meta));
    }

    const stage = createRunStage({
      runId,
      stage: stageName,
      status: 'error',
      output: passthrough,
      error,
      errorType,
      diagnostics,
      durationMs,
      modelId,
    });
    return { stage, data: passthrough, isError: true };
  }
};

import { HumanMessage } from '@langchain/core/messages';
import { CollectorOutputSchema, ResearchOutputSchema } from './types.js';
import type { ReactAgentLike } from './types.js';

// Extract JSON from LLM output that may contain markdown, commentary, or code fences
const extractJson = (raw: string): string => {
  // Try direct parse first
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  // Strip code fences
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  // Find first { to last } as a fallback
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
};

interface AgentResult {
  content: string;
  tokenCount: number;
}

// Invoke a createReactAgent agent (collector, researcher) — returns final message content + token sum
const invokeReactAgent = async (agent: ReactAgentLike, message: string): Promise<AgentResult> => {
  const result = await agent.invoke({
    messages: [new HumanMessage(message)],
  });
  const lastMsg = result.messages?.at(-1);
  const content = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content);

  // Sum tokens across all messages (each LLM call adds usage_metadata to its response message)
  let tokenCount = 0;
  for (const msg of result.messages ?? []) {
    const usage = (msg as Record<string, unknown>).usage_metadata as
      { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      tokenCount += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    }
  }

  return { content, tokenCount };
};

export const runPipeline = async (job: Job, runId: string): Promise<PipelineResult> => {
  const stages: RunStage[] = [];

  // Stage 1: Collector (React agent with tools)
  const collectorAgent = createCollectorAgent(job);
  const collectorMessage = `Collect data from: ${'url' in job.collectorConfig ? (job.collectorConfig as { url: string }).url : 'configured source'}`;
  const collectorResult = await runStage<CollectorOutput>(
    'collector',
    runId,
    async () => {
      const { content, tokenCount } = await invokeReactAgent(collectorAgent, collectorMessage);
      const json = extractJson(content);
      return { data: CollectorOutputSchema.parse(JSON.parse(json)), tokenCount };
    },
    null,
    process.env.COLLECTOR_MODEL_ID ?? 'sonnet-4.6',
  );
  stages.push(collectorResult.stage);

  // Stage 2: Summarizer (direct model with withStructuredOutput)
  const summarizerAgent = createSummarizerAgent(job);
  const summarizerMessage = `Summarize this collected data:\n\n${JSON.stringify(collectorResult.data, null, 2)}`;
  const summarizerResult = await runStage<SummaryOutput>(
    'summarizer',
    runId,
    async () => summarizerAgent.invoke(summarizerMessage),
    collectorResult.data,
    process.env.SUMMARIZER_MODEL_ID ?? 'haiku-4.5',
  );
  stages.push(summarizerResult.stage);

  // Stage 3: Researcher (React agent with tools, then parse structured output)
  const researcherAgent = createResearcherAgent(job);
  const researcherMessage = `Analyze this summary for trends and cross-references. Current job ID: ${job.id}\n\n${JSON.stringify(summarizerResult.data, null, 2)}`;
  const researcherResult = await runStage<ResearchOutput>(
    'researcher',
    runId,
    async () => {
      const { content, tokenCount } = await invokeReactAgent(researcherAgent, researcherMessage);
      const json = extractJson(content);
      return { data: ResearchOutputSchema.parse(JSON.parse(json)), tokenCount };
    },
    summarizerResult.data,
    process.env.RESEARCHER_MODEL_ID ?? 'sonnet-4.6',
  );
  stages.push(researcherResult.stage);

  // Stage 4: Editor (direct model, returns markdown string)
  const editorAgent = createEditorAgent(job);
  const editorMessage = `Write a report from this data:

## Summary
${JSON.stringify(summarizerResult.data, null, 2)}

## Research
${JSON.stringify(researcherResult.data, null, 2)}`;
  const editorResult = await runStage<string>(
    'editor',
    runId,
    async () => editorAgent.invoke(editorMessage),
    { summary: summarizerResult.data, research: researcherResult.data },
    process.env.EDITOR_MODEL_ID ?? 'haiku-4.5',
  );
  stages.push(editorResult.stage);

  const report = editorResult.isError ? null : (editorResult.data as string);
  return { stages, report };
};
