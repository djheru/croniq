// tests/scheduler.test.ts
// Tests the exported createJobCallback function in isolation.
// node-cron tasks fire asynchronously and are hard to unit-test directly;
// createJobCallback is the pure logic that wraps each cron tick.
import { createJobCallback } from '../src/scheduler/index';
import * as db from '../src/db';
import * as runner from '../src/runner';

jest.mock('../src/db');
jest.mock('../src/runner');

const mockGetJob = jest.mocked(db.getJob);
const mockRunJob = jest.mocked(runner.runJob);

describe('createJobCallback (reload-before-execute)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs job when status is active', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', status: 'active' } as any);
    mockRunJob.mockResolvedValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).toHaveBeenCalledWith('j1');
  });

  it('does not run when job is paused', async () => {
    mockGetJob.mockReturnValue({ id: 'j1', status: 'paused' } as any);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('does not run when job is deleted (undefined)', async () => {
    mockGetJob.mockReturnValue(undefined);
    await createJobCallback('j1')();
    expect(mockRunJob).not.toHaveBeenCalled();
  });
});
