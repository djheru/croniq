// tests/scheduler.test.ts
// Tests the exported createJobCallback function in isolation.
// node-cron tasks fire asynchronously and are hard to unit-test directly;
// createJobCallback is the pure logic that wraps each cron tick.
import { createJobCallback, isJobRunning } from '../src/scheduler/index';
import * as db from '../src/db';
import * as runner from '../src/runner';

jest.mock('../src/db');
jest.mock('../src/runner');

const mockGetJob = jest.mocked(db.getJob);
const mockRunJob = jest.mocked(runner.runJob);

describe('createJobCallback (reload-before-execute)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs job when status is active', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', name: 'Test', status: 'active' } as any);
    mockRunJob.mockResolvedValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).toHaveBeenCalledWith('j1');
  });

  it('does not run when job is paused', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', name: 'Test', status: 'paused' } as any);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('does not run when job is deleted (undefined)', async () => {
    mockGetJob.mockReturnValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('clears running state after job completes', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', name: 'Test', status: 'active' } as any);
    mockRunJob.mockResolvedValue(undefined);
    await createJobCallback('j1')();
    expect(isJobRunning('j1')).toBe(false);
  });

  it('clears running state even when job throws', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', name: 'Test', status: 'active' } as any);
    mockRunJob.mockRejectedValue(new Error('Bedrock timeout'));
    await createJobCallback('j1')();
    expect(isJobRunning('j1')).toBe(false);
  });

  it('skips execution when the same job is already running (overlap guard)', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', name: 'Test', status: 'active' } as any);

    // Simulate a slow job that takes time to resolve
    let resolveSlowJob!: () => void;
    const slowJobPromise = new Promise<void>((resolve) => { resolveSlowJob = resolve; });
    mockRunJob.mockReturnValue(slowJobPromise);

    // Start first invocation (will hang until we resolve)
    const firstRun = createJobCallback('j1')();
    expect(isJobRunning('j1')).toBe(true);

    // Second invocation while first is still running — should skip
    await createJobCallback('j1')();
    expect(mockRunJob).toHaveBeenCalledTimes(1); // only the first call

    // Clean up: resolve the slow job
    resolveSlowJob();
    await firstRun;
    expect(isJobRunning('j1')).toBe(false);
  });
});
