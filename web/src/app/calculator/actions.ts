"use server";

import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { getSession } from "@/lib/session";
import { toOffer } from "@/lib/calculator/db";
import { extractSheetId } from "@/lib/calculator/materialImport";
import { catalogSyncDue, runCatalogSync, runSync, syncDue } from "@/lib/calculator/sync";
import type { CatalogSyncRun, OfferInput, OfferRecord, RawMaterial, Settings, SyncRun } from "@/lib/calculator/types";

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
       returning id, name, price_eur_per_kg, regulatory_note, active, updated_at::text`,
      [id, note?.trim() || null],
    );
    if (!rows[0]) throw new Error("Not allowed");
    return { ...rows[0], price_eur_per_kg: Number(rows[0].price_eur_per_kg) };
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}

// ----------------------------------------------- Google Sheet price sync
export async function syncPriceList(): Promise<CalcResult<SyncRun>> {
  const { t } = await getSession();
  const res = await run((uid) => runSync(uid, "manual", t.calc.sync));
  revalidatePath("/calculator", "layout");
  return res;
}

/**
 * Called when the calculator opens: catches up the price list and the catalog when their daily
 * 17:00 sync has not run yet (retried hourly after a failure). True when either synced successfully.
 */
export async function syncIfStale(): Promise<CalcResult<boolean>> {
  const { t } = await getSession();
  const res = await run(async (uid) => {
    const prices = (await syncDue(uid)) ? await runSync(uid, "auto", t.calc.sync) : null;
    const catalog = (await catalogSyncDue(uid)) ? await runCatalogSync(uid, "auto", t.calc.sync) : null;
    return prices?.status === "success" || catalog?.status === "success";
  });
  if (res.ok && res.data) revalidatePath("/calculator", "layout");
  return res;
}

// ------------------------------------------------- catalog sheet sync
export async function syncCatalog(): Promise<CalcResult<CatalogSyncRun>> {
  const { t } = await getSession();
  const res = await run((uid) => runCatalogSync(uid, "manual", t.calc.sync));
  revalidatePath("/calculator", "layout");
  return res;
}

/** Admin: the catalog Google Sheet link (when it is not set on the server). */
export async function saveCatalogSheetUrl(url: string): Promise<CalcResult<boolean>> {
  const res = await run(async (uid) => {
    if (!extractSheetId(url)) throw new Error("Invalid link");
    const rows = await q<{ id: boolean }>(uid, "update calc_settings set catalog_sheet_url = $1 returning id", [url.trim()]);
    if (!rows.length) throw new Error("Not allowed");
    return true;
  });
  if (res.ok) revalidatePath("/calculator", "layout");
  return res;
}
