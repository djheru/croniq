// Global setup for test suite
// Ensures test DB is in-memory and does not touch production data
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-tests-only';

// Override globalThis.fetch with node-fetch v2 so that nock can intercept
// HTTP requests in collector tests. Node 22's native fetch uses undici and
// is not interceptable by nock v13.
import nodeFetch from 'node-fetch';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).fetch = nodeFetch;
