import { useState } from 'react';
import { api } from '@/lib/api';
import { minutes, rupees } from '@/lib/format';
import { useAddresses, useApiMutation, useVehicles } from '@/hooks/queries';
import { Button, LinkButton } from '@/ui/Button';
import { EmptyState, ErrorState } from '@/ui/Feedback';
import { SelectField, TextField } from '@/ui/Field';
import { Card, PageHeader, Stat } from '@/ui/Surface';

interface Plan {
  order: string[];
  legs: { from: string; to: string; km: number; minutes: number }[];
  distance_km: number;
  total_minutes: number;
  fuel_litres: number;
  fuel_cost: number;
  saved_km: number;
  fit_for_trip: boolean;
  risks: { label: string; level: string; note: string }[];
}

export default function TripPlanner() {
  const addresses = useAddresses();
  const vehicles = useVehicles();
  const [startId, setStartId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [roundTrip, setRoundTrip] = useState(true);
  const [vehicleId, setVehicleId] = useState('');
  const [mileage, setMileage] = useState('15');
  const [fuel, setFuel] = useState('105');

  const plan = useApiMutation<void, Plan>(() => {
    const list = addresses.data ?? [];
    const by = (id: string) => list.find((a) => a.id === id)!;
    const pt = (id: string) => ({ name: by(id).label, lat: by(id).lat, lng: by(id).lng });
    const veh = vehicles.data?.find((x) => x.id === vehicleId);
    const age = veh ? Math.max(0, new Date().getFullYear() - veh.year) : undefined;
    return api<Plan>('/api/trip/plan', {
      method: 'POST',
      body: {
        start: pt(startId),
        stops: picked.map(pt),
        ...(roundTrip ? { end: pt(startId) } : {}),
        mileage_kmpl: Number(mileage),
        fuel_price: Number(fuel),
        ...(veh
          ? {
              vehicle: {
                kind: veh.vehicle_models.kind,
                segment: veh.vehicle_models.segment,
                age_years: age,
                odometer_km: veh.odometer_km,
                km_per_day: Math.max(veh.odometer_km / Math.max((age ?? 0) * 365, 30), 1),
              },
            }
          : {}),
      },
    });
  });

  const list = addresses.data ?? [];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ready = !!startId && picked.length > 0 && Number(mileage) > 0 && Number(fuel) > 0;

  if (addresses.isSuccess && list.length < 2) {
    return (
      <div className="container-x pb-24">
        <PageHeader eyebrow="Trips" title="Trip planner" />
        <EmptyState
          title="Save at least two places first"
          body="The planner uses your saved addresses as the start and the stops."
          action={<LinkButton to="/book">Save an address</LinkButton>}
        />
      </div>
    );
  }

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Trips" title="Trip planner" />
      <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) plan.mutate();
          }}
        >
          <SelectField label="Start from" value={startId} onChange={(e) => setStartId(e.target.value)}>
            <option value="">Choose a place</option>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.city}
              </option>
            ))}
          </SelectField>

          <fieldset>
            <legend className="label mb-2">Stops to visit</legend>
            <div className="space-y-2">
              {list
                .filter((a) => a.id !== startId)
                .map((a) => (
                  <label key={a.id} className="flex items-center gap-3 border border-line p-3 text-sm">
                    <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
                    <span>
                      {a.label} <span className="text-muted">· {a.line1}</span>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
            Return to the start
          </label>

          <SelectField
            label="Vehicle (optional)"
            hint="We check whether any part comes due during the trip."
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">No vehicle</option>
            {(vehicles.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.vehicle_models.make} {v.vehicle_models.model}
              </option>
            ))}
          </SelectField>

          <div className="grid grid-cols-2 gap-4">
            <TextField label="Mileage (km/l)" inputMode="decimal" value={mileage} onChange={(e) => setMileage(e.target.value)} />
            <TextField label="Fuel price (₹/l)" inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} />
          </div>

          <Button type="submit" className="w-full" loading={plan.isPending} disabled={!ready}>
            Plan trip
          </Button>
        </form>

        <div>
          {plan.isError ? (
            (plan.error as { code?: string })?.code === 'ml_unavailable' ? (
              <p role="alert" className="text-muted">
                The planning service is not reachable right now. Try again in a minute.
              </p>
            ) : (
              <ErrorState error={plan.error} />
            )
          ) : null}

          {plan.data ? (
            <div className="space-y-8">
              <div className="grid gap-6 sm:grid-cols-3">
                <Stat label="Distance" value={`${plan.data.distance_km} km`} hint={plan.data.saved_km > 0 ? `${plan.data.saved_km} km saved by reordering` : undefined} />
                <Stat label="Time" value={minutes(plan.data.total_minutes)} />
                <Stat label="Fuel" value={rupees(plan.data.fuel_cost)} hint={`${plan.data.fuel_litres} l`} />
              </div>

              <section>
                <h2 className="text-2xl">Best order</h2>
                <ol className="mt-4 divide-y divide-line border border-line">
                  {plan.data.legs.map((l, i) => (
                    <li key={i} className="flex justify-between gap-4 p-4 text-sm">
                      <span>
                        {l.from} → <strong>{l.to}</strong>
                      </span>
                      <span className="mono text-muted">
                        {l.km} km · {minutes(l.minutes)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              {plan.data.risks.length > 0 ? (
                <Card>
                  <h2 className="text-xl">{plan.data.fit_for_trip ? 'Heads up' : 'Service before you go'}</h2>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                    {plan.data.risks.map((r) => (
                      <li key={r.label}>{r.note}</li>
                    ))}
                  </ul>
                </Card>
              ) : vehicleId ? (
                <p className="text-sm text-muted">No part is due during this trip.</p>
              ) : null}

              <p className="text-sm text-muted">
                Distances are straight-line distance scaled for roads, at an assumed average speed. Use your maps app for turn by turn
                directions.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
