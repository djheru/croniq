import { Router } from 'express';
import { z } from 'zod';
import {
  listJobs, getJob, createJob, updateJobById, deleteJob,
  listRuns, getLastRun, getRunStats, setJobStatus,
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

const CreateJobSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  schedule: z.string(),
  collectorConfig: CollectorConfigSchema,
  outputFormat: z.enum(['json','text','csv','list']).default('json'),
  tags: z.array(z.string()).default([]),
  notifyOnChange: z.boolean().default(false),
  webhookUrl: z.string().url().optional(),
  retries: z.number().int().min(0).max(5).default(2),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

router.get('/jobs', (_req, res) => {
  const jobs = listJobs();
  const scheduled = getScheduledIds();
  res.json({ data: jobs.map(j => ({ ...j, isScheduled: scheduled.includes(j.id) })) });
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

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', scheduledJobs: getScheduledIds().length });
});
