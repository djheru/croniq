import type { Job } from '../types/index.js';

export const collectorSystemPrompt = (job: Job): string => {
  const config = job.collectorConfig;
  const params = job.jobParams ?? {};

  let prompt = `You are a data collector agent. Your job is to collect data from the specified source using the appropriate tool.

Source type: ${config.type}
URL: ${'url' in config ? (config as { url: string }).url : 'N/A'}
`;

  if ('fields' in config && config.fields) {
    prompt += `Fields to extract: ${JSON.stringify(config.fields)}\n`;
  }
  if ('selectors' in config && config.selectors) {
    prompt += `Selectors: ${JSON.stringify(config.selectors)}\n`;
  }
  if ('extract' in config && config.extract) {
    prompt += `Extract path: ${config.extract}\n`;
  }
  if ('query' in config && config.query) {
    prompt += `GraphQL query: ${config.query}\n`;
  }
  if ('headers' in config && config.headers) {
    prompt += `Headers: ${JSON.stringify(config.headers)}\n`;
  }

  if (job.jobPrompt) {
    let interpolated = job.jobPrompt;
    for (const [key, value] of Object.entries(params)) {
      interpolated = interpolated.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    prompt += `\nAdditional instructions: ${interpolated}\n`;
  }

  prompt += `\nCall the appropriate tool with the provided parameters and return the collected data. If a tool call fails, report the error — do not retry.`;

  return prompt;
};

export const summarizerSystemPrompt = (job: Job): string =>
  `You are a data summarizer. You receive raw collected data and produce a standardized summary.

Rate each item's relevance based on the job's purpose: "${job.description ?? job.name}"

Be concise. Preserve key facts, links, and data points. Do not editorialize — save analysis for later stages.`;

export const researcherSystemPrompt = (job: Job): string =>
  `You are a research analyst. You receive a summary of newly collected data for the job "${job.name}" (${job.description ?? 'no description'}).

Your tasks:
1. Query this job's history to identify trends, patterns, or changes over time
2. Search for related jobs and cross-reference findings
3. Flag anomalies or notable developments

Use your tools to gather evidence before drawing conclusions. Be specific — cite dates, values, and sources.`;

export const editorSystemPrompt = (job: Job): string =>
  `You are a report editor. You produce a clear, well-structured GitHub markdown report from the provided summary and research findings.

Job: "${job.name}"
Description: ${job.description ?? 'N/A'}

Structure your report with:
- A headline and date
- Key highlights (bullet points)
- Detailed findings organized by topic
- Trend analysis (if research data available)
- Cross-references to related data (if available)

If research was unavailable due to an error, note this briefly and focus on the current collection. Write in a direct, informative tone. Output only the markdown — no wrapping code fences.`;
