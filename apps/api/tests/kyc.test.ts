import {
  gstinChecksum,
  gstinMatchesPan,
  validateBank,
  validateGstin,
  validatePan,
  validateUpiId,
} from '../src/domain/kyc';
import { decrypt, encrypt, fingerprint, last4, parseKey } from '../src/domain/secrets';

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN with a correct checksum', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toEqual({ ok: true });
  });

  it('accepts lowercase and surrounding spaces', () => {
    expect(validateGstin(' 27aapfu0939f1zv ').ok).toBe(true);
  });

  it('rejects a flipped checksum character', () => {
    const r = validateGstin('27AAPFU0939F1ZA');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/checksum/);
  });

  it('rejects wrong shapes and unknown state codes', () => {
    expect(validateGstin('27AAPFU0939F1Z').ok).toBe(false);
    expect(validateGstin('XXAAPFU0939F1ZV').ok).toBe(false);
    const made = '50AAPFU0939F1Z';
    const bad = made + gstinChecksum(made);
    expect(validateGstin(bad).reason).toMatch(/state code/);
  });

  it('builds a valid GSTIN from any 14 characters', () => {
    const base = '33ABCDE1234F1Z';
    expect(validateGstin(base + gstinChecksum(base)).ok).toBe(true);
  });

  it('checks that the GSTIN embeds the same PAN', () => {
    expect(gstinMatchesPan('27AAPFU0939F1ZV', 'AAPFU0939F')).toBe(true);
    expect(gstinMatchesPan('27AAPFU0939F1ZV', 'ABCDE1234F')).toBe(false);
  });
});

describe('PAN, UPI and bank', () => {
  it('validates PAN shape and holder type', () => {
    expect(validatePan('ABCPE1234F').ok).toBe(true);
    expect(validatePan('abcpe1234f').ok).toBe(true);
    expect(validatePan('ABCDE1234F').reason).toMatch(/holder type/); // D is not a holder type
    expect(validatePan('ABC1E1234F').ok).toBe(false);
  });

  it('validates UPI ids', () => {
    expect(validateUpiId('7339498130@ptsbi').ok).toBe(true);
    expect(validateUpiId('ravi.k@okhdfcbank').ok).toBe(true);
    expect(validateUpiId('no-at-sign').ok).toBe(false);
    expect(validateUpiId('a@b').ok).toBe(false);
  });

  it('validates bank details', () => {
    expect(validateBank('123456789012', 'HDFC0001234').ok).toBe(true);
    expect(validateBank('12345', 'HDFC0001234').ok).toBe(false);
    expect(validateBank('123456789012', 'HDFC1001234').ok).toBe(false); // 5th char must be 0
  });
});

describe('payout secrets', () => {
  const key = parseKey(Buffer.alloc(32, 7).toString('base64'));

  it('round-trips and never stores the plaintext', () => {
    const token = encrypt('ravi@okhdfcbank', key);
    expect(token).not.toContain('ravi');
    expect(decrypt(token, key)).toBe('ravi@okhdfcbank');
  });

  it('uses a fresh iv every time', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('detects tampering', () => {
    const raw = Buffer.from(encrypt('secret', key), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => decrypt(raw.toString('base64'), key)).toThrow();
  });

  it('refuses the wrong key', () => {
    const other = parseKey(Buffer.alloc(32, 9).toString('base64'));
    expect(() => decrypt(encrypt('secret', key), other)).toThrow();
  });

  it('rejects keys of the wrong length', () => {
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('fingerprints ignore case and spacing so duplicates cannot hide', () => {
    expect(fingerprint('Ravi@OKHDFC bank', key)).toBe(fingerprint('ravi@okhdfcbank', key));
    expect(fingerprint('a', key)).not.toBe(fingerprint('b', key));
  });

  it('keeps only the last four characters for display', () => {
    expect(last4('123456789012')).toBe('9012');
  });
});
