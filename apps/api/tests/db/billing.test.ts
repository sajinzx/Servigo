import { addUser, createDb } from './harness';
import { billingHandlers } from '../../src/billing/handlers';
import { renderInvoicePdf, type InvoiceData } from '../../src/billing/invoicePdf';
import { pgQueue } from '../../src/worker/pgQueue';
import { runOnce } from '../../src/worker/runner';

/** pdfkit writes text as hex glyph strings; decode them back to readable text */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts: string[] = [];
  for (const m of raw.matchAll(/<([0-9a-fA-F]{2,})>/g)) {
    parts.push(Buffer.from(m[1], 'hex').toString('latin1'));
  }
  return parts.join('');
}

const sample: InvoiceData = {
  invoice_no: 'SG/2026-27/000123',
  series: 'INV',
  issued_at: '2026-10-13T08:00:00Z',
  supplier_name: 'Anna Nagar Auto Care',
  supplier_gstin: '33AAPFU0939F1ZV',
  supplier_state_code: '33',
  customer_name: 'Asha K',
  customer_gstin: null,
  place_of_supply: 'Chennai',
  lines: [
    { description: 'Car General Service (labour)', code: '9987', taxable: 2000, tax: 360 },
    { description: 'Spare parts and consumables', code: '8708', taxable: 500, tax: 90 },
  ],
  taxable_value: 2500,
  cgst: 225,
  sgst: 225,
  igst: 0,
  total: 2950,
  reference: '123456789012',
};

describe('invoice pdf', () => {
  it('renders a readable tax invoice', async () => {
    const pdf = await renderInvoicePdf(sample);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('SG/2026-27/000123');
    expect(text).toContain('Tax Invoice');
    expect(text).toContain('33AAPFU0939F1ZV');
    expect(text).toContain('2,950.00');
  });

  it('says bill of supply and shows no tax for an unregistered supplier', async () => {
    const pdf = await renderInvoicePdf({
      ...sample, series: 'BOS', supplier_gstin: null, cgst: 0, sgst: 0, total: 2500,
      lines: [{ description: 'Labour', code: '9987', taxable: 2500, tax: 0 }],
    });
    const text = pdfText(pdf);
    expect(text).toContain('Bill of Supply');
    expect(text).toContain('not registered under GST');
    expect(text).not.toContain('CGST');
  });

  it('labels a credit note with the invoice it is against', async () => {
    const pdf = await renderInvoicePdf({
      ...sample, series: 'CN', invoice_no: 'SG/CN/2026-27/000001', original_invoice_no: 'SG/2026-27/000123', total: 1000,
    });
    const text = pdfText(pdf);
    expect(text).toContain('Credit Note');
    expect(text).toContain('Against invoice: SG/2026-27/000123');
  });
});

describe('invoice.render job', () => {
  it('renders and stores the pdf for a confirmed payment, then records its path', async () => {
    const db = await createDb();
    const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
    const customer = await addUser(db, { name: 'Asha K' });
    const mechanic = await addUser(db, { name: 'Ravi' });
    await db.query(`update public.profiles set role = 'mechanic' where id = $1`, [mechanic]);
    const ws = await one(
      `insert into public.workshops (owner_id, name, city, lat, lng, staff_count, stage, gst_registered)
       values ($1,'Anna Nagar Auto','Chennai',13.085,80.21,5,'active',true) returning id`, [mechanic]);
    const svc = await one(
      `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
       values ('CAR_001','Car General Service','car','general',2500,180) returning id`);
    const model = await one(
      `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`);
    const veh = await one(
      `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB1234',$2,2019) returning id`,
      [customer, model]);
    const b = await one(
      `select id from public.create_booking($1,$2,$3,'workshop',13.09,80.21,null,null,2500,4000,180)`,
      [customer, veh, svc]);
    await db.query(`update public.bookings set workshop_id = $2 where id = $1`, [b, ws]);
    await db.query(`select public.transition_booking($1,'offered',null,'system')`, [b]);
    await db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [b, mechanic]);
    await db.query(`select public.transition_booking($1,'in_progress',$2,'mechanic')`, [b, mechanic]);
    await db.query(`select * from public.complete_booking($1,$2,'mechanic',2000,500)`, [b, mechanic]);
    const p = await one(`select id from public.start_payment($1,$2,'upi_link')`, [b, customer]);
    await db.query(`select * from public.submit_utr($1,$2,'123456789012',null)`, [p, customer]);
    await db.query(`select * from public.confirm_payment($1,$2,'mechanic')`, [p, mechanic]);

    const stored: { path: string; bytes: Buffer }[] = [];
    const handlers = billingHandlers(db, {
      async put(path, bytes) {
        stored.push({ path, bytes });
        return path;
      },
    });
    const queue = pgQueue(db);
    const res = await runOnce(queue, handlers, { queues: ['billing'] });
    expect(res).toEqual({ processed: 1, failed: 0 });

    expect(stored).toHaveLength(1);
    expect(stored[0].path).toMatch(/\.pdf$/);
    expect(pdfText(stored[0].bytes)).toContain('Asha K');
    const inv = await db.query<{ pdf_path: string }>(`select pdf_path from public.invoices where payment_id = $1`, [p]);
    expect(inv.rows[0].pdf_path).toBe(stored[0].path);
    await db.close();
  });
});
