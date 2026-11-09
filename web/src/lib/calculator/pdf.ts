import { jsPDF } from 'jspdf';
import { docPlace } from '@/lib/doc-chrome';
import autoTable from 'jspdf-autotable';
import { footStrip, PdfFlow, PdfLayout, TABLE_RULES, type FontFor, type Rgb, type TextStyle, type Weight } from '@/lib/pdf-layout';
import { fmt } from '@/lib/i18n';
import type { CalcResult, OfferLine } from './calc';
import { formatDate, formatNumber, parseNum } from './numbers';
import { offerCapsules } from './catalogCapsules';
import { productName } from './offerRecord';
import { offerPriceOptions } from './priceOptions';
import { OFFER_TEXT, type OfferLang } from "./offer-text";
import { offerProduct } from "./offer-product";
export type { OfferLang } from "./offer-text";
import { bulkThousands, BULK_UNIT, isBulk, isCapsule, type OfferForm, type ProductType, type Settings } from './types';

// Client-facing offer, laid out after Nutrikal's offer template (Poppins, two brand marks, customer /
// supplier blocks, amount per serving table, sales prices table, excl. VAT note, payment terms, terms, footer).
// It must NEVER contain raw material prices, cost per dose, fixed costs, markup, margin, profit or the
// raw material requirement list – only the data passed in OfferPdfModel.
// The offer is downloaded in Bulgarian or English, asked at every download (owner, Nov 2026); its text lives here.

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface OfferPdfModel {
  /** The language it is downloaded in. */
  lang: OfferLang;
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
  /**
   * Capsules in bulk (owner, Nov 2026): what is and is not included, prices per 1,000 capsules. The bottled
   * products' standard terms (filling, capping, labels) are left out for them.
   */
  bulk: { included: string; notIncluded: string } | null;
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

const money = (n: number) => n.toFixed(2);
const packagingPlural: Record<ProductType, string> = {
  capsules_glass: 'glass bottles',
  capsules_plastic: 'plastic bottles',
  capsules_bulk: 'no retail packaging',
  powder: 'doypack pouches',
};

/** Only client-safe values are copied from the form and the results. */
export function toPdfModel(
  form: OfferForm,
  result: CalcResult,
  settings: Settings,
  images: { customLogo: PdfImage | null; brandLogo: PdfImage | null },
  lang: OfferLang = 'en',
): OfferPdfModel {
  const PDF = OFFER_TEXT[lang];
  const catalog = form.mode === 'catalog' ? form.catalog : null;
  if (form.mode === 'catalog' && !catalog) throw new Error('Catalog product is required');
  if (!catalog && !form.productType) throw new Error('Product type is required');
  const type = form.productType ?? 'powder';
  const capsule = isCapsule(type);
  const units = parseNum(form.numberOfUnits) ?? 0;
  const perUnit = form.quantityPerUnit;
  const name = productName(form) || PDF.newFormula;
  const catalogCaps = offerCapsules(form);

  const bulk = !catalog && isBulk(type);
  const productLine: OfferLine = {
    description: bulk
      ? fmt(PDF.bulkLine, { name, n: formatNumber((bulkThousands(form) ?? 0) * BULK_UNIT, 0) })
      : catalog
      ? catalogCaps ? `${name} - ${catalogCaps} capsules` : name
      : capsule
        ? `${name} - ${perUnit} capsules with ${packagingPlural[type]}`
        : `${name} - ${perUnit} doses in ${packagingPlural[type]}`,
    qty: units,
    unit: bulk ? PDF.bulkUnit : 'pcs',
    price: result.unitPrice,
    discountPct: parseNum(form.discount) ?? 0,
    amount: result.productAmount,
  };

  // Product name + packaging, amount per serving table (no prices), then the account manager's notes.
  const { pack, format, dosePortion, doseRows } = offerProduct(form, result, lang);
  // Bulk: said first and plainly, then the account manager's notes
  const noteLines = [...(bulk ? [PDF.bulkStatement] : []), ...form.notes.split('\n').map((l) => l.trim()).filter(Boolean)];

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

  // In Bulgarian the company stands with its Bulgarian name, address and terms (Settings; empty keeps the English)
  const bg = lang === 'bg';
  const co = {
    name: (bg && settings.company_name_bg?.trim()) || settings.company_name,
    address: (bg && settings.company_address_bg?.trim()) || settings.company_address,
    terms: ((bg && settings.terms_text_bg?.trim()) || settings.terms_text).trim(),
  };
  return {
    lang,
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
      name: co.name,
      identificationNo: settings.company_id,
      vatNumber: settings.company_vat,
      address: co.address,
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
    // The code stands under the name, not in it
    productName: catalog && name.startsWith(catalog.code) ? name.slice(catalog.code.length).trim() || name : name,
    productCode: catalog?.code ?? '',
    pack,
    format,
    noteLines,
    terms: bulk ? '' : co.terms,
    bulk: bulk
      ? { included: (parseNum(form.bulkPackaging ?? '') ?? 0) > 0 ? PDF.bulkIncludedPackaging : PDF.bulkIncluded, notIncluded: `${PDF.bulkStatement} ${PDF.bulkNotIncluded}` }
      : null,
    footerText: settings.footer_text,
    headerContact: [[settings.company_email.trim(), settings.company_phone.trim()].filter(Boolean).join(' · '), co.address].filter(Boolean),
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

/**
 * The offer. Every text stands in its own column and wraps there (lib/pdf-layout.ts); nothing is set smaller to
 * fit: a body longer than one page continues on the next, payment terms and the thanks close the last page.
 */
export function createOfferPdf(m: OfferPdfModel, fonts: PdfFonts, docPhoto: string | null = null): jsPDF {
  const base = OFFER_TEXT[m.lang ?? 'en'];
  // Bulk: its own included and not included, prices per 1,000 capsules
  const PDF = m.bulk
    ? { ...base, includedText: m.bulk.included, notIncludedText: m.bulk.notIncluded, fromUnits: base.bulkFromUnits, pricesNote: base.bulkPricesNote }
    : base;
  const priceUnits = (n: number) => (m.bulk ? n * BULK_UNIT : n);
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
  const fontFor: FontFor = (weight, text = '') => {
    if (CYRILLIC.test(text)) return ['Roboto', weight === 'regular' ? 'normal' : 'bold'];
    if (weight === 'semibold') return ['PoppinsSemiBold', 'normal'];
    return ['Poppins', weight === 'bold' ? 'bold' : 'normal'];
  };
  const lay = new PdfLayout(doc, fontFor);
  const st = (size: number, weight: Weight = 'regular', color: Rgb = TEXT, leading?: number): TextStyle => ({ size, weight, color, leading });
  const last = (next: number, style: TextStyle) => next - lay.lineHeight(style); // baseline of the last line drawn

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = pageW - 25;
  const W = R - L;
  const COL2 = pageW / 2 + 3;
  const leftW = COL2 - L - 6;
  const rightW = R - COL2;

  // The strip at the foot of every page; the body ends above it
  const stripStyle = st(7, 'regular', MUTED);
  const company = [m.supplier.name, m.supplier.identificationNo && `${PDF.identificationNo}: ${m.supplier.identificationNo}`, docPlace(m.supplier.address)].filter(Boolean).join(' · ');
  const strip = (draw: boolean) => footStrip(lay, {
    left: m.footerText.trim() || company,
    center: (m.websites.length ? m.websites : ['nutrikal.com']).join(' · '),
    right: (n, pages) => fmt(PDF.page, { n, m: pages }),
  }, { x: 15, width: pageW - 30, bottom: 284, padX: L - 15, minHeight: 7, fill: HEAD_BG, style: stripStyle, draw });
  const stripTop = strip(false);
  const bottom = stripTop - 6;

  // 1. The dark top: logo, title, contacts and the facts (number, date, valid until). Measured first: the sheet starts under it.
  const WHITE: Rgb = [255, 255, 255];
  const titleStyle = st(22, 'bold', WHITE, 1.15);
  const contactStyle = st(8, 'regular', WHITE, 1.42);
  const factStyle = st(9, 'regular', WHITE);
  const factHeadStyle = st(9, 'semibold', WHITE);
  const titleX = 15 + 52 + 6;
  const titleLines = lay.wrap(PDF.offer.toUpperCase(), pageW - 15 - titleX, titleStyle);
  const contactY = Math.max(31, 25 + (titleLines.length - 1) * lay.lineHeight(titleStyle) + 6);
  const contactLines = lay.wrap(m.headerContact, (pageW - 30) * 0.62, contactStyle);
  const contactLast = contactLines.length ? contactY + (contactLines.length - 1) * lay.lineHeight(contactStyle) : 26;
  const facts: [string, string][] = [[PDF.number, m.offerNo], [`${PDF.date}:`, formatDate(m.offerDate)], ...(m.validUntil ? [[`${PDF.validUntil}:`, formatDate(m.validUntil)] as [string, string]] : [])];
  const factW = (pageW - 30 - 8 * (facts.length - 1)) / facts.length;
  const factCells = facts.map(([head, value]) => {
    doc.setFont(...fontFor('semibold', head));
    doc.setFontSize(9);
    const headW = doc.getTextWidth(`${head} `);
    const lines = lay.wrap(value, Math.max(10, factW - headW), factStyle);
    doc.setFont(...fontFor('regular', value));
    const valueW = Math.max(0, ...lines.map((l) => doc.getTextWidth(l)));
    return { head, headW, lines, width: Math.min(factW, headW + valueW) };
  });
  const factsY = Math.max(44, contactLast + 7);
  const factsLast = factsY + (Math.max(1, ...factCells.map((f) => f.lines.length)) - 1) * lay.lineHeight(factStyle);
  const SHEET = Math.max(52, factsLast + 8);
  drawDocShell(doc, SHEET, docPhoto);

  if (m.customLogo || m.brandLogo) {
    const img = (m.customLogo ?? m.brandLogo)!;
    const ratio = Math.min(52 / img.width, 15 / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    doc.addImage(img.dataUrl, imageFormat(img), 15, 26 - h, w, h, m.customLogo ? undefined : 'brand');
  } else {
    lay.text(m.supplier.name.toUpperCase(), 15, 26, 52, st(15, 'bold', WHITE));
  }
  lay.lines(titleLines, titleX, 25, pageW - 15 - titleX, titleStyle, 'right');
  lay.lines(contactLines, 15, contactY, (pageW - 30) * 0.62, contactStyle);
  factCells.forEach((f, i) => {
    const colX = 15 + i * (factW + 8);
    const align = i === 0 ? 'left' : i === facts.length - 1 ? 'right' : 'center';
    const left = align === 'left' ? colX : align === 'right' ? colX + factW - f.width : colX + (factW - f.width) / 2;
    lay.text(f.head, left, factsY, f.headW + 1, factHeadStyle);
    lay.lines(f.lines, left + f.headW, factsY, f.width - f.headW, factStyle);
  });

  const flow = new PdfFlow(doc, SHEET + 11, 18, bottom);

  // 2. Who it is for and who made it: each in its own column, wrapping there
  const partyHead = st(9, 'semibold');
  const partyRow = st(9, 'regular', TEXT, 1.45);
  const party = (title: string, x: number, width: number, rows: string[]) => {
    const y = lay.text(title, x, flow.y, width, partyHead);
    return lay.text(rows.filter(Boolean), x, last(y, partyHead) + 5.2, width, partyRow);
  };
  const yc = party(PDF.customer, L, leftW, [m.customer.name, m.customer.contactPerson === m.customer.name ? '' : m.customer.contactPerson, m.customer.addressLines.join(', ')]);
  const ys = party(PDF.supplier, COL2, rightW, [m.supplier.name, m.contact.name, [m.contact.phone, m.contact.email].filter(Boolean).join(' · ')]);
  flow.y = Math.max(yc, ys) + 9;

  // 3. No price lines, totals or bank details on the offer – prices are in the sales prices table.
  const cellFont = (text: string, weight: Weight) => {
    const [font, fontStyle] = fontFor(weight, text);
    return { font, fontStyle: fontStyle as 'normal' | 'bold' };
  };
  /** Wrapped lines over pages, one line at a time. */
  const flowText = (lines: string[], style: TextStyle, width = W) => {
    const lh = lay.lineHeight(style);
    for (const line of lay.wrap(lines, width, style)) {
      flow.ensure(lh);
      flow.y = lay.lines([line], L, flow.y, width, style);
    }
  };
  const underline = (cell: { x: number; y: number; width: number; height: number }) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
  };

  // 4. The product row under a dark rule: product, pack and format, each in its own column
  const headStyle = st(9, 'semibold');
  const valueStyle = st(9.5, 'regular', TEXT, 1.4);
  const codeStyle = st(7.5, 'regular', MUTED);
  const cols = [
    { x: L, width: W * 0.4 - 5 },
    { x: L + W * 0.4, width: W * 0.25 - 5 },
    { x: L + W * 0.65, width: W * 0.35 },
  ];
  const heads = [PDF.product, PDF.pack, PDF.format].map((text, i) => ({ ...cols[i], text, style: headStyle }));
  const values = [m.productName, m.pack, m.format].map((text, i) => ({ ...cols[i], text, style: valueStyle }));
  const codeH = m.productCode ? 4 : 0;
  flow.ensure(lay.rowHeight(heads) + 8.5 + Math.max(lay.rowHeight(values), lay.height(m.productName, cols[0].width, valueStyle) + codeH) + 10);
  flow.y = last(lay.row(heads, flow.y), headStyle) + 2.5;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.line(L, flow.y, R, flow.y);
  flow.y += 6;
  const top = flow.y;
  let lastLine = top;
  values.forEach((c, i) => {
    let end = last(lay.text(c.text, c.x, top, c.width, c.style), c.style);
    if (i === 0 && m.productCode) end = last(lay.text(m.productCode, c.x, end + 4, c.width, codeStyle), codeStyle);
    lastLine = Math.max(lastLine, end);
  });
  flow.y = lastLine + 3.5;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.15);
  doc.line(L, flow.y, R, flow.y);
  flow.y += 7;

  if (m.doseRows.length) {
    // One column up to ten ingredients; more than ten in two columns, row by row (owner, Nov 2026)
    const twoColumns = m.doseRows.length > 10;
    const AMT = 22;
    const GAP = 8;
    const nameW = (W - GAP) / 2 - AMT;
    const titleStyle9 = st(8.5, 'semibold');
    const title = fmt(PDF.amountPerDose, { portion: m.dosePortion });
    flow.ensure(lay.height(title, W, titleStyle9) + 12);
    flow.y = last(lay.text(title, L, flow.y, W, titleStyle9), titleStyle9) + 2;
    autoTable(doc, {
      startY: flow.y,
      margin: { left: L, right: pageW - R, top: 18, bottom: pageH - bottom },
      theme: 'plain',
      rowPageBreak: TABLE_RULES.rowPageBreak,
      body: twoColumns
        ? Array.from({ length: Math.ceil(m.doseRows.length / 2) }, (_, i) => {
            const [a, b] = m.doseRows.slice(i * 2, i * 2 + 2);
            return [a.name, a.amount, '', b?.name ?? '', b?.amount ?? ''];
          })
        : m.doseRows.map((r) => [r.name, r.amount]),
      styles: { font: 'Poppins', fontSize: 8, textColor: TEXT, cellPadding: { top: 1.1, bottom: 1.1, left: 0, right: 1 }, overflow: TABLE_RULES.overflow },
      columnStyles: twoColumns
        ? { 0: { cellWidth: nameW }, 1: { cellWidth: AMT, halign: 'right' }, 2: { cellWidth: GAP }, 3: { cellWidth: nameW }, 4: { cellWidth: AMT, halign: 'right' } }
        : { 0: { cellWidth: W - 28 }, 1: { cellWidth: 28, halign: 'right' } },
      didParseCell: (data) => {
        const text = data.cell.text.join(' ');
        if (CYRILLIC.test(text)) Object.assign(data.cell.styles, cellFont(text, 'regular'));
      },
      didDrawCell: (data) => { if (data.cell.text.join('') && !(twoColumns && data.column.index === 2)) underline(data.cell); },
    });
    flow.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }
  // Notes: under the table, or with their own heading when the table is switched off.
  const noteStyle = st(9.5, 'regular', TEXT, 1.4);
  if (m.noteLines.length) {
    if (!m.doseRows.length) {
      const h = st(10.5, 'semibold');
      flow.ensure(lay.lineHeight(h) + 3 + lay.lineHeight(noteStyle) * 2);
      flow.y = last(lay.text(PDF.note, L, flow.y, W, h), h) + 5.5;
    }
    flowText(m.noteLines, noteStyle);
    flow.y += 5;
  }

  // Payment terms and the thanks close the last page, above the strip
  const payHead = st(9, 'semibold');
  const payStyle = st(9, 'regular', TEXT, 1.39);
  const thanksStyle = st(8.5, 'regular', MUTED, 1.4);
  const payment = m.paymentTerms ? lay.wrap(m.paymentTerms, leftW - 2, payStyle) : [];
  const payTitle = lay.wrap(PDF.paymentTerms, leftW - 2, payHead);
  const thanks = lay.wrap(PDF.thanks, rightW, thanksStyle);
  const closeH = Math.max(
    payment.length ? payTitle.length * lay.lineHeight(payHead) + 1 + payment.length * lay.lineHeight(payStyle) : 0,
    thanks.length * lay.lineHeight(thanksStyle),
  );
  const closeTop = stripTop - 7 - closeH;

  // Prices as cards, then what they cover and the small print; this block sits apart, half of the free room above it
  const coverHead = st(8, 'semibold');
  const coverStyle = st(8, 'regular', MUTED, 1.35);
  const included = lay.wrap(PDF.includedText, leftW - 2, coverStyle);
  const notIncluded = lay.wrap(PDF.notIncludedText, rightW, coverStyle);
  const coversH = lay.lineHeight(coverHead) + Math.max(included.length, notIncluded.length) * lay.lineHeight(coverStyle) + 4;
  const fineStyle = st(FINE_PRINT, 'regular', MUTED, 1.27);
  const finePrint = lay.wrap([m.terms, PDF.moreTerms].filter(Boolean).join(' '), W, fineStyle);
  const prices = m.salesPrices ?? [];
  const PER_ROW = 5;
  const perRow = Math.max(Math.min(prices.length, PER_ROW), 3);
  const cardW = (W - 4 * (perRow - 1)) / perRow;
  const cardLabel = st(8.5, 'regular', MUTED, 1.3);
  const cardPrice = st(13, 'bold', TEXT, 1.2);
  const cardRows = Array.from({ length: Math.ceil(prices.length / PER_ROW) }, (_, r) => {
    const cards = prices.slice(r * PER_ROW, r * PER_ROW + PER_ROW).map((p) => ({
      label: lay.wrap(fmt(PDF.fromUnits, { n: formatNumber(priceUnits(p.units), 0) }), cardW - 8, cardLabel),
      price: lay.wrap(`€${money(p.price)}`, cardW - 8, cardPrice),
    }));
    const labelH = Math.max(...cards.map((c) => c.label.length)) * lay.lineHeight(cardLabel);
    const priceH = Math.max(...cards.map((c) => c.price.length)) * lay.lineHeight(cardPrice);
    return { cards, labelH, height: Math.max(17, 4 + labelH + 1.5 + priceH + 1.5) };
  });
  const noteH = cardRows.length ? lay.height(PDF.pricesNote, W, st(7.5)) : 0;
  const pricesH = cardRows.reduce((s, r) => s + r.height + 3, 0) + (cardRows.length ? 2.5 + noteH + 4.5 : 0);
  const keptH = pricesH + coversH; // cards and covers stay together; the small print may run on
  const tailH = keptH + finePrint.length * lay.lineHeight(fineStyle);
  const room = closeTop - 8 - flow.y - tailH;
  if (room >= 4) flow.y += Math.max(4, room / 2);
  else {
    flow.y += 4;
    flow.ensure(keptH);
  }
  cardRows.forEach((row) => {
    row.cards.forEach((c, i) => {
      const x = L + i * (cardW + 4);
      doc.setFillColor(...HEAD_BG);
      doc.roundedRect(x, flow.y, cardW, row.height, 0.8, 0.8, 'F');
      const labelY = flow.y + 4 + lay.ascent(cardLabel);
      lay.lines(c.label, x + 4, labelY, cardW - 8, cardLabel);
      lay.lines(c.price, x + 4, flow.y + 4 + row.labelH + 1.5 + lay.ascent(cardPrice), cardW - 8, cardPrice);
    });
    flow.y += row.height + 3;
  });
  if (cardRows.length) {
    flow.y += 2.5;
    flow.y = lay.text(PDF.pricesNote, L, flow.y, W, st(7.5, 'regular', MUTED)) + 4.5;
  }
  const coverTop = flow.y;
  const cover = (title: string, lines: string[], x: number, width: number) =>
    lay.lines(lines, x, last(lay.text(title, x, coverTop, width, coverHead), coverHead) + 4.2, width, coverStyle);
  cover(PDF.included, included, L, leftW - 2);
  cover(PDF.notIncluded, notIncluded, COL2, rightW);
  flow.y = coverTop + coversH;
  for (const line of finePrint) {
    flow.ensure(lay.lineHeight(fineStyle));
    flow.y = lay.lines([line], L, flow.y, W, fineStyle);
  }

  // The close at the foot of the last page; a new page when the body reaches it
  if (flow.y > closeTop - 8) doc.addPage();
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.15);
  doc.line(L, closeTop - 5, R, closeTop - 5);
  if (payment.length) {
    const y = lay.lines(payTitle, L, closeTop, leftW - 2, payHead);
    lay.lines(payment, L, last(y, payHead) + 5, leftW - 2, payStyle);
  }
  lay.lines(thanks, COL2, closeTop, rightW, thanksStyle);

  // 5. The strip on every page
  strip(true);
  return doc;
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

async function buildOfferPdf(form: OfferForm, result: CalcResult, settings: Settings, lang: OfferLang): Promise<jsPDF> {
  const [{ fonts, brandLogo, docPhoto }, customLogo] = await Promise.all([loadAssets(), loadImage(settings.logo_data_url)]);
  return createOfferPdf(toPdfModel(form, result, settings, { customLogo, brandLogo }, lang), fonts, docPhoto);
}

/** The language is asked before every download (Download in BG / Download in EN). */
export async function downloadOfferPdf(form: OfferForm, result: CalcResult, settings: Settings, lang: OfferLang): Promise<void> {
  (await buildOfferPdf(form, result, settings, lang)).save(offerFileName(form));
}

export async function offerPdfBase64(form: OfferForm, result: CalcResult, settings: Settings, lang: OfferLang = 'en'): Promise<{ base64: string; fileName: string }> {
  const doc = await buildOfferPdf(form, result, settings, lang);
  return { base64: doc.output('datauristring').split(',')[1], fileName: offerFileName(form) };
}
