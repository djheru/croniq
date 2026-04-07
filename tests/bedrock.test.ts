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

  it('includes previous analysis in the user message when provided', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# New report' }] } },
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    });

    const previousAnalysis = '# Previous report\n\n## Suggestions for Next Run\n- Watch for X\n- Track Y';
    await analyzeWithBedrock('{"items":[3]}', 'Curate links', 'Test Job', previousAnalysis);

    // The ConverseCommand was called once — inspect its input
    expect(bedrockMock).toHaveReceivedCommandTimes(ConverseCommand, 1);
    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { messages: { content: { text: string }[] }[] };
    const userText = input.messages[0].content[0].text;

    // Previous analysis should be present in the prompt
    expect(userText).toContain('Previous run');
    expect(userText).toContain('Watch for X');
    expect(userText).toContain('Track Y');
    // New data should also be present
    expect(userText).toContain('Newly collected data');
    expect(userText).toContain('"items":[3]');
    // Job instructions should be present
    expect(userText).toContain('Curate links');
  });

  it('omits previous analysis section when not provided', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# First run' }] } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    await analyzeWithBedrock('{"items":[1]}', 'Summarize', 'First Job');

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { messages: { content: { text: string }[] }[] };
    const userText = input.messages[0].content[0].text;

    expect(userText).not.toContain('Previous run');
    expect(userText).toContain('Newly collected data');
  });

  it('omits previous analysis section when empty string', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# Report' }] } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    await analyzeWithBedrock('{"items":[1]}', 'Summarize', 'Job', '   ');

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { messages: { content: { text: string }[] }[] };
    const userText = input.messages[0].content[0].text;

    expect(userText).not.toContain('Previous run');
  });
});
