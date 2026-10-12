/**
 * Server-side pricing. The client never sends a price (audit item A5).
 *
 * Catalogue prices are the taxable amount. Every number shown to a customer is
 * GST-inclusive, so GST is added here, once.
 */
export const GST_RATE = 0.18;

/** Final price may exceed the top of the quote by this much before the customer must approve. */
export const OVERAGE_TOLERANCE = 0.15;

/** Baseline quote band around the expected price, until the ML price model (M3) replaces it. */
export const BASELINE_BAND = { low: 0.9, high: 1.25 };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PriceInput {
  basePrice: number;
  segmentFactor: number;
  /** a workshop's own price for this service, if it has set one */
  workshopOverride?: number | null;
}

export interface Quote {
  expected: number;
  low: number;
  high: number;
}

export function withGst(taxable: number): number {
  return round2(taxable * (1 + GST_RATE));
}

export function baselineQuote(input: PriceInput, band = BASELINE_BAND): Quote {
  if (input.basePrice < 0 || input.segmentFactor <= 0) {
    throw new RangeError('price inputs out of range');
  }
  const taxable = (input.workshopOverride ?? input.basePrice) * input.segmentFactor;
  const expected = withGst(taxable);
  return { expected, low: round2(expected * band.low), high: round2(expected * band.high) };
}

export function needsCustomerApproval(finalPrice: number, quoteHigh: number): boolean {
  return finalPrice > quoteHigh * (1 + OVERAGE_TOLERANCE);
}

/** Split an invoice-style amount of labour and parts into the GST-inclusive total. */
export function totalWithGst(labour: number, parts: number): number {
  return withGst(labour + parts);
}
