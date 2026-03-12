import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { getNestedValue } from './utils.js';

export const graphqlFetch: StructuredToolInterface = tool(
  async ({ url, query, variables, headers, extract }) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
    }

    const json = await res.json() as { data?: unknown; errors?: unknown[] };

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      return JSON.stringify({ error: 'GraphQL errors', details: json.errors });
    }

    let data = json.data;
    if (extract && data) {
      data = getNestedValue(data, extract);
    }

    return JSON.stringify(data);
  },
  {
    name: 'graphql_fetch',
    description: 'Execute a GraphQL query against an endpoint. Returns the data field, with optional dot-path extraction.',
    schema: z.object({
      url: z.string().describe('The GraphQL endpoint URL'),
      query: z.string().describe('The GraphQL query string'),
      variables: z.record(z.unknown()).optional().describe('Query variables'),
      headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
      extract: z.string().optional().describe('Dot-path to extract from response data'),
    }),
  }
);
