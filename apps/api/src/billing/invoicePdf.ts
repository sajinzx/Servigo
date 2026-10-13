import PDFDocument from 'pdfkit';

export interface InvoiceLine {
  description: string;
  code: string;
  taxable: number;
  tax: number;
}

export interface InvoiceData {
  invoice_no: string;
  series: 'INV' | 'BOS' | 'CN' | 'CI';
  issued_at: string;
  supplier_name: string;
  supplier_gstin: string | null;
  supplier_state_code: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  place_of_supply: string | null;
  lines: InvoiceLine[];
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  reference: string | null;
  original_invoice_no?: string | null;
}

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TITLES: Record<InvoiceData['series'], string> = {
  INV: 'Tax Invoice',
  BOS: 'Bill of Supply',
  CN: 'Credit Note',
  CI: 'Tax Invoice (Commission)',
};

/**
 * Renders an invoice to a PDF buffer. `compress: false` keeps the text
 * extractable, which also makes the output easy to test.
 */
export function renderInvoicePdf(inv: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, compress: false, info: { Title: inv.invoice_no } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(TITLES[inv.series], { align: 'left' });
    doc.moveDown(0.3).fontSize(10).fillColor('#444');
    doc.text(`Invoice no: ${inv.invoice_no}`);
    doc.text(`Date: ${new Date(inv.issued_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    if (inv.original_invoice_no) doc.text(`Against invoice: ${inv.original_invoice_no}`);
    if (inv.reference) doc.text(`Payment reference: ${inv.reference}`);
    doc.moveDown();

    doc.fillColor('#000').fontSize(11).text('Supplier', { underline: true });
    doc.fontSize(10).text(inv.supplier_name);
    if (inv.supplier_gstin) doc.text(`GSTIN: ${inv.supplier_gstin}`);
    else if (inv.series !== 'CI') doc.text('Not registered under GST');
    doc.moveDown(0.5);

    doc.fontSize(11).text('Customer', { underline: true });
    doc.fontSize(10).text(inv.customer_name ?? 'Customer');
    if (inv.customer_gstin) doc.text(`GSTIN: ${inv.customer_gstin}`);
    if (inv.place_of_supply) doc.text(`Place of supply: ${inv.place_of_supply}`);
    doc.moveDown();

    // table
    const x = [48, 270, 350, 430, 500];
    const header = ['Description', 'SAC/HSN', 'Taxable', 'Tax', ''];
    doc.fontSize(10).font('Helvetica-Bold');
    header.slice(0, 4).forEach((h, i) => doc.text(h, x[i], doc.y, { continued: i < 3, width: x[i + 1] - x[i] }));
    doc.font('Helvetica').moveDown(0.3);
    for (const l of inv.lines) {
      const y = doc.y;
      doc.text(l.description, x[0], y, { width: x[1] - x[0] - 8 });
      doc.text(l.code, x[1], y, { width: 70 });
      doc.text(inr(l.taxable), x[2], y, { width: 70 });
      doc.text(inr(l.tax), x[3], y, { width: 70 });
      doc.moveDown(0.2);
    }
    doc.moveDown();

    const row = (label: string, value: number, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(`${label}: ${inr(value)}`, { align: 'right' });
    };
    row('Taxable value', inv.taxable_value);
    if (inv.cgst) row('CGST 9%', inv.cgst);
    if (inv.sgst) row('SGST 9%', inv.sgst);
    if (inv.igst) row('IGST 18%', inv.igst);
    row(inv.series === 'CN' ? 'Credit total' : 'Total', inv.total, true);

    doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#666');
    doc.text(
      inv.series === 'BOS'
        ? 'Bill of supply: no tax is charged because the supplier is not registered under GST.'
        : 'Computer generated. Issued by ServiGo on behalf of the supplier named above.',
    );
    doc.end();
  });
}
