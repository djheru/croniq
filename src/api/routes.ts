import { Router } from 'express';
import { z } from 'zod';
import { execSync } from 'child_process';
import {
  listJobs, getJob, createJob, updateJobById, deleteJob, reorderJobs,
  listRuns, getLastRun, getRunStats, setJobStatus,
  listRunStages, getPipelineStats,
} from '../db/queries.js';
import { scheduleJob, unscheduleJob, rescheduleJob, getScheduledIds } from '../jobs/scheduler.js';
import { runJob } from '../jobs/runner.js';

export const router = Router();

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

router.get('/jobs', (_req, res) => {
  const jobs = listJobs();
  const scheduled = getScheduledIds();
  res.json({ data: jobs.map(j => ({ ...j, isScheduled: scheduled.includes(j.id) })) });
});

// Reorder jobs (must be before /jobs/:id to avoid param matching)
router.put('/jobs/reorder', (req, res) => {
  const parsed = z.object({ orderedIds: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  reorderJobs(parsed.data.orderedIds);
  res.json({ data: { reordered: true } });
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ data: job });
});

router.post('/jobs', (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const job = createJob(parsed.data);
  scheduleJob(job);
  res.status(201).json({ data: job });
});

router.patch('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const updated = updateJobById(req.params.id, req.body);
  if (updated) rescheduleJob(updated);
  res.json({ data: updated });
});

router.delete('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  unscheduleJob(req.params.id);
  deleteJob(req.params.id);
  res.json({ data: { deleted: true } });
});

// Pause / resume
router.post('/jobs/:id/pause', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  setJobStatus(req.params.id, 'paused');
  unscheduleJob(req.params.id);
  res.json({ data: getJob(req.params.id) });
});

router.post('/jobs/:id/resume', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  setJobStatus(req.params.id, 'active');
  scheduleJob({ ...job, status: 'active' });
  res.json({ data: getJob(req.params.id) });
});

// Manual trigger
router.post('/jobs/:id/run', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  // Fire async, return immediately
  runJob(job).catch(console.error);
  res.json({ data: { triggered: true } });
});

// ─── Runs ─────────────────────────────────────────────────────────────────────

router.get('/jobs/:id/runs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const runs = listRuns(req.params.id, limit);
  const stats = getRunStats(req.params.id);
  res.json({ data: runs, stats });
});

router.get('/jobs/:id/runs/latest', (req, res) => {
  const run = getLastRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'No runs yet' });
  res.json({ data: run });
});

router.get('/jobs/:id/runs/:runId/stages', (req, res) => {
  const stages = listRunStages(req.params.runId);
  res.json({ data: stages });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

// Blended cost per 1M tokens (assumes ~70% input, 30% output)
// AWS Bedrock pricing: Haiku ($1/$5), Sonnet 4.6 ($3/$15), Opus 4.6 ($5/$25)
const MODEL_COST_PER_MTOK: Record<string, number> = {
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 2.20,  // 0.70*1.00 + 0.30*5.00
  'us.anthropic.claude-sonnet-4-6-v1:0': 6.60,          // 0.70*3.00 + 0.30*15.00
  'us.anthropic.claude-opus-4-6-v1:0': 11.00,           // 0.70*5.00 + 0.30*25.00
};
const DEFAULT_COST_PER_MTOK = 2.20;  // Default to Haiku pricing

const PERIOD_OFFSETS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

router.get('/stats', (req, res) => {
  const period = (req.query.period as string) ?? '24h';
  const offsetMs = PERIOD_OFFSETS[period];
  const since = offsetMs
    ? new Date(Date.now() - offsetMs).toISOString()
    : undefined;

  const stats = getPipelineStats(since);

  const models = stats.models.map((m) => {
    const costRate = MODEL_COST_PER_MTOK[m.modelId] ?? DEFAULT_COST_PER_MTOK;
    const estimatedCostUsd = (m.totalTokens / 1_000_000) * costRate;
    return { ...m, estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000 };
  });

  const totalTokens = models.reduce((sum, m) => sum + m.totalTokens, 0);
  const totalCostUsd = models.reduce((sum, m) => sum + m.estimatedCostUsd, 0);

  res.json({
    data: {
      period,
      since: since ?? 'all',
      runs: {
        total: stats.totalRuns,
        success: stats.success,
        failures: stats.failures,
        timeouts: stats.timeouts,
        avgDurationMs: stats.avgDurationMs,
      },
      models,
      totals: {
        totalTokens,
        estimatedCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      },
      note: 'Cost estimates use blended input/output rates (70/30 split assumption).',
    },
  });
});

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', scheduledJobs: getScheduledIds().length });
});

// ─── System Metrics (Pi) ──────────────────────────────────────────────────────

router.get('/system/metrics', (_req, res) => {
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
