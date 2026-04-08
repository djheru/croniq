// tests/bedrock.test.ts
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { analyzeWithBedrock, extractSuggestionsSection } from '../src/bedrock/client';

const bedrockMock = mockClient(BedrockRuntimeClient);

beforeEach(() => bedrockMock.reset());

describe('extractSuggestionsSection', () => {
  it('returns null for empty input', () => {
    expect(extractSuggestionsSection('')).toBeNull();
    expect(extractSuggestionsSection('   ')).toBeNull();
  });

  it('returns null when no suggestions section exists (legacy analyses)', () => {
    const oldAnalysis = '# Report\n\n## Summary\nSome old analytical content.\n\n## Conclusions\nAll done.';
    expect(extractSuggestionsSection(oldAnalysis)).toBeNull();
  });

  it('extracts suggestions from **bold** heading style', () => {
    const analysis = `# Report\n\n**Article Listing:**\n- Story A\n\n**Suggestions for Next Run:**\n- Watch for X\n- Track Y\n- Monitor Z`;
    const result = extractSuggestionsSection(analysis);
    expect(result).toContain('Watch for X');
    expect(result).toContain('Track Y');
    expect(result).toContain('Monitor Z');
    expect(result).not.toContain('Article Listing');
    expect(result).not.toContain('Story A');
  });

  it('extracts suggestions from ## heading style', () => {
    const analysis = `# Report\n\n## Curation Notes\nSome notes.\n\n## Suggestions for Next Run\n- Item 1\n- Item 2`;
    const result = extractSuggestionsSection(analysis);
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
    expect(result).not.toContain('Curation Notes');
  });

  it('stops at next top-level heading if present', () => {
    const analysis = `**Suggestions for Next Run:**\n- Alpha\n- Beta\n\n**Appendix**\nIrrelevant content`;
    const result = extractSuggestionsSection(analysis);
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
    expect(result).not.toContain('Appendix');
    expect(result).not.toContain('Irrelevant');
  });

  it('truncates to MAX_PREVIOUS_CONTEXT_CHARS with ellipsis', () => {
    const longList = Array.from({ length: 100 }, (_, i) => `- Very long suggestion item number ${i} with extra padding text`).join('\n');
    const analysis = `**Suggestions for Next Run:**\n${longList}`;
    const result = extractSuggestionsSection(analysis);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1250); // 1200 cap + "(truncated)" suffix
    expect(result).toContain('...(truncated)');
  });

  it('is case-insensitive on the header', () => {
    const analysis = `**suggestions FOR next run:**\n- Lower case test`;
    const result = extractSuggestionsSection(analysis);
    expect(result).toContain('Lower case test');
  });
});

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

  it('caps maxTokens at 1800', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# Report' }] } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    await analyzeWithBedrock('{}', 'prompt', 'job');

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { inferenceConfig?: { maxTokens?: number } };
    expect(input.inferenceConfig?.maxTokens).toBe(1800);
  });

  it('throws on empty response', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [] } },
      usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    });

    await expect(analyzeWithBedrock('{}', 'prompt', 'job')).rejects.toThrow();
  });

  it('injects only the suggestions section from previous analysis', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# New report' }] } },
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    });

    const previousAnalysis =
      '# Previous report\n\n' +
      '**Article Listing:**\n- Story A with very long content that should NOT be injected\n- Story B also very long\n\n' +
      '**Curation Notes:**\n- Note 1\n- Note 2\n\n' +
      '**Suggestions for Next Run:**\n- Watch for X development\n- Track Y story';

    await analyzeWithBedrock('{"items":[3]}', 'Curate links', 'Test Job', previousAnalysis);

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { messages: { content: { text: string }[] }[] };
    const userText = input.messages[0].content[0].text;

    // Suggestions should be present
    expect(userText).toContain('Watch for X');
    expect(userText).toContain('Track Y');
    // Previous article listing should NOT be present (only suggestions extracted)
    expect(userText).not.toContain('Story A with very long content');
    expect(userText).not.toContain('Story B also very long');
    // Curation notes from previous run should also NOT be present
    expect(userText).not.toContain('Note 1');
    // New data and instructions should be present
    expect(userText).toContain('Newly collected data');
    expect(userText).toContain('"items":[3]');
    expect(userText).toContain('Curate links');
  });

  it('omits previous context section when previous analysis has no suggestions section', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '# Report' }] } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    // Old-style analytical prompt output without Suggestions section
    const legacyAnalysis = '# Report\n\n## Summary\nOld style analysis without any forward-looking suggestions.';
    await analyzeWithBedrock('{"items":[1]}', 'Summarize', 'Job', legacyAnalysis);

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input as { messages: { content: { text: string }[] }[] };
    const userText = input.messages[0].content[0].text;

    expect(userText).not.toContain('Previous run');
    expect(userText).not.toContain('Old style analysis');
    expect(userText).toContain('Newly collected data');
  });

  it('omits previous context when undefined', async () => {
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
});
