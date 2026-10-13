import type { ReactNode } from 'react';
import { Button } from './Button';

/** Every data-driven screen ships a loading, an empty and an error state. */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse bg-paper-2 ${className}`} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-line px-6 py-12 text-center">
      <p className="display text-2xl">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-muted">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="border border-crit px-6 py-8">
      <p className="label text-crit">Something went wrong</p>
      <p className="mt-2">{message}</p>
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>{label}…</span>
    </div>
  );
}

/** Convenience wrapper: pick the right state for a TanStack Query result. */
export function QueryBoundary<T>({
  query,
  empty,
  children,
  rows,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
  rows?: number;
}) {
  if (query.isLoading) return <SkeletonList rows={rows} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty?.(query.data)) return null;
  return <>{children(query.data)}</>;
}
