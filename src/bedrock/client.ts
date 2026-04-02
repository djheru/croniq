import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

export async function analyzeWithBedrock(
  rawData: string,
  jobPrompt: string,
  jobName: string,
): Promise<{ analysis: string; inputTokens: number; outputTokens: number }> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  const response = await client.send(new ConverseCommand({
    modelId,
    system: [{ text: `You are writing a scheduled intelligence report for the job: ${jobName}. Write a concise markdown report analyzing the data provided. Use headers, bullet points, and clear language. Focus on patterns, changes, and key insights.` }],
    messages: [{
      role: 'user',
      content: [{ text: `Data collected:\n\`\`\`json\n${rawData}\n\`\`\`\n\nAdditional instructions: ${jobPrompt}` }],
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
