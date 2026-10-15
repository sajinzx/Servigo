import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { day, plate } from '@/lib/format';
import { useVehicles } from '@/hooks/queries';
import type { Vehicle } from '@/lib/types';
import { LinkButton } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { Card, PageHeader } from '@/ui/Surface';

/** "Next service due in ~N days", from the survival model (falls back to a fixed rule). */
function useDue(v: Vehicle) {
  return useQuery({
    queryKey: ['service-due', v.id],
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: () =>
      api<{ days_left: number; probability_due: number }>('/api/vehicles/' + v.id + '/service-due'),
  });
}

function VehicleCard({ v }: { v: Vehicle }) {
  const due = useDue(v);
  const m = v.vehicle_models;
  const days = due.data ? Math.round(due.data.days_left) : null;
  return (
    <Card as="article" className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">{m.kind === 'car' ? 'Car' : 'Bike'}</p>
          <h2 className="mt-1 text-3xl">
            {m.make} {m.model}
          </h2>
          <p className="mono mt-2 inline-block border border-ink px-2 py-0.5 text-sm tracking-widest">
            {plate(v.registration_no)}
          </p>
        </div>
        <Silhouette kind={m.kind} />
      </div>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="label">Year</dt>
          <dd className="mono">{v.year}</dd>
        </div>
        <div>
          <dt className="label">Odometer</dt>
          <dd className="mono">{v.odometer_km.toLocaleString('en-IN')} km</dd>
        </div>
        <div>
          <dt className="label">Last service</dt>
          <dd>{day(v.last_service_at)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm">
          {days === null ? (
            <span className="text-muted">Next service estimate unavailable</span>
          ) : days <= 0 ? (
            <span className="text-warn">Service is due now</span>
          ) : (
            <>
              Next service due in <span className="mono">~{days}</span> days
            </>
          )}
        </p>
        <div className="flex gap-2">
          <LinkButton to={`/vehicles/${v.id}/health`} variant="secondary">
            Health
          </LinkButton>
          <LinkButton to={`/book?vehicle=${v.id}`} variant="secondary">
            Book a service
          </LinkButton>
        </div>
      </div>
    </Card>
  );
}

function Silhouette({ kind }: { kind: 'car' | 'bike' }) {
  return (
    <svg width="72" height="40" viewBox="0 0 72 40" aria-hidden className="shrink-0 text-ink">
      {kind === 'car' ? (
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 28h64M10 28l4-10 10-6h24l10 6 6 10" />
          <circle cx="20" cy="30" r="5" />
          <circle cx="54" cy="30" r="5" />
        </g>
      ) : (
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="16" cy="28" r="8" />
          <circle cx="56" cy="28" r="8" />
          <path d="M16 28l12-14h14l14 14M28 14l6 14h-6M42 14l-4-6h8" />
        </g>
      )}
    </svg>
  );
}

export default function Garage() {
  const q = useVehicles();
  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Your garage" title="Vehicles">
        <LinkButton to="/book">Book a service</LinkButton>
      </PageHeader>
      <QueryBoundary query={q}>
        {(vehicles) =>
          vehicles.length === 0 ? (
            <EmptyState
              title="No vehicles yet"
              body="Add a vehicle so we can price the job and track its service history."
              action={<LinkButton to="/onboarding">Add a vehicle</LinkButton>}
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {vehicles.map((v) => (
                <VehicleCard key={v.id} v={v} />
              ))}
            </div>
          )
        }
      </QueryBoundary>
    </div>
  );
}
