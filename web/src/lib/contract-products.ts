// Schedule A names what is made: for each row the pack, the packaging and the composition per serving, in the
// contract's language, kept in the row (set_contract_products). From the calculator offer of the order line (or
// of its recipe) exactly as on the offer document; a recipe without an offer gives its own format, serving and
// ingredients. No prices or costs go there.
import { q } from "@/lib/db/engine";
import { formatNumber, getDict } from "@/lib/i18n";
import { loadOffer, loadSettings } from "@/lib/calculator/db";
import { fromOfferRecord } from "@/lib/calculator/offerRecord";
import { offerProduct } from "@/lib/calculator/offer-product";
import { OFFER_TEXT } from "@/lib/calculator/offer-text";
import type { Settings } from "@/lib/calculator/types";
import type { ContractProduct } from "@/lib/contract-model";

type Row = { line_id?: string; offer_id?: string | null; product?: ContractProduct | null };
type Line = {
  id: string; offer: string | null; version: string | null;
  format: string | null; serving_size: number | null; serving_unit: string | null; servings: number | null;
};

/** True when some row has not been looked at yet (a contract made before the details existed). */
export const needsProducts = (rows: Row[]) => rows.some((r) => !("product" in r));

async function fromOffer(userId: string, id: string, settings: Settings, locale: "bg" | "en"): Promise<ContractProduct | null> {
  const record = await loadOffer(userId, id);
  if (!record) return null;
  const { form, result } = fromOfferRecord(record, settings);
  const p = offerProduct(form, result, locale, { composition: "always" });
  return { pack: p.pack, format: p.format, portion: p.dosePortion, composition: p.doseRows };
}

async function fromRecipe(userId: string, line: Line, locale: "bg" | "en"): Promise<ContractProduct | null> {
  if (!line.version || !line.format) return null;
  const E = getDict(locale).enums.productFormat as Record<string, string>;
  const formatName = E[line.format] ?? line.format;
  const size = Number(line.serving_size ?? 0);
  const unit = line.serving_unit === "pcs" ? formatName.toLowerCase() : line.serving_unit ?? "";
  const n = (x: number) => formatNumber(locale, x);
  const servings = Number(line.servings ?? 0);
  const ingredients = await q<{ name: string; name_bg: string | null; amount: number; unit: string }>(userId,
    `select i.name, i.name_bg, fl.amount::float as amount, fl.unit::text as unit
       from formula_lines fl join items i on i.id = fl.item_id where fl.version_id = $1 order by fl.sort_order, i.name`, [line.version]);
  return {
    pack: servings && size ? `${n(size * servings)} ${unit}, ${n(servings)} ${OFFER_TEXT[locale].servings}` : "",
    format: formatName,
    portion: size ? `${n(size)} ${unit}` : "",
    composition: ingredients.map((x) => ({ name: (locale === "bg" && x.name_bg) || x.name, amount: `${n(Number(x.amount))} ${x.unit}` })),
  };
}

export async function fillContractProducts(userId: string, contractId: string): Promise<void> {
  const [k] = await q<{ order_id: string; locale: "bg" | "en"; status: string; schedule: { rows: Row[] } }>(userId,
    "select order_id, locale, status, schedule from order_contracts where id = $1", [contractId]);
  if (!k || k.status === "signed" || k.status === "cancelled") return;
  const rows = k.schedule.rows ?? [];
  const lines = await q<Line>(userId,
    `select l.id, coalesce(l.calc_offer_id, f.calc_offer_id) as offer, l.formula_version_id as version,
            f.product_format::text as format, f.serving_size::float as serving_size, f.serving_unit::text as serving_unit, f.servings_per_pack as servings
       from sales_order_lines l
       left join formula_versions v on v.id = l.formula_version_id
       left join formulas f on f.id = v.formula_id
      where l.order_id = $1 order by l.sort_order`, [k.order_id]);
  // Rows name their order line; rows made before that: the order lines in the same order
  const byId = new Map(lines.map((l) => [l.id, l]));
  const lineOf = (r: Row, i: number) => (r.line_id ? byId.get(r.line_id) : lines.length === rows.length ? lines[i] : undefined);
  const settings = await loadSettings(userId);
  const products = await Promise.all(rows.map(async (r, i): Promise<ContractProduct | null> => {
    const line = lineOf(r, i);
    const offer = r.offer_id ?? line?.offer ?? null;
    try {
      if (offer) return await fromOffer(userId, offer, settings, k.locale);
      return line ? await fromRecipe(userId, line, k.locale) : null;
    } catch (e) {
      console.error("[contract products] row", i, e);
      return null;
    }
  }));
  await q(userId, "select set_contract_products($1, $2::jsonb)", [contractId, JSON.stringify(products)]);
}
