import type { MlClient } from '../ml/client';
import { baselineQuote } from './pricing';

export interface QuoteContext {
  serviceCode: string;
  segment: string;
  basePrice: number;
  segmentFactor: number;
  baseDurationMin: number;
  vehicleAge: number;
  kmSinceService: number;
}

export interface QuoteResult {
  low: number;
  high: number;
  expected: number;
  durationMin: number;
  durationLow: number;
  durationHigh: number;
  /** which parts came from a model rather than the rule */
  source: { price: 'baseline' | 'ml'; duration: 'baseline' | 'ml' };
  modelVersion?: { price?: string; duration?: string };
  why?: { feature: string; effect: number }[];
}

export interface Quoter {
  quote(ctx: QuoteContext, when?: Date): Promise<QuoteResult>;
}

function baseline(ctx: QuoteContext): QuoteResult {
  const q = baselineQuote({ basePrice: ctx.basePrice, segmentFactor: ctx.segmentFactor });
  return {
    low: q.low,
    high: q.high,
    expected: q.expected,
    durationMin: ctx.baseDurationMin,
    durationLow: Math.round(ctx.baseDurationMin * 0.8),
    durationHigh: Math.round(ctx.baseDurationMin * 1.4),
    source: { price: 'baseline', duration: 'baseline' },
  };
}

export const baselineQuoter: Quoter = { quote: async (ctx) => baseline(ctx) };

/**
 * Uses the ML price and duration models when they answer inside the budget and
 * the answer is sane; otherwise keeps the baseline for that part. A booking
 * never fails because of ML.
 */
export function mlQuoter(ml: MlClient): Quoter {
  return {
    async quote(ctx, when = new Date()) {
      const out = baseline(ctx);
      if (!ml.enabled) return out;
      const feat = {
        service_code: ctx.serviceCode,
        segment: ctx.segment,
        vehicle_age: ctx.vehicleAge,
        km_since_service: ctx.kmSinceService,
        hour: when.getHours(),
        weekday: (when.getDay() + 6) % 7,
      };
      const [price, duration] = await Promise.all([ml.price(feat), ml.duration(feat)]);

      if (price && price.model_version !== 'baseline' && price.low > 0 && price.low <= price.median && price.median <= price.high) {
        out.low = price.low;
        out.high = price.high;
        out.expected = price.median;
        out.source.price = 'ml';
        out.modelVersion = { ...out.modelVersion, price: price.model_version };
        out.why = price.why;
      }
      if (duration && duration.model_version !== 'baseline' && duration.minutes > 0) {
        out.durationMin = Math.round(duration.minutes);
        out.durationLow = Math.round(duration.low);
        out.durationHigh = Math.round(duration.high);
        out.source.duration = 'ml';
        out.modelVersion = { ...out.modelVersion, duration: duration.model_version };
      }
      return out;
    },
  };
}
