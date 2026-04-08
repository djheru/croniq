import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// Hard ceiling on output tokens. At ~$4/M for Haiku, this caps single-run output cost at ~$0.007.
// Typical curated top-5 analysis runs at ~800-1200 tokens, so this acts as a safety net, not a constraint.
const MAX_OUTPUT_TOKENS = 1800;

// Maximum characters of previous-run context we inject. 1200 chars ≈ 300 tokens,
// enough to preserve the "Suggestions for Next Run" feedback loop without bloating input.
const MAX_PREVIOUS_CONTEXT_CHARS = 1200;

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

/**
 * Extract only the "Suggestions for Next Run" section from a previous analysis.
 *
 * Rationale: passing the full previous analysis (~2-3k tokens) as context on every
 * run caused severe input token bloat. The only forward-looking information the
 * model needs is the suggestions section — everything else is either in the
 * current data (still relevant) or rolled off the feed (no longer relevant).
 *
 * Returns null if no suggestions section is found (e.g., analyses from old prompts
 * that predate the feedback loop). In that case we inject no context at all.
 */
export function extractSuggestionsSection(analysis: string): string | null {
  if (!analysis || analysis.trim().length === 0) return null;

  // Find the header line containing "Suggestions for Next Run" — case-insensitive,
  // formatting-agnostic. Works with **bold**, ## headings, or plain text variants.
  const lower = analysis.toLowerCase();
  const headerIdx = lower.indexOf('suggestions for next run');
  if (headerIdx === -1) return null;

  // Content starts after the end of the header line
  const lineEndIdx = analysis.indexOf('\n', headerIdx);
  if (lineEndIdx === -1) return null;

  let section = analysis.slice(lineEndIdx + 1).trim();

  // Stop at the next markdown heading if present (** bold heading ** or # heading)
  // Bullets like "- item" don't trigger this — we only stop at section headings
  const nextHeadingMatch = section.match(/\n\s*(?:\*\*[^*\n]+\*\*\s*$|#{1,6}\s+\S)/m);
  if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
    section = section.slice(0, nextHeadingMatch.index).trim();
  }

  if (section.length === 0) return null;

  // Hard cap on section length for cost safety
  if (section.length > MAX_PREVIOUS_CONTEXT_CHARS) {
    section = section.slice(0, MAX_PREVIOUS_CONTEXT_CHARS) + '\n...(truncated)';
  }

  return section;
}

/**
 * Analyze collected data with the Bedrock model.
 *
 * @param rawData  JSON-stringified collector results
 * @param jobPrompt  Job-specific instructions; drives output format
 * @param jobName  Human-readable job name for system prompt context
 * @param previousAnalysis  Optional previous run's analysis markdown. Only the
 *                          "Suggestions for Next Run" section is extracted and
 *                          used, to enable the feedback loop without input bloat.
 */
export async function analyzeWithBedrock(
  rawData: string,
  jobPrompt: string,
  jobName: string,
  previousAnalysis?: string,
): Promise<{ analysis: string; inputTokens: number; outputTokens: number }> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  const systemPrompt =
    `You are producing a scheduled intelligence report for the job: ${jobName}. ` +
    `Follow the job\'s instructions exactly — the job prompt defines the output format, sections, and focus. ` +
    `If the job asks for a link listing, produce a link listing. If it asks for analysis, produce analysis. ` +
    `Always respond in GitHub-Flavored Markdown. Preserve article URLs as clickable markdown links ([title](url)) whenever the data contains them. ` +
    `Be concise — prefer short sentences and tight bullet points over long paragraphs.`;

  // Build user message: optional previous suggestions for continuity,
  // then the current raw data, then the job-specific instructions.
  const userMessageParts: string[] = [];

  if (previousAnalysis) {
    const suggestions = extractSuggestionsSection(previousAnalysis);
    if (suggestions) {
      userMessageParts.push(
        `## Previous run\'s suggestions (for continuity)\n\n` +
        `The previous run flagged the following items to watch for in this cycle. ` +
        `Use these to prioritize which stories to surface and track developing threads:\n\n` +
        suggestions,
      );
    }
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
    inferenceConfig: { temperature: 0.3, maxTokens: MAX_OUTPUT_TOKENS },
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
