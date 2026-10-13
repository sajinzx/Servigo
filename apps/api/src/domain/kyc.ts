/**
 * Format checks for onboarding documents. These catch typos and obvious fakes;
 * they do not prove a number belongs to the applicant. Admin review does that.
 */

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Valid GST state codes are 01-38 (plus 97 and 99 for special cases). */
const stateCodeOk = (code: number) => (code >= 1 && code <= 38) || code === 97 || code === 99;

export function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function validateGstin(raw: string): { ok: boolean; reason?: string } {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(gstin)) return { ok: false, reason: 'GSTIN has the wrong format' };
  if (!stateCodeOk(Number(gstin.slice(0, 2)))) return { ok: false, reason: 'unknown state code' };
  if (gstinChecksum(gstin.slice(0, 14)) !== gstin[14]) return { ok: false, reason: 'checksum does not match' };
  return { ok: true };
}

/** 5 letters, 4 digits, 1 letter; the 4th letter is the holder type (P = person, C = company ...). */
export function validatePan(raw: string): { ok: boolean; reason?: string } {
  const pan = raw.trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { ok: false, reason: 'PAN has the wrong format' };
  if (!'ABCFGHLJPT'.includes(pan[3])) return { ok: false, reason: 'unknown PAN holder type' };
  return { ok: true };
}

export function validateUpiId(raw: string): { ok: boolean; reason?: string } {
  const upi = raw.trim().toLowerCase();
  // handle@bank: letters, digits, dot, dash, underscore; bank handle is letters only
  if (!/^[a-z0-9.\-_]{2,64}@[a-z]{2,32}$/.test(upi)) return { ok: false, reason: 'not a valid UPI id' };
  return { ok: true };
}

export function validateBank(account: string, ifsc: string): { ok: boolean; reason?: string } {
  if (!/^[0-9]{9,18}$/.test(account.trim())) return { ok: false, reason: 'account number must be 9-18 digits' };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) return { ok: false, reason: 'invalid IFSC' };
  return { ok: true };
}

/** GSTIN embeds the holder's PAN in characters 3-12; a mismatch is a strong signal of a bad entry. */
export function gstinMatchesPan(gstin: string, pan: string): boolean {
  return gstin.trim().toUpperCase().slice(2, 12) === pan.trim().toUpperCase();
}
