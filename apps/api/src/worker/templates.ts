/**
 * Message catalogue (v1). Business-initiated WhatsApp messages and SMS in India
 * must use pre-registered templates (WhatsApp approval, TRAI DLT), so wording is
 * fixed here and versioned. Changing a body means bumping `version` and
 * registering the new text with the providers first.
 */
export interface Template {
  version: number;
  /** transactional messages ignore the marketing opt-out; reminders do not */
  kind: 'transactional' | 'reminder';
  title: string;
  body: string;
}

export const TEMPLATES = {
  booking_created: {
    version: 1,
    kind: 'transactional',
    title: 'Booking received',
    body: 'Finding a workshop near you for {{service}} (ref {{ref}}).',
  },
  offer_new: {
    version: 1,
    kind: 'transactional',
    title: 'New job offer',
    body: '{{service}} · {{distance}} away · {{price_low}}-{{price_high}}. Accept within 90 seconds. Ref {{ref}}.',
  },
  booking_accepted: {
    version: 1,
    kind: 'transactional',
    title: 'Workshop confirmed',
    body: '{{workshop}} accepted your {{service}} booking {{ref}}. ETA {{eta}} min. Contact: {{contact}}.',
  },
  booking_no_match: {
    version: 1,
    kind: 'transactional',
    title: 'No workshop available',
    body: 'Sorry, no workshop could take booking {{ref}} right now. You can reschedule in the app.',
  },
  booking_started: {
    version: 1,
    kind: 'transactional',
    title: 'Work started',
    body: 'Work on your {{service}} (ref {{ref}}) has started.',
  },
  booking_completed: {
    version: 1,
    kind: 'transactional',
    title: 'Job completed',
    body: 'Your {{service}} is done. Final price {{price}}. Ref {{ref}}.',
  },
  booking_cancelled: {
    version: 1,
    kind: 'transactional',
    title: 'Booking cancelled',
    body: 'Booking {{ref}} for {{service}} was cancelled.',
  },
  payment_received: {
    version: 1,
    kind: 'transactional',
    title: 'Payment received',
    body: 'We received {{price}} for booking {{ref}}. Your GST invoice is attached.',
  },
  payout_notice: {
    version: 1,
    kind: 'transactional',
    title: 'Payment confirmed',
    body: 'Payment of {{price}} for booking {{ref}} is confirmed and will be in your next payout.',
  },
  ts_notice: {
    version: 1,
    kind: 'transactional',
    title: 'Account notice',
    body: '{{message}}',
  },
  service_due: {
    version: 1,
    kind: 'reminder',
    title: 'Service reminder',
    body: 'Your {{vehicle}} is likely due for service in about {{days}} days.',
  },
} as const satisfies Record<string, Template>;

export type TemplateId = keyof typeof TEMPLATES;

export function render(id: TemplateId, vars: Record<string, string>): { title: string; body: string; version: number } {
  const t: Template = TEMPLATES[id];
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '');
  return { title: fill(t.title), body: fill(t.body), version: t.version };
}
