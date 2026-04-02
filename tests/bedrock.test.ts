// tests/bedrock.test.ts
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { analyzeWithBedrock } from '../src/bedrock/client';

const bedrockMock = mockClient(BedrockRuntimeClient);

beforeEach(() => bedrockMock.reset());

describe('analyzeWithBedrock', () => {
  it('returns analysis and token counts', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# Report\n\nSome analysis.' }] } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    const result = await analyzeWithBedrock('{"items":[1,2]}', 'Summarize this data', 'Test Job');
    expect(result.analysis).toBe('# Report\n\nSome analysis.');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('throws on empty response', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [] } },
      usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    });

    await expect(analyzeWithBedrock('{}', 'prompt', 'job')).rejects.toThrow();
  });
});
