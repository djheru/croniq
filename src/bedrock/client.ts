import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

/**
 * Analyze collected data with the Bedrock model.
 *
 * @param rawData  JSON-stringified collector results
 * @param jobPrompt  Job-specific instructions; drives output format
 * @param jobName  Human-readable job name for system prompt context
 * @param previousAnalysis  Optional previous run's analysis markdown — enables
 *                          the "Suggestions for Next Run" feedback loop where
 *                          each run primes the next with context
 */
export async function analyzeWithBedrock(
  rawData: string,
  jobPrompt: string,
  jobName: string,
  previousAnalysis?: string,
): Promise<{ analysis: string; inputTokens: number; outputTokens: number }> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  // System prompt is intentionally format-neutral. The job prompt defines
  // structure, tone, and output format — the system prompt just establishes
  // role and defers to those instructions.
  const systemPrompt =
    `You are producing a scheduled intelligence report for the job: ${jobName}. ` +
    `Follow the job\'s instructions exactly — the job prompt defines the output format, sections, and focus. ` +
    `If the job asks for a link listing, produce a link listing. If it asks for analysis, produce analysis. ` +
    `Always respond in GitHub-Flavored Markdown. Preserve article URLs as clickable markdown links ([title](url)) whenever the data contains them.`;

  // Build user message: optional previous analysis for continuity,
  // then the current raw data, then the job-specific instructions.
  const userMessageParts: string[] = [];

  if (previousAnalysis && previousAnalysis.trim().length > 0) {
    userMessageParts.push(
      `## Previous run\'s analysis (for context and continuity)\n\n` +
      `The previous run produced the following report. If it contains a "Suggestions for Next Run" ` +
      `section (or similar), use those suggestions to guide your current analysis and track developing stories.\n\n` +
      `\`\`\`markdown\n${previousAnalysis}\n\`\`\``,
    );
  }

  userMessageParts.push(`## Newly collected data\n\n\`\`\`json\n${rawData}\n\`\`\``);
  userMessageParts.push(`## Job instructions\n\n${jobPrompt}`);

  const response = await client.send(new ConverseCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages: [{
      role: 'user',
      content: [{ text: userMessageParts.join('\n\n') }],
    }],
    inferenceConfig: { temperature: 0.3, maxTokens: 4096 },
  }));

  const textBlock = response.output?.message?.content?.find(b => 'text' in b);
  if (!textBlock || !('text' in textBlock) || !textBlock.text) {
    throw new Error('Bedrock returned no text content');
  }

  return {
    analysis: textBlock.text,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
  };
}
