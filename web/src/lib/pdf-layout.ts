import type { jsPDF } from 'jspdf';

// One place for measuring and wrapping text in every generated PDF (offer, proforma, invoice, credit and
// debit notes, purchase order, delivery note). Rules (owner, Nov 2026):
// - every text has a column (x and width); a line that does not fit wraps below it, at the same x;
// - words wrap whole; a word is split only when it alone is wider than its column (e-mail, URL, IBAN);
// - nothing is cut off, shortened with "…" or set smaller to fit; blocks grow with their text;
// - a block that does not fit goes to the next page as a whole; tables repeat their head on every page.
// y is always the baseline of the first line; the functions return the baseline the next line would take.

export type Rgb = [number, number, number];
export type Weight = 'regular' | 'semibold' | 'bold';
export type Align = 'left' | 'center' | 'right';
/** Font family and style for a text: lets the offer fall back to Roboto for Cyrillic. */
export type FontFor = (weight: Weight, text: string) => [string, string];

export interface TextStyle {
  size: number;
  weight?: Weight;
  color?: Rgb;
  /** Line height as a factor of the font size (default 1.35). */
  leading?: number;
  /** Extra space between letters, in mm. */
  spacing?: number;
}

export interface Cell {
  x: number;
  width: number;
  text: string | string[];
  style: TextStyle;
  align?: Align;
}

const PT = 0.3528; // mm per point

export class PdfLayout {
  constructor(readonly doc: jsPDF, readonly fontFor: FontFor) {}

  /** The distance between two baselines, in mm. */
  lineHeight(style: TextStyle): number {
    return style.size * PT * (style.leading ?? 1.35);
  }

  private use(style: TextStyle, text: string) {
    this.doc.setFont(...this.fontFor(style.weight ?? 'regular', text));
    this.doc.setFontSize(style.size);
    this.doc.setCharSpace(style.spacing ?? 0);
  }

  private width(text: string, style: TextStyle): number {
    return this.doc.getTextWidth(text) + (style.spacing ?? 0) * text.length;
  }

  /** Lines of the text within the width: whole words, a word wider than the column split by letters. */
  wrap(text: string | string[], width: number, style: TextStyle): string[] {
    const paragraphs = (Array.isArray(text) ? text : [text]).flatMap((t) => String(t ?? '').split('\n'));
    const out: string[] = [];
    for (const paragraph of paragraphs) {
      const clean = paragraph.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      this.use(style, clean);
      let line = '';
      for (const word of clean.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.width(candidate, style) <= width) {
          line = candidate;
          continue;
        }
        if (line) out.push(line);
        line = '';
        if (this.width(word, style) <= width) {
          line = word;
          continue;
        }
        // A word wider than the column: split it by letters
        let part = '';
        for (const ch of Array.from(word)) {
          if (part && this.width(part + ch, style) > width) {
            out.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      }
      if (line) out.push(line);
    }
    this.doc.setCharSpace(0);
    return out;
  }

  /** Height of the text wrapped in the width (number of lines × line height). */
  height(text: string | string[], width: number, style: TextStyle): number {
    return this.wrap(text, width, style).length * this.lineHeight(style);
  }

  /** Draws lines already wrapped; returns the baseline below the last one. */
  lines(lines: string[], x: number, y: number, width: number, style: TextStyle, align: Align = 'left'): number {
    const lh = this.lineHeight(style);
    const at = align === 'left' ? x : align === 'right' ? x + width : x + width / 2;
    for (const line of lines) {
      this.use(style, line);
      this.doc.setTextColor(...(style.color ?? [34, 40, 49]));
      this.doc.text(line, at, y, { align });
      y += lh;
    }
    this.doc.setCharSpace(0);
    return y;
  }

  /** Wraps the text in its column and draws it; returns the baseline below the last line. */
  text(text: string | string[], x: number, y: number, width: number, style: TextStyle, align: Align = 'left'): number {
    return this.lines(this.wrap(text, width, style), x, y, width, style, align);
  }

  /** Height of a row of cells: the tallest cell. */
  rowHeight(cells: Cell[]): number {
    return Math.max(0, ...cells.map((c) => this.height(c.text, c.width, c.style)));
  }

  /** A row of cells side by side, each in its own column; returns the baseline below the tallest one. */
  row(cells: Cell[], y: number): number {
    let bottom = y;
    for (const c of cells) bottom = Math.max(bottom, this.text(c.text, c.x, y, c.width, c.style, c.align));
    return bottom;
  }

  /** Shift from the top of a box to the baseline of its first line. */
  ascent(style: TextStyle): number {
    return style.size * PT * 0.78;
  }
}

/** Running y over pages: a block that does not fit before `bottom` starts on a new page at `top`. */
export class PdfFlow {
  y: number;
  constructor(readonly doc: jsPDF, start: number, readonly top: number, readonly bottom: number) {
    this.y = start;
  }

  /** Room for a block of this height; otherwise a new page. Returns true when a page was added. */
  ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.doc.addPage();
    this.y = this.top;
    return true;
  }
}

/** Options every table shares: wrapped cells, rows never split over two pages, the head repeated on each page. */
export const TABLE_RULES = {
  rowPageBreak: 'avoid' as const,
  showHead: 'everyPage' as const,
  overflow: 'linebreak' as const,
};

/**
 * The strip at the foot of every page: three columns (left, centre, right) that wrap inside their width;
 * the strip grows upwards with the longest one. Returns the top of the strip, the lowest the body may reach.
 */
export function footStrip(
  layout: PdfLayout,
  parts: { left: string; center: string; right: (page: number, pages: number) => string },
  o: { x: number; width: number; bottom: number; padX: number; minHeight: number; fill: Rgb; style: TextStyle; draw: boolean },
): number {
  const { doc } = layout;
  const inner = o.width - 2 * o.padX;
  const gap = 4;
  const leftW = inner * 0.5 - gap;
  const centerW = inner * 0.3 - gap;
  const rightW = inner * 0.2;
  const cols = (page: number, pages: number): Cell[] => [
    { x: o.x + o.padX, width: leftW, text: parts.left, style: o.style },
    { x: o.x + o.padX + leftW + gap, width: centerW, text: parts.center, style: o.style, align: 'center' },
    { x: o.x + o.width - o.padX - rightW, width: rightW, text: parts.right(page, pages), style: o.style, align: 'right' },
  ];
  const pages = doc.getNumberOfPages();
  // The same height on every page (the widest page number), so the body limit holds everywhere
  const height = Math.max(o.minHeight, layout.rowHeight(cols(pages, pages)) + 3.6);
  const top = o.bottom - height;
  if (!o.draw) return top;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...o.fill);
    doc.rect(o.x, top, o.width, height, 'F');
    const cells = cols(i, pages);
    const textH = layout.rowHeight(cells);
    layout.row(cells, top + (height - textH) / 2 + layout.ascent(o.style));
  }
  return top;
}
