import { Router } from 'express';
import { z } from 'zod';
import { execSync } from 'child_process';
import {
  listJobs, getJob, createJob, updateJobById, deleteJob, reorderJobs,
  listRuns, getRunById, getStats, setJobStatus, listRecentRuns,
} from '../db.js';
import type { DbRun } from '../db.js';
import { scheduleJob, unscheduleJob } from '../scheduler/index.js';
import { runJob } from '../runner.js';
import type { Run } from '../types/index.js';

export const apiRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRunResponse(run: DbRun): Run {
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    contentHash: run.contentHash ?? undefined,
    rawData: run.rawData ? JSON.parse(run.rawData) : undefined,
    analysis: run.analysis ?? undefined,
    bedrockInvoked: run.bedrockInvoked,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    error: run.error ?? undefined,
    changed: run.changed,
    durationMs: run.durationMs ?? undefined,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? undefined,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

const CollectorConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('html'),
    url: z.string().url(),
    selectors: z.record(z.union([z.string(), z.object({
      selector: z.string(),
      attribute: z.string().optional(),
      multiple: z.boolean().optional(),
      transform: z.enum(['trim','number','lowercase','uppercase']).optional(),
    })])),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('browser'),
    url: z.string().url(),
    selectors: z.record(z.union([z.string(), z.object({
      selector: z.string(),
      attribute: z.string().optional(),
      multiple: z.boolean().optional(),
      transform: z.enum(['trim','number','lowercase','uppercase']).optional(),
    })])),
    waitFor: z.string().optional(),
    clickBefore: z.array(z.string()).optional(),
    scrollToBottom: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('api'),
    url: z.string().url(),
    method: z.enum(['GET','POST','PUT','PATCH']).optional(),
    headers: z.record(z.string()).optional(),
    body: z.record(z.unknown()).optional(),
    extract: z.string().optional(),
    transform: z.array(z.object({
      from: z.string(), to: z.string(),
      transform: z.enum(['trim','number','date']).optional(),
    })).optional(),
  }),
  z.object({
    type: z.literal('rss'),
    url: z.string().url(),
    maxItems: z.number().optional(),
    fields: z.array(z.enum(['title','link','pubDate','content','author','categories'])).optional(),
  }),
  z.object({
    type: z.literal('graphql'),
    url: z.string().url(),
    query: z.string(),
    variables: z.record(z.unknown()).optional(),
    headers: z.record(z.string()).optional(),
    extract: z.string().optional(),
  }),
]);

const DataSourceSchema = z.object({
  name: z.string().optional(),
  config: CollectorConfigSchema,
});

const CreateJobSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  schedule: z.string(),
  sources: z.array(DataSourceSchema).min(1, 'At least one source is required'),
  outputFormat: z.enum(['json','text','csv','list']).default('json'),
  tags: z.array(z.string()).default([]),
  jobPrompt: z.string().optional(),
  jobParams: z.record(z.string()).optional(),
  notifyOnChange: z.boolean().default(false),
  webhookUrl: z.string().url().optional(),
  retries: z.number().int().min(0).max(5).default(2),
  timeoutMs: z.number().int().min(1000).max(300000).default(120000),
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

apiRouter.get('/jobs', (_req, res) => {
  const jobs = listJobs();
  res.json({ data: jobs });
});

// Reorder jobs (must be before /jobs/:id to avoid param matching)
apiRouter.put('/jobs/reorder', (req, res) => {
  const parsed = z.object({ orderedIds: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  reorderJobs(parsed.data.orderedIds);
  res.json({ data: { reordered: true } });
});

apiRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ data: job });
});

apiRouter.post('/jobs', (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const job = createJob(parsed.data);
  scheduleJob(job);
  res.status(201).json({ data: job });
});

apiRouter.patch('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const updated = updateJobById(req.params.id, req.body);
  if (updated) {
    unscheduleJob(updated.id);
    if (updated.status === 'active') scheduleJob(updated);
  }
  res.json({ data: updated });
});

apiRouter.delete('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  unscheduleJob(req.params.id);
  deleteJob(req.params.id);
  res.json({ data: { deleted: true } });
});

// Pause / resume
apiRouter.post('/jobs/:id/pause', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  setJobStatus(req.params.id, 'paused');
  unscheduleJob(req.params.id);
  res.json({ data: getJob(req.params.id) });
});

apiRouter.post('/jobs/:id/resume', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  setJobStatus(req.params.id, 'active');
  scheduleJob({ ...job, status: 'active' });
  res.json({ data: getJob(req.params.id) });
});

// Manual trigger
apiRouter.post('/jobs/:id/run', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  // Fire async, return immediately
  runJob(req.params.id).catch(console.error);
  res.json({ data: { triggered: true } });
});

// ─── Runs ─────────────────────────────────────────────────────────────────────

apiRouter.get('/jobs/:id/runs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const runs = listRuns(req.params.id, limit);
  res.json({ data: runs.map(toRunResponse) });
});

apiRouter.get('/jobs/:id/runs/latest', (req, res) => {
  const runs = listRuns(req.params.id, 1);
  if (!runs.length) return res.status(404).json({ error: 'No runs yet' });
  res.json({ data: toRunResponse(runs[0]) });
});

apiRouter.get('/runs/:id', (req, res) => {
  const run = getRunById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json({ data: toRunResponse(run) });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

apiRouter.get('/stats', (_req, res) => {
  const stats = getStats();
  // Haiku 4.5 pricing (approximate): $0.80/M input tokens, $4.00/M output tokens
  const estimatedCostUsd =
    (stats.totalInputTokens / 1_000_000) * 0.80 +
    (stats.totalOutputTokens / 1_000_000) * 4.00;
  const recentRuns = listRecentRuns(10);
  res.json({ ...stats, estimatedCostUsd, recentRuns: recentRuns.map(toRunResponse) });
});

// ─── Health ───────────────────────────────────────────────────────────────────

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── System Metrics (Pi) ──────────────────────────────────────────────────────

apiRouter.get('/system/metrics', (_req, res) => {
  try {
    // Temperature (Linux thermal zone)
    const tempRaw = execSync('cat /sys/class/thermal/thermal_zone0/temp', { encoding: 'utf-8' }).trim();
    const tempC = parseInt(tempRaw) / 1000;
    const tempF = (tempC * 9 / 5) + 32;

    // Memory info
    const memInfo = execSync('free -m', { encoding: 'utf-8' });
    const memLines = memInfo.split('\n')[1].split(/\s+/);
    const memTotal = parseInt(memLines[1]);
    const memUsed = parseInt(memLines[2]);
    const memPercent = Math.round((memUsed / memTotal) * 100 * 100) / 100;

    // Disk usage for root filesystem
    const diskInfo = execSync('df -h /', { encoding: 'utf-8' });
    const diskLine = diskInfo.split('\n')[1].split(/\s+/);
    const diskUsed = diskLine[4]; // e.g., "45%"
    const diskUsedPercent = parseInt(diskUsed.replace('%', ''));

    // Uptime
    const uptime = execSync('uptime -p', { encoding: 'utf-8' }).trim();

    // CPU load average (1, 5, 15 minutes)
    const loadavg = execSync('cat /proc/loadavg', { encoding: 'utf-8' }).trim().split(' ');
    const load1 = parseFloat(loadavg[0]);
    const load5 = parseFloat(loadavg[1]);
    const load15 = parseFloat(loadavg[2]);

    res.json({
      temperature: {
        celsius: Math.round(tempC * 100) / 100,
        fahrenheit: Math.round(tempF * 100) / 100,
      },
      memory: {
        totalMB: memTotal,
        usedMB: memUsed,
        percentUsed: memPercent,
      },
      disk: {
        percentUsed: diskUsedPercent,
        raw: diskUsed,
      },
      cpu: {
        load1min: load1,
        load5min: load5,
        load15min: load15,
      },
      uptime,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to get system metrics',
      message: err instanceof Error ? err.message : 'Unknown error',
      note: 'This endpoint requires Linux with /sys/class/thermal/thermal_zone0/temp (Raspberry Pi)',
    });
  }
});
