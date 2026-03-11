import cron from 'node-cron';
import { listJobs, getJob } from '../db/queries.js';
import { runJob } from './runner.js';
import type { Job } from '../types/index.js';

type ScheduledTask = ReturnType<typeof cron.schedule>;

const tasks = new Map<string, ScheduledTask>();

function getNextRun(schedule: string): string | undefined {
  try {
    // node-cron doesn't expose next run time natively; use a simple heuristic
    return undefined; // extend with croner if needed
  } catch {
    return undefined;
  }
}

export function scheduleJob(job: Job): void {
  if (tasks.has(job.id)) {
    tasks.get(job.id)?.stop();
    tasks.delete(job.id);
  }

  if (job.status !== 'active') return;

  if (!cron.validate(job.schedule)) {
    console.warn(`[scheduler] Invalid cron expression "${job.schedule}" for job "${job.name}"`);
    return;
  }

  const task = cron.schedule(job.schedule, async () => {
    const fresh = getJob(job.id);
    if (!fresh || fresh.status !== 'active') return;
    await runJob(fresh);
  });

  tasks.set(job.id, task);
  console.log(`[scheduler] Scheduled "${job.name}" → ${job.schedule}`);
}

export function unscheduleJob(id: string): void {
  tasks.get(id)?.stop();
  tasks.delete(id);
  console.log(`[scheduler] Unscheduled job ${id}`);
}

export function rescheduleJob(job: Job): void {
  unscheduleJob(job.id);
  scheduleJob(job);
}

export function initScheduler(): void {
  const jobs = listJobs();
  for (const job of jobs) {
    if (job.status === 'active') scheduleJob(job);
  }
  console.log(`[scheduler] Initialized with ${jobs.length} jobs`);
}

export function getScheduledIds(): string[] {
  return [...tasks.keys()];
}
