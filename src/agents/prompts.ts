import type { Job, CollectorConfig } from '../types/index.js';

export const collectorSystemPrompt = (sourceName: string | undefined, config: CollectorConfig, job: Job): string => {
  const params = job.jobParams ?? {};

  let prompt = `Collect from: ${sourceName ?? 'Unnamed'} (${config.type})
URL: ${'url' in config ? (config as { url: string }).url : 'N/A'}
`;

  if ('fields' in config && config.fields) {
    prompt += `Fields: ${JSON.stringify(config.fields)}\n`;
  }
  if ('selectors' in config && config.selectors) {
    prompt += `Selectors: ${JSON.stringify(config.selectors)}\n`;
  }
  if ('extract' in config && config.extract) {
    prompt += `Extract: ${config.extract}\n`;
  }
  if ('query' in config && config.query) {
    prompt += `Query: ${config.query}\n`;
  }
  if ('headers' in config && config.headers) {
    prompt += `Headers: ${JSON.stringify(config.headers)}\n`;
  }

  if (job.jobPrompt) {
    let interpolated = job.jobPrompt;
    for (const [key, value] of Object.entries(params)) {
      interpolated = interpolated.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    prompt += `\n${interpolated}\n`;
  }

  prompt += `\nReturn JSON: {"tool":"<tool_name>","sourceUrl":"<url>","rawData":<data>,"itemCount":<n>,"fetchedAt":"<iso8601>"}`;

  return prompt;
};

export const editorSystemPrompt = (job: Job): string =>
  `Write markdown report for: "${job.name}"${job.description ? ` (${job.description})` : ''}

Structure:
- Headline + date
- Key highlights (bullets)
- Findings by topic
- Patterns and analysis

Link all URLs as [text](url). Output markdown only, no code fences.`;
