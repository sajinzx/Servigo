import { Link } from 'react-router-dom';
import { dateTime, plate, rupees } from '@/lib/format';
import { useBookings, useInvoices } from '@/hooks/queries';
import { requireSupabase } from '@/lib/supabase';
import { LinkButton } from '@/ui/Button';
import { EmptyState, QueryBoundary } from '@/ui/Feedback';
import { StatusChip } from '@/ui/Status';
import { Card, PageHeader } from '@/ui/Surface';

async function openInvoice(path: string) {
  const { data, error } = await requireSupabase().storage.from('invoices').createSignedUrl(path, 60);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, '_blank', 'noopener');
}

export default function History() {
  const bookings = useBookings();
  const invoices = useInvoices();
  const invoiceFor = (bookingId: string) => invoices.data?.find((i) => i.booking_id === bookingId && i.series !== 'CN');

  return (
    <div className="container-x pb-24">
      <PageHeader eyebrow="Your bookings" title="History" />
      <QueryBoundary query={bookings} rows={4}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              body="Your past services, invoices and one-tap rebooking will show up here."
              action={<LinkButton to="/book">Book a service</LinkButton>}
            />
          ) : (
            <ul className="space-y-4">
              {rows.map((b) => {
                const inv = invoiceFor(b.id);
                return (
                  <Card as="li" key={b.id} className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <Link to={`/bookings/${b.id}`} className="text-xl underline-offset-4 hover:underline">
                        {b.services?.name ?? 'Service'}
                      </Link>
                      <p className="mt-1 text-sm text-muted">
                        {b.ref} · {b.vehicles ? plate(b.vehicles.registration_no) : ''} · {dateTime(b.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      {b.final_price !== null ? <span className="mono">{rupees(b.final_price, true)}</span> : null}
                      <StatusChip status={b.status} />
                      {inv?.pdf_path ? (
                        <button
                          type="button"
                          className="text-sm underline underline-offset-4"
                          onClick={() => void openInvoice(inv.pdf_path!)}
                        >
                          Invoice {inv.invoice_no}
                        </button>
                      ) : null}
                      {['paid', 'reviewed', 'completed'].includes(b.status) ? (
                        <Link
                          to={`/book?vehicle=${(b as unknown as { vehicle_id?: string }).vehicle_id ?? ''}`}
                          className="text-sm underline underline-offset-4"
                        >
                          Book again
                        </Link>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </ul>
          )
        }
      </QueryBoundary>
    </div>
  );
}
