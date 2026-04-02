import cron, { type ScheduledTask } from 'node-cron';
import { getJob } from '../db.js';
import { runJob } from '../runner.js';

const activeTasks = new Map<string, ScheduledTask>();

// Exported for testing: the reload-before-execute callback for a cron tick
export function createJobCallback(jobId: string): () => Promise<void> {
  return async () => {
    const job = getJob(jobId);
    if (!job || job.status !== 'active') {
      unscheduleJob(jobId);
      return;
    }
    await runJob(jobId).catch(err => console.error(`[scheduler] Job ${jobId} error:`, err));
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
}

export function initScheduler(): void {
  const { listJobs } = require('../db.js');
  const jobs = listJobs() as Array<{ id: string; schedule: string; status: string }>;
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  console.log(`[scheduler] Initialized ${activeTasks.size} jobs`);
}
