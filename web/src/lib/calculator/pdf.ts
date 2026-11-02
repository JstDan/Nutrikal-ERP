import { jsPDF } from 'jspdf';
import { docPlace } from '@/lib/doc-chrome';
import autoTable from 'jspdf-autotable';
import { fmt } from '@/lib/i18n';
import { hasAluminiumCap, type CalcResult, type OfferLine } from './calc';
import { formatDate, formatNumber, parseNum } from './numbers';
import { hasAluminiumLid, offerCapsules, offerServings } from './catalogCapsules';
import { productName } from './offerRecord';
import { offerPriceOptions } from './priceOptions';
import { CAPSULE_SIZE, isCapsule, type OfferForm, type ProductType, type Settings } from './types';

// Client-facing offer, laid out after Nutrikal's offer template (Poppins, two brand marks, customer /
// supplier blocks, amount per serving table, sales prices table, excl. VAT note, payment terms, terms, footer).
// It must NEVER contain raw material prices, cost per dose, fixed costs, markup, margin, profit or the
// raw material requirement list – only the data passed in OfferPdfModel.
// The offer document is always in English (clients are mostly abroad), so its text lives here.

const PDF = {
  offer: 'Offer',
  number: 'No',
  date: 'Date',
  customer: 'Prepared for',
  supplier: 'Prepared by',
  product: 'Product',
  pack: 'Pack',
  format: 'Format',
  identificationNo: 'Identification No',
  vatNo: 'VAT No',
  contactPerson: 'Contact Person',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  amountPerDose: 'Composition per serving ({portion})',
  included: 'Included',
  thanks: 'Thank you for considering Nutrikal. We look forward to building your brand together.',
  validUntil: 'Valid until',
  includedText: 'Manufacturing in a GMP and HACCP certified facility, container with lid, label printing and application.',
  notIncluded: 'Not included',
  notIncludedText: 'Label design, batch testing and COA, shipping and customs, VAT.',
  moreTerms: 'Lead time usually 6-10 weeks after order, deposit and artwork are confirmed. Compliance in the destination market is the client’s responsibility. Some raw materials have their own minimums, which may affect price and timing.',
  ingredient: 'Ingredient',
  amountPerDoseColumn: 'Amount',
  note: 'Note',
  paymentTerms: 'Payment terms',
  fromUnits: 'From {n} units',
  pricesNote: 'Per unit, EUR, EXW Varna, Bulgaria, without VAT.',
  page: 'Page {n} of {m}',
  packaging_capsules_glass: 'Glass bottle',
  packaging_capsules_plastic: 'Plastic bottle',
  packaging_powder: 'Doypack (pouch)',
  aluminiumLid: 'with aluminium cap',
};

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface OfferPdfModel {
  offerNo: string;
  offerDate: string;
  customer: {
    name: string;
    identificationNo: string;
    vatNumber: string;
    contactPerson: string;
    addressLines: string[];
  };
  supplier: { name: string; identificationNo: string; vatNumber: string; address: string };
  /** Nutrikal contact person (name, phone) and the sales email, printed under the logos. */
  contact: { name: string; phone: string; email: string };
  lines: OfferLine[];
  subtotal: number;
  total: number;
  bank: { iban: string; name: string; bic: string; address: string };
  /** Shown next to the bank details (offers never include VAT). */
  vatExemptionText: string | null;
  paymentTerms: string;
  /** Price per unit for each quantity (the offer quantity plus price tiers), smallest first. Null without any quantity. */
  salesPrices: { units: number; price: number }[] | null;
  /** Size of one dose, shown in the table title, e.g. "1 capsule" or "5.00 g". */
  dosePortion: string;
  /** Ingredients contained in one dose (no prices). Empty when the composition is switched off. */
  doseRows: { name: string; amount: string }[];
  /** The product row: name, catalogue code when there is one, what is in a pack and how it is packed. */
  productName: string;
  productCode: string;
  pack: string;
  format: string;
  /** The account manager's notes, printed under the amount per serving table. */
  noteLines: string[];
  /** Standard offer terms (Settings). */
  terms: string;
  footerText: string;
  websites: string[];
  /** Contacts under the logo. */
  headerContact: string[];
  validUntil: string;
  /** Uploaded logo (Settings) – replaces the built-in logo in the header. */
  customLogo: PdfImage | null;
  /** Built-in Nutrikal logo (wide wordmark). */
  brandLogo: PdfImage | null;
}

export interface PdfFonts {
  poppinsRegular: string; // base64 TTF
  poppinsSemiBold: string;
  poppinsBold: string;
  /** Fallback for Cyrillic (Poppins has no Cyrillic glyphs). */
  robotoRegular: string;
  robotoBold: string;
}

const NAVY: [number, number, number] = [34, 40, 49];   // brand ink
const TEXT: [number, number, number] = [34, 40, 49];
const MUTED: [number, number, number] = [74, 81, 96];
const LINE: [number, number, number] = [221, 225, 232];
const HEAD_BG: [number, number, number] = [244, 245, 247];
const CYRILLIC = /[Ѐ-ӿ]/;

type Weight = 'regular' | 'semibold' | 'bold';

const money = (n: number) => n.toFixed(2);
const packagingPlural: Record<ProductType, string> = {
  capsules_glass: 'glass bottles',
  capsules_plastic: 'plastic bottles',
  powder: 'doypack pouches',
};

/** Only client-safe values are copied from the form and the results. */
export function toPdfModel(
  form: OfferForm,
  result: CalcResult,
  settings: Settings,
  images: { customLogo: PdfImage | null; brandLogo: PdfImage | null },
): OfferPdfModel {
  const catalog = form.mode === 'catalog' ? form.catalog : null;
  if (form.mode === 'catalog' && !catalog) throw new Error('Catalog product is required');
  if (!catalog && !form.productType) throw new Error('Product type is required');
  const type = form.productType ?? 'powder';
  const capsule = isCapsule(type);
  const units = parseNum(form.numberOfUnits) ?? 0;
  const perUnit = form.quantityPerUnit;
  const name = productName(form) || 'New formula';
  const catalogCaps = offerCapsules(form);

  const productLine: OfferLine = {
    description: catalog
      ? catalogCaps ? `${name} - ${catalogCaps} capsules` : name
      : capsule
        ? `${name} - ${perUnit} capsules with ${packagingPlural[type]}`
        : `${name} - ${perUnit} doses in ${packagingPlural[type]}`,
    qty: units,
    unit: 'pcs',
    price: result.unitPrice,
    discountPct: parseNum(form.discount) ?? 0,
    amount: result.productAmount,
  };

  // Product name + packaging, amount per serving table (no prices), then the account manager's notes.
  const doseG = result.doseWeightMg / 1000;
  const caps = parseNum(form.capsulesPerDose) ?? 1;
  const servings = result.dosesPerUnit !== null ? formatNumber(result.dosesPerUnit, 2) : '–';
  let pack: string;
  let format: string;
  if (catalog) {
    const catalogServings = offerServings(form);
    pack = catalogCaps ? [`${catalogCaps} capsules`, ...(catalogServings ? [`${formatNumber(catalogServings, 2)} servings`] : [])].join(', ') : '';
    format = catalogCaps ? `${PDF[form.jar === 'glass' ? 'packaging_capsules_glass' : 'packaging_capsules_plastic']}${hasAluminiumLid(form) ? ` ${PDF.aluminiumLid}` : ''}` : '';
  } else if (capsule) {
    pack = `${perUnit} capsules, ${servings} servings`;
    format = `${PDF[`packaging_${type}`]}${hasAluminiumCap(form) ? ` ${PDF.aluminiumLid}` : ''}, size ${CAPSULE_SIZE.replace('size', '')} capsules`;
  } else {
    const net = result.netWeightPerPouchG;
    pack = [net ? `${formatNumber(net, 0)} g` : '', `${servings} servings`].filter(Boolean).join(', ');
    format = 'Doypack';
  }
  const dosePortion = capsule ? `${caps} ${caps === 1 ? 'capsule' : 'capsules'}` : `${formatNumber(doseG, 2)} g`;
  const doseRows = !catalog && form.includeComposition
    ? form.rows
        .filter((r) => (parseNum(r.amount) ?? 0) > 0)
        .map((r) => ({ name: r.name, amount: `${formatNumber(parseNum(r.amount) ?? 0, 4)} ${r.unit}` }))
    : [];
  const noteLines = form.notes.split('\n').map((l) => l.trim()).filter(Boolean);

  // Sales prices table: the offer quantity plus any price tiers; one column per quantity, no totals.
  // A catalog product shows its own price steps instead of tiers built from a markup.
  const allPrices = offerPriceOptions(form, result);
  const salesPrices = allPrices.length ? allPrices : null;

  const r = form.receiver;
  const inv = form.invoice;
  const cityLine = [r.zip, r.city].filter((s) => s.trim()).join(' ');
  const addressLines = inv.registrationAddress.trim()
    ? [inv.registrationAddress.trim(), r.country]
    : [r.address, cityLine, r.country];

  return {
    offerNo: form.offer.offerNo,
    offerDate: form.offer.offerDate,
    customer: {
      name: inv.companyName.trim() || r.fullName.trim(),
      identificationNo: inv.identificationNo.trim(),
      vatNumber: inv.vatNumber.trim(),
      contactPerson: r.fullName.trim(),
      addressLines: addressLines.map((s) => s.trim()).filter(Boolean),
    },
    supplier: {
      name: settings.company_name,
      identificationNo: settings.company_id,
      vatNumber: settings.company_vat,
      address: settings.company_address,
    },
    contact: {
      name: form.contact?.name.trim() ?? '',
      phone: form.contact?.phone.trim() ?? '',
      email: settings.company_email.trim(),
    },
    lines: [productLine, ...result.extraLines],
    subtotal: result.totalPriceExclVat,
    total: result.totalPriceExclVat,
    bank: { iban: settings.bank_iban, name: settings.bank_name, bic: settings.bank_bic, address: settings.bank_address },
    vatExemptionText: settings.vat_exemption_text.trim() || null,
    paymentTerms: form.paymentTerms.trim(),
    salesPrices,
    dosePortion,
    doseRows,
    productName: name,
    productCode: catalog?.code ?? '',
    pack,
    format,
    noteLines,
    terms: settings.terms_text.trim(),
    footerText: settings.footer_text,
    headerContact: [[settings.company_email.trim(), settings.company_phone.trim()].filter(Boolean).join(' · '), settings.company_address].filter(Boolean),
    validUntil: form.offer.validUntil,
    websites: settings.websites
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    customLogo: images.customLogo,
    brandLogo: images.brandLogo,
  };
}

export function offerFileName(form: Pick<OfferForm, 'offer' | 'invoice' | 'receiver'>): string {
  const who = (form.invoice.companyName.trim() || form.receiver.fullName.trim() || 'Client')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');
  const no = form.offer.offerNo.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'draft';
  return `Offer_${no}_${who}.pdf`;
}

const FINE_PRINT = 6.5;
const imageFormat = (img: PdfImage) => (img.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG');

/** An offer always stands on one page: the body shrinks step by step until it fits. */
export function createOfferPdf(m: OfferPdfModel, fonts: PdfFonts, docPhoto: string | null = null): jsPDF {
  let last: jsPDF | null = null;
  for (const scale of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65]) {
    const { doc, fits } = drawOffer(m, fonts, docPhoto, scale);
    if (fits) return doc;
    last = doc;
  }
  return last!;
}

function drawOffer(m: OfferPdfModel, fonts: PdfFonts, docPhoto: string | null, scale: number): { doc: jsPDF; fits: boolean } {
  const z = (n: number) => n * scale;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const register = (file: string, data: string, family: string, style: string) => {
    doc.addFileToVFS(file, data);
    doc.addFont(file, family, style);
  };
  register('Poppins-Regular.ttf', fonts.poppinsRegular, 'Poppins', 'normal');
  register('Poppins-Bold.ttf', fonts.poppinsBold, 'Poppins', 'bold');
  register('Poppins-SemiBold.ttf', fonts.poppinsSemiBold, 'PoppinsSemiBold', 'normal');
  // Poppins has no Cyrillic glyphs: embed the Roboto fallback only when the offer contains Cyrillic text.
  const hasCyrillic = CYRILLIC.test(JSON.stringify({ ...m, customLogo: null, brandLogo: null }));
  if (hasCyrillic) {
    register('Roboto-Regular.ttf', fonts.robotoRegular, 'Roboto', 'normal');
    register('Roboto-Bold.ttf', fonts.robotoBold, 'Roboto', 'bold');
  }

  /** Poppins like the template; Roboto for text with Cyrillic (Poppins has no Cyrillic glyphs). */
  const fontFor = (weight: Weight, text = ''): [string, string] => {
    if (CYRILLIC.test(text)) return ['Roboto', weight === 'regular' ? 'normal' : 'bold'];
    if (weight === 'semibold') return ['PoppinsSemiBold', 'normal'];
    return ['Poppins', weight === 'bold' ? 'bold' : 'normal'];
  };
  const write = (
    text: string,
    x: number,
    y: number,
    opts: { weight?: Weight; size?: number; color?: [number, number, number]; align?: 'left' | 'right' | 'center' } = {},
  ) => {
    doc.setFont(...fontFor(opts.weight ?? 'regular', text));
    doc.setFontSize(opts.size ?? 9);
    doc.setTextColor(...(opts.color ?? TEXT));
    doc.text(text, x, y, { align: opts.align ?? 'left' });
    return doc.getTextWidth(text);
  };

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = pageW - 25;
  const COL2 = pageW / 2 + 3;
  const SHEET = 52;
  drawDocShell(doc, SHEET, docPhoto);

  // 1. Header on the dark top: logo, title, number and date
  if (m.customLogo || m.brandLogo) {
    const img = (m.customLogo ?? m.brandLogo)!;
    const ratio = Math.min(52 / img.width, 15 / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    doc.addImage(img.dataUrl, imageFormat(img), 15, 26 - h, w, h, m.customLogo ? undefined : 'brand');
  } else {
    write(m.supplier.name.toUpperCase(), 15, 26, { weight: 'bold', size: 15, color: [255, 255, 255] });
  }
  write(PDF.offer.toUpperCase(), pageW - 15, 25, { weight: 'bold', size: 22, align: 'right', color: [255, 255, 255] });
  m.headerContact.forEach((line, i) => write(line, 15, 31 + i * 4, { size: 8, color: [255, 255, 255] }));
  // Number, date and how long it stands, spread over the dark top
  const facts: [string, string][] = [[PDF.number, m.offerNo], [PDF.date.endsWith(':') ? PDF.date : `${PDF.date}:`, formatDate(m.offerDate)], ...(m.validUntil ? [[`${PDF.validUntil}:`, formatDate(m.validUntil)] as [string, string]] : [])];
  const fact = (head: string, value: string, x: number, align: 'left' | 'center' | 'right') => {
    doc.setFontSize(9);
    doc.setFont(...fontFor('semibold', head));
    const headW = doc.getTextWidth(`${head} `);
    doc.setFont(...fontFor('regular', value));
    const width = headW + doc.getTextWidth(value);
    const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
    write(head, left, 44, { weight: 'semibold', size: 9, color: [255, 255, 255] });
    write(value, left + headW, 44, { size: 9, color: [255, 255, 255] });
  };
  facts.forEach(([head, value], i) => fact(head, value, i === 0 ? 15 : i === facts.length - 1 ? pageW - 15 : pageW / 2, i === 0 ? 'left' : i === facts.length - 1 ? 'right' : 'center'));

  // 2. Who it is for and who made it: only what is filled in
  const party = (title: string, x: number, rows: string[]) => {
    let py = SHEET + 11;
    write(title, x, py, { weight: 'semibold', size: z(9) });
    py += z(5.2);
    for (const row of rows.filter(Boolean)) {
      write(row, x, py, { size: z(9) });
      py += z(4.6);
    }
    return py;
  };
  const yc = party(PDF.customer, L, [m.customer.name, m.customer.contactPerson, m.customer.addressLines.join(', ')]);
  const ys = party(PDF.supplier, COL2, [m.supplier.name, m.contact.name, [m.contact.phone, m.contact.email].filter(Boolean).join(' · ')]);

  // 3. No price lines, totals or bank details on the offer – prices are in the sales prices table.
  const cellFont = (text: string, weight: Weight) => {
    const [font, fontStyle] = fontFor(weight, text);
    return { font, fontStyle: fontStyle as 'normal' | 'bold' };
  };
  let y = Math.max(yc, ys) + z(9);

  // Payment terms and the thanks stand at the foot of the page, above the strip; the body ends above them
  doc.setFont(...fontFor('regular', m.paymentTerms));
  doc.setFontSize(z(9));
  const payment = m.paymentTerms ? doc.splitTextToSize(m.paymentTerms, COL2 - L - 8) as string[] : [];
  doc.setFontSize(z(8.5));
  const thanks = doc.splitTextToSize(PDF.thanks, R - COL2) as string[];
  const closeH = Math.max(payment.length ? z(6) + payment.length * z(4.4) : 0, thanks.length * z(4.2));
  const closeTop = 277 - 7 - closeH;
  const bottomLimit = closeTop - 8;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 18;
    }
  };

  // 4. Product row, composition, then the prices and what they cover as a block of their own
  const textLines = (lines: string[], base = 9.5, color = TEXT) => {
    const size = z(base);
    doc.setFontSize(size);
    for (const line of lines) {
      doc.setFont(...fontFor('regular', line));
      for (const part of doc.splitTextToSize(line, R - L) as string[]) {
        ensureSpace(size * 0.53);
        write(part, L, y, { size, color });
        y += size * 0.53;
      }
    }
  };
  const heading = (title: string) => {
    write(title, L, y, { weight: 'semibold', size: z(10.5) });
    y += z(2.5);
  };
  const block = (title: string, lines: string[], size = 9.5, color = TEXT) => {
    if (!lines.length) return;
    ensureSpace(z(14));
    heading(title);
    y += z(3);
    textLines(lines, size, color);
    y += z(5);
  };
  const underline = (cell: { x: number; y: number; width: number; height: number }) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
  };
  // The product row, under a dark rule
  ensureSpace(z(22));
  const packX = L + (R - L) * 0.5;
  write(PDF.product, L, y, { weight: 'semibold', size: z(9) });
  write(PDF.pack, packX, y, { weight: 'semibold', size: z(9), align: 'center' });
  write(PDF.format, R, y, { weight: 'semibold', size: z(9), align: 'right' });
  y += z(2.5);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.line(L, y, R, y);
  y += z(6);
  doc.setFont(...fontFor('regular', m.productName));
  doc.setFontSize(z(9.5));
  const nameLines = doc.splitTextToSize(m.productName, (R - L) * 0.36) as string[];
  nameLines.forEach((line, i) => write(line, L, y + i * z(4.4), { size: z(9.5) }));
  write(m.pack, packX, y, { size: z(9.5), align: 'center' });
  write(m.format, R, y, { size: z(9.5), align: 'right' });
  y += (nameLines.length - 1) * z(4.4);
  if (m.productCode) {
    y += z(4);
    write(m.productCode, L, y, { size: z(7.5), color: MUTED });
  }
  y += z(3.5);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.15);
  doc.line(L, y, R, y);
  y += z(7);

  if (m.doseRows.length) {
    // One clean list; from seven ingredients three columns, row by row
    const threeColumns = m.doseRows.length > 6;
    const nameW = (R - L - 10) / 3 - 16;
    ensureSpace(z(16));
    write(fmt(PDF.amountPerDose, { portion: m.dosePortion }), L, y, { weight: 'semibold', size: z(8.5) });
    y += z(2);
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: pageW - R, top: 15, bottom: pageH - bottomLimit },
      theme: 'plain',
      body: threeColumns
        ? Array.from({ length: Math.ceil(m.doseRows.length / 3) }, (_, i) => {
            const [a, b, c] = m.doseRows.slice(i * 3, i * 3 + 3);
            return [a.name, a.amount, '', b?.name ?? '', b?.amount ?? '', '', c?.name ?? '', c?.amount ?? ''];
          })
        : m.doseRows.map((r) => [r.name, r.amount]),
      styles: { font: 'Poppins', fontSize: z(8), textColor: TEXT, cellPadding: { top: z(1.1), bottom: z(1.1), left: 0, right: 0 }, overflow: 'linebreak' },
      columnStyles: threeColumns
        ? { 0: { cellWidth: nameW }, 1: { cellWidth: 16, halign: 'right' }, 2: { cellWidth: 5 }, 3: { cellWidth: nameW }, 4: { cellWidth: 16, halign: 'right' }, 5: { cellWidth: 5 }, 6: { cellWidth: nameW }, 7: { cellWidth: 16, halign: 'right' } }
        : { 0: { cellWidth: R - L - 25 }, 1: { cellWidth: 25, halign: 'right' } },
      didParseCell: (data) => {
        const text = data.cell.text.join(' ');
        if (CYRILLIC.test(text)) Object.assign(data.cell.styles, cellFont(text, 'regular'));
      },
      didDrawCell: (data) => { if (data.cell.text.join('') && !(threeColumns && data.column.index % 3 === 2)) underline(data.cell); },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + z(6);
  }
  // Notes: under the table, or with their own heading when the table is switched off.
  if (m.doseRows.length) {
    if (m.noteLines.length) {
      textLines(m.noteLines);
      y += z(5);
    }
  } else {
    block(PDF.note, m.noteLines);
  }
  // Prices as cards, then what they cover and the small print; this block sits apart, half of the free room above it
  const covers = (text: string) => {
    doc.setFont(...fontFor('regular', text));
    doc.setFontSize(z(8));
    return doc.splitTextToSize(text, COL2 - L - 8) as string[];
  };
  const includedLines = covers(PDF.includedText);
  const notIncludedLines = covers(PDF.notIncludedText);
  doc.setFont(...fontFor('regular', m.terms));
  doc.setFontSize(FINE_PRINT);
  const finePrint = doc.splitTextToSize([m.terms, PDF.moreTerms].filter(Boolean).join(' '), R - L) as string[];
  const prices = m.salesPrices ?? [];
  const PER_ROW = 5;
  const cardRows = Math.ceil(prices.length / PER_ROW);
  const cardH = z(17);
  const pricesH = cardRows ? cardRows * (cardH + 3) + z(7) : 0;
  const coversH = z(4.2) + Math.max(includedLines.length, notIncludedLines.length) * z(3.8) + z(4);
  const free = bottomLimit - y - pricesH - coversH - finePrint.length * 2.9;
  y += Math.max(z(4), free / 2);
  ensureSpace(pricesH + coversH + finePrint.length * 2.9);
  if (cardRows) {
    const cardW = (R - L - 4 * (Math.max(Math.min(prices.length, PER_ROW), 3) - 1)) / Math.max(Math.min(prices.length, PER_ROW), 3);
    prices.forEach((p, i) => {
      const x = L + (i % PER_ROW) * (cardW + 4);
      const top = y + Math.floor(i / PER_ROW) * (cardH + 3);
      doc.setFillColor(...HEAD_BG);
      doc.roundedRect(x, top, cardW, cardH, 0.8, 0.8, 'F');
      write(fmt(PDF.fromUnits, { n: formatNumber(p.units, 0) }), x + 4, top + z(6.5), { size: z(8.5), color: MUTED });
      write(`€${money(p.price)}`, x + 4, top + z(13), { weight: 'bold', size: z(13) });
    });
    y += cardRows * (cardH + 3) + z(2.5);
    write(PDF.pricesNote, L, y, { size: z(7.5), color: MUTED });
    y += z(7);
  }
  const cover = (title: string, lines: string[], x: number) => {
    write(title, x, y, { weight: 'semibold', size: z(8) });
    lines.forEach((part, i) => write(part, x, y + z(4.2) + i * z(3.8), { size: z(8), color: MUTED }));
  };
  cover(PDF.included, includedLines, L);
  cover(PDF.notIncluded, notIncludedLines, COL2);
  y += coversH;
  finePrint.forEach((line) => {
    write(line, L, y, { size: FINE_PRINT, color: MUTED });
    y += 2.9;
  });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.15);
  doc.line(L, closeTop - 5, R, closeTop - 5);
  if (payment.length) {
    write(PDF.paymentTerms, L, closeTop, { weight: 'semibold', size: z(9) });
    payment.forEach((line, i) => write(line, L, closeTop + z(5) + i * z(4.4), { size: z(9) }));
  }
  thanks.forEach((line, i) => write(line, COL2, closeTop + i * z(4.2), { size: z(8.5), color: MUTED }));

  // 5. Footer strip on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...HEAD_BG);
    doc.rect(15, 277, pageW - 30, 7, 'F');
    const company = [m.supplier.name, m.supplier.identificationNo && `${PDF.identificationNo}: ${m.supplier.identificationNo}`, docPlace(m.supplier.address)].filter(Boolean).join(' · ');
    write(m.footerText.trim() || company, L, 281.6, { size: 7, color: MUTED });
    write((m.websites.length ? m.websites : ['nutrikal.com']).join(' · '), pageW / 2 + 22, 281.6, { size: 7, color: MUTED, align: 'center' });
    write(fmt(PDF.page, { n: i, m: pages }), R, 281.6, { size: 7, color: MUTED, align: 'right' });
  }

  return { doc, fits: pages === 1 };
}

// ---------------------------------------------------------------------------
// Browser helpers: lazy font / image loading and download
// ---------------------------------------------------------------------------

let assetCache: Promise<{ fonts: PdfFonts; brandLogo: PdfImage | null; inkLogo: PdfImage | null; docPhoto: string | null }> | null = null;

/** First page of every document: dark top, capsule photo below, a white sheet over both. Returns nothing: the sheet starts at top. */
export function drawDocShell(doc: jsPDF, top: number, photo: string | null, bottom = 284) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(34, 40, 49);
  doc.rect(0, 0, w, h, 'F');
  if (photo) doc.addImage(photo, 'JPEG', 0, h - 140, w, 140, 'docphoto');
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(15, top, w - 30, bottom - top, 0.8, 0.8, 'F');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function loadImage(dataUrl: string | null): Promise<PdfImage | null> {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** The NUTRIKAL wordmark in one colour, as a PNG (jsPDF has no WebP). */
function wordmark(color: string): Promise<PdfImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 2;
      canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => resolve(null);
    img.src = '/nutrikal-wordmark.webp';
  });
}

export function loadAssets() {
  assetCache ??= (async () => {
    // Served from web/public/calculator.
    const files = ['Poppins-Regular.ttf', 'Poppins-SemiBold.ttf', 'Poppins-Bold.ttf', 'Roboto-Regular.ttf', 'Roboto-Bold.ttf', 'logo-nutrikal.png'];
    const base64 = await Promise.all(
      files.map(async (file) => {
        const res = await fetch(`/calculator/${file}`);
        if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
        return arrayBufferToBase64(await res.arrayBuffer());
      }),
    );
    const [poppinsRegular, poppinsSemiBold, poppinsBold, robotoRegular, robotoBold, nk] = base64;
    const fallback = await loadImage(`data:image/png;base64,${nk}`);
    const brandLogo = (await wordmark('#ffffff')) ?? fallback;
    const inkLogo = (await wordmark('#222831')) ?? fallback;
    return {
      fonts: { poppinsRegular, poppinsSemiBold, poppinsBold, robotoRegular, robotoBold },
      brandLogo,
      inkLogo,
      docPhoto: await fetch('/doc-bg.jpg').then(async (r) => (r.ok ? `data:image/jpeg;base64,${arrayBufferToBase64(await r.arrayBuffer())}` : null)).catch(() => null),
    };
  })().catch((e) => {
    assetCache = null;
    throw e;
  });
  return assetCache;
}

async function buildOfferPdf(form: OfferForm, result: CalcResult, settings: Settings): Promise<jsPDF> {
  const [{ fonts, brandLogo, docPhoto }, customLogo] = await Promise.all([loadAssets(), loadImage(settings.logo_data_url)]);
  return createOfferPdf(toPdfModel(form, result, settings, { customLogo, brandLogo }), fonts, docPhoto);
}

export async function downloadOfferPdf(form: OfferForm, result: CalcResult, settings: Settings): Promise<void> {
  (await buildOfferPdf(form, result, settings)).save(offerFileName(form));
}

export async function offerPdfBase64(form: OfferForm, result: CalcResult, settings: Settings): Promise<{ base64: string; fileName: string }> {
  const doc = await buildOfferPdf(form, result, settings);
  return { base64: doc.output('datauristring').split(',')[1], fileName: offerFileName(form) };
}
