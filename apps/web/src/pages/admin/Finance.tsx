import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { dateTime, rupees } from '@/lib/format';
import { useApiMutation } from '@/hooks/queries';
import { requireSupabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { TextField } from '@/ui/Field';
import { Card, PageHeader } from '@/ui/Surface';

interface PendingPayment {
  id: string;
  amount: number;
  utr: string | null;
  reference: string;
  submitted_at: string | null;
}
interface PendingRefund {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}
interface Payout {
  id: string;
  amount: number;
  status: 'planned' | 'paid';
  workshop_id: string;
  created_at: string;
}

const older24 = (iso: string | null) => (iso ? Date.now() - new Date(iso).getTime() > 24 * 3600_000 : false);

function useTable<T>(
  key: string,
  fetcher: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
) {
  return useQuery({
    queryKey: [key],
    queryFn: async () => {
      const { data, error } = await fetcher();
      if (error) throw new Error(error.message);
      return (data ?? []) as T[];
    },
  });
}

export default function Finance() {
  const qc = useQueryClient();
  const reload = (k: string) => () => void qc.invalidateQueries({ queryKey: [k] });

  const sb = requireSupabase;
  const payments = useTable<PendingPayment>('fin-payments', () =>
    sb().from('payments').select('id, amount, utr, reference, submitted_at')
      .eq('status', 'pending_verification').order('submitted_at'));
  const refunds = useTable<PendingRefund>('fin-refunds', () =>
    sb().from('refunds').select('id, amount, reason, created_at').eq('status', 'pending').order('created_at'));
  const payouts = useTable<Payout>('fin-payouts', () =>
    sb().from('payouts').select('id, amount, status, workshop_id, created_at')
      .eq('status', 'planned').order('created_at'));
  const balanced = useQuery({
    queryKey: ['fin-balanced'],
    queryFn: () => api<{ balanced: boolean }>('/api/admin/finance/ledger/balanced'),
  });

  const confirm = useApiMutation((id: string) => api(`/api/payments/${id}/confirm`, { body: {} }), []);
  const reject = useApiMutation((v: { id: string; fake: boolean }) =>
    api(`/api/payments/${v.id}/reject`, { body: { reason: 'UTR not found in the bank statement', fake: v.fake } }), []);
  const plan = useApiMutation(() => api<{ planned: number }>('/api/admin/finance/payouts/plan', { body: {} }), []);

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Money" title="Finance">
        <p className={`label ${balanced.data?.balanced === false ? 'text-crit' : 'text-ok'}`}>
          Ledger {balanced.data ? (balanced.data.balanced ? 'balanced' : 'NOT BALANCED') : '…'}
        </p>
      </PageHeader>

      <section className="mb-12">
        <h2 className="label mb-4">UTRs to reconcile</h2>
        <QueryBoundary query={payments} rows={2}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="Nothing to reconcile" body="Match each UTR with the account statement, then confirm." />
            ) : (
              <ul className="space-y-3">
                {rows.map((p) => (
                  <Card as="li" key={p.id} className={`flex flex-wrap items-center justify-between gap-4 ${older24(p.submitted_at) ? 'border-warn' : ''}`}>
                    <div>
                      <p><span className="mono text-lg">{rupees(p.amount, true)}</span> · {p.reference}</p>
                      <p className="mt-1 text-sm text-muted">
                        UTR <span className="mono">{p.utr}</span> · {dateTime(p.submitted_at)}
                        {older24(p.submitted_at) ? ' · over 24 h' : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => confirm.mutate(p.id, { onSuccess: reload('fin-payments') })}>Confirm</Button>
                      <Button variant="secondary" onClick={() => reject.mutate({ id: p.id, fake: false }, { onSuccess: reload('fin-payments') })}>
                        Wrong UTR
                      </Button>
                      <Button variant="danger" onClick={() => reject.mutate({ id: p.id, fake: true }, { onSuccess: reload('fin-payments') })}>
                        Fake (strike)
                      </Button>
                    </div>
                  </Card>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
        {confirm.isError || reject.isError ? (
          <p role="alert" className="mt-3 text-sm text-crit">{((confirm.error ?? reject.error) as Error).message}</p>
        ) : null}
      </section>

      <section className="mb-12">
        <h2 className="label mb-4">Refunds to send</h2>
        <QueryBoundary query={refunds} rows={1}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="No pending refunds" />
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <RefundRow key={r.id} r={r} onDone={reload('fin-refunds')} />
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="label">Weekly payouts</h2>
          <Button variant="secondary" loading={plan.isPending} onClick={() => plan.mutate(undefined as never, { onSuccess: reload('fin-payouts') })}>
            Plan this week&apos;s payouts
          </Button>
        </div>
        <QueryBoundary query={payouts} rows={1}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="No planned payouts" body="Confirmed payments older than 72 hours are included when you plan." />
            ) : (
              <ul className="space-y-3">
                {rows.map((p) => (
                  <PayoutRow key={p.id} p={p} onDone={reload('fin-payouts')} />
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </section>
    </div>
  );
}

function RefundRow({ r, onDone }: { r: PendingRefund; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const m = useApiMutation(() => api(`/api/admin/finance/refunds/${r.id}/complete`, { body: { reference: ref } }), []);
  return (
    <Card as="li" className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p><span className="mono text-lg">{rupees(r.amount, true)}</span></p>
        <p className="mt-1 text-sm text-muted">{r.reason} · {dateTime(r.created_at)}</p>
      </div>
      <div className="flex items-end gap-2">
        <TextField label="UPI / bank reference" value={ref} onChange={(e) => setRef(e.target.value)} className="mono" />
        <Button disabled={ref.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined as never, { onSuccess: onDone })}>
          Mark sent
        </Button>
      </div>
      {m.isError ? <p role="alert" className="w-full text-sm text-crit">{(m.error as Error).message}</p> : null}
    </Card>
  );
}

function PayoutRow({ p, onDone }: { p: Payout; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const m = useApiMutation(() => api(`/api/admin/finance/payouts/${p.id}/paid`, { body: { reference: ref } }), []);
  return (
    <Card as="li" className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p><span className="mono text-lg">{rupees(p.amount, true)}</span></p>
        <p className="mt-1 text-sm text-muted">Workshop {p.workshop_id.slice(0, 8)} · planned {dateTime(p.created_at)}</p>
      </div>
      <div className="flex items-end gap-2">
        <TextField label="Transfer reference" value={ref} onChange={(e) => setRef(e.target.value)} className="mono" />
        <Button disabled={ref.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined as never, { onSuccess: onDone })}>
          Mark paid
        </Button>
      </div>
      {m.isError ? <p role="alert" className="w-full text-sm text-crit">{(m.error as Error).message}</p> : null}
    </Card>
  );
}
