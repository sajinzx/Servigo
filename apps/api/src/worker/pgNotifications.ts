import type { Sql } from '../db/sql';
import type { BookingSummary, ChannelName, NotificationStore, Recipient } from './ports';

export function pgNotificationStore(sql: Sql): NotificationStore {
  return {
    async reserve(rec) {
      const res = await sql.query(
        `insert into public.notifications
           (user_id, channel, template, template_version, payload, idempotency_key, status)
         values ($1, $2, $3, $4, $5::jsonb, $6, 'queued')
         on conflict (idempotency_key) do update set status = 'queued', error = null
           where public.notifications.status in ('failed', 'queued')
         returning id`,
        [rec.userId, rec.channel, rec.template, rec.templateVersion, JSON.stringify(rec.payload), rec.key],
      );
      return res.rows.length > 0;
    },

    async markSent(key, providerMsgId) {
      await sql.query(
        `update public.notifications
            set status = 'sent', sent_at = now(), provider_msg_id = $2
          where idempotency_key = $1`,
        [key, providerMsgId ?? null],
      );
    },

    async markFailed(key, error) {
      await sql.query(
        `update public.notifications set status = 'failed', error = left($2, 500)
          where idempotency_key = $1`,
        [key, error],
      );
    },

    async applyReceipt(providerMsgId, status, error) {
      await sql.query(
        `update public.notifications
            set status = $2::public.notification_status,
                delivered_at = case when $2 in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
                read_at = case when $2 = 'read' then now() else read_at end,
                error = coalesce($3, error)
          where provider_msg_id = $1`,
        [providerMsgId, status, error ?? null],
      );
    },

    async statusOf(key) {
      const res = await sql.query<{ status: string }>(
        'select status from public.notifications where idempotency_key = $1',
        [key],
      );
      return res.rows[0]?.status ?? null;
    },

    async recipient(userId): Promise<Recipient | null> {
      const p = await sql.query<{
        id: string;
        full_name: string | null;
        phone: string | null;
        whatsapp_opt_in: boolean;
        email: string | null;
      }>(
        `select p.id, p.full_name, p.phone, p.whatsapp_opt_in, u.email
           from public.profiles p left join auth.users u on u.id = p.id
          where p.id = $1`,
        [userId],
      );
      if (!p.rows[0]) return null;
      const prefs = await sql.query<{ channel: ChannelName }>(
        'select channel from public.notification_prefs where user_id = $1 and not enabled',
        [userId],
      );
      const tokens = await sql.query<{ token: string }>(
        'select token from public.device_tokens where user_id = $1',
        [userId],
      );
      const row = p.rows[0];
      return {
        userId,
        name: row.full_name,
        phone: row.phone,
        email: row.email,
        whatsappOptIn: row.whatsapp_opt_in,
        disabled: prefs.rows.map((r) => r.channel),
        pushTokens: tokens.rows.map((r) => r.token),
      };
    },

    async booking(bookingId): Promise<BookingSummary | null> {
      const res = await sql.query<Record<string, unknown>>(
        `select b.id, b.ref, b.status, b.customer_id, b.workshop_id, b.final_price,
                b.quote_low, b.quote_high, b.eta_min,
                s.name as service_name,
                w.name as workshop_name, w.owner_id as workshop_owner_id, w.phone as workshop_phone
           from public.bookings b
           join public.services s on s.id = b.service_id
           left join public.workshops w on w.id = b.workshop_id
          where b.id = $1`,
        [bookingId],
      );
      const r = res.rows[0];
      if (!r) return null;
      return {
        id: r.id as string,
        ref: r.ref as string,
        status: r.status as string,
        customerId: r.customer_id as string,
        workshopId: (r.workshop_id as string) ?? null,
        workshopName: (r.workshop_name as string) ?? null,
        workshopOwnerId: (r.workshop_owner_id as string) ?? null,
        workshopPhone: (r.workshop_phone as string) ?? null,
        serviceName: r.service_name as string,
        finalPrice: r.final_price == null ? null : Number(r.final_price),
        quoteLow: Number(r.quote_low),
        quoteHigh: Number(r.quote_high),
        etaMin: r.eta_min == null ? null : Number(r.eta_min),
      };
    },

    async pendingOfferId(bookingId) {
      const res = await sql.query<{ id: string }>(
        `select id from public.offers where booking_id = $1 and response = 'pending'`,
        [bookingId],
      );
      return res.rows[0]?.id ?? null;
    },

    async isOfferPending(offerId) {
      const res = await sql.query(
        `select 1 from public.offers where id = $1 and response = 'pending'`,
        [offerId],
      );
      return res.rows.length > 0;
    },
  };
}
