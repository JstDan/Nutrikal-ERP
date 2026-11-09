/**
 * A quantity typed by a person, in either language: "12,5", "12.5", "1 234,5", "1.234,5" or "1,234.5".
 * With both a comma and a point the last one is the decimal mark; a lone one is the decimal mark unless it is
 * followed by exactly three digits more than once ("1.234.567"). Null when it is not a number.
 */
export function parseQty(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).replace(/[\s  ']/g, "").replace("−", "-");
  if (!s) return null;
  const comma = s.lastIndexOf(","), point = s.lastIndexOf(".");
  if (comma >= 0 && point >= 0) {
    const dec = Math.max(comma, point);
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else if (comma >= 0 || point >= 0) {
    const mark = comma >= 0 ? "," : ".";
    const parts = s.split(mark);
    s = parts.length > 2 && parts.slice(1).every((p) => p.length === 3) ? parts.join("") : parts.join(".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
