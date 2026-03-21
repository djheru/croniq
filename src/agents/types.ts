import { z } from 'zod';

// --- Pipeline stage metadata ---

export type PipelineStage = 'collector' | 'editor';
export type StageStatus = 'success' | 'error' | 'skipped';
export type StageErrorType = 'timeout' | 'llm_error' | 'validation_error' | 'tool_error';

export interface RunStage {
  id: string;
  runId: string;
  stage: PipelineStage;
  status: StageStatus;
  output?: unknown;
  error?: string;
  errorType?: StageErrorType;
  diagnostics?: string;
  durationMs?: number;
  modelId?: string;
  tokenCount?: number;
  createdAt: string;
}

// --- Error pass-through envelope ---

export interface StageErrorPayload {
  passthrough: unknown;
}

// --- Collector output ---

// Single source result
export const SourceResultSchema = z.object({
  sourceName: z.string().optional().describe('Display name of the source'),
  tool: z.string().describe('Which tool was used: rss_fetch, api_fetch, etc.'),
  sourceUrl: z.string(),
  rawData: z.unknown().describe('The raw data returned by the tool'),
  itemCount: z.number().optional().describe('Number of items if applicable'),
  fetchedAt: z.string().describe('ISO 8601 timestamp'),
  error: z.string().optional().describe('Error message if collection failed'),
});

export type SourceResult = z.infer<typeof SourceResultSchema>;

// Multi-source collector output
export const CollectorOutputSchema = z.object({
  sources: z.array(SourceResultSchema).describe('Results from each configured source'),
  totalItems: z.number().describe('Total items collected across all sources'),
  collectedAt: z.string().describe('ISO 8601 timestamp when collection started'),
});

export type CollectorOutput = z.infer<typeof CollectorOutputSchema>;

// --- Pipeline result ---

export interface PipelineResult {
  stages: RunStage[];
  report: string | null;
}

// Shared interface for createReactAgent return type (avoids TS2742 with LangGraph internals)
export interface ReactAgentLike {
  invoke: (input: { messages: import('@langchain/core/messages').BaseMessage[] }) => Promise<{
    messages?: Array<{ content: string | unknown }>;
  }>;
}
