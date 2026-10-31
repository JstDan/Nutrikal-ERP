import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadAssets, loadImage } from '@/lib/calculator/pdf';

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
  const [{ fonts, brandLogo }, customLogo] = await Promise.all([loadAssets(), loadImage(m.logoDataUrl)]);
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
  const L = 16;
  const R = pageW - 16;
  const write = (text: string, x: number, y: number, o: { bold?: boolean; size?: number; color?: [number, number, number]; align?: 'left' | 'right'; spacing?: number } = {}) => {
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

  // Band: wordmark (or uploaded logo on a white plate) and the title
  doc.setFillColor(...INK);
  doc.rect(0, 0, pageW, 28, 'F');
  if (customLogo) {
    const ratio = Math.min(46 / customLogo.width, 13 / customLogo.height);
    const w = customLogo.width * ratio;
    const h = customLogo.height * ratio;
    doc.setFillColor(...WHITE);
    doc.rect(L - 2, 14 - h / 2 - 1.5, w + 4, h + 3, 'F');
    doc.addImage(customLogo.dataUrl, customLogo.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', L, 14 - h / 2, w, h);
  } else if (brandLogo) {
    const w = 52;
    doc.addImage(brandLogo.dataUrl, 'PNG', L, 14 - (w * brandLogo.height / brandLogo.width) / 2, w, w * brandLogo.height / brandLogo.width);
  }
  write(m.title.toUpperCase(), R, 16.5, { size: 17, color: WHITE, align: 'right', spacing: 0.9 });

  // Number and dates on a light strip: each item at its full width, a new row when the page is full
  let y = 28;
  if (m.meta.length) {
    const items = m.meta.map((line) => {
      const at = line.indexOf(': ');
      const head = at > 0 ? line.slice(0, at) : '';
      const value = at > 0 ? line.slice(at + 2) : line;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8.5);
      const width = doc.getTextWidth(value);
      doc.setFontSize(7);
      // The labels are written with letter spacing
      return { head, value, width: Math.max(width, doc.getTextWidth(head.toUpperCase()) + head.length * 0.4 + 2) };
    });
    const rows: (typeof items)[] = [[]];
    let used = 0;
    for (const item of items) {
      if (used > 0 && used + item.width > R - L) {
        rows.push([]);
        used = 0;
      }
      rows[rows.length - 1].push(item);
      used += item.width + 9;
    }
    const rowH = 10.5;
    doc.setFillColor(...CANVAS);
    doc.rect(0, 28, pageW, rows.length * rowH + 4.5, 'F');
    rows.forEach((row, r) => {
      let x = L;
      const top = 33.5 + r * rowH;
      for (const item of row) {
        if (item.head) label(item.head, x, top);
        write(item.value, x, top + 5, { bold: true, size: 8.5 });
        x += item.width + 9;
      }
    });
    y = 28 + rows.length * rowH + 4.5;
  }

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
    margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
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
    if (y + h > pageH - 18) {
      doc.addPage();
      y = 18;
    }
  };

  // Totals (right); the amount due on an ink bar
  ensure(m.totals.length * 6 + 8);
  m.totals.forEach(([name, value], i) => {
    const last = i === m.totals.length - 1;
    if (last) {
      doc.setFillColor(...INK);
      doc.rect(R - 84, y - 1, 84, 9.5, 'F');
      write(name, R - 81, y + 5, { bold: true, size: 10.5, color: WHITE });
      write(value, R - 3, y + 5, { bold: true, size: 10.5, color: WHITE, align: 'right' });
      y += 13;
    } else {
      write(name, R - 81, y + 3, { size: 9, color: MUTED });
      write(value, R - 3, y + 3, { size: 9, align: 'right' });
      y += 5.5;
    }
  });
  if (m.vatNote) {
    ensure(8);
    y = block([m.vatNote], L, y + 1, R - L) + 1;
  }

  // Bank details (none on a purchase order or delivery note)
  if (m.bank.heading) {
    ensure(28);
    y += 4;
    label(m.bank.heading, L, y);
    y += 1;
    for (const line of m.bank.lines) {
      y += 4.6;
      write(line, L, y);
    }
    y += 4;
  }

  if (m.notes) {
    ensure(10);
    y = block(m.notes.split('\n'), L, y + 2, R - L);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...MIST);
    doc.setLineWidth(0.2);
    doc.line(L, pageH - 14, R, pageH - 14);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(m.footer, R - L - (pages > 1 ? 16 : 0)) as string[];
    lines.forEach((line, j) => write(line, L, pageH - 10 + j * 3.4, { size: 7.5, color: MUTED }));
    if (pages > 1) write(`${i} / ${pages}`, R, pageH - 10, { size: 7.5, color: MUTED, align: 'right' });
  }

  return doc;
}

export async function downloadProformaPdf(model: ProformaPdfModel): Promise<void> {
  (await buildProformaPdf(model)).save(model.fileName);
}

export async function proformaPdfBase64(model: ProformaPdfModel): Promise<{ base64: string; fileName: string }> {
  const doc = await buildProformaPdf(model);
  return { base64: doc.output('datauristring').split(',')[1], fileName: model.fileName };
}
