import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateTime, rupees } from '@/lib/format';
import { useApiMutation, useMyWorkshop } from '@/hooks/queries';
import { requireSupabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { Card, PageHeader } from '@/ui/Surface';

interface Row {
  id: string;
  amount: number;
  status: string;
  utr: string | null;
  reference: string;
  submitted_at: string | null;
  bookings: { ref: string; services: { name: string } | null } | null;
}

/** UPI payments cannot confirm themselves: the workshop taps "Payment received" after checking its app. */
export default function MechanicPayments() {
  const ws = useMyWorkshop();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mechanic-payments', ws.data?.id],
    enabled: Boolean(ws.data?.id),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('payments')
        .select('id, amount, status, utr, reference, submitted_at, bookings(ref, services(name))')
        .in('status', ['pending_verification', 'confirmed'])
        .order('submitted_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });
  const confirm = useApiMutation((id: string) => api(`/api/payments/${id}/confirm`, { body: {} }), [['mechanic-payments']]);

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Money" title="Payments" />
      <QueryBoundary query={q} rows={3}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No payments yet" body="When a customer pays by UPI, it shows up here for you to confirm." />
          ) : (
            <ul className="space-y-4">
              {rows.map((p) => (
                <Card as="li" key={p.id} className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-lg">{p.bookings?.services?.name ?? 'Service'}</p>
                    <p className="mt-1 text-sm text-muted">
                      {p.bookings?.ref ?? p.reference} · {dateTime(p.submitted_at)}
                      {p.utr ? <> · UTR <span className="mono">{p.utr}</span></> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="mono text-xl">{rupees(p.amount, true)}</span>
                    {p.status === 'pending_verification' ? (
                      <Button
                        loading={confirm.isPending && confirm.variables === p.id}
                        onClick={() => confirm.mutate(p.id, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['mechanic-payments'] }) })}
                      >
                        Payment received
                      </Button>
                    ) : (
                      <span className="label text-ok">Confirmed</span>
                    )}
                  </div>
                </Card>
              ))}
            </ul>
          )
        }
      </QueryBoundary>
      {confirm.isError ? <p role="alert" className="mt-4 text-sm text-crit">{(confirm.error as Error).message}</p> : null}
      <p className="mt-8 text-sm text-muted">
        Only confirm after the money shows in your account. A confirmed payment cannot be undone from here.
      </p>
    </div>
  );
}
