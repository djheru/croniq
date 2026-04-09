// tests/db.stats.test.ts
//
// Tests for getStats() period-window filtering. This behavior is the fix for
// a long-standing bug where /api/stats?period=24h returned lifetime totals.
import {
  createJob,
  createRun,
  completeRun,
  getStats,
  resetForTesting,
  setRunStartedAtForTesting,
} from '../src/db';
import type { CreateJobInput } from '../src/types/index';

beforeEach(() => resetForTesting());

const MOCK_JOB: CreateJobInput = {
  name: 'Stats Test Job',
  description: 'seed',
  schedule: '0 * * * *',
  sources: [{ name: 'src', config: { type: 'api', url: 'https://api.example.com' } }],
  outputFormat: 'json',
  tags: [],
  notifyOnChange: false,
  retries: 2,
  timeoutMs: 60000,
};

const hoursAgoIso = (hours: number): string =>
  new Date(Date.now() - hours * 3600 * 1000).toISOString();

const seedCompletedRun = (jobId: string, inputTokens: number, outputTokens: number, hoursAgo: number): void => {
  const run = createRun(jobId);
  completeRun(run.id, 'complete', 'hash', '{}', '# Report', true, inputTokens, outputTokens, 1000, null);
  setRunStartedAtForTesting(run.id, hoursAgoIso(hoursAgo));
};

describe('getStats period filtering', () => {
  it('defaults to 24 hours when called with no argument', () => {
    const job = createJob(MOCK_JOB);
    seedCompletedRun(job.id, 100, 50, 1);    // 1h ago — in window
    seedCompletedRun(job.id, 200, 100, 12);  // 12h ago — in window
    seedCompletedRun(job.id, 400, 200, 48);  // 48h ago — out of window

    const stats = getStats();
    expect(stats.totalRuns).toBe(2);
    expect(stats.totalInputTokens).toBe(300);  // 100 + 200
    expect(stats.totalOutputTokens).toBe(150); // 50 + 100
    expect(stats.periodHours).toBe(24);
  });

  it('respects an explicit 1-hour window', () => {
    const job = createJob(MOCK_JOB);
    seedCompletedRun(job.id, 100, 50, 0.25);  // 15 min ago — in window
    seedCompletedRun(job.id, 200, 100, 2);    // 2h ago — out of window

    const stats = getStats(1);
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.periodHours).toBe(1);
  });

  it('returns lifetime totals when periodHours is 0', () => {
    const job = createJob(MOCK_JOB);
    seedCompletedRun(job.id, 100, 50, 1);
    seedCompletedRun(job.id, 200, 100, 100);    // 4+ days ago
    seedCompletedRun(job.id, 400, 200, 1000);   // ~40 days ago

    const stats = getStats(0);
    expect(stats.totalRuns).toBe(3);
    expect(stats.totalInputTokens).toBe(700);
    expect(stats.totalOutputTokens).toBe(350);
    expect(stats.periodHours).toBe(0);
  });

  it('handles empty DB without crashing', () => {
    const stats = getStats(24);
    expect(stats.totalRuns).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  it('counts skipped runs separately from completed', () => {
    const job = createJob(MOCK_JOB);
    const run1 = createRun(job.id);
    completeRun(run1.id, 'complete', 'h1', '{}', '# r', true, 100, 50, 1000, null);
    const run2 = createRun(job.id);
    completeRun(run2.id, 'skipped', 'h2', '{}', '# cached', false, 0, 0, 500, null);

    const stats = getStats(24);
    expect(stats.totalRuns).toBe(2);
    expect(stats.skippedRuns).toBe(1);
    expect(stats.successRate).toBe(50.0);
    expect(stats.totalInputTokens).toBe(100); // skipped runs contribute 0
  });
});
