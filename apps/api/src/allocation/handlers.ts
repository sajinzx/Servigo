import type { Sql } from '../db/sql';
import type { JobQueue } from '../worker/ports';
import type { Handlers } from '../worker/runner';
import { Allocator, BATCH_THRESHOLD } from './allocator';

/** How often the batch assigner wakes up (plan 4.4: every 30 seconds at peak). */
export const BATCH_WINDOW_SECONDS = 30;

export function allocationHandlers(sql: Sql, allocator: Allocator): Handlers {
  return {
    'dispatch.booking': async (job) => {
      const bookingId = String((job.payload as { booking_id: string }).booking_id);
      // under peak load the batch window decides, so a request is not given
      // to the nearest shop just because it arrived first
      const waiting = await allocator.waitingByCell();
      for (const ids of waiting.values()) {
        if (ids.includes(bookingId) && ids.length > BATCH_THRESHOLD) return;
      }
      await allocator.dispatch(bookingId);
    },

    'dispatch.batch': async () => {
      const waiting = await allocator.waitingByCell();
      for (const ids of waiting.values()) {
        if (ids.length > BATCH_THRESHOLD) {
          await allocator.dispatchBatch(ids);
        } else {
          for (const id of ids) await allocator.dispatch(id);
        }
      }
    },

    'offer.timeout': async (job) => {
      const offerId = String((job.payload as { offer_id: string }).offer_id);
      await sql.query(`select public.respond_offer($1, 'expired', null, 'system')`, [offerId]);
    },
  };
}

/** Called on a timer by the worker: one batch job per window, idempotent per window. */
export async function scheduleBatchWindow(queue: JobQueue, now = new Date()): Promise<void> {
  const bucket = Math.floor(now.getTime() / (BATCH_WINDOW_SECONDS * 1000));
  await queue.enqueue({
    queue: 'realtime',
    eventType: 'dispatch.batch',
    payload: {},
    key: `dispatch:batch:${bucket}`,
  });
}
