export type BookingStatus =
  | 'requested'
  | 'matching'
  | 'offered'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'payment_pending_verification'
  | 'paid'
  | 'reviewed'
  | 'cancelled'
  | 'no_match'
  | 'disputed'
  | 'refunded';

type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'live';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: 'Requested',
  matching: 'Finding a workshop',
  offered: 'Waiting for the workshop',
  accepted: 'Workshop confirmed',
  in_progress: 'Work in progress',
  completed: 'Completed',
  payment_pending_verification: 'Payment being verified',
  paid: 'Paid',
  reviewed: 'Reviewed',
  cancelled: 'Cancelled',
  no_match: 'No workshop available',
  disputed: 'Under review',
  refunded: 'Refunded',
};

export const STATUS_TONE: Record<BookingStatus, Tone> = {
  requested: 'neutral',
  matching: 'live',
  offered: 'live',
  accepted: 'live',
  in_progress: 'live',
  completed: 'ok',
  payment_pending_verification: 'warn',
  paid: 'ok',
  reviewed: 'ok',
  cancelled: 'neutral',
  no_match: 'crit',
  disputed: 'warn',
  refunded: 'neutral',
};

/** The happy path, in order, for the vertical timeline. */
export const TIMELINE: BookingStatus[] = [
  'requested',
  'matching',
  'offered',
  'accepted',
  'in_progress',
  'completed',
  'paid',
  'reviewed',
];

/** Statuses a customer can still cancel from. */
export const CANCELLABLE: BookingStatus[] = ['requested', 'matching', 'offered', 'accepted'];

export const isTerminal = (s: BookingStatus) =>
  ['cancelled', 'no_match', 'reviewed', 'refunded'].includes(s);

export const needsPayment = (s: BookingStatus) => s === 'completed';
