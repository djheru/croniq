// tests/collectors/html.test.ts
import nock from 'nock';
import { collectHtml } from '../../src/collectors/html';

const SAMPLE_HTML = `<html><body>
  <h1 class="title">Hello World</h1>
  <ul class="items"><li>A</li><li>B</li><li>C</li></ul>
  <span data-price="42.5">Price</span>
</body></html>`;

beforeEach(() => nock.cleanAll());

describe('collectHtml', () => {
  it('extracts single element by selector', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { title: { selector: 'h1.title' } }
    }, 'src');
    expect(result.error).toBeUndefined();
    expect((result.data as any).title).toBe('Hello World');
  });

  it('extracts multiple elements with multiple: true', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { items: { selector: 'ul.items li', multiple: true } }
    }, 'src');
    expect((result.data as any).items).toEqual(['A', 'B', 'C']);
  });

  it('extracts attribute value', async () => {
    nock('https://example.com').get('/').reply(200, SAMPLE_HTML);
    const result = await collectHtml({
      type: 'html', url: 'https://example.com/',
      selectors: { price: { selector: '[data-price]', attribute: 'data-price', transform: 'number' } }
    }, 'src');
    expect((result.data as any).price).toBe(42.5);
  });

  it('returns error on network failure', async () => {
    nock('https://example.com').get('/').replyWithError('timeout');
    const result = await collectHtml({ type: 'html', url: 'https://example.com/', selectors: {} }, 'src');
    expect(result.error).toBeDefined();
  });
});
