import { useQuery } from '@tanstack/react-query';
import { cellToBoundary } from 'h3-js';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { dateTime } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';
import type { BookingStatus } from '@/lib/status';
import { MapView, type HexCell } from '@/map/Map';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { StatusChip } from '@/ui/Status';
import { Card, PageHeader, Stat } from '@/ui/Surface';

interface Live {
  id: string;
  ref: string;
  status: BookingStatus;
  created_at: string;
  service: string;
  workshop: string | null;
  lat: number;
  lng: number;
  miss_count: number;
}

interface Heat {
  h3_cell: string;
  total_yhat: number;
  total_hi: number;
}

const CHENNAI = { lat: 13.0827, lng: 80.2707 };

export function hexesFrom(rows: Heat[]): HexCell[] {
  return rows.map((r) => ({
    // h3-js returns [lat, lng]; the map wants [lng, lat]
    ring: cellToBoundary(r.h3_cell).map(([lat, lng]) => [lng, lat] as [number, number]),
    value: r.total_yhat,
  }));
}

export default function Operations() {
  const live = useQuery({
    queryKey: ['admin-live'],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('admin_live_bookings');
      if (error) throw new Error(error.message);
      return (data ?? []) as Live[];
    },
  });
  const heat = useQuery({
    queryKey: ['admin-heat'],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('admin_demand_heatmap');
      if (error) throw new Error(error.message);
      return (data ?? []) as Heat[];
    },
  });
  const hexes = useMemo(() => hexesFrom(heat.data ?? []), [heat.data]);

  const stuck = (live.data ?? []).filter((b) => b.status === 'no_match' || b.miss_count >= 3);
  const active = (live.data ?? []).filter((b) => ['matching', 'offered', 'accepted', 'in_progress'].includes(b.status));

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Operations" title="Live" />

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat label="Active now" value={active.length} />
        <Stat label="Matching" value={active.filter((b) => b.status === 'matching').length} />
        <Stat label="Offered" value={active.filter((b) => b.status === 'offered').length} />
        <Stat label="Needs attention" value={stuck.length} hint="No match, or 3+ misses" />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_420px]">
        <div>
          <p className="label mb-3">Demand next 7 days (H3 cells)</p>
          <MapView
            center={CHENNAI}
            zoom={10}
            hexes={hexes}
            pins={active.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, tone: b.status === 'matching' ? 'crit' : 'accent', label: b.ref }))}
            className="h-[460px]"
            ariaLabel="Demand heatmap with live bookings"
          />
          {heat.data && heat.data.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No forecast yet. The nightly job writes it once the demand model is promoted.</p>
          ) : null}
        </div>

        <div>
          <p className="label mb-3">Live bookings</p>
          <QueryBoundary query={live} rows={4}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState title="Quiet right now" />
              ) : (
                <ul className="divide-y divide-line border border-line">
                  {rows.slice(0, 30).map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">
                          <Link className="underline-offset-4 hover:underline" to={`/bookings/${b.id}`}>{b.ref}</Link> · {b.service}
                        </p>
                        <p className="truncate text-muted">
                          {b.workshop ?? 'unassigned'} · {dateTime(b.created_at)}
                          {b.miss_count ? ` · ${b.miss_count} misses` : ''}
                        </p>
                      </div>
                      <StatusChip status={b.status} />
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
          {stuck.length > 0 ? (
            <Card className="mt-6 border-warn">
              <p className="label text-warn">Unmatched or stuck</p>
              <ul className="mt-2 space-y-1 text-sm">
                {stuck.slice(0, 8).map((b) => (
                  <li key={b.id}>
                    {b.ref} · {b.service} · {b.status === 'no_match' ? 'no workshop' : `${b.miss_count} misses`}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
