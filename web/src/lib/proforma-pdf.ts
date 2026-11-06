import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawDocShell, loadAssets, loadImage } from '@/lib/calculator/pdf';
import { footStrip, PdfFlow, PdfLayout, TABLE_RULES, type Rgb, type TextStyle } from '@/lib/pdf-layout';

// Proforma, invoice or purchase order as a PDF file (downloaded in the browser). All text comes in the model,
// already in the client's language; Roboto is used throughout because it has Cyrillic letters.

export interface ProformaPdfModel {
  fileName: string;
  title: string;
  meta: string[];                          // "No SO-00001", "Date: …"
  seller: { heading: string; lines: string[] };
  buyer: { heading: string; lines: string[] };
  head: [string, string, string, string];
  rows: { description: string; note: string | null; quantity: string; unitPrice: string; amount: string }[];
  totals: [string, string][];              // last one is the amount due
  vatNote: string | null;
  bank: { heading: string; lines: string[] };
  notes: string | null;
  footer: string;
  logoDataUrl: string | null;
  contact?: string[];                      // under the logo
  sign?: [string, string];                 // the two lines to sign
  base?: string;                           // the strip at the foot
  pageOf?: string;                         // "Page {i} of {n}"
  noPrices?: boolean;                      // only description and quantity, no totals
}

const INK: [number, number, number] = [34, 40, 49];
const MUTED: [number, number, number] = [74, 81, 96];
const WHITE: [number, number, number] = [255, 255, 255];
const CANVAS: [number, number, number] = [244, 245, 247];
const MIST: [number, number, number] = [235, 235, 235];
const CYRILLIC = /[Ѐ-ӿ]/;

async function buildProformaPdf(model: ProformaPdfModel): Promise<jsPDF> {
  // Number formatting uses narrow/no-break spaces; the embedded font has plain spaces only.
  const m: ProformaPdfModel = JSON.parse(JSON.stringify(model).replace(/[   ]/g, ' '));
  const [{ fonts, brandLogo, docPhoto }, customLogo] = await Promise.all([loadAssets(), loadImage(m.logoDataUrl)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  // Poppins like the site; it has no Cyrillic letters, so documents in Bulgarian use Roboto.
  const cyrillic = CYRILLIC.test(JSON.stringify({ ...m, logoDataUrl: null }));
  const FONT = cyrillic ? 'Roboto' : 'Poppins';
  doc.addFileToVFS(`${FONT}-Regular.ttf`, cyrillic ? fonts.robotoRegular : fonts.poppinsRegular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, cyrillic ? fonts.robotoBold : fonts.poppinsBold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');

  // Every text stands in its own column and wraps there (lib/pdf-layout.ts); nothing is cut or set smaller.
  const lay = new PdfLayout(doc, (weight) => [FONT, weight === 'regular' ? 'normal' : 'bold']);
  const st = (size: number, bold = false, color: Rgb = INK, leading?: number, spacing?: number): TextStyle => ({ size, weight: bold ? 'bold' : 'regular', color, leading, spacing });
  const last = (next: number, style: TextStyle) => next - lay.lineHeight(style);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = pageW - 25;
  const W = R - L;
  const colW = (W - 10) / 2;
  const labelStyle = st(7, true, MUTED, 1.35, 0.4);
  const label = (text: string, x: number, y: number, width: number) => lay.text(text.toUpperCase(), x, y, width, labelStyle);

  // The strip at the foot of every page; the body ends above it
  const stripStyle = st(7, false, MUTED);
  const strip = (draw: boolean) => footStrip(lay, {
    left: m.base ?? '',
    center: 'nutrikal.com',
    right: (i, n) => (m.pageOf ? m.pageOf.replace('{i}', String(i)).replace('{n}', String(n)) : ''),
  }, { x: 15, width: pageW - 30, bottom: 284, padX: L - 15, minHeight: 9, fill: CANVAS, style: stripStyle, draw });
  const stripTop = strip(false);
  const bottom = stripTop - 4;

  // The dark top, measured first: logo and contacts on the left, the title on the right, then number and dates
  const titleStyle = st(20, true, WHITE, 1.15);
  const contactStyle = st(8, false, WHITE, 1.42);
  const metaStyle = st(8.5, false, WHITE);
  const metaHead = st(8.5, true, WHITE);
  const logoRight = 15 + 52 + 6;
  const titleW = pageW - 15 - logoRight;
  const titleLines = lay.wrap(m.title.toUpperCase(), titleW, titleStyle);
  const titleLast = 25 + (titleLines.length - 1) * lay.lineHeight(titleStyle);
  const contactW = Math.min(titleW, (pageW - 30) * 0.6);
  const contactLines = lay.wrap(m.contact ?? [], contactW, contactStyle);
  // Contacts start under the title when it takes more than one line, so the two never meet
  const contactY = Math.max(30.5, titleLast + 5.5);
  const contactLast = contactLines.length ? contactY + (contactLines.length - 1) * lay.lineHeight(contactStyle) : 25;

  // Number and dates in rows; an item too long for a row wraps inside it
  const full = pageW - 30;
  const items = m.meta.map((line) => {
    const at = line.indexOf(': ');
    const head = at > 0 ? `${line.slice(0, at)}: ` : '';
    const value = at > 0 ? line.slice(at + 2) : line;
    doc.setFontSize(8.5);
    doc.setFont(FONT, 'bold');
    const headW = Math.min(doc.getTextWidth(head), full / 2);
    const lines = lay.wrap(value, full - headW, metaStyle);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    const width = headW + Math.max(0, ...lines.map((l) => doc.getTextWidth(l)));
    return { head, headW, lines, width };
  });
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const item of items) {
    if (used > 0 && used + item.width > full) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(item);
    used += item.width + 10;
  }
  const metaLh = lay.lineHeight(metaStyle);
  const metaTop = Math.max(42, titleLast + 9, contactLast + 7.5);
  const rowY: number[] = [];
  let my = metaTop;
  for (const row of rows) {
    rowY.push(my);
    my += Math.max(1, ...row.map((x) => x.lines.length)) * metaLh + (6 - metaLh);
  }
  const SHEET = my + 2;
  drawDocShell(doc, SHEET, docPhoto);
  rows.forEach((row, r) => {
    const free = full - row.reduce((sum, x) => sum + x.width, 0);
    const gap = row.length > 1 ? free / (row.length - 1) : 0;
    let x = 15;
    for (const item of row) {
      if (item.head) lay.text(item.head.trim(), x, rowY[r], item.headW + 1, metaHead);
      lay.lines(item.lines, x + item.headW, rowY[r], item.width - item.headW, metaStyle);
      x += item.width + gap;
    }
  });

  // Logo and title on the dark top
  if (customLogo) {
    const ratio = Math.min(46 / customLogo.width, 13 / customLogo.height);
    const w = customLogo.width * ratio;
    const h = customLogo.height * ratio;
    doc.setFillColor(...WHITE);
    doc.rect(13, 22 - h / 2 - 1.5, w + 4, h + 3, 'F');
    doc.addImage(customLogo.dataUrl, customLogo.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', 15, 22 - h / 2, w, h);
  } else if (brandLogo) {
    const w = 52;
    doc.addImage(brandLogo.dataUrl, 'PNG', 15, 22 - (w * brandLogo.height / brandLogo.width) / 2, w, w * brandLogo.height / brandLogo.width);
  }
  lay.lines(titleLines, logoRight, 25, titleW, titleStyle, 'right');
  lay.lines(contactLines, 15, contactY, contactW, contactStyle);

  const flow = new PdfFlow(doc, SHEET + 11, 18, bottom);

  // Supplier / client: two columns, each wrapping in its own width
  const firstStyle = st(10, true, INK, 1.3);
  const restStyle = st(9, false, MUTED, 1.45);
  const party = (p: { heading: string; lines: string[] }, x: number) => {
    let y = last(label(p.heading, x, flow.y, colW), labelStyle) + 5;
    const [first, ...rest] = p.lines;
    if (first) y = lay.text(first, x, y, colW, firstStyle);
    return lay.text(rest, x, y, colW, restStyle);
  };
  const partiesH = Math.max(
    ...[m.seller, m.buyer].map((p) => lay.lineHeight(labelStyle) + 5 + lay.height(p.lines.slice(0, 1), colW, firstStyle) + lay.height(p.lines.slice(1), colW, restStyle)),
  );
  flow.ensure(partiesH);
  flow.y = Math.max(party(m.seller, L), party(m.buyer, L + colW + 10)) + 5;

  // Lines: hairlines only; the head repeats on each page, a row never splits over two
  autoTable(doc, {
    startY: flow.y,
    margin: { left: L, right: pageW - R, top: 18, bottom: pageH - bottom },
    theme: 'plain',
    rowPageBreak: TABLE_RULES.rowPageBreak,
    showHead: TABLE_RULES.showHead,
    head: [(m.noPrices ? m.head.slice(0, 2) : m.head).map((h) => h.toUpperCase())],
    body: m.rows.map((r) => {
      const description = r.note ? `${r.description}\n${r.note}` : r.description;
      return m.noPrices ? [description, r.quantity] : [description, r.quantity, r.unitPrice, r.amount];
    }),
    styles: { font: FONT, fontSize: 9, textColor: INK, cellPadding: { top: 2.4, bottom: 2.4, left: 0, right: 1.5 }, overflow: TABLE_RULES.overflow },
    headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7, textColor: MUTED },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: m.noPrices ? 40 : 26, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right';
    },
    didDrawCell: (data) => {
      doc.setLineWidth(data.section === 'head' ? 0.3 : 0.15);
      if (data.section === 'head') doc.setDrawColor(...INK);
      else doc.setDrawColor(...MIST);
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });
  flow.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  // Totals (right): the name wraps in its column, the value keeps its own; the amount due under an ink rule
  const totalsX = R - 84;
  const totalStyle = st(9, false, MUTED);
  const dueStyle = st(11, true, INK);
  const totalRow = (name: string, value: string, style: TextStyle, valueStyle: TextStyle) => {
    doc.setFont(FONT, valueStyle.weight === 'bold' ? 'bold' : 'normal');
    doc.setFontSize(valueStyle.size);
    const valueW = Math.min(doc.getTextWidth(value), 84 - 20);
    return [
      { x: totalsX, width: 84 - valueW - 4, text: name, style },
      { x: R - valueW, width: valueW, text: value, style: valueStyle, align: 'right' as const },
    ];
  };
  const totalRows = m.totals.map(([name, value], i) => {
    const due = i === m.totals.length - 1;
    const cells = totalRow(name, value, due ? dueStyle : totalStyle, due ? dueStyle : st(9));
    return { due, cells, height: lay.rowHeight(cells) };
  });
  const totalsH = totalRows.reduce((s, r) => s + r.height + (r.due ? 7 : 2), 0);
  if (totalRows.length) flow.ensure(totalsH + 2);
  for (const r of totalRows) {
    if (r.due) {
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(totalsX, flow.y, R, flow.y);
      flow.y = lay.row(r.cells, flow.y + 6) - lay.lineHeight(dueStyle) + 5;
    } else {
      flow.y = lay.row(r.cells, flow.y + 3) - lay.lineHeight(totalStyle) + 2.5;
    }
  }
  /** Text over pages, a line at a time, in the full width. */
  const flowText = (text: string | string[], style: TextStyle, gapBefore: number) => {
    const lines = lay.wrap(text, W, style);
    if (!lines.length) return;
    flow.y += gapBefore;
    flow.ensure(lay.lineHeight(style) * Math.min(2, lines.length));
    for (const line of lines) {
      flow.ensure(lay.lineHeight(style));
      flow.y = lay.lines([line], L, flow.y, W, style);
    }
  };
  if (m.vatNote) {
    flowText(m.vatNote, st(9, false, INK, 1.6), 1);
    flow.y += 1;
  }
  if (m.notes) flowText(m.notes.split('\n'), st(9, false, MUTED, 1.6), 2);

  // What closes the document stands at the foot of its last page, above the strip
  const hasBank = !!m.bank.heading;
  const bankStyle = st(9, false, INK, 1.6);
  const footStyle = st(8.5, false, MUTED, 1.4);
  const signStyle = st(8, false, MUTED);
  const footW = hasBank ? colW : W;
  const bankLines = hasBank ? lay.wrap(m.bank.lines, colW, bankStyle) : [];
  const bankHead = hasBank ? lay.wrap(m.bank.heading.toUpperCase(), colW, labelStyle) : [];
  const closing = m.footer ? lay.wrap(m.footer, footW, footStyle) : [];
  const closeH = Math.max(
    hasBank ? bankHead.length * lay.lineHeight(labelStyle) + 2 + bankLines.length * lay.lineHeight(bankStyle) : 0,
    closing.length * lay.lineHeight(footStyle),
  );
  const signText = (m.sign ?? []).map((t) => lay.wrap(t, colW, signStyle));
  const signH = m.sign ? 16.5 + Math.max(...signText.map((l) => l.length)) * lay.lineHeight(signStyle) : 0;
  const footH = (closeH ? closeH + 7 : 0) + signH;
  if (flow.y + footH + 4 > stripTop - 4) doc.addPage();
  if (closeH) {
    const top = stripTop - 5 - footH;
    doc.setDrawColor(...MIST);
    doc.setLineWidth(0.15);
    doc.line(L, top, R, top);
    if (hasBank) {
      const y = lay.lines(bankHead, L, top + 6, colW, labelStyle);
      lay.lines(bankLines, L, last(y, labelStyle) + 5, colW, bankStyle);
    }
    lay.lines(closing, hasBank ? L + colW + 10 : L, top + (hasBank ? 6 : 5), footW, footStyle);
  }
  if (m.sign) {
    const line = stripTop - 5 - signH + 14;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.25);
    m.sign.forEach((_, i) => {
      const x = L + i * (colW + 10);
      doc.line(x, line, x + colW, line);
      lay.lines(signText[i], x, line + 4.5, colW, signStyle);
    });
  }

  // The strip on every page
  strip(true);
  return doc;
}

export async function downloadProformaPdf(model: ProformaPdfModel): Promise<void> {
  (await buildProformaPdf(model)).save(model.fileName);
}

/** Saves the PDF on the device and returns the same file (base64), to keep a copy in the order tasks. */
export async function downloadProformaPdfKept(model: ProformaPdfModel): Promise<string> {
  const doc = await buildProformaPdf(model);
  doc.save(model.fileName);
  return doc.output('datauristring').split(',')[1];
}

export async function proformaPdfBase64(model: ProformaPdfModel): Promise<{ base64: string; fileName: string }> {
  const doc = await buildProformaPdf(model);
  return { base64: doc.output('datauristring').split(',')[1], fileName: model.fileName };
}
