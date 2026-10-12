import type { Sql } from '../db/sql';
import { RADIUS_STEPS_KM, type Point } from '../domain/geo';
import { assign } from '../domain/hungarian';
import type { EtaProvider } from '../domain/osrm';
import {
  scoreCandidates,
  type Candidate,
  type ScoreContext,
  type Scored,
  type Weights,
} from '../domain/scoring';

/** Fewer than this many candidates at a radius means we widen (plan 4.1). */
export const MIN_CANDIDATES = 3;
/** A booking waits no longer than this for an answer from one workshop. */
export const OFFER_TTL_SECONDS = 90;
/** More than this many waiting bookings in one area switches to batch assignment. */
export const BATCH_THRESHOLD = 5;

export type DispatchOutcome =
  | { outcome: 'offered'; offerId: string; workshopId: string; radiusKm: number }
  | { outcome: 'no_match' }
  | { outcome: 'skipped'; reason: string };

interface BookingRow {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  miss_count: number;
  search_radius_km: number;
}

interface CandidateRow {
  workshop_id: string;
  lat: number;
  lng: number;
  distance_km: number;
  staff_count: number;
  active_jobs: number;
  rating_sum: number;
  rating_count: number;
  jobs_today: number;
  offers_30d: number;
  accepted_30d: number;
  low_acceptance: boolean;
}

export interface AllocatorOptions {
  eta: EtaProvider;
  score?: ScoreContext;
  /** optional ML hook: returns P(accept) per workshop, or null to use the baseline */
  acceptModel?: (
    offers: {
      workshop_id: string;
      distance_km: number;
      active_jobs: number;
      staff_count: number;
      hour: number;
      weekday: number;
    }[],
  ) => Promise<Record<string, number> | null>;
  /** weights from the tuned allocation entry; defaults are the plan's starting values */
  weights?: () => Promise<Weights | null>;
  log?: (msg: string, extra?: unknown) => void;
}

export class Allocator {
  constructor(
    private sql: Sql,
    private opts: AllocatorOptions,
  ) {}

  private async loadBooking(id: string): Promise<BookingRow | null> {
    const r = await this.sql.query<BookingRow>(
      `select id, status, pickup_lat, pickup_lng, miss_count, search_radius_km
         from public.bookings where id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  private async candidates(bookingId: string, radiusKm: number): Promise<CandidateRow[]> {
    const r = await this.sql.query<CandidateRow>(
      'select * from public.find_candidates($1, $2, 20)',
      [bookingId, radiusKm],
    );
    return r.rows.map((c) => ({
      ...c,
      lat: Number(c.lat),
      lng: Number(c.lng),
      distance_km: Number(c.distance_km),
    }));
  }

  /** Rank candidates by score. Pure apart from the ETA and ML lookups. */
  async rank(booking: BookingRow, rows: CandidateRow[]): Promise<Scored[]> {
    const pickup: Point = { lat: booking.pickup_lat, lng: booking.pickup_lng };
    const { etaMin, usedFallback } = await this.opts.eta.etas(
      rows.map((c) => ({ lat: c.lat, lng: c.lng })),
      pickup,
    );
    if (usedFallback) this.opts.log?.('eta fallback used', { booking: booking.id });

    const now = new Date();
    const ml = this.opts.acceptModel
      ? await this.opts
          .acceptModel(
            rows.map((c) => ({
              workshop_id: c.workshop_id,
              distance_km: c.distance_km,
              active_jobs: c.active_jobs,
              staff_count: c.staff_count,
              hour: now.getHours(),
              weekday: (now.getDay() + 6) % 7,
            })),
          )
          .catch(() => null)
      : null;
    const tuned = this.opts.weights ? await this.opts.weights().catch(() => null) : null;

    const cands: Candidate[] = rows.map((c, i) => ({
      workshopId: c.workshop_id,
      etaMin: etaMin[i],
      distanceKm: c.distance_km,
      staffCount: c.staff_count,
      activeJobs: c.active_jobs,
      ratingSum: c.rating_sum,
      ratingCount: c.rating_count,
      jobsToday: c.jobs_today,
      offers30d: c.offers_30d,
      accepted30d: c.accepted_30d,
      pAccept: ml?.[c.workshop_id],
      lowAcceptance: c.low_acceptance,
    }));
    return scoreCandidates(cands, { ...this.opts.score, ...(tuned ? { weights: tuned } : {}) });
  }

  /** Radius to start from: one step wider for every three misses so far. */
  private startIndex(b: BookingRow): number {
    const byRadius = RADIUS_STEPS_KM.findIndex((r) => r >= b.search_radius_km);
    const byMisses = Math.floor(b.miss_count / 3);
    return Math.min(Math.max(byRadius, byMisses, 0), RADIUS_STEPS_KM.length - 1);
  }

  /** Find the best workshops, widening the radius only when fewer than 3 qualify. */
  private async search(b: BookingRow): Promise<{ ranked: Scored[]; rows: CandidateRow[]; radiusKm: number } | null> {
    let idx = this.startIndex(b);
    for (; idx < RADIUS_STEPS_KM.length; idx++) {
      const radius = RADIUS_STEPS_KM[idx];
      const rows = await this.candidates(b.id, radius);
      const lastStep = idx === RADIUS_STEPS_KM.length - 1;
      if (rows.length >= MIN_CANDIDATES || (lastStep && rows.length > 0)) {
        return { ranked: await this.rank(b, rows), rows, radiusKm: radius };
      }
      if (lastStep) break;
    }
    return null;
  }

  private async makeOffer(
    bookingId: string,
    s: Scored,
    rank: number,
    radiusKm: number,
  ): Promise<string> {
    const r = await this.sql.query<{ id: string }>(
      `select id from public.create_offer($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        bookingId,
        s.candidate.workshopId,
        s.score.toFixed(4),
        rank,
        JSON.stringify({ ...s.parts, radius_km: radiusKm, eta_min: s.candidate.etaMin }),
        s.candidate.etaMin,
        s.candidate.distanceKm.toFixed(2),
        OFFER_TTL_SECONDS,
      ],
    );
    return r.rows[0].id;
  }

  private async noMatch(bookingId: string): Promise<DispatchOutcome> {
    await this.sql.query(`select public.transition_booking($1, 'no_match', null, 'system')`, [bookingId]);
    return { outcome: 'no_match' };
  }

  /** Online greedy dispatch: offer to the top-scored workshop that can still take the job. */
  async dispatch(bookingId: string): Promise<DispatchOutcome> {
    const b = await this.loadBooking(bookingId);
    if (!b) return { outcome: 'skipped', reason: 'booking not found' };
    if (b.status !== 'matching') return { outcome: 'skipped', reason: `booking is ${b.status}` };

    const found = await this.search(b);
    if (!found) return this.noMatch(bookingId);

    // try the best first; if it filled up between ranking and offering, try the next
    for (let i = 0; i < found.ranked.length; i++) {
      try {
        const offerId = await this.makeOffer(bookingId, found.ranked[i], i + 1, found.radiusKm);
        if (found.radiusKm > b.search_radius_km) {
          // recorded after the offer so a failure above does not widen the search for nothing
          await this.sql.query('select public.set_search_radius($1, $2)', [bookingId, found.radiusKm]);
        }
        return {
          outcome: 'offered',
          offerId,
          workshopId: found.ranked[i].candidate.workshopId,
          radiusKm: found.radiusKm,
        };
      } catch (e) {
        const msg = (e as Error).message;
        if (/at capacity|workshop not available/.test(msg)) continue;
        if (/cannot be offered|booking is /.test(msg)) return { outcome: 'skipped', reason: msg };
        throw e;
      }
    }
    return this.noMatch(bookingId);
  }

  /**
   * Peak load: solve one minimum-cost assignment across all waiting bookings
   * (Hungarian, cost = 1 - score) so greedy order cannot strand a request.
   */
  async dispatchBatch(bookingIds: string[]): Promise<DispatchOutcome[]> {
    const bookings: BookingRow[] = [];
    for (const id of bookingIds) {
      const b = await this.loadBooking(id);
      if (b && b.status === 'matching') bookings.push(b);
    }
    if (bookings.length === 0) return [];

    const per = await Promise.all(
      bookings.map(async (b) => {
        const found = await this.search(b);
        return { b, found };
      }),
    );

    // one column per free staff slot of each workshop that appears anywhere
    const slots: { workshopId: string }[] = [];
    const slotCount = new Map<string, number>();
    for (const { found } of per) {
      for (const s of found?.ranked ?? []) {
        const free = Math.max(0, s.candidate.staffCount - s.candidate.activeJobs);
        slotCount.set(s.candidate.workshopId, free);
      }
    }
    for (const [workshopId, free] of slotCount) for (let k = 0; k < free; k++) slots.push({ workshopId });

    const cost = per.map(({ found }) =>
      slots.map((slot) => {
        const hit = found?.ranked.find((s) => s.candidate.workshopId === slot.workshopId);
        return hit ? 1 - hit.score : Infinity;
      }),
    );
    const { assignment } = assign(cost);

    const results: DispatchOutcome[] = [];
    for (let i = 0; i < per.length; i++) {
      const { b, found } = per[i];
      const col = assignment[i];
      if (col < 0 || !found) {
        // nothing free for this one right now: leave it matching, the next window retries;
        // only a booking with no candidates at all at the widest radius is a no_match
        results.push(found ? { outcome: 'skipped', reason: 'no free slot this window' } : await this.noMatch(b.id));
        continue;
      }
      const wid = slots[col].workshopId;
      const rank = found.ranked.findIndex((s) => s.candidate.workshopId === wid);
      try {
        const offerId = await this.makeOffer(b.id, found.ranked[rank], rank + 1, found.radiusKm);
        results.push({ outcome: 'offered', offerId, workshopId: wid, radiusKm: found.radiusKm });
      } catch (e) {
        results.push({ outcome: 'skipped', reason: (e as Error).message });
      }
    }
    return results;
  }

  /** Grid cell used to decide which waiting bookings compete for the same shops. */
  static cell(lat: number, lng: number): string {
    return `${Math.round(lat / 0.2)}:${Math.round(lng / 0.2)}`;
  }

  async waitingByCell(): Promise<Map<string, string[]>> {
    const r = await this.sql.query<{ id: string; pickup_lat: number; pickup_lng: number }>(
      'select * from public.bookings_waiting()',
    );
    const out = new Map<string, string[]>();
    for (const row of r.rows) {
      const k = Allocator.cell(Number(row.pickup_lat), Number(row.pickup_lng));
      out.set(k, [...(out.get(k) ?? []), row.id]);
    }
    return out;
  }
}
