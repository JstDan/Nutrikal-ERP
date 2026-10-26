import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmt } from '@/lib/i18n';
import { unitPriceFor, type CalcResult, type OfferLine } from './calc';
import { formatDate, formatNumber, parseNum } from './numbers';
import { catalogTiersFor, hasAluminiumLid, offerCapsules, offerServings } from './catalogCapsules';
import { productName } from './offerRecord';
import { CAPSULE_SIZES, isCapsule, type OfferForm, type ProductType, type Settings } from './types';

// Client-facing offer, laid out after Nutrikal's offer template (Poppins, two brand marks, customer /
// supplier blocks, amount per serving table, sales prices table, excl. VAT note, payment terms, terms, footer).
// It must NEVER contain raw material prices, cost per dose, fixed costs, markup, margin, profit or the
// raw material requirement list – only the data passed in OfferPdfModel.
// The offer document is always in English (clients are mostly abroad), so its text lives here.

const PDF = {
  offer: 'OFFER',
  number: 'Number',
  date: 'Date',
  customer: 'CUSTOMER',
  supplier: 'SUPPLIER',
  identificationNo: 'Identification No',
  vatNo: 'VAT No',
  contactPerson: 'Contact Person',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  amountPerDose: 'AMOUNT PER SERVING ({portion}):',
  ingredient: 'Ingredient',
  amountPerDoseColumn: 'Amount per serving',
  note: 'NOTE:',
  paymentTerms: 'PAYMENT TERMS:',
  terms: 'DISCLAIMER:',
  pricesExclVat: 'All prices are excl. VAT.',
  salesPrices: 'SALES PRICES:',
  units: 'Units',
  pricePerUnit: 'Price/Unit (EUR)',
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

const NAVY: [number, number, number] = [27, 31, 59];
const TEXT: [number, number, number] = [31, 35, 40];
const LINE: [number, number, number] = [150, 155, 160];
const HEAD_BG: [number, number, number] = [229, 231, 233];
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
    const size = (Object.keys(CAPSULE_SIZES) as (keyof typeof CAPSULE_SIZES)[]).includes(form.capsuleSize)
      ? `, capsule size ${form.capsuleSize.replace('size', '')}`
      : '';
    packaging.push(
      `${PDF[`packaging_${type}`]}s${form.lid === 'aluminium' ? ` ${PDF.aluminiumLid}` : ''}, ${perUnit} capsules each${size}.`,
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
  const tierPrices = catalog
    ? catalogTiersFor(form).map((x) => ({ units: x.min_qty, price: x.price }))
    : (form.priceTiers ?? []).flatMap((tier) => {
        const qty = parseNum(tier.qty);
        const markup = parseNum(tier.markup);
        return qty && qty > 0 && markup !== null ? [{ units: qty, price: unitPriceFor(result.unitCost, markup) }] : [];
      });
  const allPrices = [...(units > 0 && result.complete ? [{ units, price: result.unitPrice }] : []), ...tierPrices]
    .filter((p, i, all) => all.findIndex((q) => q.units === p.units) === i)
    .sort((a, b) => a.units - b.units);
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

export function createOfferPdf(m: OfferPdfModel, fonts: PdfFonts): jsPDF {
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
  /** "Label: value" with the value in bold, as in the template. */
  const labelValue = (label: string, value: string, x: number, y: number, boldValue = true) => {
    const w = write(`${label} `, x, y);
    if (value) write(value, x + w, y, { weight: boldValue ? 'bold' : 'regular' });
  };

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 8.5;
  const R = 193.5;
  const COL2 = 103;
  const bottomLimit = pageH - 18;

  // 1. Header: Nutrikal logo (or uploaded logo) + OFFER meta
  if (m.customLogo) {
    const ratio = Math.min(60 / m.customLogo.width, 24 / m.customLogo.height);
    doc.addImage(m.customLogo.dataUrl, imageFormat(m.customLogo), 12, 12, m.customLogo.width * ratio, m.customLogo.height * ratio);
  } else if (m.brandLogo) {
    const w = 62;
    doc.addImage(m.brandLogo.dataUrl, imageFormat(m.brandLogo), L, 12, w, w * (m.brandLogo.height / m.brandLogo.width), 'brand');
  } else {
    write(m.supplier.name.toUpperCase(), 12, 24, { weight: 'bold', size: 20, color: NAVY });
  }
  write(PDF.offer, COL2, 17.5, { weight: 'bold', size: 24, color: NAVY });
  labelValue(`${PDF.number}:`, m.offerNo, COL2, 24, false);
  labelValue(`${PDF.date}:`, formatDate(m.offerDate), COL2, 30, false);

  // Nutrikal contact person, phone and sales email under the logos (top left).
  let top = 51;
  const contactLines = [
    [PDF.contactPerson, m.contact.name],
    [PDF.phone, m.contact.phone],
    [PDF.email, m.contact.email],
  ].filter(([, value]) => value);
  if (contactLines.length) {
    let yh = 28;
    for (const [label, value] of contactLines) {
      const w = write(`${label}: `, L, yh, { size: 8.5 });
      write(value, L + w, yh, { weight: 'bold', size: 8.5 });
      yh += 4.4;
    }
    top = Math.max(top, yh + 6);
  }

  // 2. Customer / supplier
  const STEP = 6.2;
  let yc = top;
  write(PDF.customer, L, yc, { weight: 'semibold', size: 11 });
  yc += 7;
  if (m.customer.name) {
    write(m.customer.name, L, yc);
    yc += STEP;
  }
  labelValue(`${PDF.identificationNo}:`, m.customer.identificationNo, L, yc);
  yc += STEP;
  labelValue(`${PDF.vatNo}:`, m.customer.vatNumber, L, yc);
  yc += STEP;
  if (m.customer.contactPerson) {
    labelValue(`${PDF.contactPerson}:`, m.customer.contactPerson, L, yc);
    yc += STEP;
  }
  doc.setFontSize(9);
  for (const line of m.customer.addressLines) {
    doc.setFont(...fontFor('regular', line));
    for (const part of doc.splitTextToSize(line, COL2 - L - 6) as string[]) {
      write(part, L, yc);
      yc += STEP;
    }
  }

  let ys = top;
  write(PDF.supplier, COL2, ys, { weight: 'semibold', size: 11 });
  ys += 7;
  write(m.supplier.name, COL2, ys);
  ys += STEP;
  labelValue(`${PDF.identificationNo}:`, m.supplier.identificationNo, COL2, ys);
  ys += STEP;
  labelValue(`${PDF.vatNo}:`, m.supplier.vatNumber, COL2, ys);
  ys += STEP;
  doc.setFont(...fontFor('regular', m.supplier.address));
  const addrLabel = `${PDF.address}: `;
  const addrParts = doc.splitTextToSize(addrLabel + m.supplier.address, R - COL2) as string[];
  for (const part of addrParts) {
    write(part, COL2, ys);
    ys += STEP;
  }

  // 3. No price lines, totals or bank details on the offer – prices are in the sales prices table.
  const cellFont = (text: string, weight: Weight) => {
    const [font, fontStyle] = fontFor(weight, text);
    return { font, fontStyle: fontStyle as 'normal' | 'bold' };
  };
  let y = Math.max(yc, ys) + 6;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 15;
    }
  };

  // 4. Amount per serving, sales prices, excl. VAT note, payment terms, standard terms
  const textLines = (lines: string[]) => {
    doc.setFontSize(9);
    for (const line of lines) {
      doc.setFont(...fontFor('regular', line));
      for (const part of doc.splitTextToSize(line, R - L) as string[]) {
        ensureSpace(6);
        write(part, L, y);
        y += 5.2;
      }
    }
  };
  const block = (title: string, lines: string[]) => {
    if (!lines.length) return;
    ensureSpace(14);
    write(title, L, y, { weight: 'bold', size: 8 });
    y += 6.5;
    textLines(lines);
    y += 4;
  };
  // Product name with the packaging lines under it.
  ensureSpace(16);
  write(m.productName, L, y, { weight: 'bold', size: 12, color: NAVY });
  y += 6;
  textLines(m.packaging);
  y += 4;

  if (m.doseRows.length) {
    ensureSpace(24);
    write(fmt(PDF.amountPerDose, { portion: m.dosePortion.toUpperCase() }), L, y, { weight: 'bold', size: 8 });
    y += 2.5;
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
      theme: 'plain',
      head: [[PDF.ingredient, PDF.amountPerDoseColumn]],
      body: m.doseRows.map((r) => [r.name, r.amount]),
      styles: { font: 'Poppins', fontSize: 8.5, textColor: TEXT, cellPadding: { top: 1.2, bottom: 1.2, left: 1, right: 1 }, overflow: 'linebreak' },
      headStyles: { font: 'Poppins', fontStyle: 'bold', fontSize: 8, fillColor: HEAD_BG, textColor: NAVY },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 40, halign: 'right' } },
      didParseCell: (data) => {
        const text = data.cell.text.join(' ');
        if (data.section === 'head') {
          data.cell.text = data.cell.text.map((s) => s.toUpperCase());
          if (data.column.index === 1) data.cell.styles.halign = 'right';
        } else if (CYRILLIC.test(text)) {
          Object.assign(data.cell.styles, cellFont(text, 'regular'));
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.25);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }
  // Notes: under the table, or with their own heading when the table is switched off.
  if (m.doseRows.length) {
    if (m.noteLines.length) {
      textLines(m.noteLines);
      y += 4;
    }
  } else {
    block(PDF.note, m.noteLines);
  }
  // Sales prices, then the excl. VAT line, payment terms and standard terms at the end.
  if (m.salesPrices) {
    ensureSpace(24);
    write(PDF.salesPrices, L, y, { weight: 'bold', size: 8 });
    y += 2.5;
    autoTable(doc, {
      startY: y,
      margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
      theme: 'plain',
      body: [
        [PDF.units, ...m.salesPrices.map((p) => formatNumber(p.units, 0))],
        [PDF.pricePerUnit, ...m.salesPrices.map((p) => `€${money(p.price)}`)],
      ],
      styles: { font: 'Poppins', fontSize: 9, textColor: TEXT, cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 }, halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', fillColor: HEAD_BG, textColor: NAVY, cellWidth: 38 } },
      didDrawCell: (data) => {
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.25);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  ensureSpace(8);
  write(PDF.pricesExclVat, L, y, { weight: 'bold', size: 9 });
  y += 9;
  block(PDF.paymentTerms, m.paymentTerms ? [m.paymentTerms] : []);
  block(PDF.terms, m.terms ? [m.terms] : []);

  // 5. Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...TEXT);
    doc.setLineWidth(0.4);
    doc.line(5, pageH - 10, pageW - 5, pageH - 10);
    if (m.footerText.trim()) write(m.footerText, 5, pageH - 4.5, { size: 8.5 });
    // Websites from the right.
    let x = pageW - 5;
    [...m.websites].reverse().forEach((site) => {
      x -= write(site, x, pageH - 4.5, { size: 8.5, align: 'right' }) + 4.5;
    });
    if (pages > 1) write(fmt(PDF.page, { n: i, m: pages }), pageW / 2, pageH - 4.5, { size: 8, align: 'left' });
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Browser helpers: lazy font / image loading and download
// ---------------------------------------------------------------------------

let assetCache: Promise<{ fonts: PdfFonts; brandLogo: PdfImage | null }> | null = null;

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
    const brandLogo = await loadImage(`data:image/png;base64,${nk}`);
    return {
      fonts: { poppinsRegular, poppinsSemiBold, poppinsBold, robotoRegular, robotoBold },
      brandLogo,
    };
  })().catch((e) => {
    assetCache = null;
    throw e;
  });
  return assetCache;
}

export async function downloadOfferPdf(form: OfferForm, result: CalcResult, settings: Settings): Promise<void> {
  const [{ fonts, brandLogo }, customLogo] = await Promise.all([loadAssets(), loadImage(settings.logo_data_url)]);
  const doc = createOfferPdf(toPdfModel(form, result, settings, { customLogo, brandLogo }), fonts);
  doc.save(offerFileName(form));
}
