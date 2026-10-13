import { useState } from 'react';
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { rupees } from '@/lib/format';
import type { PayResponse } from '@/lib/types';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/Field';
import { Card, Chip } from '@/ui/Surface';

type Method = 'upi_link' | 'upi_qr' | 'razorpay';

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/** Same UTR rule as the server: exactly 12 digits. */
export const isUtr = (s: string) => /^\d{12}$/.test(s.trim());

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the card checkout'));
    document.head.appendChild(s);
  });
}

/**
 * Payment opens once the job is completed and the price is approved. The amount
 * is always the server's; this screen only displays it.
 */
export function PayPanel({
  bookingId,
  amount,
  onPaid,
}: {
  bookingId: string;
  amount: number;
  onPaid: () => void;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [pay, setPay] = useState<PayResponse | null>(null);
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const start = async (m: Method) => {
    setMethod(m);
    setBusy(true);
    setErr(null);
    try {
      // desktop browsers cannot open upi:// links, so they go straight to the QR
      const effective: Method = m === 'upi_link' && !isMobile() ? 'upi_qr' : m;
      const res = await api<PayResponse>(`/api/bookings/${bookingId}/pay`, { body: { method: effective } });
      setPay(res);
      setMethod(effective);

      if (effective === 'razorpay' && res.order) {
        await loadRazorpay();
        new window.Razorpay!({
          key: res.order.key_id,
          order_id: res.order.id,
          amount: res.order.amount,
          currency: res.order.currency,
          name: 'ServiGo',
          description: res.reference,
          handler: () => onPaid(),
        }).open();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the payment');
    } finally {
      setBusy(false);
    }
  };

  const submitUtr = async () => {
    if (!pay) return;
    if (!isUtr(utr)) return setErr('A UTR is the 12 digit transaction ID shown by your UPI app');
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/payments/${pay.payment.id}/utr`, { body: { utr: utr.trim() } });
      setSubmitted(true);
      onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the UTR');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <p className="label">Payment</p>
        <p className="mt-2 text-xl">Thank you. We are verifying your payment.</p>
        <p className="mt-1 text-muted">The workshop or our team confirms it against the bank statement, usually within a few hours.</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label">Amount due</p>
          <p className="mono mt-1 text-4xl">{rupees(amount, true)}</p>
        </div>
        <p className="text-sm text-muted">GST invoice on payment</p>
      </div>

      {!pay ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Payment method">
          <Chip selected={method === 'upi_link'} onClick={() => void start('upi_link')}>
            Pay with UPI app
          </Chip>
          <Chip selected={method === 'upi_qr'} onClick={() => void start('upi_qr')}>
            Scan QR
          </Chip>
          <Chip selected={method === 'razorpay'} onClick={() => void start('razorpay')}>
            Card or netbanking
          </Chip>
        </div>
      ) : null}

      {busy && !pay ? <p className="text-muted">Preparing your payment…</p> : null}

      {pay?.upi_link ? (
        <div className="space-y-3">
          <a
            href={pay.upi_link}
            className="inline-flex w-full items-center justify-center bg-ink px-5 py-3 text-sm font-medium text-paper hover:opacity-90"
          >
            Open my UPI app
          </a>
          <p className="text-sm text-muted">
            The amount and reference are filled in. You only enter your UPI PIN. Afterwards, come back and enter the
            transaction ID.
          </p>
        </div>
      ) : null}

      {pay?.static_qr ? (
        <div className="space-y-4">
          <div className="border border-ink p-4 text-center">
            <p className="mono text-3xl">{rupees(pay.amount, true)}</p>
            <p className="mono mt-1 text-sm text-muted">Note: {pay.reference}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <figure className="text-center">
              {/* the ServiGo QR if you add public/upi-qr.png, otherwise the generated static one */}
              <img
                src={pay.static_qr}
                alt="ServiGo UPI QR. It carries no amount; type the amount shown above."
                className="mx-auto h-44 w-44"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = env.upiQrPath;
                }}
              />
              <figcaption className="mt-2 text-sm text-muted">Type the amount above</figcaption>
            </figure>
            {pay.dynamic_qr ? (
              <figure className="text-center">
                <img src={pay.dynamic_qr} alt="UPI QR with the amount filled in" className="mx-auto h-44 w-44" />
                <figcaption className="mt-2 text-sm text-muted">Scan with the amount filled in</figcaption>
              </figure>
            ) : null}
          </div>
          {pay.instructions ? <p className="text-sm text-muted">{pay.instructions}</p> : null}
        </div>
      ) : null}

      {pay && method !== 'razorpay' ? (
        <div className="space-y-3 border-t border-line pt-5">
          <TextField
            label="Transaction ID (UTR)"
            inputMode="numeric"
            maxLength={12}
            placeholder="12 digits"
            className="mono"
            value={utr}
            onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))}
            hint="Shown by your UPI app after the payment."
          />
          <Button loading={busy} onClick={() => void submitUtr()} disabled={!isUtr(utr)}>
            I have paid
          </Button>
        </div>
      ) : null}

      {err ? (
        <p role="alert" className="text-sm text-crit">
          {err}
        </p>
      ) : null}
    </Card>
  );
}
