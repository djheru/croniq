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
  if (msg.includes('Timeout') || msg.includes('timeout') || msg.includes('AbortError')) return 'timeout';
  if (msg.includes('validation') || msg.includes('schema') || msg.includes('parse')) return 'validation_error';
  if (msg.includes('tool') || msg.includes('Tool')) return 'tool_error';
  return 'llm_error';
};

const runStage = async <T>(
  stageName: PipelineStage,
  runId: string,
  agentFn: () => Promise<T>,
  previousData: unknown,
  modelId: string,
): Promise<StageResult<T>> => {
  const start = Date.now();
  try {
    const data = await agentFn();
    const durationMs = Date.now() - start;
    const stage = createRunStage({
      runId,
      stage: stageName,
      status: 'success',
      output: data,
      durationMs,
      modelId,
    });
    return { stage, data, isError: false };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    const errorType = classifyError(err);
    const diagnostics = err instanceof Error ? err.stack : undefined;
    const passthrough: StageErrorPayload = { passthrough: previousData };

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

import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { ResearchOutputSchema } from './types.js';

interface ReactAgentLike {
  invoke: (input: { messages: BaseMessage[] }) => Promise<{ messages?: BaseMessage[] }>;
}

// Invoke a createReactAgent agent (collector, researcher) — returns final message content
const invokeReactAgent = async (agent: ReactAgentLike, message: string): Promise<string> => {
  const result = await agent.invoke({
    messages: [new HumanMessage(message)],
  });
  const lastMsg = result.messages?.at(-1);
  return typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content);
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
      const raw = await invokeReactAgent(collectorAgent, collectorMessage);
      return JSON.parse(raw) as CollectorOutput;
    },
    null,
    process.env.COLLECTOR_MODEL_ID ?? 'haiku',
  );
  stages.push(collectorResult.stage);

  // Stage 2: Summarizer (direct model with withStructuredOutput)
  const summarizerAgent = createSummarizerAgent(job);
  const summarizerMessage = `Summarize this collected data:\n\n${JSON.stringify(collectorResult.data, null, 2)}`;
  const summarizerResult = await runStage<SummaryOutput>(
    'summarizer',
    runId,
    () => summarizerAgent.invoke(summarizerMessage),
    collectorResult.data,
    process.env.SUMMARIZER_MODEL_ID ?? 'sonnet',
  );
  stages.push(summarizerResult.stage);

  // Stage 3: Researcher (React agent with tools, then parse structured output)
  const researcherAgent = createResearcherAgent(job);
  const researcherMessage = `Analyze this summary for trends and cross-references. Current job ID: ${job.id}\n\n${JSON.stringify(summarizerResult.data, null, 2)}`;
  const researcherResult = await runStage<ResearchOutput>(
    'researcher',
    runId,
    async () => {
      const raw = await invokeReactAgent(researcherAgent, researcherMessage);
      return ResearchOutputSchema.parse(JSON.parse(raw));
    },
    summarizerResult.data,
    process.env.RESEARCHER_MODEL_ID ?? 'sonnet',
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
    () => editorAgent.invoke(editorMessage),
    { summary: summarizerResult.data, research: researcherResult.data },
    process.env.EDITOR_MODEL_ID ?? 'opus',
  );
  stages.push(editorResult.stage);

  const report = editorResult.isError ? null : (editorResult.data as string);
  return { stages, report };
};
