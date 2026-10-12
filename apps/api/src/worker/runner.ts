import type { Job, JobQueue } from './ports';

export type Handler = (job: Job) => Promise<void>;
export type Handlers = Record<string, Handler>;

export interface RunnerOptions {
  queues: Job['queue'][];
  batchSize?: number;
  visibilitySeconds?: number;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Claim a batch, run each job, then complete or fail it. If the process dies
 * between claim and complete, the visibility timeout makes the job claimable
 * again, so work is at-least-once and handlers must be idempotent.
 */
export async function runOnce(
  queue: JobQueue,
  handlers: Handlers,
  opts: RunnerOptions,
): Promise<{ processed: number; failed: number }> {
  const log = opts.log ?? (() => undefined);
  const jobs = await queue.claim(opts.queues, opts.batchSize ?? 10, opts.visibilitySeconds ?? 30);
  let failed = 0;

  for (const job of jobs) {
    const handler = handlers[job.event_type];
    try {
      if (!handler) throw new Error(`no handler for ${job.event_type}`);
      await handler(job);
      await queue.complete(job.id);
    } catch (e) {
      failed += 1;
      const message = (e as Error).message ?? String(e);
      log(`job ${job.id} (${job.event_type}) failed: ${message}`);
      await queue.fail(job.id, message);
    }
  }
  return { processed: jobs.length, failed };
}

export async function runForever(
  queue: JobQueue,
  handlers: Handlers,
  opts: RunnerOptions & { idleMs?: number; signal?: AbortSignal },
): Promise<void> {
  const idle = opts.idleMs ?? 1000;
  while (!opts.signal?.aborted) {
    try {
      const { processed } = await runOnce(queue, handlers, opts);
      if (processed === 0) await new Promise((r) => setTimeout(r, idle));
    } catch (e) {
      opts.log?.('worker loop error', e);
      await new Promise((r) => setTimeout(r, idle * 5));
    }
  }
}
