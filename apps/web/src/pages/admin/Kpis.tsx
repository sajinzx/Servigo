import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { QueryBoundary } from '@/ui/Feedback';
import { Card, PageHeader, Stat } from '@/ui/Surface';

export interface KpiDay {
  day: string;
  bookings: number;
  assigned: number;
  no_match: number;
  median_assign_s: number | null;
  p90_assign_s: number | null;
  offers: number;
  offers_accepted: number;
  mean_eta_min: number | null;
}

/** Tiny dependency-free trend line. */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v) => (v === null ? NaN : v));
  const finite = pts.filter(Number.isFinite);
  if (finite.length < 2) return <p className="text-sm text-muted">Not enough days yet</p>;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  const w = 160;
  const h = 36;
  const step = w / (pts.length - 1);
  const d = pts
    .map((v, i) => (Number.isFinite(v) ? `${i === 0 || !Number.isFinite(pts[i - 1]) ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - lo) / span) * (h - 4) - 2).toFixed(1)}` : ''))
    .join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="text-ink">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');

export default function Kpis() {
  const kpis = useQuery({
    queryKey: ['admin-kpis'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('admin_kpis', { p_days: 14 });
      if (error) throw new Error(error.message);
      return (data ?? []) as KpiDay[];
    },
  });
  const gini = useQuery({
    queryKey: ['admin-gini'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('jobs_gini', { p_days: 14 });
      if (error) throw new Error(error.message);
      return Number(data);
    },
  });

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Allocation" title="KPIs, last 14 days" />
      <QueryBoundary query={kpis} rows={3}>
        {(days) => {
          const last = days[days.length - 1];
          const total = days.reduce((a, d) => ({ b: a.b + d.bookings, nm: a.nm + d.no_match, o: a.o + d.offers, ok: a.ok + d.offers_accepted }), { b: 0, nm: 0, o: 0, ok: 0 });
          return (
            <>
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Stat label="Median time to assign" value={last?.median_assign_s != null ? `${last.median_assign_s}s` : '—'} hint="Latest day" />
                <Stat label="Offer acceptance" value={pct(total.ok, total.o)} hint={`${total.ok} of ${total.o} offers`} />
                <Stat label="No match" value={pct(total.nm, total.b)} hint={`${total.nm} of ${total.b} bookings`} />
                <Stat label="Fairness (Gini)" value={gini.data !== undefined ? gini.data.toFixed(2) : '—'} hint="0 = even, 1 = one shop gets all" />
              </div>

              <div className="mt-10 grid gap-6 sm:grid-cols-3">
                <Card>
                  <p className="label mb-3">Median time to assign (s)</p>
                  <Sparkline values={days.map((d) => d.median_assign_s)} label="Median time to assign per day" />
                </Card>
                <Card>
                  <p className="label mb-3">Mean ETA (min)</p>
                  <Sparkline values={days.map((d) => d.mean_eta_min)} label="Mean customer ETA per day" />
                </Card>
                <Card>
                  <p className="label mb-3">Bookings per day</p>
                  <Sparkline values={days.map((d) => d.bookings)} label="Bookings per day" />
                </Card>
              </div>

              <div className="mt-10 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink text-left">
                      {['Day', 'Bookings', 'Assigned', 'No match', 'Median s', 'p90 s', 'Acceptance', 'ETA min'].map((h) => (
                        <th key={h} className="label py-2 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...days].reverse().map((d) => (
                      <tr key={d.day} className="border-b border-line">
                        <td className="mono py-2 pr-4">{d.day}</td>
                        <td className="mono pr-4">{d.bookings}</td>
                        <td className="mono pr-4">{d.assigned}</td>
                        <td className="mono pr-4">{d.no_match}</td>
                        <td className="mono pr-4">{d.median_assign_s ?? '—'}</td>
                        <td className="mono pr-4">{d.p90_assign_s ?? '—'}</td>
                        <td className="mono pr-4">{pct(d.offers_accepted, d.offers)}</td>
                        <td className="mono">{d.mean_eta_min ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </QueryBoundary>
    </div>
  );
}
