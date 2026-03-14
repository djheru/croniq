/**
 * Test which Bedrock models are accessible.
 * Run: npx tsx scripts/test-models.ts
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const client = new BedrockRuntimeClient({ region: REGION });

const models = [
  // Claude 4.6
  'us.anthropic.claude-opus-4-6-v1',
  'us.anthropic.claude-sonnet-4-6',
  // Claude 4.5
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'us.anthropic.claude-opus-4-5-20251101-v1:0',
  // Llama 4
  'us.meta.llama4-maverick-17b-instruct-v1:0',
  'us.meta.llama4-scout-17b-instruct-v1:0',
];

async function testModel(modelId: string): Promise<void> {
  const start = Date.now();
  try {
    const isLlama = modelId.startsWith('meta.');

    const body = isLlama
      ? JSON.stringify({
          prompt: 'Tell me something interesting in one sentence.',
          max_gen_len: 100,
        })
      : JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          messages: [{ role: 'user', content: 'Tell me something interesting in one sentence.' }],
          max_tokens: 100,
        });

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const elapsed = Date.now() - start;

    // Extract text from response
    let text: string;
    if (isLlama) {
      text = result.generation?.trim() ?? JSON.stringify(result);
    } else {
      text = result.content?.[0]?.text?.trim() ?? JSON.stringify(result);
    }

    console.log(`  ✓ ${modelId}`);
    console.log(`    ${text.slice(0, 120)}`);
    console.log(`    (${elapsed}ms)\n`);
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const error = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = error.$metadata?.httpStatusCode ?? '?';
    console.log(`  ✗ ${modelId} [${status}] (${elapsed}ms)`);
    console.log(`    ${error.name}: ${error.message?.slice(0, 150)}`);

    // Provide actionable guidance
    if (error.name === 'AccessDeniedException' || status === 403) {
      console.log(`    → Enable this model in the AWS Console: Amazon Bedrock > Model access > Request access`);
    } else if (error.name === 'ThrottlingException' || status === 429) {
      console.log(`    → Model is enabled but quota is 0. Request a quota increase:`);
      console.log(`      AWS Console > Service Quotas > Amazon Bedrock > Search for the model`);
    } else if (error.name === 'ValidationException' || status === 400) {
      console.log(`    → Model ID may be invalid or the request format is wrong`);
    }
    console.log();
  }
}

async function main() {
  console.log(`Testing Bedrock models in ${REGION}...\n`);
  for (const modelId of models) {
    await testModel(modelId);
  }
  console.log('Done.');
}

main().catch(console.error);
