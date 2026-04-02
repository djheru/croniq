// tests/collectors/graphql.test.ts
import nock from 'nock';
import { collectGraphql } from '../../src/collectors/graphql';

beforeEach(() => nock.cleanAll());

describe('collectGraphql', () => {
  it('sends POST query and returns data', async () => {
    nock('https://api.example.com')
      .post('/graphql', body => body.query === '{ users { id } }')
      .reply(200, { data: { users: [{ id: '1' }] } });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: '{ users { id } }' }, 'src');
    expect(result.error).toBeUndefined();
    expect((result.data as any).data.users).toHaveLength(1);
  });

  it('applies dot-path extract', async () => {
    nock('https://api.example.com').post('/graphql').reply(200, { data: { users: [{ id: '1' }] } });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: '{ users { id } }', extract: 'data.users' }, 'src');
    expect(result.data).toEqual([{ id: '1' }]);
  });

  it('returns error on 4xx', async () => {
    nock('https://api.example.com').post('/graphql').reply(400, { errors: [{ message: 'bad query' }] });
    const result = await collectGraphql({ type: 'graphql', url: 'https://api.example.com/graphql', query: 'bad' }, 'src');
    expect(result.error).toBeDefined();
  });
});
