import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const getNestedValue = (obj: unknown, path: string): unknown => {
  return path.split('.').reduce((curr: unknown, key: string) => {
    if (curr && typeof curr === 'object' && key in curr) {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

export const apiFetch = tool(
  async ({ url, method, headers, body, extract }) => {
    const options: RequestInit = {
      method,
      headers: {
        'Accept': 'application/json',
        ...headers,
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    let data = await res.json();

    if (extract) {
      data = getNestedValue(data, extract);
    }

    return JSON.stringify(data);
  },
  {
    name: 'api_fetch',
    description: 'Fetch data from a REST/JSON API endpoint. Supports GET, POST, PUT, PATCH with optional dot-path extraction.',
    schema: z.object({
      url: z.string().describe('The API endpoint URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('GET').describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
      body: z.record(z.unknown()).optional().describe('Request body (for POST/PUT/PATCH)'),
      extract: z.string().optional().describe('Dot-path to extract from response, e.g. "data.items"'),
    }),
  }
);
