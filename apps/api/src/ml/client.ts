/**
 * Client for the ML service. The service is optional by design: every call has
 * a hard time budget (300 ms by default) and resolves to `null` on a timeout,
 * a network error or a bad response, so callers always have a baseline to use.
 */
export interface MlOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onFallback?: (path: string, reason: string) => void;
}

export interface TriageSuggestion {
  code: string;
  name: string;
  probability: number;
}

export interface JobFeatures {
  service_code: string;
  segment: string;
  vehicle_age: number;
  km_since_service: number;
  hour?: number;
  weekday?: number;
  workshop_id?: string | null;
}

export interface DurationPrediction {
  minutes: number;
  low: number;
  high: number;
  why: { feature: string; effect: number }[];
  model_version: string;
}

export interface PricePrediction {
  low: number;
  median: number;
  high: number;
  why: { feature: string; effect: number }[];
  model_version: string;
}

export interface OfferFeatures {
  workshop_id: string;
  distance_km: number;
  active_jobs: number;
  staff_count: number;
  hour: number;
  weekday: number;
}

export interface ServiceDuePrediction {
  days_left: number;
  probability_due: number;
  median_days_between_services: number;
  model_version: string;
}

export class MlClient {
  constructor(private o: MlOptions) {}

  get enabled(): boolean {
    return !!this.o.baseUrl;
  }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T | null> {
    if (!this.o.baseUrl) return null;
    const f = this.o.fetchImpl ?? fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 300);
    try {
      const res = await f(`${this.o.baseUrl}${path}`, {
        method: init?.method ?? (init?.body ? 'POST' : 'GET'),
        headers: {
          'Content-Type': 'application/json',
          ...(this.o.apiKey ? { 'X-ML-Key': this.o.apiKey } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      this.o.onFallback?.(path, (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async triage(text: string, vehicleKind: 'car' | 'bike', k = 3): Promise<TriageSuggestion[] | null> {
    const r = await this.call<{ suggestions: TriageSuggestion[] }>('/triage', {
      body: { text, vehicle_kind: vehicleKind, k },
    });
    return r?.suggestions ?? null;
  }

  duration(f: JobFeatures): Promise<DurationPrediction | null> {
    return this.call('/predict/duration', { body: f });
  }

  price(f: JobFeatures): Promise<PricePrediction | null> {
    return this.call('/predict/price', { body: f });
  }

  async acceptance(offers: OfferFeatures[]): Promise<Record<string, number> | null> {
    const r = await this.call<{ probabilities: Record<string, number> }>('/predict/acceptance', {
      body: { offers },
    });
    return r?.probabilities ?? null;
  }

  serviceDue(args: {
    kind: 'car' | 'bike';
    age_years: number;
    km_per_day: number;
    days_since_service: number;
    within_days?: number;
  }): Promise<ServiceDuePrediction | null> {
    return this.call('/predict/service-due', { body: args });
  }

  /** admin: registry summary with the promotion decision of each active version */
  models(): Promise<{ models: unknown[] } | null> {
    return this.call('/models');
  }

  rollback(name: string, version: string): Promise<{ name: string; active: string } | null> {
    return this.call(`/models/${encodeURIComponent(name)}/rollback`, { body: { version } });
  }

  async weights(): Promise<Record<string, number> | null> {
    const r = await this.call<{ weights: Record<string, number> }>('/allocation/weights');
    return r?.weights ?? null;
  }
}
