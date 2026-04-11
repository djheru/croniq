import cron, { type ScheduledTask } from 'node-cron';
import { getJob, listJobs } from '../db.js';
import { runJob } from '../runner.js';

const activeTasks = new Map<string, ScheduledTask>();

// Track which jobs are currently executing to prevent overlapping runs.
// node-cron fires on every tick regardless of whether the previous callback
// completed — without this guard, slow jobs (browser scraping, Bedrock analysis)
// can stack up, exhausting memory on the Pi and triggering PM2 restarts.
const runningJobs = new Set<string>();

// Exported for testing: the reload-before-execute callback for a cron tick
export function createJobCallback(jobId: string): () => Promise<void> {
  return async () => {
    const job = getJob(jobId);
    if (!job || job.status !== 'active') {
      unscheduleJob(jobId);
      return;
    }

    // Overlap guard: skip this tick if the job is already executing.
    // This prevents memory pressure from concurrent Playwright launches
    // and avoids duplicate runs when a job takes longer than its interval.
    if (runningJobs.has(jobId)) {
      console.log(`[scheduler] Skipping ${job.name} — previous run still in progress`);
      return;
    }

    runningJobs.add(jobId);
    try {
      console.log(`[scheduler] Starting ${job.name}`);
      await runJob(jobId);
      console.log(`[scheduler] Completed ${job.name}`);
    } catch (err) {
      console.error(`[scheduler] Job ${job.name} error:`, err);
    } finally {
      runningJobs.delete(jobId);
    }
  };
}

export function scheduleJob(job: { id: string; schedule: string }): void {
  unscheduleJob(job.id);
  const task = cron.schedule(job.schedule, createJobCallback(job.id));
  activeTasks.set(job.id, task);
}

export function unscheduleJob(jobId: string): void {
  const task = activeTasks.get(jobId);
  if (task) {
    task.stop();
    activeTasks.delete(jobId);
  }
  // Also clear running state in case the job was mid-execution when unscheduled
  runningJobs.delete(jobId);
}

export function initScheduler(): void {
  const jobs = listJobs();
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  console.log(`[scheduler] Initialized ${activeTasks.size} jobs`);
}

// Exported for testing
export function isJobRunning(jobId: string): boolean {
  return runningJobs.has(jobId);
}
