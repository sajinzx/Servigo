import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { km, minutes, normalisePlate, plate, priceRange, rupees } from '@/lib/format';
import { CANCELLABLE, STATUS_LABEL, TIMELINE, isTerminal, needsPayment } from '@/lib/status';
import { normalisePhone } from '@/pages/SignIn';
import { isUtr } from '@/features/PayPanel';
import { toAddress } from '@/features/AddressPicker';
import { hexesFrom } from '@/pages/admin/Operations';

describe('formatting', () => {
  it('formats rupees in the Indian grouping', () => {
    expect(rupees(2950)).toBe('₹2,950');
    expect(rupees(125000)).toBe('₹1,25,000');
    expect(rupees(2950.5, true)).toBe('₹2,950.50');
    expect(rupees(null)).toBe('—');
    expect(rupees('abc')).toBe('—');
  });

  it('formats ranges, durations and distances', () => {
    expect(priceRange(2500, 3200)).toBe('₹2,500 – ₹3,200');
    expect(minutes(45)).toBe('45 min');
    expect(minutes(90)).toBe('1 h 30 min');
    expect(minutes(120)).toBe('2 h');
    expect(minutes(null)).toBe('—');
    expect(km(0.4)).toBe('400 m');
    expect(km(3.26)).toBe('3.3 km');
  });

  it('shows plates the way they are written on the vehicle', () => {
    expect(plate('TN09AB1234')).toBe('TN 09 AB 1234');
    expect(plate('KA1A9')).toBe('KA 1 A 9');
    expect(normalisePlate(' tn09-ab 1234 ')).toBe('TN09AB1234');
  });
});

describe('phone numbers', () => {
  it.each([
    ['98400 12345', '+919840012345'],
    ['+91 98400 12345', '+919840012345'],
    ['098400 12345', '+919840012345'],
    ['919840012345', '+919840012345'],
  ])('accepts %s', (input, out) => {
    expect(normalisePhone(input)).toBe(out);
  });

  it.each(['12345', '5840012345', '98400', ''])('rejects %s', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe('UTR', () => {
  it('is exactly twelve digits', () => {
    expect(isUtr('123456789012')).toBe(true);
    expect(isUtr(' 123456789012 ')).toBe(true);
    expect(isUtr('12345678901')).toBe(false);
    expect(isUtr('1234567890123')).toBe(false);
    expect(isUtr('12345678901a')).toBe(false);
  });
});

describe('status helpers', () => {
  it('has a label for every timeline step and lets only early bookings be cancelled', () => {
    for (const s of TIMELINE) expect(STATUS_LABEL[s]).toBeTruthy();
    expect(CANCELLABLE).toEqual(['requested', 'matching', 'offered', 'accepted']);
    expect(isTerminal('reviewed')).toBe(true);
    expect(isTerminal('in_progress')).toBe(false);
    expect(needsPayment('completed')).toBe(true);
    expect(needsPayment('paid')).toBe(false);
  });
});

describe('address search result', () => {
  it('maps a nominatim hit to an address with a valid pincode only', () => {
    const a = toAddress({
      display_name: '12, Main Road, Anna Nagar, Chennai, Tamil Nadu, 600040, India',
      lat: '13.0850',
      lon: '80.2101',
      address: { city: 'Chennai', postcode: '600 040' },
    });
    expect(a).toMatchObject({ city: 'Chennai', pincode: '600040', lat: 13.085, lng: 80.2101 });
    expect(a.line1).toBe('12, Main Road, Anna Nagar');

    const bad = toAddress({ display_name: 'x', lat: '1', lon: '2', address: { postcode: 'ABC' } });
    expect(bad.pincode).toBeNull();
  });
});

describe('heatmap', () => {
  it('converts H3 cells to [lng, lat] rings', () => {
    const [h] = hexesFrom([{ h3_cell: '87618c4d0ffffff', total_yhat: 4, total_hi: 6 }]);
    expect(h.ring.length).toBe(6);
    const [lng, lat] = h.ring[0];
    expect(lat).toBeGreaterThan(12);
    expect(lat).toBeLessThan(14);
    expect(lng).toBeGreaterThan(79);
    expect(lng).toBeLessThan(81);
    expect(h.value).toBe(4);
  });
});

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws an ApiError carrying the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'conflict', message: 'workshop is at capacity' }), { status: 409 })));
    await expect(api('/api/offers/x/accept', { body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'workshop is at capacity',
    });
  });

  it('summarises validation issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'validation_failed', issues: [{ path: 'rating', message: 'too big' }] }), { status: 400 })),
    );
    await expect(api('/api/x', { body: {} })).rejects.toThrow('rating: too big');
  });

  it('sends json and returns parsed data', async () => {
    const f = vi.fn(async (_u: URL, _i: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const out = await api<{ ok: boolean }>('/api/me', { method: 'PATCH', body: { full_name: 'Asha' }, query: { a: '1', b: undefined } });
    expect(out.ok).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('/api/me?a=1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(ApiError).toBeDefined();
  });
});
