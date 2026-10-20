// Price-list sync logic shared by the web app (demo-mode sync) and the sync-raw-materials Edge Function.
// Keep this file free of imports so it runs in both Vite and Deno.

export interface ExistingMaterial {
  name: string;
  price_eur_per_kg: number;
  /** Missing means active (e.g. rows from an older select). */
  active?: boolean;
}

export interface ImportPreview {
  added: { name: string; price: number }[];
  changed: { name: string; oldPrice: number; newPrice: number }[];
  unchanged: string[];
  invalid: { row: number; reason: string }[];
  /** Existing materials that are not in the imported file. */
  missing: string[];
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Parse a price cell: numbers as-is, strings like "14,7", "€14.70" or "14.70 EUR". */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/€|eur/gi, '').replace(/\s/g, '').replace(',', '.');
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

/** Find the "Raw Material" and "Price DDP/EUR/kg" columns, tolerating case/spacing differences. */
function findColumns(headers: string[]): { name: string; price: string } | null {
  const name = headers.find((h) => normalize(h) === 'rawmaterial');
  const price =
    headers.find((h) => normalize(h) === 'priceddpeurkg') ?? headers.find((h) => normalize(h).startsWith('price'));
  return name && price ? { name, price } : null;
}

/**
 * Compare imported rows (as produced by SheetJS sheet_to_json) with the current materials.
 * Names are matched case-insensitively; matched rows keep the existing spelling so the upsert hits them.
 * Returns null when the required columns are missing.
 */
export function buildImportPreview(
  rows: Record<string, unknown>[],
  materials: ExistingMaterial[],
): ImportPreview | null {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cols = findColumns(headers);
  if (!cols) return null;

  const existing = new Map(materials.map((m) => [m.name.trim().toLowerCase(), m]));
  const seen = new Map<string, { name: string; price: number }>();
  const invalid: ImportPreview['invalid'] = [];

  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const name = String(r[cols.name] ?? '').trim();
    const rawPrice = r[cols.price];
    if (!name && (rawPrice === null || rawPrice === undefined || rawPrice === '')) return; // blank line
    const price = parsePrice(rawPrice);
    if (!name) return invalid.push({ row: rowNo, reason: 'missing name' });
    if (price === null || price < 0)
      return invalid.push({ row: rowNo, reason: `${name}: invalid price "${String(rawPrice ?? '')}"` });
    seen.set(name.toLowerCase(), { name, price });
  });

  const preview: ImportPreview = { added: [], changed: [], unchanged: [], invalid, missing: [] };
  for (const [key, item] of seen) {
    const match = existing.get(key);
    if (!match) preview.added.push(item);
    else if (Math.abs(Number(match.price_eur_per_kg) - item.price) > 1e-9)
      preview.changed.push({ name: match.name, oldPrice: Number(match.price_eur_per_kg), newPrice: item.price });
    else preview.unchanged.push(match.name);
  }
  preview.missing = materials.filter((m) => !seen.has(m.name.trim().toLowerCase())).map((m) => m.name);
  return preview;
}


/** Extract the Drive/Sheets file id from a share link (or accept a bare id). */
export function extractSheetId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  const m = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(s) ?? /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}

/** Download path (relative to https://docs.google.com) that exports native Sheets and uploaded .xlsx alike. */
export function sheetExportPath(fileId: string): string {
  return `/spreadsheets/d/${fileId}/export?format=xlsx`;
}

export interface SyncPlan {
  /** Rows to upsert by name; everything in the sheet ends up active. */
  upserts: { name: string; price_eur_per_kg: number; active: true }[];
  /** Active materials no longer in the sheet – deactivated (hidden from the calculator, never deleted). */
  deactivate: string[];
  /** Inactive materials that are back in the sheet. */
  reactivate: string[];
}

/**
 * Turn a preview into a sheet -> database sync plan. The sheet is the source of truth for which
 * materials are active. Throws when the sheet has no valid rows, so a broken or emptied sheet can
 * never deactivate the whole price list.
 */
export function buildSyncPlan(p: ImportPreview, materials: ExistingMaterial[]): SyncPlan {
  if (!p.added.length && !p.changed.length && !p.unchanged.length) {
    throw new Error('The sheet has no valid raw material rows – nothing was changed');
  }
  const byName = new Map(materials.map((m) => [m.name, m]));
  const inactive = (name: string) => byName.get(name)?.active === false;
  const reactivate = [...p.changed.map((c) => c.name), ...p.unchanged].filter(inactive);
  return {
    upserts: [
      ...p.added.map((a) => ({ name: a.name, price_eur_per_kg: a.price, active: true as const })),
      ...p.changed.map((c) => ({ name: c.name, price_eur_per_kg: c.newPrice, active: true as const })),
      ...p.unchanged
        .filter(inactive)
        .map((name) => ({ name, price_eur_per_kg: Number(byName.get(name)!.price_eur_per_kg), active: true as const })),
    ],
    deactivate: p.missing.filter((name) => !inactive(name)),
    reactivate,
  };
}
