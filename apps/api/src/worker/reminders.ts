import type { Sql } from '../db/sql';
import type { MlClient } from '../ml/client';
import type { JobQueue } from './ports';
import type { Handlers } from './runner';

/** Only remind when the model is fairly sure; the plan allows one WhatsApp a month per vehicle. */
export const REMINDER_THRESHOLD = 0.6;

interface Candidate {
  vehicle_id: string;
  owner_id: string;
  kind: 'car' | 'bike';
  label: string;
  age_years: number;
  km_per_day: number;
  days_since_service: number;
}

/**
 * `reminders.service_due` (batch queue, nightly): ask the survival model who is
 * likely due within 30 days and queue one reminder each. The unique
 * (vehicle, month) row and the idempotency key keep it to one a month even if
 * the job reruns.
 */
export function reminderHandlers(sql: Sql, ml: MlClient, queue: JobQueue): Handlers {
  return {
    'reminders.service_due': async () => {
      const month = new Date().toISOString().slice(0, 7);
      const res = await sql.query<Candidate>('select * from public.service_due_candidates(500)');
      for (const v of res.rows) {
        const p = await ml.serviceDue({
          kind: v.kind,
          age_years: Number(v.age_years),
          km_per_day: Number(v.km_per_day),
          days_since_service: Number(v.days_since_service),
          within_days: 30,
        });
        if (!p || p.probability_due < REMINDER_THRESHOLD) continue;

        const inserted = await sql.query(
          `insert into public.service_reminders (vehicle_id, month, p_due, days_left)
           values ($1, $2, $3, $4) on conflict (vehicle_id, month) do nothing returning id`,
          [v.vehicle_id, month, p.probability_due, p.days_left],
        );
        if (inserted.rows.length === 0) continue;

        await queue.enqueue({
          queue: 'notify',
          eventType: 'notify.send',
          payload: {
            user_id: v.owner_id,
            template: 'service_due',
            vars: { vehicle: v.label, days: String(Math.max(1, Math.round(p.days_left))) },
            channels: ['whatsapp', 'in_app'],
            live: false,
            key: `reminder:${v.vehicle_id}:${month}`,
          },
          key: `reminder:${v.vehicle_id}:${month}`,
        });
      }
    },
  };
}
