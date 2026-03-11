import { z } from 'zod';

// --- Pipeline stage metadata ---

export type PipelineStage = 'collector' | 'summarizer' | 'researcher' | 'editor';
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

export const CollectorOutputSchema = z.object({
  tool: z.string().describe('Which tool was used: rss_fetch, api_fetch, etc.'),
  sourceUrl: z.string(),
  rawData: z.unknown().describe('The raw data returned by the tool'),
  itemCount: z.number().optional().describe('Number of items if applicable'),
  fetchedAt: z.string().describe('ISO 8601 timestamp'),
});

export type CollectorOutput = z.infer<typeof CollectorOutputSchema>;

// --- Summarizer output ---

export const SummaryItemSchema = z.object({
  headline: z.string(),
  summary: z.string().describe('1-2 sentence summary'),
  url: z.string().optional(),
  relevance: z.enum(['high', 'medium', 'low']),
  metadata: z.record(z.unknown()).optional(),
});

export const SummaryOutputSchema = z.object({
  title: z.string().describe('Brief title for this collection'),
  sourceUrl: z.string(),
  collectedAt: z.string(),
  items: z.array(SummaryItemSchema),
  overallSummary: z.string().describe('2-3 sentence overview of the collection'),
});

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// --- Researcher output ---

export const ResearchOutputSchema = z.object({
  trends: z.array(z.object({
    description: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
    supportingEvidence: z.array(z.string()),
  })),
  relatedFindings: z.array(z.object({
    fromJob: z.string().describe('Job name'),
    connection: z.string().describe('How this relates'),
    items: z.array(z.string()).describe('Key relevant items'),
  })),
  anomalies: z.array(z.object({
    description: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
  })),
});

export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

// --- Pipeline result ---

export interface PipelineResult {
  stages: RunStage[];
  report: string | null;
}
