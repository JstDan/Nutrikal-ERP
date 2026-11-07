import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawDocShell, loadAssets } from '@/lib/calculator/pdf';
import { footStrip, PdfFlow, PdfLayout, TABLE_RULES, type Rgb, type TextStyle } from '@/lib/pdf-layout';

// The production contract as a PDF (downloaded in the browser or attached to an e-mail): the shared document look
// (dark top, white sheet, strip at the foot), the clauses flowing over the pages, Schedule A as a table, and the
// lines to sign. All text comes in the model in the contract's language.

export interface ContractPdfModel {
  fileName: string;
  title: string;
  meta: string[];                       // "No C-2026-0001", "Date: …"
  contact: string[];                    // under the logo
  body: string;                         // "# " starts a clause, "- " a bullet
  schedule: { title: string; head: [string, string, string, string]; rows: [string, string, string, string][]; totals: [string, string][] };
  spec: { title: string; products: { name: string; facts: [string, string][]; compositionTitle: string; composition: [string, string][] }[] };
  stamp: string | null;                 // accepted on the link: who, when, IP
  sign: [string, string];               // For the Manufacturer / For the Client
  signNames: [string, string];          // the two parties' names under the lines
  nameLine: string;
  base: string;                         // the strip at the foot
  pageOf: string;                       // "Page {i} of {n}"
}

const INK: Rgb = [34, 40, 49];
const MUTED: Rgb = [74, 81, 96];
const WHITE: Rgb = [255, 255, 255];
const CANVAS: Rgb = [244, 245, 247];
const MIST: Rgb = [235, 235, 235];
const GREEN: Rgb = [47, 125, 50];
const CYRILLIC = /[Ѐ-ӿ]/;

async function buildContractPdf(model: ContractPdfModel): Promise<jsPDF> {
  // Number formatting uses narrow/no-break spaces; the embedded font has plain spaces only
  const m: ContractPdfModel = JSON.parse(JSON.stringify(model).replace(/[   ]/g, ' '));
  const { fonts, brandLogo, docPhoto } = await loadAssets();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const cyrillic = CYRILLIC.test(JSON.stringify(m));
  const FONT = cyrillic ? 'Roboto' : 'Poppins';
  doc.addFileToVFS(`${FONT}-Regular.ttf`, cyrillic ? fonts.robotoRegular : fonts.poppinsRegular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, cyrillic ? fonts.robotoBold : fonts.poppinsBold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');

  const lay = new PdfLayout(doc, (weight) => [FONT, weight === 'regular' ? 'normal' : 'bold']);
  const st = (size: number, bold = false, color: Rgb = INK, leading?: number, spacing?: number): TextStyle => ({ size, weight: bold ? 'bold' : 'regular', color, leading, spacing });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = pageW - 25;
  const W = R - L;

  const stripTop = footStrip(lay, { left: m.base, center: 'nutrikal.com', right: (i, n) => m.pageOf.replace('{i}', String(i)).replace('{n}', String(n)) },
    { x: 15, width: pageW - 30, bottom: 284, padX: L - 15, minHeight: 9, fill: CANVAS, style: st(7, false, MUTED), draw: false });
  const bottom = stripTop - 4;

  // The dark top: wordmark and contacts on the left, the title on the right, number and date under them
  const titleStyle = st(20, true, WHITE, 1.15);
  const contactStyle = st(8, false, WHITE, 1.42);
  const metaStyle = st(8.5, true, WHITE);
  const logoRight = 15 + 52 + 6;
  const titleW = pageW - 15 - logoRight;
  const contactLines = lay.wrap(m.contact, Math.min(titleW, (pageW - 30) * 0.6), contactStyle);
  const contactLast = contactLines.length ? 30.5 + (contactLines.length - 1) * lay.lineHeight(contactStyle) : 25;
  const metaY = Math.max(42, contactLast + 7.5);
  const metaLines = lay.wrap(m.meta.join('   ·   '), pageW - 30, metaStyle);
  const SHEET = metaY + (metaLines.length - 1) * lay.lineHeight(metaStyle) + 6;
  drawDocShell(doc, SHEET, docPhoto);
  // Every further page has the same look: the dark ground and photo with the white sheet over them, from near the top
  const SHEET_NEXT = 15;
  const TOP_NEXT = SHEET_NEXT + 12;
  (doc.internal as unknown as { events: { subscribe(e: string, fn: () => void): void } }).events.subscribe("addPage", () => drawDocShell(doc, SHEET_NEXT, docPhoto));
  if (brandLogo) {
    const w = 52;
    doc.addImage(brandLogo.dataUrl, 'PNG', 15, 22 - (w * brandLogo.height / brandLogo.width) / 2, w, w * brandLogo.height / brandLogo.width);
  }
  lay.text(m.title.toUpperCase(), logoRight, 25, titleW, titleStyle, 'right');
  lay.lines(contactLines, 15, 30.5, pageW - 30, contactStyle);
  lay.lines(metaLines, 15, metaY, pageW - 30, metaStyle);

  const flow = new PdfFlow(doc, SHEET + 12, TOP_NEXT, bottom);
  /** Lines of one block, kept together when short; long paragraphs flow a line at a time. */
  const put = (text: string, style: TextStyle, x: number, width: number, gapBefore: number, keepWithNext = 0): number => {
    const lines = lay.wrap(text, width, style);
    if (!lines.length) return flow.y;
    flow.y += gapBefore;
    flow.ensure(lay.lineHeight(style) * Math.min(lines.length, 3) + keepWithNext);
    const firstBaseline = flow.y;
    for (const line of lines) {
      flow.ensure(lay.lineHeight(style));
      flow.y = lay.lines([line], x, flow.y, width, style);
    }
    return firstBaseline;
  };

  // The clauses: the first line is the heading of the agreement
  const headStyle = st(12, true, INK, 1.3);
  const clauseStyle = st(10.5, true, INK, 1.35);
  const paraStyle = st(9.2, false, INK, 1.5);
  const lines = m.body.replace(/\r/g, '').split('\n');
  let first = true;
  let gap = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { gap = 2.2; continue; }
    if (first) { put(line.trim(), headStyle, L, W, 0, 10); first = false; gap = 0; continue; }
    if (line.startsWith('# ')) { put(line.slice(2).trim(), clauseStyle, L, W, 5, 12); gap = 0; continue; }
    if (/^\s*-\s+/.test(line)) {
      const text = line.replace(/^\s*-\s+/, '');
      const baseline = put(text, paraStyle, L + 6, W - 6, gap + 0.6);
      // The dot on the first line of the bullet (bullets are short: one block on one page)
      doc.setFillColor(...INK);
      doc.circle(L + 2.2, baseline - lay.ascent(paraStyle) * 0.35, 0.55, 'F');
      gap = 0;
      continue;
    }
    put(line.trim(), paraStyle, L, W, gap + 1);
    gap = 0;
  }

  // Schedule A
  put(m.schedule.title, clauseStyle, L, W, 8, 30);
  flow.y += 2;
  autoTable(doc, {
    startY: flow.y,
    margin: { left: L, right: pageW - R, top: TOP_NEXT, bottom: pageH - bottom },
    theme: 'plain',
    rowPageBreak: TABLE_RULES.rowPageBreak,
    showHead: TABLE_RULES.showHead,
    head: [m.schedule.head.map((h) => h.toUpperCase())],
    body: m.schedule.rows,
    styles: { font: FONT, fontSize: 9, textColor: INK, cellPadding: { top: 2.4, bottom: 2.4, left: 0, right: 1.5 }, overflow: TABLE_RULES.overflow },
    headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7, textColor: MUTED },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 26, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (data) => { if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'; },
    didDrawCell: (data) => {
      doc.setLineWidth(data.section === 'head' ? 0.3 : 0.15);
      doc.setDrawColor(...(data.section === 'head' ? INK : MIST));
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });
  flow.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const totalsX = R - 90;
  for (const [i, [name, value]] of m.schedule.totals.entries()) {
    const strong = i === 2;
    const style = st(strong ? 10 : 9, strong, strong ? INK : MUTED);
    // The value is set in bold: measured in bold, so it keeps to one line
    doc.setFont(FONT, 'bold');
    doc.setFontSize(style.size);
    const vw = Math.min(doc.getTextWidth(value) + 0.5, 60);
    const cells = [
      { x: totalsX, width: 90 - vw - 4, text: name, style },
      { x: R - vw, width: vw, text: value, style: st(style.size, true, INK), align: 'right' as const },
    ];
    flow.ensure(lay.rowHeight(cells) + 2);
    flow.y = lay.row(cells, flow.y + 3) - lay.lineHeight(style) + 2.5;
  }

  // What is made: for each product its pack, packaging and serving, then the composition per serving
  if (m.spec.products.length) {
    put(m.spec.title, clauseStyle, L, W, 10, 30);
    const nameStyle = st(10, true, INK, 1.35);
    const factLabel = st(8.5, false, MUTED, 1.45);
    const factValue = st(9, false, INK, 1.45);
    const labelW = 48;
    for (const p of m.spec.products) {
      put(p.name, nameStyle, L, W, 5, 24);
      flow.y += 1;
      for (const [label, value] of p.facts) {
        const cells = [{ x: L, width: labelW - 3, text: label, style: factLabel }, { x: L + labelW, width: W - labelW, text: value, style: factValue }];
        flow.ensure(lay.rowHeight(cells));
        flow.y = lay.row(cells, flow.y + 1.2);
      }
      if (p.composition.length) {
        flow.y += 3;
        flow.ensure(28);
        autoTable(doc, {
          startY: flow.y,
          margin: { left: L, right: pageW - R, top: TOP_NEXT, bottom: pageH - bottom },
          theme: 'plain',
          rowPageBreak: TABLE_RULES.rowPageBreak,
          showHead: TABLE_RULES.showHead,
          head: [[p.compositionTitle.toUpperCase(), '']],
          body: p.composition,
          styles: { font: FONT, fontSize: 8.6, textColor: INK, cellPadding: { top: 1.5, bottom: 1.5, left: 0, right: 1.5 }, overflow: TABLE_RULES.overflow },
          headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7, textColor: MUTED },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 40, halign: 'right' } },
          didDrawCell: (data) => {
            doc.setLineWidth(data.section === 'head' ? 0.3 : 0.15);
            doc.setDrawColor(...(data.section === 'head' ? INK : MIST));
            doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
          },
        });
        flow.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      }
    }
  }

  // Accepted on the link: a green note before the signatures
  if (m.stamp) {
    const stampStyle = st(8.5, true, GREEN, 1.45);
    const text = lay.wrap(m.stamp, W - 8, stampStyle);
    const h = text.length * lay.lineHeight(stampStyle) + 6;
    flow.y += 6;
    flow.ensure(h + 2);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.4);
    doc.roundedRect(L, flow.y, W, h, 1, 1, 'S');
    lay.lines(text, L + 4, flow.y + 3 + lay.ascent(stampStyle), W - 8, stampStyle);
    flow.y += h;
  }

  // The lines to sign: both parties, kept together
  const colW = (W - 10) / 2;
  const signHead = st(9, true, INK);
  const signSmall = st(8, false, MUTED);
  const signH = 30;
  flow.y += 8;
  flow.ensure(signH);
  m.sign.forEach((heading, i) => {
    const x = L + i * (colW + 10);
    let y = lay.text(heading, x, flow.y, colW, signHead);
    y = lay.text(m.signNames[i], x, y, colW, st(8.5, false, INK));
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.25);
    doc.line(x, y + 9, x + colW, y + 9);
    lay.text(m.nameLine, x, y + 13.5, colW, signSmall);
  });

  footStrip(lay, { left: m.base, center: 'nutrikal.com', right: (i, n) => m.pageOf.replace('{i}', String(i)).replace('{n}', String(n)) },
    { x: 15, width: pageW - 30, bottom: 284, padX: L - 15, minHeight: 9, fill: CANVAS, style: st(7, false, MUTED), draw: true });
  return doc;
}

export async function downloadContractPdf(model: ContractPdfModel): Promise<void> {
  (await buildContractPdf(model)).save(model.fileName);
}

export async function contractPdfBase64(model: ContractPdfModel): Promise<{ base64: string; fileName: string }> {
  const doc = await buildContractPdf(model);
  return { base64: doc.output('datauristring').split(',')[1], fileName: model.fileName };
}
