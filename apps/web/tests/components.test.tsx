import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfferCard } from '@/features/OfferCard';
import { PayPanel } from '@/features/PayPanel';
import { RequireRole } from '@/auth/RequireRole';
import { Sparkline } from '@/pages/admin/Kpis';
import { BusyHours } from '@/pages/mechanic/Insights';
import { CountdownRing, useSecondsLeft } from '@/ui/Countdown';
import { StatusChip, Timeline } from '@/ui/Status';
import type { Offer } from '@/lib/types';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

let authState: Record<string, unknown> = {};
vi.mock('@/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/auth/AuthProvider')>('@/auth/AuthProvider');
  return { ...actual, useAuth: () => authState };
});

beforeEach(() => {
  apiMock.mockReset();
});

describe('Timeline and StatusChip', () => {
  it('marks the current step and shows when earlier ones happened', () => {
    render(
      <Timeline
        current="in_progress"
        events={[
          { to_status: 'requested', at: '2026-10-13T08:00:00Z' },
          { to_status: 'accepted', at: '2026-10-13T08:02:00Z' },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Booking progress' })).toBeInTheDocument();
    const current = screen.getByText('Work in progress').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByText(/Oct/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a cancelled booking as off the happy path', () => {
    render(<Timeline current="cancelled" events={[{ to_status: 'requested', at: '2026-10-13T08:00:00Z' }]} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('labels the chip', () => {
    render(<StatusChip status="no_match" />);
    expect(screen.getByText('No workshop available')).toBeInTheDocument();
  });
});

describe('countdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks down and stops at zero', () => {
    vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
    const expires = new Date('2026-10-13T08:00:03Z');
    render(<CountdownRing expiresAt={expires} total={90} />);
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '3 seconds left to respond');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '0 seconds left to respond');
  });

  it('never goes negative for a past time', () => {
    vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
    function Probe() {
      return <span data-testid="s">{useSecondsLeft('2026-10-13T07:00:00Z')}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('s')).toHaveTextContent('0');
  });
});

describe('OfferCard', () => {
  const offer = (expiresInS: number): Offer => ({
    id: 'o1',
    booking_id: 'b1',
    workshop_id: 'w1',
    score: 0.8,
    rank: 1,
    offered_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + expiresInS * 1000).toISOString(),
    response: 'pending',
    bookings: {
      id: 'b1', ref: 'BK-1', status: 'offered', mode: 'workshop', customer_id: 'c', workshop_id: 'w1',
      pickup_lat: 13.09, pickup_lng: 80.21, quote_low: 2500, quote_high: 3200, final_price: null,
      needs_price_approval: false, price_approved_at: null, predicted_duration_min: 180, eta_min: 12,
      distance_km: 2.4, symptom_text: 'grinding noise when braking', labour_amount: null, parts_amount: null,
      created_at: new Date().toISOString(), started_at: null, completed_at: null, scheduled_for: null,
      services: { name: 'Car Brake Inspection', code: 'CAR_003', vehicle_kind: 'car' },
      vehicles: { registration_no: 'TN09AB1234', vehicle_models: { make: 'Maruti', model: 'Swift' } },
    },
  });

  it('shows the job, distance, price range and commission, and accepts through the api', async () => {
    apiMock.mockResolvedValue({});
    const onAnswered = vi.fn();
    render(<OfferCard offer={offer(80)} workshop={{ lat: 13.08, lng: 80.2 }} onAnswered={onAnswered} />);

    expect(screen.getByText('Car Brake Inspection')).toBeInTheDocument();
    expect(screen.getByText('2.4 km')).toBeInTheDocument();
    expect(screen.getByText('₹2,500 – ₹3,200')).toBeInTheDocument();
    expect(screen.getByText(/commission: 10%/)).toBeInTheDocument();
    expect(screen.getByText(/grinding noise/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/api/offers/o1/accept', { body: {} });
  });

  it('shows the server error when the workshop is full', async () => {
    apiMock.mockRejectedValue(new Error('workshop is at capacity'));
    render(<OfferCard offer={offer(80)} workshop={{ lat: 13.08, lng: 80.2 }} onAnswered={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('workshop is at capacity');
  });

  it('disables the buttons once it has expired', () => {
    render(<OfferCard offer={offer(-5)} workshop={{ lat: 13.08, lng: 80.2 }} onAnswered={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(screen.getByText(/expired/)).toBeInTheDocument();
  });
});

describe('PayPanel', () => {
  const payResponse = {
    payment: { id: 'p1', booking_id: 'b1', amount: 2950, method: 'upi_qr', status: 'initiated', reference: 'BK-10423', utr: null, submitted_at: null },
    amount: 2950,
    reference: 'BK-10423',
    static_qr: 'data:image/png;base64,AAA',
    dynamic_qr: 'data:image/png;base64,BBB',
    instructions: 'Pay exactly ₹2950.00 and put BK-10423 in the note.',
  };

  it('shows the server amount large and sends the user to the QR on a desktop browser', async () => {
    apiMock.mockResolvedValue(payResponse);
    render(<PayPanel bookingId="b1" amount={2950} onPaid={() => undefined} />);
    expect(screen.getByText('₹2,950.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay with UPI app' }));
    // jsdom is not a phone, so the upi:// link is skipped in favour of the QR
    expect(apiMock).toHaveBeenCalledWith('/api/bookings/b1/pay', { body: { method: 'upi_qr' } });
    expect(await screen.findByAltText(/carries no amount/)).toBeInTheDocument();
    expect(screen.getByAltText(/amount filled in/)).toBeInTheDocument();
    expect(screen.getByText('Note: BK-10423')).toBeInTheDocument();
  });

  it('only enables "I have paid" for a 12 digit UTR and posts it', async () => {
    apiMock.mockResolvedValueOnce(payResponse).mockResolvedValueOnce({});
    const onPaid = vi.fn();
    render(<PayPanel bookingId="b1" amount={2950} onPaid={onPaid} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));

    const input = await screen.findByLabelText(/Transaction ID/);
    const pay = screen.getByRole('button', { name: 'I have paid' });
    expect(pay).toBeDisabled();
    await userEvent.type(input, '12345');
    expect(pay).toBeDisabled();
    await userEvent.type(input, '6789012');
    expect(pay).toBeEnabled();

    await userEvent.click(pay);
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(apiMock).toHaveBeenLastCalledWith('/api/payments/p1/utr', { body: { utr: '123456789012' } });
    expect(await screen.findByText(/verifying your payment/)).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  const renderAt = (state: Record<string, unknown>, roles: ('customer' | 'mechanic' | 'admin')[]) => {
    authState = state;
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<RequireRole roles={roles}><p>secret</p></RequireRole>} />
          <Route path="/signin" element={<p>sign in page</p>} />
          <Route path="/garage" element={<p>garage page</p>} />
          <Route path="/onboarding" element={<p>onboarding page</p>} />
        </Routes>
      </MemoryRouter>,
    );
  };
  const profile = (role: string, onboarded = true) => ({ id: 'u', role, full_name: 'A', phone: null, phone_verified: true, whatsapp_opt_in: false, onboarded_at: onboarded ? '2026-01-01' : null });

  it('sends a signed-out visitor to sign in', () => {
    renderAt({ session: null, profile: null, loading: false }, ['admin']);
    expect(screen.getByText('sign in page')).toBeInTheDocument();
  });

  it('keeps a customer out of the admin area', () => {
    renderAt({ session: {}, profile: profile('customer'), loading: false }, ['admin']);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('garage page')).toBeInTheDocument();
  });

  it('lets an admin in', () => {
    renderAt({ session: {}, profile: profile('admin'), loading: false }, ['admin']);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('holds a customer who has not finished onboarding at the onboarding steps', () => {
    renderAt({ session: {}, profile: profile('customer', false), loading: false }, ['customer']);
    expect(screen.getByText('onboarding page')).toBeInTheDocument();
  });

  it('waits while the session loads', () => {
    renderAt({ session: null, profile: null, loading: true }, ['admin']);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('small charts', () => {
  it('draws a sparkline and handles missing days', () => {
    render(<Sparkline values={[10, null, 30, 20]} label="Median time to assign per day" />);
    expect(screen.getByRole('img', { name: 'Median time to assign per day' })).toBeInTheDocument();
  });

  it('says so when there is not enough data', () => {
    render(<Sparkline values={[5]} label="x" />);
    expect(screen.getByText(/Not enough days/)).toBeInTheDocument();
  });

  it('draws 24 hourly bars for the busy-hours strip', () => {
    render(<BusyHours hours={[{ hour_of_day: 10, expected: 5 }, { hour_of_day: 17, expected: 3 }]} />);
    const strip = screen.getByRole('img', { name: /by hour of day/ });
    expect(strip.children).toHaveLength(24);
  });
});
