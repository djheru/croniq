// tests/runner.test.ts
import { createHash } from 'node:crypto';
import { runJob } from '../src/runner';
import * as collectors from '../src/collectors/index';
import * as bedrock from '../src/bedrock/client';
import * as db from '../src/db';

jest.mock('../src/collectors/index');
jest.mock('../src/bedrock/client');
jest.mock('../src/db');

const mockCollectSources = jest.mocked(collectors.collectSources);
const mockAnalyze = jest.mocked(bedrock.analyzeWithBedrock);
const mockGetJob = jest.mocked(db.getJob);
const mockCreateRun = jest.mocked(db.createRun);
const mockSetRunStatus = jest.mocked(db.setRunStatus);
const mockCompleteRun = jest.mocked(db.completeRun);
const mockGetLatestCompletedRun = jest.mocked(db.getLatestCompletedRun);
const mockSetJobLastRun = jest.mocked(db.setJobLastRun);

const MOCK_JOB = {
  id: 'j1', name: 'Test Job', schedule: '0 * * * *',
  sources: [{ name: 'src', config: { type: 'api' as const, url: 'https://api.example.com' } }],
  jobPrompt: 'Summarize this', status: 'active' as const,
} as any;

const MOCK_RUN = { id: 'run1', jobId: 'j1', status: 'pending', contentHash: null } as any;

describe('runJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetJob.mockReturnValue(MOCK_JOB);
    mockCreateRun.mockReturnValue(MOCK_RUN);
    mockGetLatestCompletedRun.mockReturnValue(undefined);
  });

  it('calls Bedrock and marks run complete on success', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: { items: [1, 2] } }]);
    mockAnalyze.mockResolvedValue({ analysis: '# Report', inputTokens: 100, outputTokens: 50 });

    await runJob('j1');

    expect(mockSetRunStatus).toHaveBeenCalledWith('run1', 'collecting');
    expect(mockSetRunStatus).toHaveBeenCalledWith('run1', 'analyzing');
    expect(mockAnalyze).toHaveBeenCalledWith(
      expect.any(String),
      'Summarize this',
      'Test Job',
      undefined, // no previous run
    );
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'complete', expect.any(String), expect.any(String),
      '# Report', true, 100, 50, expect.any(Number), null
    );
  });

  it('passes previous run analysis to Bedrock when content has changed', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: { items: [1, 2, 3] } }]);
    mockAnalyze.mockResolvedValue({ analysis: '# New report', inputTokens: 120, outputTokens: 60 });
    mockGetLatestCompletedRun.mockReturnValue({
      id: 'prev',
      status: 'complete',
      contentHash: 'different-hash',
      analysis: '# Previous report\n\n## Suggestions for Next Run\n- Watch for X',
    } as any);

    await runJob('j1');

    expect(mockAnalyze).toHaveBeenCalledWith(
      expect.any(String),
      'Summarize this',
      'Test Job',
      '# Previous report\n\n## Suggestions for Next Run\n- Watch for X',
    );
  });

  it('skips Bedrock when content hash matches previous run', async () => {
    const rawData = [{ source: 'src', data: { same: true } }];
    mockCollectSources.mockResolvedValue(rawData);

    const hash = createHash('sha256').update(JSON.stringify(rawData)).digest('hex');
    mockGetLatestCompletedRun.mockReturnValue({ id: 'prev', status: 'complete', contentHash: hash, analysis: '# Old report' } as any);

    await runJob('j1');

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'skipped', hash, expect.any(String),
      '# Old report', false, 0, 0, expect.any(Number), null
    );
  });

  it('marks run as error when all collectors fail', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: null, error: 'network down' }]);

    await runJob('j1');

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'error', null, null, null, false, 0, 0, expect.any(Number), expect.stringContaining('all sources failed')
    );
  });

  it('marks run as error when Bedrock fails', async () => {
    mockCollectSources.mockResolvedValue([{ source: 'src', data: { ok: true } }]);
    mockAnalyze.mockRejectedValue(new Error('throttled'));

    await runJob('j1');

    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run1', 'error', expect.any(String), expect.any(String),
      null, false, 0, 0, expect.any(Number), 'throttled'
    );
  });
});
