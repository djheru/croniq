// Global setup for test suite
// Ensures test DB is in-memory and does not touch production data
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-tests-only';
