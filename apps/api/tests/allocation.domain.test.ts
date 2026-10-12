import { fallbackEtaMin, haversineKm } from '../src/domain/geo';
import { assign } from '../src/domain/hungarian';
import { osrmEtaProvider } from '../src/domain/osrm';
import {
  bayesianRating,
  fairness,
  scoreCandidates,
  smoothedAcceptRate,
  type Candidate,
} from '../src/domain/scoring';

const base: Candidate = {
  workshopId: 'a',
  etaMin: 10,
  distanceKm: 3,
  staffCount: 4,
  activeJobs: 0,
  ratingSum: 0,
  ratingCount: 0,
  jobsToday: 0,
  offers30d: 0,
  accepted30d: 0,
};

describe('geo', () => {
  it('computes known distances', () => {
    // Anna Nagar to T Nagar is about 6 km
    const d = haversineKm({ lat: 13.085, lng: 80.2101 }, { lat: 13.0418, lng: 80.2341 });
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(6.5);
    expect(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });

  it('gives a sane fallback ETA with a detour factor', () => {
    const eta = fallbackEtaMin({ lat: 13.085, lng: 80.2101 }, { lat: 13.0418, lng: 80.2341 });
    expect(eta).toBeGreaterThan(10);
    expect(eta).toBeLessThan(30);
  });
});

describe('scoring', () => {
  it('does not let one 5-star review beat 200 reviews at 4.6', () => {
    const newShop = bayesianRating(5, 1, 4.0);
    const trusted = bayesianRating(200 * 4.6, 200, 4.0);
    expect(trusted).toBeGreaterThan(newShop);
  });

  it('shrinks a new shop towards the platform mean', () => {
    expect(bayesianRating(0, 0, 4.0)).toBeCloseTo(0.8, 5);
  });

  it('smooths acceptance rates', () => {
    expect(smoothedAcceptRate(0, 0)).toBeCloseTo(0.6);
    expect(smoothedAcceptRate(1, 1)).toBeLessThan(0.7); // one accept is not proof
    expect(smoothedAcceptRate(90, 100)).toBeGreaterThan(0.8);
  });

  it('decays fairness with jobs already taken today', () => {
    expect(fairness(0)).toBe(1);
    expect(fairness(3)).toBeLessThan(fairness(1));
  });

  it('prefers the nearer shop when everything else is equal', () => {
    const [first] = scoreCandidates([
      { ...base, workshopId: 'far', etaMin: 30 },
      { ...base, workshopId: 'near', etaMin: 8 },
    ]);
    expect(first.candidate.workshopId).toBe('near');
  });

  it('spreads work: a busy top shop loses to an idle one nearby', () => {
    const ranked = scoreCandidates([
      { ...base, workshopId: 'busy', etaMin: 9, activeJobs: 4, jobsToday: 6 },
      { ...base, workshopId: 'idle', etaMin: 11, activeJobs: 0, jobsToday: 0 },
    ]);
    expect(ranked[0].candidate.workshopId).toBe('idle');
  });

  it('ranks a low-acceptance workshop below an otherwise identical one', () => {
    const ranked = scoreCandidates([
      { ...base, workshopId: 'flagged', lowAcceptance: true },
      { ...base, workshopId: 'fine' },
    ]);
    expect(ranked[0].candidate.workshopId).toBe('fine');
    expect(ranked[1].score).toBeLessThan(ranked[0].score);
  });

  it('keeps every score within 0..1', () => {
    const ranked = scoreCandidates([
      { ...base, workshopId: 'x', etaMin: 5, ratingSum: 100, ratingCount: 20, accepted30d: 20, offers30d: 20 },
      { ...base, workshopId: 'y', etaMin: 50, activeJobs: 4, jobsToday: 10 },
    ]);
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('uses the ML acceptance probability when supplied', () => {
    const ranked = scoreCandidates([
      { ...base, workshopId: 'likely', pAccept: 0.95 },
      { ...base, workshopId: 'unlikely', pAccept: 0.1 },
    ]);
    expect(ranked[0].candidate.workshopId).toBe('likely');
  });

  it('handles an empty or single candidate list', () => {
    expect(scoreCandidates([])).toEqual([]);
    expect(scoreCandidates([base])).toHaveLength(1);
  });
});

describe('hungarian assignment', () => {
  it('finds the global minimum where greedy would not', () => {
    // greedy gives request 0 its best (col 0, cost 1) and strands request 1 with cost 100
    const cost = [
      [1, 2],
      [1, 100],
    ];
    const { assignment, total } = assign(cost);
    expect(assignment).toEqual([1, 0]);
    expect(total).toBe(3);
  });

  it('handles more requests than slots', () => {
    const { assignment } = assign([[1], [5], [3]]);
    expect(assignment.filter((a) => a >= 0)).toHaveLength(1);
    expect(assignment[0]).toBe(0);
  });

  it('never assigns a forbidden pair', () => {
    const { assignment } = assign([
      [Infinity, 4],
      [Infinity, 6],
    ]);
    expect(assignment.filter((a) => a === 0)).toHaveLength(0);
    expect(assignment.filter((a) => a === 1)).toHaveLength(1);
  });

  it('matches brute force on random matrices', () => {
    const rng = (() => {
      let s = 42;
      return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    })();
    const permutations = (n: number): number[][] =>
      n === 0 ? [[]] : permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
    for (let t = 0; t < 30; t++) {
      const n = 5;
      const cost = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.floor(rng() * 50)));
      const best = Math.min(...permutations(n).map((p) => p.reduce((s, c, r) => s + cost[r][c], 0)));
      expect(assign(cost).total).toBe(best);
    }
  });
});

describe('osrm eta provider', () => {
  const pickup = { lat: 13.0, lng: 80.2 };
  const shops = [
    { lat: 13.01, lng: 80.21 },
    { lat: 13.05, lng: 80.25 },
  ];

  it('reads drive times from the table response and caches them', async () => {
    let calls = 0;
    const f = (async (url: string) => {
      calls++;
      expect(url).toContain('/table/v1/driving/80.2,13;80.21,13.01;80.25,13.05');
      expect(url).toContain('sources=1;2');
      return new Response(JSON.stringify({ code: 'Ok', durations: [[600], [1260]] }));
    }) as unknown as typeof fetch;
    const p = osrmEtaProvider({ baseUrl: 'http://osrm', fetchImpl: f });
    const first = await p.etas(shops, pickup);
    expect(first).toEqual({ etaMin: [10, 21], usedFallback: false });
    await p.etas(shops, pickup);
    expect(calls).toBe(1);
  });

  it('falls back to haversine and reports it when osrm is down', async () => {
    const reasons: string[] = [];
    const f = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const p = osrmEtaProvider({ baseUrl: 'http://osrm', fetchImpl: f, onFallback: (r) => reasons.push(r) });
    const res = await p.etas(shops, pickup);
    expect(res.usedFallback).toBe(true);
    expect(res.etaMin.every((m) => m >= 1)).toBe(true);
    expect(reasons).toEqual(['ECONNREFUSED']);
  });

  it('falls back for a single unreachable origin', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ code: 'Ok', durations: [[null], [300]] }))) as unknown as typeof fetch;
    const p = osrmEtaProvider({ baseUrl: 'http://osrm', fetchImpl: f });
    const res = await p.etas(shops, pickup);
    expect(res.etaMin[1]).toBe(5);
    expect(res.etaMin[0]).toBe(fallbackEtaMin(shops[0], pickup));
  });
});
