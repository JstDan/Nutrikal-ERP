import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawDocShell, loadAssets, loadImage } from '@/lib/calculator/pdf';

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
}

const INK: [number, number, number] = [34, 40, 49];
const MUTED: [number, number, number] = [74, 81, 96];
const WHITE: [number, number, number] = [255, 255, 255];
const CANVAS: [number, number, number] = [244, 245, 247];
const MIST: [number, number, number] = [235, 235, 235];
const CYRILLIC = /[Ѐ-ӿ]/;

async function buildProformaPdf(model: ProformaPdfModel): Promise<jsPDF> {
  // Number formatting uses narrow/no-break spaces; the embedded font has plain spaces only.
  const m: ProformaPdfModel = JSON.parse(JSON.stringify(model).replace(/[   ]/g, ' '));
  const [{ fonts, brandLogo, docPhoto }, customLogo] = await Promise.all([loadAssets(), loadImage(m.logoDataUrl)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  // Poppins like the site; it has no Cyrillic letters, so documents in Bulgarian use Roboto.
  const cyrillic = CYRILLIC.test(JSON.stringify({ ...m, logoDataUrl: null }));
  const FONT = cyrillic ? 'Roboto' : 'Poppins';
  doc.addFileToVFS(`${FONT}-Regular.ttf`, cyrillic ? fonts.robotoRegular : fonts.poppinsRegular);
  doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, cyrillic ? fonts.robotoBold : fonts.poppinsBold);
  doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = pageW - 25;
  const write = (text: string, x: number, y: number, o: { bold?: boolean; size?: number; color?: [number, number, number]; align?: 'left' | 'right' | 'center'; spacing?: number } = {}) => {
    doc.setFont(FONT, o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(...(o.color ?? INK));
    doc.setCharSpace(o.spacing ?? 0);
    doc.text(text, x, y, { align: o.align ?? 'left' });
    doc.setCharSpace(0);
  };
  const label = (text: string, x: number, y: number) => write(text.toUpperCase(), x, y, { bold: true, size: 7, color: MUTED, spacing: 0.4 });
  /** Wrapped lines; returns the y below the block. */
  const block = (lines: string[], x: number, y: number, width: number, first?: { bold: boolean }) => {
    lines.forEach((line, i) => {
      doc.setFont(FONT, i === 0 && first?.bold ? 'bold' : 'normal');
      doc.setFontSize(i === 0 && first?.bold ? 10 : 9);
      for (const part of doc.splitTextToSize(line, width) as string[]) {
        write(part, x, y, { bold: i === 0 && first?.bold, size: i === 0 && first?.bold ? 10 : 9, color: i === 0 ? INK : MUTED });
        y += 4.6;
      }
    });
    return y;
  };

  // Number and dates in rows on the dark top; the white sheet starts under them
  doc.setFontSize(8.5);
  const items = m.meta.map((line) => {
    const at = line.indexOf(': ');
    const head = at > 0 ? `${line.slice(0, at)}: ` : '';
    const value = at > 0 ? line.slice(at + 2) : line;
    doc.setFont(FONT, 'bold');
    const headW = doc.getTextWidth(head);
    doc.setFont(FONT, 'normal');
    return { head, value, headW, width: headW + doc.getTextWidth(value) };
  });
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const item of items) {
    if (used > 0 && used + item.width > pageW - 30) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(item);
    used += item.width + 10;
  }
  const SHEET = 44 + rows.length * 6;
  drawDocShell(doc, SHEET, docPhoto);
  rows.forEach((row, r) => {
    const free = pageW - 30 - row.reduce((sum, x) => sum + x.width, 0);
    const gap = row.length > 1 ? free / (row.length - 1) : 0;
    let x = 15;
    for (const item of row) {
      if (item.head) write(item.head, x, 42 + r * 6, { bold: true, size: 8.5, color: WHITE });
      write(item.value, x + item.headW, 42 + r * 6, { size: 8.5, color: WHITE });
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
  write(m.title.toUpperCase(), pageW - 15, 25, { bold: true, size: 20, color: WHITE, align: 'right' });
  (m.contact ?? []).forEach((line, i) => write(line, 15, 30.5 + i * 4, { size: 8, color: WHITE }));

  let y = SHEET + 2;

  // Supplier / client
  y += 9;
  const colW = (R - L - 10) / 2;
  label(m.seller.heading, L, y);
  label(m.buyer.heading, L + colW + 10, y);
  const y1 = block(m.seller.lines, L, y + 5, colW, { bold: true });
  const y2 = block(m.buyer.lines, L + colW + 10, y + 5, colW, { bold: true });
  y = Math.max(y1, y2) + 5;

  // Lines: hairlines only
  autoTable(doc, {
    startY: y,
    margin: { left: L, right: pageW - R, top: 18, bottom: 26 },
    theme: 'plain',
    head: [m.head.map((h) => h.toUpperCase())],
    body: m.rows.map((r) => [r.note ? `${r.description}\n${r.note}` : r.description, r.quantity, r.unitPrice, r.amount]),
    styles: { font: FONT, fontSize: 9, textColor: INK, cellPadding: { top: 2.4, bottom: 2.4, left: 0, right: 1 }, overflow: 'linebreak' },
    headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7, textColor: MUTED },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 26, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' } },
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
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  const ensure = (h: number) => {
    if (y + h > pageH - 26) {
      doc.addPage();
      y = 18;
    }
  };

  // Totals (right); the amount due on an ink bar
  ensure(m.totals.length * 6 + 8);
  m.totals.forEach(([name, value], i) => {
    const last = i === m.totals.length - 1;
    if (last) {
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(R - 84, y, R, y);
      write(name, R - 84, y + 6, { bold: true, size: 11 });
      write(value, R, y + 6, { bold: true, size: 11, align: 'right' });
      y += 11;
    } else {
      write(name, R - 84, y + 3, { size: 9, color: MUTED });
      write(value, R, y + 3, { size: 9, align: 'right' });
      y += 5.5;
    }
  });
  if (m.vatNote) {
    ensure(8);
    y = block([m.vatNote], L, y + 1, R - L) + 1;
  }

  if (m.notes) {
    ensure(10);
    y = block(m.notes.split('\n'), L, y + 2, R - L);
  }

  // What closes the document stands at the foot of its last page, above the strip
  const STRIP = 9;
  const stripTop = 284 - STRIP;
  const hasBank = !!m.bank.heading;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  const closing = m.footer ? doc.splitTextToSize(m.footer, hasBank ? colW : R - L) as string[] : [];
  const closeH = Math.max(hasBank ? 6 + m.bank.lines.length * 4.6 : 0, closing.length * 4.2);
  const signH = m.sign ? 20 : 0;
  const footH = (closeH ? closeH + 7 : 0) + signH;
  if (y + footH + 4 > stripTop - 4) {
    doc.addPage();
    y = 18;
  }
  if (closeH) {
    const top = stripTop - 5 - footH;
    doc.setDrawColor(...MIST);
    doc.setLineWidth(0.15);
    doc.line(L, top, R, top);
    if (hasBank) {
      label(m.bank.heading, L, top + 6);
      m.bank.lines.forEach((line, i) => write(line, L, top + 11 + i * 4.6));
    }
    closing.forEach((line, i) => write(line, hasBank ? L + colW + 10 : L, top + (hasBank ? 6 : 5) + i * 4.2, { size: 8.5, color: MUTED }));
  }
  if (m.sign) {
    const line = stripTop - 11;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.25);
    m.sign.forEach((text, i) => {
      const x = L + i * (colW + 10);
      doc.line(x, line, x + colW, line);
      write(text, x, line + 4.5, { size: 8, color: MUTED });
    });
  }

  // The strip on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...CANVAS);
    doc.rect(15, stripTop, pageW - 30, STRIP, 'F');
    if (m.base) write(m.base, L, stripTop + 5.6, { size: 7, color: MUTED });
    write('nutrikal.com', pageW / 2 + 22, stripTop + 5.6, { size: 7, color: MUTED, align: 'center' });
    if (m.pageOf) write(m.pageOf.replace('{i}', String(i)).replace('{n}', String(pages)), R, stripTop + 5.6, { size: 7, color: MUTED, align: 'right' });
  }

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
