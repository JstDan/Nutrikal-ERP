import { jsPDF } from 'jspdf';
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
  customer: 'CUSTOMER',
  supplier: 'SUPPLIER',
  identificationNo: 'Identification No',
  vatNo: 'VAT No',
  contactPerson: 'Contact Person',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  amountPerDose: 'Composition per serving ({portion})',
  included: 'Included',
  includedText: 'Manufacturing in a GMP and HACCP certified facility, container with lid, label printing and application.',
  notIncluded: 'Not included',
  notIncludedText: 'Label design, batch testing and COA, shipping and customs, VAT.',
  moreTerms: 'Lead time usually 6-10 weeks once order, deposit and artwork are confirmed. Compliance in the destination market is the client’s responsibility unless agreed otherwise in writing. Some raw materials have their own minimums, which may affect price and timing.',
  ingredient: 'Ingredient',
  amountPerDoseColumn: 'Amount',
  note: 'Note',
  paymentTerms: 'Payment terms',
  terms: 'Disclaimer',
  pricesExclVat: 'All prices are excl. VAT.',
  salesPrices: 'Sales prices',
  units: 'Quantity (units)',
  pricePerUnit: 'Price per unit (EUR)',
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
  /** Product name and packaging lines (container, per serving, servings per container), above the amount per serving table. */
  productName: string;
  packaging: string[];
  /** The account manager's notes, printed under the amount per serving table. */
  noteLines: string[];
  /** Standard offer terms (Settings). */
  terms: string;
  footerText: string;
  websites: string[];
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
  const name = productName(form) || 'Custom formula';
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
  const packaging: string[] = [];
  const doseG = result.doseWeightMg / 1000;
  const caps = parseNum(form.capsulesPerDose) ?? 1;
  const servings = result.dosesPerUnit !== null ? formatNumber(result.dosesPerUnit, 2) : '–';
  if (catalog) {
    packaging.push(`Product code: ${catalog.code}`, ...(catalog.category ? [catalog.category] : []));
    const catalogServings = offerServings(form);
    if (catalogCaps) {
      packaging.push(
        `${PDF[form.jar === 'glass' ? 'packaging_capsules_glass' : 'packaging_capsules_plastic']}${hasAluminiumLid(form) ? ` ${PDF.aluminiumLid}` : ''}, ${catalogCaps} capsules per container.`,
        ...(catalog.capsules_per_serving ? [`Capsules/Serving: ${catalog.capsules_per_serving}`] : []),
        ...(catalogServings ? [`Servings/Container: ${formatNumber(catalogServings, 2)}`] : []),
      );
    }
  } else if (capsule) {
    const size = `, capsule size ${CAPSULE_SIZE.replace('size', '')}`;
    packaging.push(
      `${PDF[`packaging_${type}`]}s${hasAluminiumCap(form) ? ` ${PDF.aluminiumLid}` : ''}, ${perUnit} capsules each${size}.`,
      `Capsules/Serving: ${formatNumber(caps, 2)}`,
      `Servings/Container: ${servings}`,
    );
  } else {
    const net = result.netWeightPerPouchG;
    packaging.push(
      `Doypack${net ? `, net ${formatNumber(net, 0)} g` : ''}.`,
      `Gr/Serving: ${formatNumber(doseG, 2)}gr`,
      `Servings/Container: ${servings}`,
    );
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
    packaging,
    noteLines,
    terms: settings.terms_text.trim(),
    footerText: settings.footer_text,
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

const imageFormat = (img: PdfImage) => (img.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG');

export function createOfferPdf(m: OfferPdfModel, fonts: PdfFonts, docPhoto: string | null = null): jsPDF {
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
    opts: { weight?: Weight; size?: number; color?: [number, number, number]; align?: 'left' | 'right' } = {},
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
  const bottomLimit = pageH - 26;
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
  write(PDF.offer, pageW - 15, 25, { weight: 'bold', size: 22, align: 'right', color: [255, 255, 255] });
  write(`${PDF.number} ${m.offerNo}`, 15, 44, { weight: 'semibold', size: 9, color: [255, 255, 255] });
  write(formatDate(m.offerDate), pageW - 15, 44, { size: 9, align: 'right', color: [255, 255, 255] });

  // 2. Customer / supplier: only what is filled in
  const party = (title: string, x: number, width: number, name: string, rows: [string, string][]) => {
    let py = SHEET + 11;
    write(title, x, py, { weight: 'semibold', size: 7.5, color: MUTED });
    py += 5.5;
    if (name) {
      write(name, x, py, { weight: 'bold', size: 11 });
      py += 5.6;
    }
    doc.setFontSize(9);
    for (const [label, value] of rows.filter(([, v]) => v)) {
      const line = label ? `${label}: ${value}` : value;
      doc.setFont(...fontFor('regular', line));
      for (const part of doc.splitTextToSize(line, width) as string[]) {
        write(part, x, py, { size: 9 });
        py += 4.7;
      }
    }
    return py;
  };
  const yc = party(PDF.customer, L, COL2 - L - 8, m.customer.name, [
    [PDF.identificationNo, m.customer.identificationNo], [PDF.vatNo, m.customer.vatNumber],
    [PDF.contactPerson, m.customer.contactPerson], ...m.customer.addressLines.map((a): [string, string] => ['', a]),
  ]);
  const ys = party(PDF.supplier, COL2, R - COL2, m.supplier.name, [
    [PDF.identificationNo, m.supplier.identificationNo], [PDF.vatNo, m.supplier.vatNumber], ['', m.supplier.address],
    [PDF.contactPerson, m.contact.name], [PDF.phone, m.contact.phone], [PDF.email, m.contact.email],
  ]);

  // 3. No price lines, totals or bank details on the offer – prices are in the sales prices table.
  const cellFont = (text: string, weight: Weight) => {
    const [font, fontStyle] = fontFor(weight, text);
    return { font, fontStyle: fontStyle as 'normal' | 'bold' };
  };
  let y = Math.max(yc, ys) + 6;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 18;
    }
  };

  // 4. Product, amount per serving, sales prices, excl. VAT note, payment terms, standard terms
  const textLines = (lines: string[], size = 9.5, color = TEXT) => {
    doc.setFontSize(size);
    for (const line of lines) {
      doc.setFont(...fontFor('regular', line));
      for (const part of doc.splitTextToSize(line, R - L) as string[]) {
        ensureSpace(6);
        write(part, L, y, { size, color });
        y += size * 0.53;
      }
    }
  };
  const heading = (title: string) => {
    write(title, L, y, { weight: 'semibold', size: 10.5 });
    y += 2.5;
  };
  const block = (title: string, lines: string[], size = 9.5, color = TEXT) => {
    if (!lines.length) return;
    ensureSpace(14);
    heading(title);
    y += 3;
    textLines(lines, size, color);
    y += 5;
  };
  const underline = (cell: { x: number; y: number; width: number; height: number }, color = LINE) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
  };
  // Product name with the packaging lines under it.
  ensureSpace(18);
  write(m.productName, L, y, { weight: 'bold', size: 15 });
  y += 6.5;
  textLines(m.packaging, 9.5, MUTED);
  y += 6;

  if (m.doseRows.length) {
    ensureSpace(24);
    heading(fmt(PDF.amountPerDose, { portion: m.dosePortion }));
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
      theme: 'plain',
      // Two columns of ingredients keep the offer on one page
      body: Array.from({ length: Math.ceil(m.doseRows.length / 2) }, (_, i) => {
        const half = Math.ceil(m.doseRows.length / 2);
        const a = m.doseRows[i];
        const b = m.doseRows[i + half];
        return [a.name, a.amount, '', b?.name ?? '', b?.amount ?? ''];
      }),
      styles: { font: 'Poppins', fontSize: 8.5, textColor: TEXT, cellPadding: { top: 1.1, bottom: 1.1, left: 0, right: 0 }, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 56 }, 1: { cellWidth: 19, halign: 'right' }, 2: { cellWidth: 10 }, 3: { cellWidth: 56 }, 4: { cellWidth: 19, halign: 'right' } },
      didParseCell: (data) => {
        const text = data.cell.text.join(' ');
        if (CYRILLIC.test(text)) Object.assign(data.cell.styles, cellFont(text, 'regular'));
      },
      didDrawCell: (data) => { if (data.column.index !== 2 && data.cell.text.join('')) underline(data.cell); },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  }
  // Notes: under the table, or with their own heading when the table is switched off.
  if (m.doseRows.length) {
    if (m.noteLines.length) {
      textLines(m.noteLines);
      y += 5;
    }
  } else {
    block(PDF.note, m.noteLines);
  }
  // Sales prices, then the excl. VAT line, payment terms and standard terms at the end.
  if (m.salesPrices) {
    ensureSpace(30);
    heading(PDF.salesPrices);
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
      theme: 'plain',
      head: [[PDF.units, ...m.salesPrices.map((p) => formatNumber(p.units, 0))]],
      body: [[PDF.pricePerUnit, ...m.salesPrices.map((p) => `€${money(p.price)}`)]],
      styles: { font: 'Poppins', fontSize: 9.5, textColor: TEXT, cellPadding: { top: 2.2, bottom: 2.2, left: 0, right: 2 }, halign: 'right' },
      headStyles: { font: 'Poppins', fontSize: 9.5, textColor: MUTED },
      columnStyles: { 0: { halign: 'left', cellWidth: 46 } },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index === 0) data.cell.styles.halign = 'left';
        if (data.section === 'body' && data.column.index > 0) Object.assign(data.cell.styles, { fontStyle: 'bold', fontSize: 11.5 });
      },
      didDrawCell: (data) => underline(data.cell, data.section === 'head' ? NAVY : LINE),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }

  ensureSpace(8);
  write(PDF.pricesExclVat, L, y, { size: 8.5, color: MUTED });
  y += 7;
  // What the price covers, side by side
  ensureSpace(20);
  const half = (title: string, text: string, x: number) => {
    write(title, x, y, { weight: 'semibold', size: 9 });
    doc.setFont(...fontFor('regular', text));
    doc.setFontSize(8.5);
    (doc.splitTextToSize(text, COL2 - L - 8) as string[]).forEach((part, i) => write(part, x, y + 4.4 + i * 3.9, { size: 8.5, color: MUTED }));
  };
  half(PDF.included, PDF.includedText, L);
  half(PDF.notIncluded, PDF.notIncludedText, COL2);
  y += 20;
  block(PDF.paymentTerms, m.paymentTerms ? [m.paymentTerms] : [], 9);
  block(PDF.terms, [m.terms, PDF.moreTerms].filter(Boolean), 8, MUTED);

  // 5. Footer strip on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...HEAD_BG);
    doc.rect(15, 277, pageW - 30, 7, 'F');
    if (m.footerText.trim()) write(m.footerText, L, 281.6, { size: 7.5, color: MUTED });
    let x = R - (pages > 1 ? 16 : 0);
    [...m.websites].reverse().forEach((site) => {
      x -= write(site, x, 281.6, { size: 7.5, color: MUTED, align: 'right' }) + 4;
    });
    if (pages > 1) write(fmt(PDF.page, { n: i, m: pages }), R, 281.6, { size: 7.5, color: MUTED, align: 'right' });
  }

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
