import { useState } from 'react';
import { api } from '@/lib/api';
import { km, minutes, priceRange } from '@/lib/format';
import type { Offer } from '@/lib/types';
import { Button } from '@/ui/Button';
import { CountdownRing, useSecondsLeft } from '@/ui/Countdown';
import { Card } from '@/ui/Surface';

/**
 * A new job offer: what it is, how far, the price range, and 90 seconds to answer.
 * The commission is shown before accepting, as the plan requires.
 */
export function OfferCard({
  offer,
  workshop,
  commissionRate = 0.1,
  onAnswered,
}: {
  offer: Offer;
  workshop: { lat: number; lng: number };
  commissionRate?: number;
  onAnswered: () => void;
}) {
  const left = useSecondsLeft(offer.expires_at);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const b = offer.bookings;

  const answer = async (kind: 'accept' | 'reject') => {
    setBusy(kind);
    setErr(null);
    try {
      await api(`/api/offers/${offer.id}/${kind}`, { body: {} });
      onAnswered();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send your answer');
    } finally {
      setBusy(null);
    }
  };

  const approxKm =
    b ? Math.hypot((b.pickup_lat - workshop.lat) * 111, (b.pickup_lng - workshop.lng) * 108) : null;

  return (
    <Card as="article" className="border-accent">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label text-accent">New job</p>
          <h3 className="mt-1 text-3xl">{b?.services?.name ?? 'Service'}</h3>
          <p className="mt-1 text-sm text-muted">
            {b?.vehicles ? `${b.vehicles.vehicle_models.make} ${b.vehicles.vehicle_models.model}` : ''}
            {b?.mode === 'doorstep' ? ' · doorstep' : ''}
          </p>
        </div>
        <CountdownRing expiresAt={offer.expires_at} />
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="label">Distance</dt>
          <dd className="mono">{km(b?.distance_km ?? approxKm)}</dd>
        </div>
        <div>
          <dt className="label">ETA</dt>
          <dd className="mono">{minutes(b?.eta_min)}</dd>
        </div>
        <div>
          <dt className="label">Price range</dt>
          <dd className="mono">{b ? priceRange(b.quote_low, b.quote_high) : '—'}</dd>
        </div>
      </dl>
      {b?.symptom_text ? <p className="mt-4 border-l-2 border-line pl-3 text-sm text-muted">“{b.symptom_text}”</p> : null}
      <p className="mt-4 text-xs text-muted">
        ServiGo commission: {(commissionRate * 100).toFixed(0)}% of labour (plus 18% GST on the commission). Parts are
        not commissioned.
      </p>

      <div className="mt-5 flex gap-3">
        <Button loading={busy === 'accept'} disabled={left === 0 || busy !== null} onClick={() => void answer('accept')}>
          Accept
        </Button>
        <Button variant="secondary" loading={busy === 'reject'} disabled={left === 0 || busy !== null} onClick={() => void answer('reject')}>
          Decline
        </Button>
      </div>
      {left === 0 ? <p className="mt-3 text-sm text-muted">This offer has expired.</p> : null}
      {err ? <p role="alert" className="mt-3 text-sm text-crit">{err}</p> : null}
    </Card>
  );
}
