import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTime, km, plate, priceRange, rupees } from '@/lib/format';
import { useApiMutation, useMyWorkshop, usePendingOffers, useWorkshopJobs } from '@/hooks/queries';
import { requireSupabase } from '@/lib/supabase';
import { OfferCard } from '@/features/OfferCard';
import { MapView } from '@/map/Map';
import type { Booking } from '@/lib/types';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, QueryBoundary, SkeletonList } from '@/ui/Feedback';
import { TextField } from '@/ui/Field';
import { Modal } from '@/ui/Modal';
import { StatusChip } from '@/ui/Status';
import { Card, PageHeader } from '@/ui/Surface';

const STAGE_NOTE: Record<string, string> = {
  probation: 'On probation: nearby jobs only, up to 2 a day, until you complete 10 jobs.',
  review: 'Your workshop is being re-verified. You will not receive offers until it is approved.',
  suspended: 'Your workshop is suspended pending review. Check your notifications for the reason.',
};

export default function Today() {
  const qc = useQueryClient();
  const ws = useMyWorkshop();
  const offers = usePendingOffers(ws.data?.id);
  const jobs = useWorkshopJobs(ws.data?.id);
  const [completing, setCompleting] = useState<Booking | null>(null);

  if (ws.isLoading) return <div className="container-x py-12"><SkeletonList /></div>;
  if (ws.isError) return <div className="container-x py-12"><ErrorState error={ws.error} onRetry={() => void ws.refetch()} /></div>;
  if (!ws.data) return <Navigate to="/mechanic/apply" replace />;

  const w = ws.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['offers', w.id] });
    void qc.invalidateQueries({ queryKey: ['workshop-jobs', w.id] });
  };

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow={w.name} title="Today" />
      {STAGE_NOTE[w.stage] ? (
        <p className="mb-8 border border-warn px-4 py-3 text-sm text-warn">{STAGE_NOTE[w.stage]}</p>
      ) : null}

      <section className="mb-12" aria-labelledby="offers-h">
        <h2 id="offers-h" className="label mb-4">Offers</h2>
        <QueryBoundary query={offers} rows={1}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No offers right now" body="Keep this open. New jobs near you appear here with a 90 second timer." />
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {list.map((o) => (
                  <OfferCard key={o.id} offer={o} workshop={w} onAnswered={refresh} />
                ))}
              </div>
            )
          }
        </QueryBoundary>
      </section>

      <section aria-labelledby="queue-h">
        <h2 id="queue-h" className="label mb-4">Your queue</h2>
        <QueryBoundary query={jobs} rows={2}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="Nothing in progress" />
            ) : (
              <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
                <ul className="space-y-4">
                  {list.map((b) => (
                    <JobRow key={b.id} job={b} onChange={refresh} onComplete={() => setCompleting(b)} />
                  ))}
                </ul>
                <MapView
                  center={{ lat: w.lat, lng: w.lng }}
                  zoom={11}
                  pins={[
                    { id: 'shop', lat: w.lat, lng: w.lng, tone: 'ink', label: w.name },
                    ...list.map((b) => ({ id: b.id, lat: b.pickup_lat, lng: b.pickup_lng, tone: 'accent' as const, label: b.ref })),
                  ]}
                  className="h-80"
                  ariaLabel="Your jobs on the map"
                />
              </div>
            )
          }
        </QueryBoundary>
      </section>

      <CompleteModal job={completing} onClose={() => setCompleting(null)} onDone={refresh} />
    </div>
  );
}

function JobRow({ job, onChange, onComplete }: { job: Booking; onChange: () => void; onComplete: () => void }) {
  const start = useApiMutation(() => api(`/api/bookings/${job.id}/start`, { body: {} }), []);
  const confirm = useApiMutation(
    async () => {
      // RLS lets a workshop read the payments of its own bookings
      const { data, error } = await requireSupabase()
        .from('payments')
        .select('id')
        .eq('booking_id', job.id)
        .eq('status', 'pending_verification')
        .limit(1)
        .single();
      if (error) throw new Error('No payment is waiting for this job');
      return api(`/api/payments/${data.id}/confirm`, { body: {} });
    },
    [],
  );

  return (
    <Card as="li">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xl">{job.services?.name}</p>
          <p className="mt-1 text-sm text-muted">
            {job.ref} · {job.vehicles ? `${job.vehicles.vehicle_models.make} ${job.vehicles.vehicle_models.model} · ${plate(job.vehicles.registration_no)}` : ''}
          </p>
          <p className="mt-1 text-sm text-muted">
            {dateTime(job.created_at)} · {km(job.distance_km)} · quote {priceRange(job.quote_low, job.quote_high)}
          </p>
        </div>
        <StatusChip status={job.status} />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {job.status === 'accepted' ? (
          <Button loading={start.isPending} onClick={() => start.mutate(undefined as never, { onSuccess: onChange })}>
            Start job
          </Button>
        ) : null}
        {job.status === 'in_progress' ? <Button onClick={onComplete}>Mark completed</Button> : null}
        {job.status === 'payment_pending_verification' ? (
          <Button loading={confirm.isPending} onClick={() => confirm.mutate(undefined as never, { onSuccess: onChange })}>
            Payment received
          </Button>
        ) : null}
        {job.status === 'completed' && job.final_price !== null ? (
          <p className="text-sm text-muted">
            Final price {rupees(job.final_price, true)}
            {job.needs_price_approval && !job.price_approved_at ? ' · waiting for the customer to approve' : ' · waiting for payment'}
          </p>
        ) : null}
      </div>
      {start.isError || confirm.isError ? (
        <p role="alert" className="mt-3 text-sm text-crit">{((start.error ?? confirm.error) as Error).message}</p>
      ) : null}
    </Card>
  );
}

function CompleteModal({ job, onClose, onDone }: { job: Booking | null; onClose: () => void; onDone: () => void }) {
  const [labour, setLabour] = useState('');
  const [parts, setParts] = useState('0');
  const m = useApiMutation(
    () => api(`/api/bookings/${job!.id}/complete`, { body: { labour_amount: Number(labour), parts_amount: Number(parts) || 0 } }),
    [],
  );
  const taxable = (Number(labour) || 0) + (Number(parts) || 0);
  const total = Math.round(taxable * 1.18 * 100) / 100;
  const over = job ? total > job.quote_high * 1.15 : false;

  return (
    <Modal
      open={job !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Complete the job"
      description="Enter what you are charging, before GST. The customer sees the total with GST."
    >
      <div className="space-y-5">
        <TextField label="Labour (₹, before GST)" inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} className="mono" />
        <TextField label="Parts (₹, before GST)" inputMode="decimal" value={parts} onChange={(e) => setParts(e.target.value)} className="mono" />
        <p className="mono text-lg">Total with GST: {rupees(total, true)}</p>
        {over ? (
          <p className="border border-warn px-3 py-2 text-sm text-warn">
            This is more than 15% above the top of the quote, so the customer must approve it before they can pay.
          </p>
        ) : null}
        <Button
          loading={m.isPending}
          disabled={!(Number(labour) >= 0) || labour === ''}
          onClick={() => m.mutate(undefined as never, { onSuccess: () => { onClose(); onDone(); } })}
        >
          Mark completed
        </Button>
        {m.isError ? <p role="alert" className="text-sm text-crit">{(m.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}
