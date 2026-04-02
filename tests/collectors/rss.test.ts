// tests/collectors/rss.test.ts
import nock from 'nock';
import { collectRss } from '../../src/collectors/rss';

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item><title>Item 1</title><link>https://example.com/1</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
  <item><title>Item 2</title><link>https://example.com/2</link><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(() => nock.cleanAll());

describe('collectRss', () => {
  it('parses RSS feed and returns items', async () => {
    nock('https://feeds.example.com').get('/rss').reply(200, SAMPLE_RSS, { 'Content-Type': 'application/rss+xml' });
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss' }, 'feed');
    expect(result.error).toBeUndefined();
    const data = result.data as any;
    expect(data.items).toHaveLength(2);
    expect(data.items[0].title).toBe('Item 1');
  });

  it('respects maxItems cap', async () => {
    nock('https://feeds.example.com').get('/rss').reply(200, SAMPLE_RSS, { 'Content-Type': 'application/rss+xml' });
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss', maxItems: 1 }, 'feed');
    const data = result.data as any;
    expect(data.items).toHaveLength(1);
  });

  it('returns error on bad URL', async () => {
    nock('https://feeds.example.com').get('/rss').replyWithError('network error');
    const result = await collectRss({ type: 'rss', url: 'https://feeds.example.com/rss' }, 'feed');
    expect(result.error).toBeDefined();
    expect(result.data).toBeNull();
  });
});
