import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useApiMutation } from '@/hooks/queries';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, QueryBoundary } from '@/ui/Feedback';
import { Card, PageHeader } from '@/ui/Surface';

interface ModelRow {
  name: string;
  active: string | null;
  versions: string[];
  promotion?: { metric: string; score: number; baseline_score: number; higher_is_better: boolean } | null;
}

interface DeadJob {
  id: number;
  event_type: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

const TITLES: Record<string, string> = {
  triage: 'M1 Symptom triage',
  duration: 'M2 Job duration',
  price: 'M3 Price range',
  acceptance: 'M4 Offer acceptance',
  demand: 'M5 Demand forecast',
  service_due: 'M6 Next service due',
  anomaly: 'M7 Anomaly flags',
};

/** Model health: live score next to the baseline, active version and a roll-back. */
export default function Models() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ['admin-models'], retry: false, queryFn: () => api<{ models: ModelRow[] }>('/api/admin/models') });
  const dead = useQuery({ queryKey: ['dead-letters'], queryFn: () => api<DeadJob[]>('/api/admin/dead-letters') });
  const rollback = useApiMutation((v: { name: string; version: string }) =>
    api(`/api/admin/models/${v.name}/rollback`, { body: { version: v.version } }), [['admin-models']]);
  const requeue = useApiMutation((id: number) => api(`/api/admin/dead-letters/${id}/requeue`, { body: {} }), [['dead-letters']]);

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Machine learning" title="Model health" />
      {models.isError ? (
        <ErrorState error={models.error} onRetry={() => void models.refetch()} />
      ) : (
        <QueryBoundary query={models} rows={3}>
          {({ models: rows }) =>
            rows.length === 0 ? (
              <EmptyState title="No models yet" body="Run the training pipeline. Until a model beats its baseline, the baseline serves." />
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {rows.map((m) => {
                  const p = m.promotion;
                  const better = p ? (p.higher_is_better ? p.score > p.baseline_score : p.score < p.baseline_score) : false;
                  return (
                    <Card as="li" key={m.name}>
                      <p className="label">{TITLES[m.name] ?? m.name}</p>
                      <p className="mt-2">
                        {m.active ? (
                          <>
                            Active <span className="mono">{m.active}</span>
                          </>
                        ) : (
                          <span className="text-warn">Serving the baseline</span>
                        )}
                      </p>
                      {p ? (
                        <p className="mono mt-2 text-sm">
                          {p.metric}: {p.score.toFixed(3)} vs baseline {p.baseline_score.toFixed(3)}{' '}
                          <span className={better ? 'text-ok' : 'text-crit'}>{better ? '● beats' : '● worse'}</span>
                        </p>
                      ) : null}
                      {m.versions.length > 1 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {m.versions
                            .filter((v) => v !== m.active)
                            .slice(-3)
                            .map((v) => (
                              <Button
                                key={v}
                                variant="secondary"
                                className="!px-3 !py-1.5"
                                loading={rollback.isPending}
                                onClick={() => rollback.mutate({ name: m.name, version: v })}
                              >
                                Roll back to {v.slice(4, 12)}
                              </Button>
                            ))}
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </ul>
            )
          }
        </QueryBoundary>
      )}

      <section className="mt-14">
        <h2 className="label mb-4">Failed jobs (dead letter)</h2>
        <QueryBoundary query={dead} rows={1}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="No failed jobs" />
            ) : (
              <ul className="space-y-3">
                {rows.map((j) => (
                  <Card as="li" key={j.id} className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="mono">{j.event_type}</p>
                      <p className="mt-1 text-sm text-muted">{j.attempts} attempts · {j.last_error ?? 'no error recorded'}</p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => requeue.mutate(j.id, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['dead-letters'] }) })}
                    >
                      Retry
                    </Button>
                  </Card>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </section>
    </div>
  );
}
