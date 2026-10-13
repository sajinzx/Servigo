import type { PGlite } from '@electric-sql/pglite';
import { createDb } from './harness';

describe('job queue', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createDb();
  });
  afterEach(async () => {
    await db.close();
  });

  const enqueue = (key: string, queue = 'notify', runAt = 'now()') =>
    db.query(`select public.enqueue_job($1, 'test.event', '{"n":1}'::jsonb, $2, ${runAt})`, [
      queue,
      key,
    ]);
  const claim = async (limit = 10, visibility = 30) =>
    (
      await db.query<{ id: number; attempts: number; idempotency_key: string }>(
        `select * from public.claim_jobs('{notify,realtime}', $1, $2)`,
        [limit, visibility],
      )
    ).rows;

  it('delivers a job once and does not hand it out twice', async () => {
    await enqueue('k1');
    const first = await claim();
    expect(first).toHaveLength(1);
    expect(first[0].attempts).toBe(1);
    expect(await claim()).toHaveLength(0); // still invisible
  });

  it('ignores a duplicate enqueue with the same idempotency key', async () => {
    await enqueue('same');
    await enqueue('same');
    const n = await db.query<{ n: string }>('select count(*)::text n from public.outbox');
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('makes a job visible again when the worker dies (visibility timeout)', async () => {
    await enqueue('k2');
    const [job] = await claim();
    // simulate the worker crashing: no complete_job, lock expires
    await db.query(`update public.outbox set locked_until = now() - interval '1 second' where id = $1`, [
      job.id,
    ]);
    const again = await claim();
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(job.id);
    expect(again[0].attempts).toBe(2);
  });

  it('does not run a job before its time', async () => {
    await enqueue('later', 'realtime', `now() + interval '90 seconds'`);
    expect(await claim()).toHaveLength(0);
    await db.query(`update public.outbox set next_run_at = now() - interval '1 second'`);
    expect(await claim()).toHaveLength(1);
  });

  it('only claims from the queues it was asked for', async () => {
    await enqueue('b', 'billing');
    expect(await claim()).toHaveLength(0);
  });

  it('completes a job for good', async () => {
    await enqueue('k3');
    const [job] = await claim();
    await db.query('select public.complete_job($1)', [job.id]);
    await db.query(`update public.outbox set locked_until = null`);
    expect(await claim()).toHaveLength(0);
    const r = await db.query<{ status: string }>('select status from public.outbox');
    expect(r.rows[0].status).toBe('done');
  });

  it('retries with growing backoff and then dead-letters after 5 failures', async () => {
    await enqueue('flaky');
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await db.query(`update public.outbox set next_run_at = now() where status = 'pending'`);
      const [job] = await claim();
      expect(job.attempts).toBe(attempt);
      const res = await db.query<{ status: string; wait: number }>(
        `select status, extract(epoch from (next_run_at - now()))::float as wait
           from public.fail_job($1, 'boom')`,
        [job.id],
      );
      waits.push(res.rows[0].wait);
      if (attempt < 5) expect(res.rows[0].status).toBe('pending');
      else expect(res.rows[0].status).toBe('dead');
    }
    // 10s, 60s, 300s, 1800s with +/-20% jitter
    expect(waits[0]).toBeGreaterThan(7);
    expect(waits[0]).toBeLessThan(13);
    expect(waits[1]).toBeGreaterThan(45);
    expect(waits[1]).toBeLessThan(75);
    expect(waits[2]).toBeGreaterThan(waits[1]);
    expect(waits[3]).toBeGreaterThan(waits[2]);

    const dead = await db.query<{ last_error: string }>(
      `select last_error from public.outbox where status = 'dead'`,
    );
    expect(dead.rows[0].last_error).toBe('boom');
  });

  it('dead-letters a job whose worker keeps crashing on the last attempt', async () => {
    await enqueue('crashy');
    for (let i = 0; i < 5; i++) {
      const [job] = await claim();
      expect(job).toBeDefined();
      await db.query(`update public.outbox set locked_until = now() - interval '1 second' where id = $1`, [
        job.id,
      ]);
    }
    expect(await claim()).toHaveLength(0);
    const r = await db.query<{ status: string }>('select status from public.outbox');
    expect(r.rows[0].status).toBe('dead');
  });

  it('can requeue a dead job from the admin screen', async () => {
    await enqueue('revive');
    for (let i = 0; i < 5; i++) {
      await db.query(`update public.outbox set next_run_at = now() where status = 'pending'`);
      const [job] = await claim();
      await db.query('select public.fail_job($1, $2)', [job.id, 'nope']);
    }
    const dead = await db.query<{ id: number }>(`select id from public.outbox where status = 'dead'`);
    await db.query('select public.requeue_dead_job($1)', [dead.rows[0].id]);
    const [job] = await claim();
    expect(job.attempts).toBe(1);
  });

  it('hands concurrent workers different jobs', async () => {
    for (let i = 0; i < 6; i++) await enqueue(`c${i}`);
    const a = await claim(3);
    const b = await claim(3);
    const ids = new Set([...a, ...b].map((j) => j.id));
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(ids.size).toBe(6);
  });
});
