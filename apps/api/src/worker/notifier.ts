import type {
  BookingSummary,
  Channel,
  ChannelName,
  JobQueue,
  NotificationStore,
  Recipient,
} from './ports';
import { render, TEMPLATES, type TemplateId } from './templates';
import { inQuietHours, nextQuietEnd } from './quietHours';

export interface NotifyPayload {
  user_id: string;
  template: TemplateId;
  vars: Record<string, string>;
  /** ordered: the first is tried first, the rest are fallbacks */
  channels: ChannelName[];
  /** messages about a live job ignore quiet hours */
  live: boolean;
  /** if set, remaining channels are tried later while the offer is unanswered */
  escalate_after_s?: number;
  ack_offer_id?: string;
  /** base idempotency key; each channel appends its own name */
  key: string;
  /** notification key of the previous escalation step, used to stop on delivery */
  prev_key?: string;
}

const inr = (n: number | null | undefined) =>
  n == null ? '' : `Rs ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Turn a booking status change into the messages it should produce. */
export function intentsForStatus(
  b: BookingSummary,
  status: string,
  from: string | null,
  offerId: string | null,
  eventKey: string,
): NotifyPayload[] {
  const base = {
    ref: b.ref,
    service: b.serviceName,
    workshop: b.workshopName ?? '',
    contact: b.workshopPhone ?? '',
    eta: b.etaMin != null ? String(b.etaMin) : '',
    price: inr(b.finalPrice),
    price_low: inr(b.quoteLow),
    price_high: inr(b.quoteHigh),
  };
  const make = (
    userId: string,
    template: TemplateId,
    channels: ChannelName[],
    extra: Partial<NotifyPayload> = {},
  ): NotifyPayload => ({
    user_id: userId,
    template,
    vars: base,
    channels,
    live: true,
    key: `${eventKey}:${template}:${userId}:${channels.join('+')}`,
    ...extra,
  });

  const out: NotifyPayload[] = [];
  const customer = b.customerId;
  const owner = b.workshopOwnerId;

  switch (status) {
    case 'matching':
      if (from === 'requested') out.push(make(customer, 'booking_created', ['in_app']));
      break;
    case 'offered':
      if (owner && offerId) {
        out.push(
          make(owner, 'offer_new', ['push', 'whatsapp', 'sms'], {
            escalate_after_s: 20,
            ack_offer_id: offerId,
          }),
        );
      }
      break;
    case 'accepted':
      out.push(make(customer, 'booking_accepted', ['in_app']));
      out.push(make(customer, 'booking_accepted', ['whatsapp']));
      break;
    case 'no_match':
      out.push(make(customer, 'booking_no_match', ['in_app']));
      out.push(make(customer, 'booking_no_match', ['whatsapp']));
      break;
    case 'in_progress':
      out.push(make(customer, 'booking_started', ['in_app']));
      out.push(make(customer, 'booking_started', ['push']));
      break;
    case 'completed':
      out.push(make(customer, 'booking_completed', ['in_app']));
      out.push(make(customer, 'booking_completed', ['push']));
      break;
    case 'cancelled':
      out.push(make(customer, 'booking_cancelled', ['in_app']));
      if (owner) out.push(make(owner, 'booking_cancelled', ['in_app']));
      break;
    case 'paid':
      out.push(make(customer, 'payment_received', ['whatsapp'], { live: false }));
      out.push(make(customer, 'payment_received', ['email'], { live: false }));
      if (owner) {
        out.push(make(owner, 'payout_notice', ['whatsapp'], { live: false }));
        out.push(make(owner, 'payout_notice', ['email'], { live: false }));
      }
      break;
    default:
      break;
  }
  return out;
}

function reachable(ch: ChannelName, r: Recipient): boolean {
  if (ch === 'in_app') return true;
  if (r.disabled.includes(ch)) return false;
  switch (ch) {
    case 'push':
      return r.pushTokens.length > 0;
    case 'whatsapp':
      return r.whatsappOptIn && !!r.phone;
    case 'sms':
      return !!r.phone;
    case 'email':
      return !!r.email;
  }
}

export interface NotifierDeps {
  store: NotificationStore;
  queue: JobQueue;
  channels: Partial<Record<ChannelName, Channel>>;
  now?: () => Date;
}

export class Notifier {
  constructor(private deps: NotifierDeps) {}

  async deliver(p: NotifyPayload): Promise<void> {
    const { store, queue, channels } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    const tpl = TEMPLATES[p.template];

    // someone already answered the offer: nothing left to escalate
    if (p.ack_offer_id && !(await store.isOfferPending(p.ack_offer_id))) return;

    // delivery receipt for the previous step says it arrived: stop escalating
    if (p.prev_key) {
      const prev = await store.statusOf(p.prev_key);
      if (prev === 'delivered' || prev === 'read') return;
    }

    // keep quiet at night unless the message is about a job in flight
    if (!p.live && inQuietHours(now)) {
      await queue.enqueue({
        queue: 'notify',
        eventType: 'notify.send',
        payload: { ...p },
        key: `${p.key}:after-quiet`,
        runAt: nextQuietEnd(now),
      });
      return;
    }

    const recipient = await store.recipient(p.user_id);
    if (!recipient) return;

    const { title, body, version } = render(p.template, p.vars);
    const remaining = [...p.channels];
    let lastError: string | null = null;

    while (remaining.length) {
      const name = remaining.shift()!;
      if (!reachable(name, recipient)) continue;
      // marketing-style reminders respect opt-out; transactional ones do not
      if (tpl.kind === 'reminder' && recipient.disabled.includes(name)) continue;

      const key = `${p.key}:${name}`;
      const fresh = await store.reserve({
        key,
        userId: p.user_id,
        channel: name,
        template: p.template,
        templateVersion: version,
        payload: p.vars,
      });
      if (!fresh) return; // this exact message was already sent by an earlier attempt

      const impl = channels[name];
      try {
        if (name === 'in_app') {
          await store.markSent(key);
        } else {
          if (!impl) throw new Error(`channel ${name} is not configured`);
          const res = await impl.send({
            to: { phone: recipient.phone, email: recipient.email, pushToken: recipient.pushTokens[0] },
            template: p.template,
            templateVersion: version,
            title,
            body,
            vars: p.vars,
          });
          await store.markSent(key, res.providerMsgId);
        }
      } catch (e) {
        lastError = (e as Error).message;
        await store.markFailed(key, lastError);
        continue; // fall back to the next channel straight away
      }

      if (p.escalate_after_s && remaining.length) {
        await queue.enqueue({
          queue: 'realtime',
          eventType: 'notify.send',
          payload: { ...p, channels: remaining, prev_key: key },
          key: `${p.key}:esc:${remaining[0]}`,
          runAt: new Date(now.getTime() + p.escalate_after_s * 1000),
        });
      }
      return;
    }

    if (lastError) throw new Error(`all channels failed: ${lastError}`);
  }
}
