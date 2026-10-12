import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { minutes, plate, priceRange } from '@/lib/format';
import { quoteFor, triage, useAddresses, useServices, useVehicles } from '@/hooks/queries';
import { AddressPicker, type PickedAddress } from '@/features/AddressPicker';
import { Button, LinkButton } from '@/ui/Button';
import { EmptyState, ErrorState, QueryBoundary, Spinner } from '@/ui/Feedback';
import { MapView } from '@/map/Map';
import { TextArea } from '@/ui/Field';
import { Card, Chip, PageHeader } from '@/ui/Surface';
import type { Booking } from '@/lib/types';

const STEPS = ['Describe', 'Choose', 'Confirm'] as const;

/**
 * Three steps, one decision each:
 *  1. say what is wrong (the model suggests three services)
 *  2. pick a service and see the price range and time estimate
 *  3. confirm the place on a map and get matched
 */
export default function Book() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const vehicles = useVehicles();
  const addresses = useAddresses();

  const [step, setStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(params.get('vehicle') ?? '');
  const [text, setText] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState<PickedAddress | null>(null);
  const [mode, setMode] = useState<'workshop' | 'doorstep'>('workshop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicle = useMemo(
    () => vehicles.data?.find((v) => v.id === vehicleId) ?? null,
    [vehicles.data, vehicleId],
  );
  useEffect(() => {
    if (!vehicleId && vehicles.data?.length === 1) setVehicleId(vehicles.data[0].id);
  }, [vehicles.data, vehicleId]);
  useEffect(() => {
    if (!addressId && !newAddress && addresses.data?.length) {
      setAddressId((addresses.data.find((a) => a.is_default) ?? addresses.data[0]).id);
    }
  }, [addresses.data, addressId, newAddress]);

  const kind = vehicle?.vehicle_models.kind;
  const services = useServices(kind);

  // step 1 -> suggestions
  const suggestions = useQuery({
    queryKey: ['triage', text, kind],
    enabled: step === 0 && text.trim().length >= 8 && Boolean(kind),
    staleTime: 5 * 60_000,
    queryFn: async () => (await triage(text.trim(), kind!)).suggestions,
  });

  const quote = useQuery({
    queryKey: ['quote', vehicleId, serviceId],
    enabled: Boolean(vehicleId && serviceId),
    queryFn: () => quoteFor(vehicleId, serviceId!),
  });

  const chosenService = services.data?.find((s) => s.id === serviceId);
  const pickedAddress = addresses.data?.find((a) => a.id === addressId);
  const point = newAddress ?? (pickedAddress ? { lat: pickedAddress.lat, lng: pickedAddress.lng } : null);

  const confirm = async () => {
    if (!point || !serviceId || !vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      let addr = addressId;
      if (newAddress) {
        // a new place is saved once; the server then uses the stored point
        const { requireSupabase } = await import('@/lib/supabase');
        const { data: u } = await requireSupabase().auth.getUser();
        const { data, error: err } = await requireSupabase()
          .from('addresses')
          .insert({ user_id: u.user!.id, label: 'other', line1: newAddress.line1, city: newAddress.city, pincode: newAddress.pincode, lat: newAddress.lat, lng: newAddress.lng })
          .select('id')
          .single();
        if (err) throw new Error(err.message);
        addr = data.id as string;
      }
      const booking = await api<Booking>('/api/bookings', {
        body: {
          vehicle_id: vehicleId,
          service_id: serviceId,
          mode,
          address_id: addr,
          symptom_text: text.trim() || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ['bookings'] });
      nav(`/bookings/${booking.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not create the booking');
    } finally {
      setBusy(false);
    }
  };

  if (vehicles.isLoading) return <div className="container-x py-24"><Spinner /></div>;
  if (vehicles.isError) return <div className="container-x py-12"><ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} /></div>;
  if (!vehicles.data?.length) {
    return (
      <div className="container-x py-16">
        <EmptyState
          title="Add a vehicle first"
          body="We need to know what we are servicing to price it."
          action={<LinkButton to="/onboarding">Add a vehicle</LinkButton>}
        />
      </div>
    );
  }

  return (
    <div className="container-x max-w-3xl pb-24">
      <PageHeader eyebrow={`Step ${step + 1} of 3`} title={STEPS[step] === 'Describe' ? 'What is wrong?' : STEPS[step] === 'Choose' ? 'Pick a service' : 'Confirm and get matched'} />

      {step === 0 && (
        <section className="space-y-6">
          {vehicles.data.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Vehicle">
              {vehicles.data.map((v) => (
                <Chip key={v.id} selected={v.id === vehicleId} onClick={() => setVehicleId(v.id)}>
                  {v.vehicle_models.make} {v.vehicle_models.model} · {plate(v.registration_no)}
                </Chip>
              ))}
            </div>
          ) : null}
          <TextArea
            label="Describe the problem in your own words"
            placeholder="e.g. grinding noise when I brake, mostly at low speed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            hint="English, Tamil or Hindi is fine. Or skip this and choose a service yourself."
          />
          {suggestions.isFetching ? <Spinner label="Looking for the right service" /> : null}
          {suggestions.data?.length ? (
            <div>
              <p className="label mb-3">Suggested</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.data.map((s) => (
                  <Chip
                    key={s.code}
                    selected={services.data?.find((x) => x.code === s.code)?.id === serviceId}
                    onClick={() => {
                      const hit = services.data?.find((x) => x.code === s.code);
                      if (hit) {
                        setServiceId(hit.id);
                        setStep(1);
                      }
                    }}
                  >
                    {s.name}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          <Button disabled={!vehicleId} onClick={() => setStep(1)}>
            Continue
          </Button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <QueryBoundary query={services} rows={4}>
            {(list) => (
              <ul className="divide-y divide-line border border-line">
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={s.id === serviceId}
                      onClick={() => setServiceId(s.id)}
                      className={`flex w-full items-center justify-between gap-4 px-4 py-4 text-left hover:bg-paper-2 ${s.id === serviceId ? 'bg-paper-2' : ''}`}
                    >
                      <span>{s.name}</span>
                      <span className="mono text-sm text-muted">{minutes(s.base_duration_min)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>

          {serviceId ? (
            <Card>
              {quote.isLoading ? (
                <Spinner label="Working out your price" />
              ) : quote.isError ? (
                <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
              ) : quote.data ? (
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <p className="label">Likely price, GST included</p>
                    <p className="mono mt-1 text-3xl">{priceRange(quote.data.price.low, quote.data.price.high)}</p>
                  </div>
                  <div>
                    <p className="label">Time estimate</p>
                    <p className="mono mt-1 text-3xl">{minutes(quote.data.duration.minutes)}</p>
                  </div>
                  {quote.data.why.length > 0 ? (
                    <details className="sm:col-span-2 text-sm text-muted">
                      <summary className="cursor-pointer">Why this estimate?</summary>
                      <ul className="mt-2 list-inside list-disc">
                        {quote.data.why.map((w) => (
                          <li key={w.feature}>
                            {w.feature.replace(/_/g, ' ')} {w.effect >= 0 ? 'raises' : 'lowers'} it
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <p className="sm:col-span-2 text-sm text-muted">
                    The final price is set by the workshop when the job is done. If it comes in well above this range,
                    you approve it before paying.
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button disabled={!serviceId || !quote.data} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Service type">
            <Chip selected={mode === 'workshop'} onClick={() => setMode('workshop')}>
              I will take it to the workshop
            </Chip>
            <Chip selected={mode === 'doorstep'} onClick={() => setMode('doorstep')}>
              Doorstep service
            </Chip>
          </div>

          {addresses.data?.length ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Address">
              {addresses.data.map((a) => (
                <Chip
                  key={a.id}
                  selected={!newAddress && a.id === addressId}
                  onClick={() => {
                    setAddressId(a.id);
                    setNewAddress(null);
                  }}
                >
                  {a.label}: {a.line1.slice(0, 32)}
                </Chip>
              ))}
              <Chip selected={Boolean(newAddress)} onClick={() => setNewAddress(newAddress ?? { line1: '', city: 'Chennai', pincode: null, lat: 13.0827, lng: 80.2707 })}>
                Somewhere else
              </Chip>
            </div>
          ) : null}

          {newAddress || !addresses.data?.length ? (
            <AddressPicker value={newAddress && newAddress.line1 ? newAddress : null} onChange={setNewAddress} />
          ) : point ? (
            <MapView
              center={point}
              zoom={14}
              pins={[{ id: 'pickup', lat: point.lat, lng: point.lng, tone: 'accent' }]}
              className="h-64"
              ariaLabel="Where the service will happen"
            />
          ) : null}

          {chosenService ? (
            <p className="text-sm text-muted">
              {chosenService.name}
              {quote.data ? ` · ${priceRange(quote.data.price.low, quote.data.price.high)} · ${minutes(quote.data.duration.minutes)}` : ''}
            </p>
          ) : null}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button loading={busy} disabled={!point || (newAddress !== null && !newAddress.line1)} onClick={() => void confirm()}>
              Find me a workshop
            </Button>
          </div>
        </section>
      )}

      {error ? (
        <p role="alert" className="mt-6 text-sm text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}
