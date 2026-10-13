import { STATUS_LABEL, STATUS_TONE, TIMELINE, type BookingStatus } from '@/lib/status';
import { dateTime } from '@/lib/format';

const toneClass = {
  neutral: 'border-line text-muted',
  ok: 'border-ok text-ok',
  warn: 'border-warn text-warn',
  crit: 'border-crit text-crit',
  // live status is the only place the accent colour is used for state
  live: 'border-accent text-accent',
} as const;

export function StatusChip({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] ${toneClass[STATUS_TONE[status]]}`}
    >
      {STATUS_TONE[status] === 'live' ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface TimelineEvent {
  to_status: BookingStatus;
  at: string;
}

/** Vertical status timeline; steps already reached show their time. */
export function Timeline({ current, events }: { current: BookingStatus; events: TimelineEvent[] }) {
  const reached = new Map<BookingStatus, string>();
  for (const e of events) reached.set(e.to_status, e.at);

  const off =
    current === 'cancelled' || current === 'no_match' || current === 'disputed' || current === 'refunded'
      ? current
      : null;
  const idx = TIMELINE.indexOf(current === 'payment_pending_verification' ? 'completed' : current);

  return (
    <ol className="relative space-y-6 border-l border-line pl-6" aria-label="Booking progress">
      {TIMELINE.map((s, i) => {
        const done = reached.has(s) || (!off && i < idx);
        const active = !off && i === idx;
        return (
          <li key={s} className="relative" aria-current={active ? 'step' : undefined}>
            <span
              className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border ${
                active ? 'border-accent bg-accent' : done ? 'border-ink bg-ink' : 'border-line bg-paper'
              }`}
              aria-hidden
            />
            <p className={done || active ? 'text-ink' : 'text-muted'}>{STATUS_LABEL[s]}</p>
            {reached.get(s) ? <p className="mono text-xs text-muted">{dateTime(reached.get(s))}</p> : null}
          </li>
        );
      })}
      {off ? (
        <li className="relative">
          <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border border-crit bg-crit" aria-hidden />
          <p className="text-crit">{STATUS_LABEL[off]}</p>
        </li>
      ) : null}
    </ol>
  );
}
