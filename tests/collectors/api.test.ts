// tests/collectors/api.test.ts
import nock from 'nock';
import { collectApi } from '../../src/collectors/api';

beforeEach(() => nock.cleanAll());
afterAll(() => nock.restore());

describe('collectApi', () => {
  it('fetches JSON and returns data', async () => {
    nock('https://api.example.com').get('/data').reply(200, { items: [1, 2, 3] });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/data' }, 'test-source');
    expect(result.source).toBe('test-source');
    expect(result.data).toEqual({ items: [1, 2, 3] });
    expect(result.error).toBeUndefined();
  });

  it('uses dot-path extraction when extract is set', async () => {
    nock('https://api.example.com').get('/data').reply(200, { results: { items: [1, 2, 3] } });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/data', extract: 'results.items' }, 'src');
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('returns error result on network failure', async () => {
    nock('https://api.example.com').get('/fail').replyWithError('connection refused');
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/fail' }, 'src');
    expect(result.error).toBeDefined();
    expect(result.data).toBeNull();
  });

  it('sends POST with body', async () => {
    nock('https://api.example.com').post('/submit', { foo: 'bar' }).reply(200, { ok: true });
    const result = await collectApi({ type: 'api', url: 'https://api.example.com/submit', method: 'POST', body: { foo: 'bar' } }, 'src');
    expect(result.data).toEqual({ ok: true });
  });
});
