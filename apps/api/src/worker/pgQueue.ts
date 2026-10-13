import type { Sql } from '../db/sql';
import type { Job, JobQueue } from './ports';

export function pgQueue(sql: Sql): JobQueue {
  return {
    async claim(queues, limit, visibilitySeconds = 30) {
      const res = await sql.query<Job>(
        'select id, queue, event_type, payload, idempotency_key, attempts from public.claim_jobs($1::text[], $2, $3)',
        [queues, limit, visibilitySeconds],
      );
      return res.rows;
    },
    async complete(id) {
      await sql.query('select public.complete_job($1)', [id]);
    },
    async fail(id, error) {
      await sql.query('select public.fail_job($1, $2)', [id, error]);
    },
    async enqueue({ queue, eventType, payload, key, runAt }) {
      await sql.query('select public.enqueue_job($1, $2, $3::jsonb, $4, $5::timestamptz)', [
        queue,
        eventType,
        JSON.stringify(payload),
        key,
        (runAt ?? new Date()).toISOString(),
      ]);
    },
  };
}
