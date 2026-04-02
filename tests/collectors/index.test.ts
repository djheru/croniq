import { collectSources } from '../../src/collectors/index';
import * as apiCollector from '../../src/collectors/api';
import * as rssCollector from '../../src/collectors/rss';

jest.mock('../../src/collectors/api');
jest.mock('../../src/collectors/rss');
jest.mock('../../src/collectors/html');
jest.mock('../../src/collectors/browser');
jest.mock('../../src/collectors/graphql');

const mockCollectApi = jest.mocked(apiCollector.collectApi);
const mockCollectRss = jest.mocked(rssCollector.collectRss);

describe('collectSources', () => {
  it('dispatches to correct collector by type', async () => {
    mockCollectApi.mockResolvedValueOnce({ source: 'api-src', data: { ok: true } });
    const results = await collectSources([{ name: 'api-src', config: { type: 'api', url: 'https://example.com' } }]);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('api-src');
    expect(mockCollectApi).toHaveBeenCalledWith({ type: 'api', url: 'https://example.com' }, 'api-src');
  });

  it('continues collecting when one source fails', async () => {
    mockCollectApi.mockRejectedValueOnce(new Error('network down'));
    mockCollectRss.mockResolvedValueOnce({ source: 'rss-src', data: { items: [] } });
    const results = await collectSources([
      { name: 'broken', config: { type: 'api', url: 'https://fail.example.com' } },
      { name: 'rss-src', config: { type: 'rss', url: 'https://feeds.example.com/rss' } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].error).toBeDefined();
    expect(results[1].error).toBeUndefined();
  });

  it('uses config.url as fallback source name', async () => {
    mockCollectApi.mockResolvedValueOnce({ source: 'https://example.com', data: {} });
    const results = await collectSources([{ config: { type: 'api', url: 'https://example.com' } }]);
    expect(mockCollectApi).toHaveBeenCalledWith({ type: 'api', url: 'https://example.com' }, undefined);
  });
});
