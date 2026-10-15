import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { priceRange, rupees } from '@/lib/format';
import { useVehicles } from '@/hooks/queries';
import { LinkButton } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/ui/Feedback';
import { Card, PageHeader, Stat } from '@/ui/Surface';

interface Component {
  key: string;
  label: string;
  service_code: string;
  status: 'ok' | 'watch' | 'due' | 'overdue';
  score: number;
  wear: number;
  since_days: number;
  interval_km: number | null;
  interval_days: number | null;
  basis: string;
}

interface Intelligence {
  health: { score: number; grade: string; confidence?: string; components: Component[] };
  actions: { service_code: string; label: string; urgency: string; why: string }[];
  cost: {
    now: { low: number; median: number; high: number };
    next_12_months: { low: number; median: number; high: number };
  };
  service_due_probability_30d: number | null;
  learned_interval_days: number | null;
  sources: string[];
}

const TONE: Record<Component['status'], string> = {
  ok: 'text-muted',
  watch: 'text-warn',
  due: 'text-warn',
  overdue: 'text-crit',
};

const WORDS: Record<Component['status'], string> = {
  ok: 'Fine',
  watch: 'Keep an eye',
  due: 'Due',
  overdue: 'Overdue',
};

export default function VehicleHealth() {
  const { id } = useParams();
  const vehicles = useVehicles();
  const v = vehicles.data?.find((x) => x.id === id);
  const q = useQuery({
    queryKey: ['vehicle-intelligence', id],
    enabled: !!id,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => api<Intelligence>(`/api/vehicles/${id}/intelligence`),
  });

  return (
    <div className="container-x pb-24">
      <PageHeader
        eyebrow="Vehicle health"
        title={v ? `${v.vehicle_models.make} ${v.vehicle_models.model}` : 'Vehicle'}
      >
        <LinkButton to="/garage" variant="secondary">
          Back to garage
        </LinkButton>
      </PageHeader>

      {q.isLoading ? <SkeletonList rows={4} /> : null}

      {q.isError ? (
        (q.error as { code?: string })?.code === 'ml_unavailable' ? (
          <EmptyState
            title="Health analysis is warming up"
            body="The analysis service is not reachable right now. Your bookings and service reminders still work. Try again in a minute."
          />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : null}

      {q.data ? (
        <div className="space-y-10">
          <section className="grid gap-6 sm:grid-cols-3">
            <Stat label="Health score" value={`${q.data.health.score}/100`} hint={q.data.health.grade} />
            <Stat
              label="Needed now"
              value={q.data.cost.now.median > 0 ? rupees(q.data.cost.now.median) : 'Nothing'}
              hint={q.data.cost.now.median > 0 ? priceRange(q.data.cost.now.low, q.data.cost.now.high) : undefined}
            />
            <Stat
              label="Next 12 months"
              value={rupees(q.data.cost.next_12_months.median)}
              hint={priceRange(q.data.cost.next_12_months.low, q.data.cost.next_12_months.high)}
            />
          </section>

          {q.data.health.confidence === 'low' ? (
            <p className="border border-line p-4 text-sm text-muted">
              We have little service history for this vehicle, so some parts are estimated from its age. Book a
              service and the picture gets sharper.
            </p>
          ) : null}

          {q.data.actions.length > 0 ? (
            <section>
              <h2 className="text-2xl">What to do</h2>
              <ul className="mt-4 divide-y divide-line border border-line">
                {q.data.actions.map((a) => (
                  <li key={a.service_code} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-medium">{a.label}</p>
                      <p className={`text-sm ${a.urgency === 'overdue' ? 'text-crit' : 'text-warn'}`}>{a.why}</p>
                    </div>
                    <Link
                      to={`/book?vehicle=${id}`}
                      className="shrink-0 text-sm underline underline-offset-4"
                    >
                      Book
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-muted">Nothing needs attention right now.</p>
          )}

          <section>
            <h2 className="text-2xl">Parts</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {q.data.health.components.map((c) => (
                <Card key={c.key} as="article">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-lg">{c.label}</h3>
                    <span className={`text-sm ${TONE[c.status]}`}>{WORDS[c.status]}</span>
                  </div>
                  <div className="mt-3 h-1.5 w-full bg-line" role="presentation">
                    <div
                      className={`h-full ${c.status === 'overdue' ? 'bg-crit' : c.status === 'ok' ? 'bg-ink' : 'bg-warn'}`}
                      style={{ width: `${Math.min(100, Math.round(c.wear * 100))}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-muted">
                    {Math.round(c.wear * 100)}% of its interval used
                    {c.interval_km ? `, every ${c.interval_km.toLocaleString('en-IN')} km` : ''}
                    {c.interval_days ? ` or ${c.interval_days} days` : ''}. Based on {c.basis}.
                  </p>
                </Card>
              ))}
            </div>
          </section>

          <p className="text-sm text-muted">
            {q.data.sources.length > 0
              ? 'Service interval and prices come from models trained on ServiGo service data. '
              : 'Intervals are typical manufacturer-style values and prices come from our service catalogue. '}
            Other part intervals are standard planning values, not fitted to your driving. These are estimates, not
            an inspection.
          </p>
        </div>
      ) : null}
    </div>
  );
}
