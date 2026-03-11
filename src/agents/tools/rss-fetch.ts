import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import Parser from 'rss-parser';

const parser = new Parser();

type RssField = 'title' | 'link' | 'pubDate' | 'content' | 'author' | 'categories';

const fieldMap: Record<RssField, (item: Parser.Item) => unknown> = {
  title: (item) => item.title ?? null,
  link: (item) => item.link ?? null,
  pubDate: (item) => item.pubDate ?? item.isoDate ?? null,
  content: (item) => item.contentSnippet ?? item.content ?? null,
  author: (item) => item.creator ?? item.author ?? null,
  categories: (item) => item.categories ?? [],
};

export const rssFetch = tool(
  async ({ url, max_items, fields }) => {
    const feed = await parser.parseURL(url);
    const items = feed.items.slice(0, max_items).map((item) => {
      const extracted: Record<string, unknown> = {};
      for (const f of fields) {
        extracted[f] = fieldMap[f](item);
      }
      return extracted;
    });
    return JSON.stringify(items);
  },
  {
    name: 'rss_fetch',
    description: 'Fetch and parse an RSS or Atom feed. Returns an array of items with the specified fields.',
    schema: z.object({
      url: z.string().describe('The RSS/Atom feed URL'),
      max_items: z.number().default(20).describe('Maximum number of items to return'),
      fields: z.array(
        z.enum(['title', 'link', 'pubDate', 'content', 'author', 'categories'])
      ).describe('Which fields to extract from each feed item'),
    }),
  }
);
