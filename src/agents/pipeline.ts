import type { Job } from '../types/index.js';
import type {
  PipelineStage,
  RunStage,
  CollectorOutput,
  PipelineResult,
  StageErrorPayload,
  StageErrorType,
} from './types.js';
import { createCollectorAgent } from './collector.js';
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
import { CollectorOutputSchema, SourceResultSchema, type SourceResult } from './types.js';
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

// Invoke a createReactAgent agent (collector) — returns final message content + token sum
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

  // Stage 1: Collector (run all sources in parallel, aggregate results)
  const collectorResult = await runStage<CollectorOutput>(
    'collector',
    runId,
    async () => {
      const collectedAt = new Date().toISOString();

      console.log(`[pipeline] Collecting from ${job.sources.length} source${job.sources.length !== 1 ? 's' : ''} in parallel...`);

      // Collect from all sources in parallel
      const collectionPromises = job.sources.map(async (source) => {
        const sourceName = source.name ?? source.config.type;
        console.log(`[pipeline] → Starting collection: ${sourceName}`);

        try {
          const agent = createCollectorAgent(source.name, source.config, job);
          const url = 'url' in source.config ? (source.config as { url: string }).url : 'N/A';
          const message = `Collect data from: ${url}`;

          const { content, tokenCount } = await invokeReactAgent(agent, message);

          const json = extractJson(content);
          const singleResult = SourceResultSchema.parse(JSON.parse(json));

          console.log(`[pipeline] ✓ ${sourceName}: ${singleResult.itemCount ?? 0} items, ${tokenCount.toLocaleString()} tokens`);

          // Add source name to result
          return {
            result: {
              ...singleResult,
              sourceName: source.name,
            } as SourceResult,
            tokenCount,
          };
        } catch (err) {
          // If a source fails, record error but return partial result
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[pipeline] ✗ ${sourceName} failed:`, error);

          return {
            result: {
              sourceName: source.name,
              tool: source.config.type,
              sourceUrl: 'url' in source.config ? (source.config as { url: string }).url : 'unknown',
              rawData: null,
              fetchedAt: new Date().toISOString(),
              error,
            } as SourceResult,
            tokenCount: 0,
          };
        }
      });

      // Wait for all collections to complete (or fail)
      const settled = await Promise.allSettled(collectionPromises);

      // Extract results and sum tokens
      const sourceResults: SourceResult[] = [];
      let totalTokens = 0;

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          sourceResults.push(outcome.value.result);
          totalTokens += outcome.value.tokenCount;
        } else {
          // Promise itself rejected (shouldn't happen since we catch errors inside)
          console.error(`[pipeline] Unexpected promise rejection:`, outcome.reason);
          sourceResults.push({
            sourceName: 'unknown',
            tool: 'unknown',
            sourceUrl: 'unknown',
            rawData: null,
            fetchedAt: new Date().toISOString(),
            error: String(outcome.reason),
          });
        }
      }

      // Aggregate into multi-source output
      const totalItems = sourceResults.reduce((sum, r) => sum + (r.itemCount ?? 0), 0);
      const aggregated: CollectorOutput = {
        sources: sourceResults,
        totalItems,
        collectedAt,
      };

      const successCount = sourceResults.filter(r => !r.error).length;
      console.log(`[pipeline] Collection complete: ${successCount}/${job.sources.length} sources succeeded, ${totalItems} total items`);

      return { data: aggregated, tokenCount: totalTokens };
    },
    null,
    process.env.COLLECTOR_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  );
  stages.push(collectorResult.stage);

  // Stage 2: Editor (direct model, returns markdown string)
  const editorAgent = createEditorAgent(job);
  const editorMessage = `Write a report from this collected data:\n\n${JSON.stringify(collectorResult.data, null, 2)}`;
  const editorResult = await runStage<string>(
    'editor',
    runId,
    async () => editorAgent.invoke(editorMessage),
    collectorResult.data,
    process.env.EDITOR_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  );
  stages.push(editorResult.stage);

  const report = editorResult.isError ? null : (editorResult.data as string);
  return { stages, report };
};
