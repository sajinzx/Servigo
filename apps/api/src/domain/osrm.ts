import { fallbackEtaMin, type Point } from './geo';

export interface EtaResult {
  etaMin: number[];
  /** true when the haversine fallback was used instead of the routing service */
  usedFallback: boolean;
}

export interface EtaProvider {
  /** drive time in minutes from each origin to `to`, in the order given */
  etas(from: Point[], to: Point): Promise<EtaResult>;
}

interface Options {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  onFallback?: (reason: string) => void;
}

const key = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/**
 * OSRM table endpoint: one HTTP call returns the drive time from every
 * candidate to the pickup. Results are cached per origin/destination pair for
 * ten minutes; any failure falls back to haversine x detour factor.
 */
export function osrmEtaProvider(opts: Options): EtaProvider {
  const f = opts.fetchImpl ?? fetch;
  const timeout = opts.timeoutMs ?? 2000;
  const ttl = opts.cacheTtlMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { minutes: number; at: number }>();

  return {
    async etas(from, to) {
      const result: number[] = Array(from.length).fill(NaN);
      const missing: number[] = [];
      from.forEach((p, i) => {
        const hit = cache.get(`${key(p)}>${key(to)}`);
        if (hit && now() - hit.at < ttl) result[i] = hit.minutes;
        else missing.push(i);
      });
      if (missing.length === 0) return { etaMin: result, usedFallback: false };

      try {
        // coordinates: destination first, then each missing origin; lng,lat order
        const coords = [to, ...missing.map((i) => from[i])].map((p) => `${p.lng},${p.lat}`).join(';');
        const sources = missing.map((_, k) => k + 1).join(';');
        const url = `${opts.baseUrl}/table/v1/driving/${coords}?sources=${sources}&destinations=0&annotations=duration`;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeout);
        let body: { code?: string; durations?: (number | null)[][] };
        try {
          const res = await f(url, { signal: ctl.signal });
          if (!res.ok) throw new Error(`osrm ${res.status}`);
          body = (await res.json()) as typeof body;
        } finally {
          clearTimeout(timer);
        }
        if (body.code !== 'Ok' || !body.durations) throw new Error(`osrm code ${body.code}`);

        missing.forEach((idx, k) => {
          const seconds = body.durations![k]?.[0];
          if (seconds == null) {
            result[idx] = fallbackEtaMin(from[idx], to);
          } else {
            result[idx] = Math.max(1, Math.round(seconds / 60));
            cache.set(`${key(from[idx])}>${key(to)}`, { minutes: result[idx], at: now() });
          }
        });
        return { etaMin: result, usedFallback: false };
      } catch (e) {
        opts.onFallback?.((e as Error).message);
        missing.forEach((idx) => {
          result[idx] = fallbackEtaMin(from[idx], to);
        });
        return { etaMin: result, usedFallback: true };
      }
    },
  };
}
