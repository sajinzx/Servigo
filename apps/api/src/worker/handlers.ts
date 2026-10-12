import type { NotificationStore } from './ports';
import type { Handlers } from './runner';
import { intentsForStatus, Notifier, type NotifyPayload } from './notifier';
import type { JobQueue } from './ports';

export interface HandlerDeps {
  store: NotificationStore;
  queue: JobQueue;
  notifier: Notifier;
  /** extra handlers contributed by other modules (offers, billing, batch jobs) */
  extra?: Handlers;
}

export function buildHandlers(deps: HandlerDeps): Handlers {
  const { store, notifier } = deps;

  return {
    'booking.status_changed': async (job) => {
      const p = job.payload as { booking_id: string; status: string; from?: string | null };
      const booking = await store.booking(p.booking_id);
      if (!booking) return;
      const offerId = p.status === 'offered' ? await store.pendingOfferId(p.booking_id) : null;
      const intents = intentsForStatus(booking, p.status, p.from ?? null, offerId, job.idempotency_key);
      for (const intent of intents) {
        await notifier.deliver(intent);
      }
    },

    'notify.send': async (job) => {
      await notifier.deliver(job.payload as unknown as NotifyPayload);
    },

    ...deps.extra,
  };
}
