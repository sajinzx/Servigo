import {
  baselineQuote,
  needsCustomerApproval,
  totalWithGst,
  withGst,
} from '../src/domain/pricing';

describe('pricing', () => {
  it('adds 18% GST once', () => {
    expect(withGst(2500)).toBe(2950);
  });

  it('applies the segment factor before GST', () => {
    const q = baselineQuote({ basePrice: 2500, segmentFactor: 1.35 });
    expect(q.expected).toBe(3982.5); // 2500 * 1.35 * 1.18
    expect(q.low).toBeLessThan(q.expected);
    expect(q.high).toBeGreaterThan(q.expected);
  });

  it('uses a workshop override instead of the catalogue price', () => {
    const q = baselineQuote({ basePrice: 2500, segmentFactor: 1, workshopOverride: 2000 });
    expect(q.expected).toBe(2360);
  });

  it('rejects nonsense input', () => {
    expect(() => baselineQuote({ basePrice: -1, segmentFactor: 1 })).toThrow(RangeError);
    expect(() => baselineQuote({ basePrice: 100, segmentFactor: 0 })).toThrow(RangeError);
  });

  it('requires approval only above 15% over the top of the quote', () => {
    expect(needsCustomerApproval(4000, 3500)).toBe(false); // 3500 * 1.15 = 4025
    expect(needsCustomerApproval(4026, 3500)).toBe(true);
  });

  it('matches the invoice example in the plan', () => {
    expect(totalWithGst(2000, 500)).toBe(2950);
  });
});
