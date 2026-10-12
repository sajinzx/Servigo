import QRCode from 'qrcode';

export interface UpiPayee {
  /** the virtual payment address, e.g. 7339498130@ptsbi */
  vpa: string;
  name: string;
}

export interface UpiRequest {
  amount: number;
  /** booking reference, e.g. BK-10423, so the payment can be matched later */
  reference: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '%20');

/**
 * Builds the intent link a phone's UPI app opens. The amount is always passed
 * in by the server from the booking, never taken from the browser.
 */
export function upiLink(payee: UpiPayee, req: UpiRequest): string {
  if (!/^[a-z0-9.\-_]{2,64}@[a-z]{2,32}$/i.test(payee.vpa)) throw new Error('invalid payee VPA');
  if (!(req.amount > 0) || req.amount > 1_000_000) throw new RangeError('amount out of range');
  const params = [
    `pa=${payee.vpa}`,
    `pn=${enc(payee.name)}`,
    `am=${req.amount.toFixed(2)}`,
    'cu=INR',
    `tn=${enc(`ServiGo ${req.reference}`)}`,
    `tr=${enc(req.reference)}`,
  ];
  return `upi://pay?${params.join('&')}`;
}

/** The static QR carries no amount; the customer must type it. */
export function staticUpiString(payee: UpiPayee): string {
  return `upi://pay?pa=${payee.vpa}&pn=${enc(payee.name)}`;
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
}

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
}
