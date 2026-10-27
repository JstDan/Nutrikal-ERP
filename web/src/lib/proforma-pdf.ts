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

const NAVY: [number, number, number] = [27, 31, 59];
const TEXT: [number, number, number] = [31, 35, 40];
const MUTED: [number, number, number] = [95, 100, 108];
const HEAD_BG: [number, number, number] = [229, 231, 233];

export async function downloadProformaPdf(model: ProformaPdfModel): Promise<void> {
  // Number formatting uses narrow/no-break spaces; the embedded font has plain spaces only.
  const m: ProformaPdfModel = JSON.parse(JSON.stringify(model).replace(/[   ]/g, ' '));
  const [{ fonts, brandLogo }, customLogo] = await Promise.all([loadAssets(), loadImage(m.logoDataUrl)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.robotoRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.robotoBold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const L = 14;
  const R = pageW - 14;
  const write = (text: string, x: number, y: number, o: { bold?: boolean; size?: number; color?: [number, number, number]; align?: 'left' | 'right' } = {}) => {
    doc.setFont('Roboto', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(...(o.color ?? TEXT));
    doc.text(text, x, y, { align: o.align ?? 'left' });
  };
  /** Wrapped lines; returns the y below the block. */
  const block = (lines: string[], x: number, y: number, width: number, first?: { bold: boolean }) => {
    lines.forEach((line, i) => {
      doc.setFont('Roboto', i === 0 && first?.bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      for (const part of doc.splitTextToSize(line, width) as string[]) {
        write(part, x, y, { bold: i === 0 && first?.bold, color: i === 0 ? TEXT : MUTED });
        y += 4.4;
      }
    });
    return y;
  };

  // Header: logo left, title and number right
  const logo = customLogo ?? brandLogo;
  if (logo) {
    const ratio = Math.min(55 / logo.width, 18 / logo.height);
    doc.addImage(logo.dataUrl, logo.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', L, 12, logo.width * ratio, logo.height * ratio);
  }
  write(m.title.toUpperCase(), R, 18, { bold: true, size: 18, color: NAVY, align: 'right' });
  m.meta.forEach((line, i) => write(line, R, 25 + i * 5, { size: 9.5, align: 'right' }));

  // Supplier / client
  let y = 44;
  const colW = (R - L - 8) / 2;
  write(m.seller.heading.toUpperCase(), L, y, { bold: true, size: 8, color: NAVY });
  write(m.buyer.heading.toUpperCase(), L + colW + 8, y, { bold: true, size: 8, color: NAVY });
  const y1 = block(m.seller.lines, L, y + 5, colW, { bold: true });
  const y2 = block(m.buyer.lines, L + colW + 8, y + 5, colW, { bold: true });
  y = Math.max(y1, y2) + 4;

  // Lines
  autoTable(doc, {
    startY: y,
    margin: { left: L, right: pageW - R, top: 15, bottom: 20 },
    theme: 'plain',
    head: [m.head],
    body: m.rows.map((r) => [r.note ? `${r.description}\n${r.note}` : r.description, r.quantity, r.unitPrice, r.amount]),
    styles: { font: 'Roboto', fontSize: 9, textColor: TEXT, cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 }, overflow: 'linebreak' },
    headStyles: { font: 'Roboto', fontStyle: 'bold', fontSize: 8.5, fillColor: HEAD_BG, textColor: NAVY },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 22, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 32, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right';
    },
    didDrawCell: (data) => {
      if (data.section === 'body') {
        doc.setDrawColor(210, 214, 220);
        doc.setLineWidth(0.2);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Totals (right)
  const ensure = (h: number) => {
    if (y + h > pageH - 18) {
      doc.addPage();
      y = 18;
    }
  };
  ensure(m.totals.length * 6 + 4);
  m.totals.forEach(([label, value], i) => {
    const last = i === m.totals.length - 1;
    if (last) {
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.3);
      doc.line(R - 80, y - 4, R, y - 4);
    }
    write(label, R - 80, y, { bold: last, size: last ? 11 : 9.5 });
    write(value, R, y, { bold: last, size: last ? 11 : 9.5, align: 'right' });
    y += last ? 7 : 5.5;
  });
  if (m.vatNote) {
    ensure(8);
    y = block([m.vatNote], L, y + 1, R - L) + 1;
  }

  // Bank details (none on a purchase order)
  if (m.bank.heading) {
    ensure(28);
    y += 3;
    write(m.bank.heading.toUpperCase(), L, y, { bold: true, size: 8, color: NAVY });
    for (const line of m.bank.lines) {
      y += 4.6;
      write(line, L, y);
    }
    y += 2;
  }

  if (m.notes) {
    ensure(10);
    y = block(['', ...m.notes.split('\n')], L, y, R - L);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(m.footer, R - L) as string[];
    lines.forEach((line, j) => write(line, (pageW - doc.getTextWidth(line)) / 2, pageH - 10 + j * 3.4, { size: 7.5, color: MUTED }));
  }

  doc.save(m.fileName);
}
