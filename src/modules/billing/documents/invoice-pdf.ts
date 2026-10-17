import { openSync, type Font } from 'fontkit';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { Invoice } from '../entities/invoice.entity';
const scalar = (value: unknown, fallback = '—'): string => {
  if (value == null) return fallback;
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  throw new Error('INVOICE_SNAPSHOT_INVALID');
};
const amount = (v: unknown) => `INR ${scalar(v, '0.00')}`;
/** Only immutable issue data is rendered: never a live center, menu or profile. */
export async function renderInvoicePdf(invoice: Invoice): Promise<Buffer> {
  if (
    invoice.schemaVersion !== 2 ||
    !invoice.billingSnapshot ||
    !invoice.snapshotHash
  )
    throw new Error('Invoice snapshot required');
  const snapshot = invoice.billingSnapshot;
  const showsTax =
    invoice.documentKind === 'TAX_INVOICE' ||
    (invoice.documentKind.endsWith('_NOTE') &&
      (snapshot.seller as { registrationStatus?: string })
        ?.registrationStatus === 'REGULAR');
  const font = join(__dirname, 'fonts', 'NotoSans-Regular.ttf');
  const bold = join(__dirname, 'fonts', 'NotoSans-Bold.ttf');
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    bufferPages: true,
    font,
    info: {
      Title: `${invoice.documentKind} ${invoice.invoiceNumber}`,
      Author: invoice.seller.name ?? 'Service center',
      CreationDate: invoice.issuedAt,
      ModDate: invoice.issuedAt,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont('Body', font);
  doc.registerFont('Heading', bold);
  const width = doc.page.width - 84;
  const fallbackFamilies = [
    'NotoSans',
    'NotoSansDevanagari',
    'NotoSansKannada',
  ];
  const faces = fallbackFamilies.map((family) => ({
    family,
    font: openSync(join(__dirname, 'fonts', `${family}-Regular.ttf`)) as Font,
  }));
  for (const face of faces) {
    doc.registerFont(
      face.family,
      join(__dirname, 'fonts', `${face.family}-Regular.ttf`),
    );
    doc.registerFont(
      face.family + 'Bold',
      join(__dirname, 'fonts', `${face.family}-Bold.ttf`),
    );
  }
  const text = (value: unknown, heading = false, size = 10) => {
    const groups: { family: string; text: string }[] = [];
    for (const char of scalar(value)) {
      const code = char.codePointAt(0)!;
      const family =
        /\s/u.test(char) || code === 0x200d || code === 0x200c
          ? (groups.at(-1)?.family ?? 'NotoSans')
          : faces.find((face) => face.font.hasGlyphForCodePoint(code))?.family;
      if (!family) throw new Error('INVOICE_FONT_COVERAGE_REQUIRED');
      if (groups.at(-1)?.family === family)
        groups[groups.length - 1].text += char;
      else groups.push({ family, text: char });
    }
    groups.forEach((group, index) =>
      doc
        .font(group.family + (heading ? 'Bold' : ''))
        .fontSize(size)
        .fillColor('#152b3c')
        .text(group.text, {
          width,
          lineGap: 3,
          continued: index < groups.length - 1,
        }),
    );
    return doc;
  };
  const line = () => {
    doc.moveDown(0.5);
    doc
      .strokeColor('#d4dee5')
      .moveTo(42, doc.y)
      .lineTo(doc.page.width - 42, doc.y)
      .stroke();
    doc.moveDown(0.8);
  };
  const room = (height: number) => {
    if (doc.y + height > doc.page.height - 72) doc.addPage();
  };
  text(invoice.documentKind.replaceAll('_', ' '), true, 20);
  text(invoice.invoiceNumber, true, 12);
  text(
    `Issued: ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(invoice.issuedAt)} · Supply: ${scalar(snapshot.supplyDate)}`,
  );
  line();
  text('SELLER', true, 9);
  text(invoice.seller.name, true, 13);
  text(invoice.seller.address);
  text(
    `PIN ${invoice.seller.pin ?? '—'} · State ${invoice.seller.stateCode ?? '—'}`,
  );
  if (invoice.seller.gstin) text(`GSTIN ${invoice.seller.gstin}`);
  line();
  text('BILL TO', true, 9);
  text(invoice.buyer.name, true, 12);
  text(invoice.buyer.address);
  text(
    `PIN ${invoice.buyer.pin ?? '—'} · State ${invoice.buyer.stateCode ?? '—'}`,
  );
  if (invoice.buyer.gstin) text(`GSTIN ${invoice.buyer.gstin}`);
  text(
    `Vehicle: ${invoice.buyer.vehicleRegistration ?? '—'} · ${invoice.buyer.vehicleLabel ?? '—'}`,
  );
  const supply = snapshot.placeOfSupply as { stateCode?: string } | undefined;
  text(`Place of supply: ${supply?.stateCode ?? '—'}`);
  line();
  const lines = [...(invoice.lineItems ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  if (!lines.length) throw new Error('Invoice lines required');
  for (const [index, item] of lines.entries()) {
    const scope = (item.taxSnapshot?.scope ?? []) as {
      name?: string;
      quantity?: string;
    }[];
    const details = [
      `${index + 1}. ${item.description}`,
      `Qty ${item.quantity} × ${amount(item.unitPriceInr)}${item.taxSnapshot?.priceMode === 'INCLUSIVE' ? ' (tax included)' : ''} · Base ${amount(item.amountInr)}`,
      ...(item.taxSnapshot?.discountInr
        ? [
            `Discount ${amount(item.taxSnapshot.discountInr)} · ${scalar(item.taxSnapshot.discountReason, '')}`,
          ]
        : []),
      ...(item.taxSnapshot?.classificationCode
        ? [`HSN/SAC ${scalar(item.taxSnapshot.classificationCode)}`]
        : []),
      ...scope.map(
        (p) => `Includes ${p.quantity ?? 1} × ${p.name ?? 'Included work'}`,
      ),
    ];
    // Break between rows; long descriptions can naturally flow onto another page.
    room(80);
    text(details[0], true);
    for (const detail of details.slice(1)) text(detail);
    if (showsTax)
      text(
        `Tax ${item.taxRatePct}%: ${amount(item.taxInr)} · Line total ${amount(item.taxSnapshot?.totalInr ?? item.amountInr)}`,
      );
    doc.moveDown(0.7);
  }
  room(160);
  line();
  text(`Subtotal  ${amount(invoice.subtotalInr)}`);
  if (showsTax) {
    const totals = lines.reduce(
      (a, l) => {
        const t = l.taxSnapshot ?? {};
        for (const key of ['cgstInr', 'sgstInr', 'igstInr'])
          a[key] = (a[key] ?? 0) + Math.round(Number(t[key] ?? 0) * 100);
        return a;
      },
      {} as Record<string, number>,
    );
    text(
      `CGST ${amount((totals.cgstInr / 100).toFixed(2))} · SGST/UTGST ${amount((totals.sgstInr / 100).toFixed(2))} · IGST ${amount((totals.igstInr / 100).toFixed(2))}`,
    );
  }
  text(`TOTAL  ${amount(invoice.totalInr)}`, true, 18);
  if (invoice.notes) {
    doc.moveDown();
    text(invoice.notes);
  }
  doc.moveDown();
  text(
    `Authorized signatory: ${String((snapshot.seller as { signatory?: string })?.signatory ?? '—')}`,
  );
  text(
    'Issued by the service center using Autoflex. Payment status is maintained separately.',
    false,
    8,
  );
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Body')
      .fontSize(8)
      .text(
        `${invoice.invoiceNumber} · Page ${i + 1} of ${pages.count}`,
        42,
        doc.page.height - 42,
        { width, align: 'right', lineBreak: false },
      );
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}
