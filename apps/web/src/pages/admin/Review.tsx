import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useApiMutation } from '@/hooks/queries';
import { requireSupabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { TextField } from '@/ui/Field';
import { Card, PageHeader } from '@/ui/Surface';

interface QueueRow {
  id: string;
  shop_name: string;
  city: string;
  review_due_at: string | null;
  overdue: boolean;
  failed_checks: number;
}

interface DocRow {
  id: string;
  kind: string;
  storage_path: string | null;
  number: string | null;
}

interface CheckRow {
  check_name: string;
  passed: boolean;
  blocking: boolean;
  detail: { reason?: string; matches?: unknown[] };
}

async function signed(path: string) {
  const { data, error } = await requireSupabase().storage.from('workshop-docs').createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, '_blank', 'noopener');
}

function Application({ row, onDone }: { row: QueueRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const docs = useQuery({
    queryKey: ['app-docs', row.id],
    enabled: open,
    queryFn: async () => {
      const [d, c] = await Promise.all([
        requireSupabase().from('workshop_documents').select('id, kind, storage_path, number').eq('application_id', row.id),
        requireSupabase().from('kyc_checks').select('check_name, passed, blocking, detail').eq('application_id', row.id).order('id'),
      ]);
      return { docs: (d.data ?? []) as DocRow[], checks: (c.data ?? []) as CheckRow[] };
    },
  });
  const approve = useApiMutation(() => api(`/api/admin/applications/${row.id}/approve`, { body: {} }), []);
  const reject = useApiMutation(() => api(`/api/admin/applications/${row.id}/reject`, { body: { reason } }), []);

  return (
    <Card as="li" className={row.overdue ? 'border-warn' : ''}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xl">{row.shop_name}</p>
          <p className="text-sm text-muted">
            {row.city} · review due {dateTime(row.review_due_at)}
            {row.overdue ? ' · overdue' : ''}
            {row.failed_checks ? ` · ${row.failed_checks} flagged checks` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Review'}
        </Button>
      </div>

      {open ? (
        <div className="mt-5 space-y-5 border-t border-line pt-5">
          <QueryBoundary query={docs}>
            {(d) => (
              <>
                <div>
                  <p className="label mb-2">Documents</p>
                  <ul className="space-y-1 text-sm">
                    {d.docs.map((x) => (
                      <li key={x.id} className="flex gap-3">
                        <span className="w-44 text-muted">{x.kind.replace(/_/g, ' ')}</span>
                        {x.storage_path ? (
                          <button className="underline underline-offset-4" onClick={() => void signed(x.storage_path!)}>
                            Open
                          </button>
                        ) : (
                          <span className="mono">{x.number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="label mb-2">Automated checks</p>
                  <ul className="space-y-1 text-sm">
                    {d.checks.map((c, i) => (
                      <li key={i} className={c.passed ? 'text-ok' : c.blocking ? 'text-crit' : 'text-warn'}>
                        {c.passed ? '✓' : '✕'} {c.check_name.replace(/_/g, ' ')}
                        {c.detail?.reason ? ` — ${c.detail.reason}` : ''}
                        {c.detail?.matches?.length ? ` — ${c.detail.matches.length} possible duplicate(s)` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </QueryBoundary>
          <p className="text-sm text-muted">Compare the photos with the map pin, call the owner, and confirm services and prices before approving.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Button loading={approve.isPending} onClick={() => approve.mutate(undefined as never, { onSuccess: onDone })}>
              Approve to probation
            </Button>
            <div className="min-w-[240px] flex-1">
              <TextField label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={reject.isPending} onClick={() => reject.mutate(undefined as never, { onSuccess: onDone })}>
              Reject
            </Button>
          </div>
          {approve.isError || reject.isError ? (
            <p role="alert" className="text-sm text-crit">{((approve.error ?? reject.error) as Error).message}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export default function Review() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['review-queue'], queryFn: () => api<QueueRow[]>('/api/admin/review-queue') });
  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Onboarding" title="Review queue" />
      <QueryBoundary query={q} rows={3}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="Nothing waiting" body="Applications appear here once the applicant submits their documents." />
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => (
                <Application key={r.id} row={r} onDone={() => void qc.invalidateQueries({ queryKey: ['review-queue'] })} />
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </div>
  );
}
