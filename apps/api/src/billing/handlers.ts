import type { Sql } from '../db/sql';
import type { Handlers } from '../worker/runner';
import { renderInvoicePdf, type InvoiceData } from './invoicePdf';

export interface InvoiceStorage {
  /** store the file and return the path it can be fetched from */
  put(path: string, bytes: Buffer): Promise<string>;
}

interface InvoiceRow extends Omit<InvoiceData, 'lines' | 'taxable_value' | 'cgst' | 'sgst' | 'igst' | 'total'> {
  id: string;
  customer_id: string | null;
  lines: InvoiceData['lines'];
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

/** `invoice.render` (billing queue): make the PDF for a confirmed payment and record where it is. */
export function billingHandlers(sql: Sql, storage: InvoiceStorage): Handlers {
  return {
    'invoice.render': async (job) => {
      const paymentId = String((job.payload as { payment_id: string }).payment_id);
      const res = await sql.query<InvoiceRow>(
        `select i.*, o.invoice_no as original_invoice_no
           from public.invoices i
           left join public.invoices o on o.id = i.original_invoice_id
          where i.payment_id = $1 and i.series in ('INV', 'BOS')`,
        [paymentId],
      );
      const row = res.rows[0];
      if (!row) throw new Error(`no invoice for payment ${paymentId}`);

      const pdf = await renderInvoicePdf({
        ...row,
        taxable_value: Number(row.taxable_value),
        cgst: Number(row.cgst),
        sgst: Number(row.sgst),
        igst: Number(row.igst),
        total: Number(row.total),
      });
      const path = `${row.customer_id ?? 'unknown'}/${row.invoice_no.replace(/\//g, '-')}.pdf`;
      const stored = await storage.put(path, pdf);
      await sql.query('update public.invoices set pdf_path = $2 where id = $1', [row.id, stored]);
    },
  };
}
