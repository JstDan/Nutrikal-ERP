// The texts the system itself writes on an invoice (advance lines, transport, the reason for 0 % VAT) are stored
// in the language the invoice was made in. A copy downloaded in the other language shows them in that language
// (owner, Nov 2026). Text a person wrote stays as written.
import { getDict } from "@/lib/i18n";

type L = "bg" | "en";

/** Lines written by create_order_invoice: [Bulgarian, English], the same captures in both. */
const LINES: [RegExp, RegExp, (m: string[], l: L) => string][] = [
  [/^Авансово плащане (\S+)% по поръчка (.+)$/, /^Advance payment (\S+)% for order (.+)$/,
    (m, l) => (l === "bg" ? `Авансово плащане ${m[1]}% по поръчка ${m[2]}` : `Advance payment ${m[1]}% for order ${m[2]}`)],
  [/^Авансово плащане по поръчка (.+)$/, /^Advance payment for order (.+)$/,
    (m, l) => (l === "bg" ? `Авансово плащане по поръчка ${m[1]}` : `Advance payment for order ${m[1]}`)],
  [/^Приспадане на аванс по фактура № (\S+) от (\S+)$/, /^Less advance invoiced, invoice No (\S+) of (\S+)$/,
    (m, l) => (l === "bg" ? `Приспадане на аванс по фактура № ${m[1]} от ${m[2]}` : `Less advance invoiced, invoice No ${m[1]} of ${m[2]}`)],
  [/^Транспорт$/, /^Transport$/, (_, l) => (l === "bg" ? "Транспорт" : "Transport")],
];

/** A line description in the language of the copy. */
export function lineIn(text: string, l: L): string {
  const t = text.trim();
  for (const [bg, en, out] of LINES) {
    const m = t.match(bg) ?? t.match(en);
    if (m) return out(m, l);
  }
  return text;
}

/** The reasons offered before November 2026, still on older invoices: [Bulgarian, English]. */
const OLD_BASES: [string, string][] = [
  ["Обратно начисляване: мястото на изпълнение е извън страната, чл. 21, ал. 2 от ЗДДС (чл. 44 и 196 от Директива 2006/112/ЕО).",
    "Reverse charge: place of supply outside Bulgaria, Art. 21(2) of the Bulgarian VAT Act (Art. 44 and 196 of Directive 2006/112/EC)."],
  ["Вътреобщностна доставка на стоки, чл. 7 от ЗДДС (чл. 138 от Директива 2006/112/ЕО).",
    "Intra-Community supply of goods, Art. 7 of the Bulgarian VAT Act (Art. 138 of Directive 2006/112/EC)."],
  ["Износ извън ЕС, чл. 28 от ЗДДС (чл. 146 от Директива 2006/112/ЕО).",
    "Export outside the EU, Art. 28 of the Bulgarian VAT Act (Art. 146 of Directive 2006/112/EC)."],
];

/** The reason for 0 % VAT in the language of the copy, when it is one of the list; own text as written. */
export function vatBasisIn(text: string, l: L): string {
  const t = text.trim();
  const bg = getDict("bg").invoices.direct.vatBases;
  const en = getDict("en").invoices.direct.vatBases;
  const i = bg.findIndex((b) => b.text === t) >= 0 ? bg.findIndex((b) => b.text === t) : en.findIndex((b) => b.text === t);
  if (i >= 0) return (l === "bg" ? bg : en)[i].text;
  const old = OLD_BASES.find((p) => p[0] === t || p[1] === t);
  if (old) return l === "bg" ? old[0] : old[1];
  return text;
}
