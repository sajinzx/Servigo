import { useQuery } from '@tanstack/react-query';
import { rupees } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';
import { QueryBoundary } from '@/ui/Feedback';
import { Card, PageHeader, Stat } from '@/ui/Surface';

interface Summary {
  workshop_id: string;
  rating: number | null;
  review_count: number;
  jobs_30d: number;
  earned_30d: number;
  owed: number;
  active_strikes: number;
  stage: string;
}

interface Hour {
  hour_of_day: number;
  expected: number;
}

export function BusyHours({ hours }: { hours: Hour[] }) {
  const max = Math.max(0.0001, ...hours.map((h) => h.expected));
  return (
    <div className="flex h-28 items-end gap-1" role="img" aria-label="Expected bookings by hour of day next week">
      {Array.from({ length: 24 }, (_, h) => {
        const v = hours.find((x) => x.hour_of_day === h)?.expected ?? 0;
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full bg-ink" style={{ height: `${Math.max(2, (v / max) * 96)}px`, opacity: v / max > 0.6 ? 1 : 0.35 }} title={`${h}:00  ${v.toFixed(1)}`} />
            <span className="mono text-[10px] text-muted">{h % 3 === 0 ? h : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Insights() {
  const summary = useQuery({
    queryKey: ['my-summary'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('my_workshop_summary');
      if (error) throw new Error(error.message);
      return ((data ?? []) as Summary[])[0] ?? null;
    },
  });
  const hours = useQuery({
    queryKey: ['busy-hours'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('busy_hours_next_week');
      if (error) throw new Error(error.message);
      return (data ?? []) as Hour[];
    },
  });

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Your workshop" title="Insights" />
      <QueryBoundary query={summary} rows={2}>
        {(s) =>
          s === null ? null : (
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <Stat label="Earned, 30 days" value={rupees(s.earned_30d)} hint="After commission" />
              <Stat label="Owed to you" value={rupees(s.owed)} hint="Paid out weekly" />
              <Stat label="Jobs, 30 days" value={s.jobs_30d} />
              <Stat
                label="Rating"
                value={s.rating ?? '—'}
                hint={s.rating === null ? `Shown after 5 reviews (${s.review_count} so far)` : `${s.review_count} reviews`}
              />
              {s.active_strikes > 0 ? (
                <Stat label="Active strikes" value={s.active_strikes} hint="3 in 90 days suspends the workshop" />
              ) : null}
            </div>
          )
        }
      </QueryBoundary>

      <Card className="mt-10">
        <p className="label mb-4">Busy hours next week</p>
        <QueryBoundary query={hours}>
          {(h) => (h.length === 0 ? <p className="text-muted">The forecast is not available yet.</p> : <BusyHours hours={h} />)}
        </QueryBoundary>
      </Card>
    </div>
  );
}
