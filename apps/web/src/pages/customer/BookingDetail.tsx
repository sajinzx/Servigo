import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTime, km, minutes, plate, priceRange, rupees } from '@/lib/format';
import { CANCELLABLE, needsPayment } from '@/lib/status';
import { useApiMutation, useBooking, usePayment } from '@/hooks/queries';
import { PayPanel } from '@/features/PayPanel';
import { MapView } from '@/map/Map';
import { Button } from '@/ui/Button';
import { ErrorState, SkeletonList } from '@/ui/Feedback';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/Field';
import { StatusChip, Timeline } from '@/ui/Status';
import { Card, Chip, PageHeader, Stat } from '@/ui/Surface';

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { booking, events } = useBooking(id);
  const payment = usePayment(id);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['booking', id] });
    void qc.invalidateQueries({ queryKey: ['booking-events', id] });
    void qc.invalidateQueries({ queryKey: ['payment', id] });
  };
  const cancel = useApiMutation(() => api(`/api/bookings/${id}/cancel`, { body: {} }), [['booking', id], ['bookings']]);
  const approve = useApiMutation(() => api(`/api/bookings/${id}/approve-price`, { body: {} }), [['booking', id]]);

  if (booking.isLoading) return <div className="container-x py-12"><SkeletonList rows={4} /></div>;
  if (booking.isError || !booking.data) {
    return <div className="container-x py-12"><ErrorState error={booking.error ?? new Error('Booking not found')} onRetry={() => void booking.refetch()} /></div>;
  }
  const b = booking.data;
  const w = b.workshops;
  const mustApprove = b.needs_price_approval && !b.price_approved_at;
  const canPay = needsPayment(b.status) && !mustApprove && b.final_price !== null;
  const showMap = ['accepted', 'in_progress'].includes(b.status) && w;

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow={b.ref} title={b.services?.name ?? 'Service'}>
        <StatusChip status={b.status} />
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {b.status === 'no_match' ? (
            <Card className="border-crit">
              <p className="display text-2xl">No workshop could take this right now.</p>
              <p className="mt-2 text-muted">We looked up to 40 km around you. You can try again in a little while or book for a later time.</p>
            </Card>
          ) : null}

          {showMap ? (
            <MapView
              center={{ lat: w.lat, lng: w.lng }}
              zoom={13}
              pins={[
                { id: 'ws', lat: w.lat, lng: w.lng, label: w.name, tone: 'ink' },
                { id: 'you', lat: b.pickup_lat, lng: b.pickup_lng, label: 'You', tone: 'accent' },
              ]}
              route={[[w.lng, w.lat], [b.pickup_lng, b.pickup_lat]]}
              className="h-72"
              ariaLabel={`${w.name} and your location`}
            />
          ) : null}

          {w ? (
            <Card>
              <p className="label">Workshop</p>
              <p className="mt-1 text-2xl">{w.name}</p>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Stat label="Distance" value={km(b.distance_km)} />
                <Stat label="ETA" value={minutes(b.eta_min)} />
                <Stat label="Job time" value={minutes(b.predicted_duration_min)} />
              </div>
              {/* the number is only shown after the workshop has accepted */}
              {w.phone ? (
                <p className="mt-4 text-sm">
                  Contact: <a className="mono underline" href={`tel:${w.phone}`}>{w.phone}</a>
                </p>
              ) : null}
            </Card>
          ) : null}

          {mustApprove ? (
            <Card className="border-warn">
              <p className="label text-warn">Approval needed</p>
              <p className="mt-2 text-xl">
                The workshop&apos;s final price is <span className="mono">{rupees(b.final_price, true)}</span>, well above the quoted{' '}
                <span className="mono">{priceRange(b.quote_low, b.quote_high)}</span>.
              </p>
              <p className="mt-1 text-muted">Check it before you pay. If it does not look right, raise an issue instead.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button loading={approve.isPending} onClick={() => approve.mutate(undefined as never)}>
                  Approve this price
                </Button>
                <Button variant="secondary" onClick={() => setDisputeOpen(true)}>
                  Something is wrong
                </Button>
              </div>
            </Card>
          ) : null}

          {canPay && b.final_price !== null ? (
            payment.data?.status === 'pending_verification' ? (
              <Card>
                <p className="label">Payment</p>
                <p className="mt-2 text-xl">We are verifying your payment.</p>
              </Card>
            ) : (
              <PayPanel bookingId={b.id} amount={Number(b.final_price)} onPaid={refresh} />
            )
          ) : null}

          {b.status === 'payment_pending_verification' ? (
            <Card>
              <p className="label">Payment</p>
              <p className="mt-2 text-xl">We are verifying your payment.</p>
              <p className="mt-1 text-muted">UTR <span className="mono">{payment.data?.utr ?? '—'}</span></p>
            </Card>
          ) : null}

          {b.status === 'paid' ? (
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="label">Paid</p>
                <p className="mt-1 text-xl">How was {w?.name ?? 'the service'}?</p>
              </div>
              <Button onClick={() => setReviewOpen(true)}>Leave a review</Button>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-8">
          <Card>
            <p className="label mb-4">Progress</p>
            <Timeline current={b.status} events={events.data ?? []} />
          </Card>
          <Card>
            <p className="label">Vehicle</p>
            <p className="mt-1">
              {b.vehicles?.vehicle_models.make} {b.vehicles?.vehicle_models.model}
            </p>
            <p className="mono text-sm text-muted">{b.vehicles ? plate(b.vehicles.registration_no) : ''}</p>
            <p className="label mt-4">Requested</p>
            <p className="text-sm">{dateTime(b.created_at)}</p>
            <p className="label mt-4">Quote</p>
            <p className="mono text-sm">{priceRange(b.quote_low, b.quote_high)}</p>
            {b.final_price !== null ? (
              <>
                <p className="label mt-4">Final price</p>
                <p className="mono text-lg">{rupees(b.final_price, true)}</p>
              </>
            ) : null}
          </Card>
          {CANCELLABLE.includes(b.status) ? (
            <Button variant="danger" className="w-full" loading={cancel.isPending} onClick={() => cancel.mutate(undefined as never)}>
              Cancel booking
            </Button>
          ) : null}
          {['completed', 'paid', 'reviewed'].includes(b.status) ? (
            <button type="button" className="text-sm text-muted underline underline-offset-4" onClick={() => setDisputeOpen(true)}>
              Raise an issue (within 72 hours)
            </button>
          ) : null}
          {cancel.isError ? <p role="alert" className="text-sm text-crit">{(cancel.error as Error).message}</p> : null}
        </aside>
      </div>

      <ReviewModal open={reviewOpen} onOpenChange={setReviewOpen} bookingId={b.id} onDone={refresh} />
      <DisputeModal open={disputeOpen} onOpenChange={setDisputeOpen} bookingId={b.id} onDone={refresh} />
    </div>
  );
}

function ReviewModal({ open, onOpenChange, bookingId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; bookingId: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const m = useApiMutation(
    () => api(`/api/bookings/${bookingId}/review`, { body: { rating, comment: comment.trim() || undefined } }),
    [],
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Rate the service">
      <div className="space-y-5">
        <div className="flex gap-2" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} selected={rating === n} onClick={() => setRating(n)}>
              {n}
            </Chip>
          ))}
        </div>
        <TextArea label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        <Button
          loading={m.isPending}
          disabled={rating === 0}
          onClick={() => m.mutate(undefined as never, { onSuccess: () => { onOpenChange(false); onDone(); } })}
        >
          Submit review
        </Button>
        {m.isError ? <p role="alert" className="text-sm text-crit">{(m.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}

function DisputeModal({ open, onOpenChange, bookingId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; bookingId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useApiMutation(() => api(`/api/bookings/${bookingId}/dispute`, { body: { reason: reason.trim() } }), []);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Raise an issue"
      description="Tell us what went wrong. Our team reviews it and may refund part or all of the amount."
    >
      <div className="space-y-5">
        <TextArea label="What happened?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        <Button
          loading={m.isPending}
          disabled={reason.trim().length < 5}
          onClick={() => m.mutate(undefined as never, { onSuccess: () => { onOpenChange(false); onDone(); } })}
        >
          Send to our team
        </Button>
        {m.isError ? <p role="alert" className="text-sm text-crit">{(m.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}
