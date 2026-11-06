"use server";

import { revalidatePath } from "next/cache";
import { q, withUser } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { toOffer } from "@/lib/calculator/db";
import type { CatalogIngredient, CatalogTier, OfferInput, OfferRecord, RawMaterial, Settings } from "@/lib/calculator/types";

export type CalcResult<T> = { ok: true; data: T } | { ok: false; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

async function run<T>(fn: (userId: string) => Promise<T>): Promise<CalcResult<T>> {
  const { user } = await getSession();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// --------------------------------------------------------------- offers
export async function reserveOfferNo(): Promise<CalcResult<string>> {
  return run(async (uid) => (await q<{ no: string }>(uid, "select calc_next_offer_no() as no"))[0].no);
}

/** Whether a saved offer can still be changed: gone, or locked because it is in an order that is not cancelled. */
export async function offerState(id: string): Promise<CalcResult<"ok" | "missing" | "locked">> {
  return run(async (uid) => {
    const [row] = await q<{ locked: boolean }>(
      uid,
      `select exists (select 1 from sales_order_lines l join sales_orders so on so.id = l.order_id
                       where l.calc_offer_id = o.id and so.status <> 'cancelled') as locked
         from calc_offers o where o.id = $1`,
      [id],
    );
    return !row ? "missing" : row.locked ? "locked" : "ok";
  });
}

export async function saveOffer(input: OfferInput): Promise<CalcResult<OfferRecord>> {
  const res = await run(async (uid) => {
    const values = [
      input.offer_no, input.receiver_name, input.receiver_email, input.company_name, input.product_name, input.product_type,
      input.total_excl_vat, input.total_incl_vat, JSON.stringify(input.data), JSON.stringify(input.results), input.client_id,
    ];
    const cols = `id, offer_no, receiver_name, receiver_email, client_id, company_name, product_name, product_type, total_excl_vat,
      total_incl_vat, data, results, created_by, created_at::text, updated_at::text`;
    const rows = input.id
      ? await q<OfferRecord>(
          uid,
          `update calc_offers set offer_no = $1, receiver_name = $2, receiver_email = $3, company_name = $4, product_name = $5,
             product_type = $6, total_excl_vat = $7, total_incl_vat = $8, data = $9::jsonb, results = $10::jsonb, client_id = $11
           where id = $12 returning ${cols}`,
          [...values, input.id],
        )
      : await q<OfferRecord>(
          uid,
          `insert into calc_offers (offer_no, receiver_name, receiver_email, company_name, product_name, product_type,
             total_excl_vat, total_incl_vat, data, results, client_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11) returning ${cols}`,
          values,
        );
    if (!rows[0]) throw new Error("Offer not found");
    return toOffer(rows[0]);
  });
  if (res.ok) revalidatePath("/offers", "layout");
  return res;
}

export async function deleteOffer(id: string): Promise<CalcResult<boolean>> {
  const res = await run(async (uid) => {
    const rows = await q<{ id: string }>(uid, "delete from calc_offers where id = $1 returning id", [id]);
    if (!rows.length) throw new Error("Not allowed or not found");
    return true;
  });
  if (res.ok) revalidatePath("/offers", "layout");
  return res;
}

// ------------------------------------------------------------- settings
export async function saveSettings(s: Settings): Promise<CalcResult<boolean>> {
  const res = await run(async (uid) => {
    const rows = await q<{ id: boolean }>(
      uid,
      `update calc_settings set fixed_cost_capsules_glass = $1, fixed_cost_capsules_plastic = $2, fixed_cost_powder = $3,
         default_markup = $4, default_vat_rate = $5, company_name = $6, company_id = $7, company_vat = $8, company_address = $9,
         company_email = $10, company_phone = $11, bank_iban = $12, bank_name = $13, bank_bic = $14, bank_address = $15,
         default_payment_terms = $16, vat_exemption_text = $17, footer_text = $18, websites = $19, service_presets = $20::jsonb,
         logo_data_url = $21, terms_text = $22, google_sheet_url = $23
       returning id`,
      [
        s.fixed_costs.capsules_glass, s.fixed_costs.capsules_plastic, s.fixed_costs.powder, s.default_markup, s.default_vat_rate,
        s.company_name, s.company_id, s.company_vat, s.company_address, s.company_email, s.company_phone, s.bank_iban, s.bank_name,
        s.bank_bic, s.bank_address, s.default_payment_terms, s.vat_exemption_text, s.footer_text, s.websites,
        JSON.stringify(s.service_presets), s.logo_data_url, s.terms_text, s.google_sheet_url,
      ],
    );
    if (!rows.length) throw new Error("Not allowed");
    return true;
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}

// -------------------------------------------------------- raw materials
export async function saveRegulatoryNote(id: string, note: string | null): Promise<CalcResult<RawMaterial>> {
  const res = await run(async (uid) => {
    const rows = await q<RawMaterial>(
      uid,
      `update calc_raw_materials set regulatory_note = $2 where id = $1
       returning id, name, price_eur_per_kg, regulatory_note, active, manual, updated_at::text`,
      [id, note?.trim() || null],
    );
    if (!rows[0]) throw new Error("Not allowed");
    return { ...rows[0], price_eur_per_kg: Number(rows[0].price_eur_per_kg) };
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}

/** Admin, sales: a raw material that is not in the price list, with its price per kg. */
export async function addRawMaterial(name: string, price: number): Promise<CalcResult<RawMaterial>> {
  const res = await run(async (uid) => {
    const rows = await withUser(uid, async (tx) => {
      const { id } = (await tx.query<{ id: string }>("select calc_add_raw_material($1, $2) as id", [name, price])).rows[0];
      return (await tx.query<RawMaterial>(
        "select id, name, price_eur_per_kg, regulatory_note, active, manual, updated_at::text from calc_raw_materials where id = $1",
        [id],
      )).rows;
    });
    if (!rows[0]) throw new Error("Not allowed");
    return { ...rows[0], price_eur_per_kg: Number(rows[0].price_eur_per_kg) };
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}

/** Admin: name, price per kg and status of a raw material (the price list lives in the database since Nov 2026). */
export async function updateRawMaterial(id: string, patch: { name: string; price: number; active: boolean }): Promise<CalcResult<RawMaterial>> {
  const { t } = await getSession();
  const res = await run(async (uid) => {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error(t.calc.formula.addNameRequired);
    if (!Number.isFinite(patch.price) || patch.price <= 0) throw new Error(t.calc.formula.addPriceInvalid);
    const rows = await q<RawMaterial>(
      uid,
      `update calc_raw_materials set name = $2, price_eur_per_kg = round($3::numeric, 4), active = $4 where id = $1
       returning id, name, price_eur_per_kg, regulatory_note, active, manual, updated_at::text`,
      [id, name, patch.price, patch.active],
    );
    if (!rows[0]) throw new Error("Not allowed");
    return { ...rows[0], price_eur_per_kg: Number(rows[0].price_eur_per_kg) };
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}

export type CatalogProductInput = {
  id?: string | null;
  code: string;
  name: string;
  category: string | null;
  tiers: CatalogTier[];
  sort_order: number;
  active: boolean;
  capsules_per_serving: number | null;
  capsules_per_container: number | null;
  serving_g: number | null;
  servings_per_container: number | null;
  composition: CatalogIngredient[] | null;
};

/** Admin: a new catalog product of the calculator, or changes to one. */
export async function saveCatalogProduct(p: CatalogProductInput): Promise<CalcResult<string>> {
  const { t } = await getSession();
  const res = await run(async (uid) => {
    const code = p.code.trim().toUpperCase(), name = p.name.trim();
    if (!code || !name) throw new Error(t.calc.catalogTab.errCodeName);
    const tiers = [...p.tiers].sort((a, b) => a.min_qty - b.min_qty);
    if (!tiers.length || tiers.some((x) => !(x.min_qty > 0) || !(x.price >= 0))) throw new Error(t.calc.catalogTab.errTiers);
    const values = [
      code, name, p.category?.trim() || null, JSON.stringify(tiers), Math.round(p.sort_order) || 0, p.active,
      p.capsules_per_serving, p.capsules_per_container, p.serving_g, p.servings_per_container,
      p.composition?.length ? JSON.stringify(p.composition) : null,
    ];
    const rows = p.id
      ? await q<{ id: string }>(uid,
          `update calc_catalog_products set code = $1, name = $2, category = $3, tiers = $4::jsonb, sort_order = $5, active = $6,
             capsules_per_serving = $7, capsules_per_container = $8, serving_g = $9, servings_per_container = $10, composition = $11::jsonb
           where id = $12 returning id`, [...values, p.id])
      : await q<{ id: string }>(uid,
          `insert into calc_catalog_products (code, name, category, tiers, sort_order, active, capsules_per_serving, capsules_per_container,
             serving_g, servings_per_container, composition)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb) returning id`, values);
    if (!rows[0]) throw new Error("Not allowed");
    return rows[0].id;
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}
