import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

let client: BedrockRuntimeClient | null = null;

const getClient = (): BedrockRuntimeClient => {
  if (!client) {
    client = new BedrockRuntimeClient({ region: AWS_REGION });
  }
  return client;
};

export interface AnalysisInput {
  jobName: string;
  prompt: string;
  runs: Array<{
    startedAt: string;
    outcome: string;
    result?: unknown;
  }>;
}

export async function analyzeWithLLM(input: AnalysisInput): Promise<string> {
  const runsText = input.runs
    .map((r, i) => `--- Run ${i + 1} (${r.startedAt}, ${r.outcome}) ---\n${JSON.stringify(r.result, null, 2)}`)
    .join('\n\n');

  const userMessage = `Job: "${input.jobName}"

Here are the last ${input.runs.length} collection results:

${runsText}

---

${input.prompt}`;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
    system: 'You are an analyst for a scheduled data collection system called Croniq. The user will provide you with recent collection results and a specific analysis prompt. Provide concise, actionable insights. Use markdown formatting for readability.',
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await getClient().send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text;
}
