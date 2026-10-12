import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useApiMutation } from '@/hooks/queries';
import { Button } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { SelectField, TextField } from '@/ui/Field';
import { Card, PageHeader } from '@/ui/Surface';

interface Case {
  kind: 'incident' | 'dispute' | 'appeal';
  id: string;
  booking_id: string | null;
  summary: string;
  opened_at: string;
}

function CaseCard({ c, onDone }: { c: Case; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'upheld' | 'partial' | 'rejected'>('rejected');
  const [refund, setRefund] = useState('');

  const resolve = useApiMutation(async (action: string) => {
    const base = `/api/admin`;
    if (c.kind === 'incident') {
      return api(`${base}/incidents/${c.id}/resolve`, { body: { upheld: action === 'uphold', resolution: note } });
    }
    if (c.kind === 'dispute') {
      return api(`${base}/disputes/${c.id}/resolve`, {
        body: { outcome, refund_amount: outcome === 'rejected' ? 0 : Number(refund), resolution: note },
      });
    }
    return api(`${base}/strikes/${c.id}/appeal`, { body: { accept: action === 'accept', note } });
  }, []);

  const done = () => onDone();
  return (
    <Card as="li">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">{c.kind}</p>
          <p className="mt-1 text-lg">{c.summary}</p>
          <p className="mt-1 text-sm text-muted">
            {dateTime(c.opened_at)}
            {c.booking_id ? (
              <>
                {' · '}
                <Link className="underline underline-offset-4" to={`/bookings/${c.booking_id}`}>booking</Link>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextField label="Decision note (kept in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
        {c.kind === 'dispute' ? (
          <>
            <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="rejected">Reject: no refund</option>
              <option value="partial">Partial refund</option>
              <option value="upheld">Upheld: refund</option>
            </SelectField>
            {outcome !== 'rejected' ? (
              <TextField label="Refund amount (₹)" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} className="mono" />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {c.kind === 'dispute' ? (
          <Button loading={resolve.isPending} disabled={note.trim().length < 3} onClick={() => resolve.mutate('resolve', { onSuccess: done })}>
            Resolve dispute
          </Button>
        ) : c.kind === 'incident' ? (
          <>
            <Button loading={resolve.isPending} disabled={note.trim().length < 3} onClick={() => resolve.mutate('uphold', { onSuccess: done })}>
              Uphold (strike)
            </Button>
            <Button variant="secondary" disabled={note.trim().length < 3} onClick={() => resolve.mutate('reject', { onSuccess: done })}>
              Reject
            </Button>
          </>
        ) : (
          <>
            <Button loading={resolve.isPending} disabled={note.trim().length < 3} onClick={() => resolve.mutate('accept', { onSuccess: done })}>
              Accept appeal (remove strike)
            </Button>
            <Button variant="secondary" disabled={note.trim().length < 3} onClick={() => resolve.mutate('decline', { onSuccess: done })}>
              Decline
            </Button>
          </>
        )}
      </div>
      {resolve.isError ? <p role="alert" className="mt-3 text-sm text-crit">{(resolve.error as Error).message}</p> : null}
    </Card>
  );
}

export default function Cases() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-cases'], queryFn: () => api<Case[]>('/api/admin/cases') });
  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Trust & safety" title="Open cases" />
      <QueryBoundary query={q} rows={3}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No open cases" />
          ) : (
            <ul className="space-y-4">
              {rows.map((c) => (
                <CaseCard key={`${c.kind}-${c.id}`} c={c} onDone={() => void qc.invalidateQueries({ queryKey: ['admin-cases'] })} />
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </div>
  );
}
