"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, withUser } from "@/lib/db/engine";
import { ACT_AS_COOKIE, getOptionalSession, getSession, homeFor } from "@/lib/session";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, fmt, formatQty, getDict, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Role } from "@/lib/db/demo-users";
import { DELIVERY_LINES } from "@/lib/deliveries";
import { DELIVERY_BUCKET, MAX_FILE_BYTES, newDeliveryPath, putFile, removeFile } from "@/lib/files";
import type { Tx } from "@/lib/db/engine";
import { offerPriceOptions } from "@/lib/calculator/priceOptions";
import type { CalcResult } from "@/lib/calculator/calc";
import type { OfferForm } from "@/lib/calculator/types";

export type ActionState = { ok?: boolean; error?: string; message?: string };

const YEAR = 60 * 60 * 24 * 365;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(",", ".").replace("−", "-"));
  return Number.isFinite(n) ? n : null;
};
const errorText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

// ------------------------------------------------------------ preferences
export async function setLocale(fd: FormData) {
  const locale = fd.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  const s = await getOptionalSession(); // also used on the sign-in page
  if (s) await q(s.developer?.id ?? s.user.id, "select set_my_locale($1)", [locale]);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------- sign in / out
/** Email + password through Supabase Auth; then the user's start page. */
export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const jar = await cookies();
  const c = jar.get(LOCALE_COOKIE)?.value;
  const t = getDict(isLocale(c) ? c : DEFAULT_LOCALE);
  const email = str(fd, "email"), password = fd.get("password");
  if (!email || typeof password !== "string" || !password) return { error: t.login.failed };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: t.login.failed };

  const [profile] = await q<{ role: Role; is_active: boolean }>(data.user.id, "select role, is_active from profiles where id = auth.uid()");
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: t.login.noAccess };
  }
  jar.delete(LOCALE_COOKIE); // use the user's saved language
  jar.delete(ACT_AS_COOKIE);
  if (profile.role === "developer") {
    // a developer starts as the first user in the list; log it like any switch
    await q(data.user.id, "select start_impersonation(id) from impersonation_targets() limit 1");
  }
  redirect(homeFor(profile.role));
}

export async function signOut() {
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut();
  (await cookies()).delete(ACT_AS_COOKIE);
  redirect("/login");
}

/** Developer: act as another user (checked and logged in the database). */
export async function actAs(fd: FormData) {
  const { developer } = await getSession();
  const target = developer?.targets.find((x) => x.id === fd.get("user"));
  if (!developer || !target) return;
  await q(developer.id, "select start_impersonation($1)", [target.id]);
  (await cookies()).set(ACT_AS_COOKIE, target.id, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true });
  redirect(homeFor(target.role));
}

// -------------------------------------------------------------------- CRM
export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  // Only the contact person's names and email are required at first; the rest is filled in later.
  const contactName = str(fd, "contact_name");
  const contactEmail = str(fd, "contact_email");
  if (!contactName || !contactEmail) return { error: t.clients.form.contactRequired };
  let id: string;
  try {
    // The client and its contact person (who receives the offers) together
    id = await withUser(user.id, async (tx) => {
      const values = clientValues(fd);
      values[0] ??= contactName; // no company name yet: the contact person's names until it is filled in
      const [row] = (await tx.query<{ id: string }>(
        `insert into clients (legal_name, trade_name, status, country_code, vat_number, company_id, address_line1, city,
           postal_code, billing_email, phone, website, preferred_locale, deposit_pct, balance_terms, balance_net_days,
           credit_limit, notes, registration_address, owner_id)
         values ($1, $2, coalesce($3, 'lead')::client_status, upper(coalesce($4, 'BG')), $5, $6, $7, $8, $9, $10, $11, $12,
           coalesce($13, 'en')::app_locale, $14, $15::balance_terms, $16, $17, $18, $19, auth.uid())
         returning id`,
        values,
      )).rows;
      await tx.query(
        "insert into contacts (client_id, first_name, email, phone, is_primary) values ($1, $2, $3, $4, true)",
        [row.id, contactName, contactEmail, str(fd, "contact_phone")],
      );
      return row.id;
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

/** The client form fields ($1–$19), in the order of the insert above and the update below. */
const clientValues = (fd: FormData) => [
  str(fd, "legal_name"), str(fd, "trade_name"), str(fd, "status"), str(fd, "country_code"), str(fd, "vat_number"),
  str(fd, "company_id"), str(fd, "address_line1"), str(fd, "city"), str(fd, "postal_code"), str(fd, "billing_email"),
  str(fd, "phone"), str(fd, "website"), str(fd, "preferred_locale"), num(fd, "deposit_pct"), str(fd, "balance_terms"),
  num(fd, "balance_net_days"), num(fd, "credit_limit"), str(fd, "notes"), str(fd, "registration_address"),
];

export async function updateClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "client_id");
  try {
    const rows = await q<{ id: string }>(
      user.id,
      `update clients set legal_name = $1, trade_name = $2, status = coalesce($3, status::text)::client_status,
         country_code = upper(coalesce($4, country_code)), vat_number = $5, company_id = $6, address_line1 = $7, city = $8,
         postal_code = $9, billing_email = $10, phone = $11, website = $12, preferred_locale = coalesce($13, 'en')::app_locale,
         deposit_pct = $14, balance_terms = $15::balance_terms, balance_net_days = $16, credit_limit = $17, notes = $18,
         registration_address = $19
       where id = $20 returning id`,
      [...clientValues(fd), id],
    );
    if (!rows.length) return { error: t.clients.form.notSaved };
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { ok: true, message: t.common.saved };
}

export async function createProject(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const clientId = str(fd, "client_id");
  try {
    await q(
      user.id,
      `insert into projects (client_id, name, product_format, expected_units, target_date, nda_signed, description, owner_id)
       values ($1, $2, $3::product_format, $4, $5::date, $6, $7, auth.uid())`,
      [clientId, str(fd, "name"), str(fd, "product_format"), num(fd, "expected_units"), str(fd, "target_date"),
       fd.get("nda_signed") === "on", str(fd, "description")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/projects");
  redirect(`/clients/${clientId}`);
}

export async function setProjectStatus(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update projects set status = $2::project_status where id = $1", [str(fd, "project_id"), str(fd, "status")]);
  revalidatePath("/", "layout");
}

export async function addContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const clientId = str(fd, "client_id");
  if (!str(fd, "first_name") || !str(fd, "email")) return { error: t.clients.form.contactRequired };
  try {
    await q(
      user.id,
      `insert into contacts (client_id, first_name, last_name, position, email, phone, is_primary)
       values ($1, $2, $3, $4, $5, $6, not exists (select 1 from contacts where client_id = $1 and is_primary))`,
      [clientId, str(fd, "first_name"), str(fd, "last_name"), str(fd, "position"), str(fd, "email"), str(fd, "phone")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: t.common.saved };
}

export async function addActivity(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const clientId = str(fd, "client_id");
  try {
    await q(
      user.id,
      `insert into activities (client_id, project_id, type, subject, body, due_at, assigned_to)
       values ($1, $2, $3::activity_type, $4, $5, $6::timestamptz,
               case when $3 = 'task' then auth.uid() end)`,
      [clientId, str(fd, "project_id"), str(fd, "type") ?? "note", str(fd, "subject"), str(fd, "body"), str(fd, "due_at")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
  return { ok: true, message: t.common.saved };
}

export async function completeTask(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update activities set done_at = now() where id = $1 and done_at is null", [str(fd, "id")]);
  revalidatePath("/", "layout");
}

// ------------------------------------------------------------ formulation
export async function createFormula(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      `insert into formulas (name, name_bg, product_format, project_id, serving_size, serving_unit, servings_per_pack,
         shell_item_id, description)
       values ($1, $2, $3::product_format, $4, $5, coalesce($6, 'pcs')::serving_unit, $7, $8, $9)
       returning id`,
      [str(fd, "name"), str(fd, "name_bg"), str(fd, "product_format"), str(fd, "project_id"), num(fd, "serving_size"),
       str(fd, "serving_unit"), num(fd, "servings_per_pack"), str(fd, "shell_item_id"), str(fd, "description")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/formulas");
  redirect(`/formulas/${id}`);
}

export async function addFormulaLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      `insert into formula_lines (version_id, item_id, amount, unit, overage_pct, sort_order)
       values ($1, $2, $3, coalesce($4, 'mg')::dose_unit, coalesce($5, 0),
               (select coalesce(max(sort_order), 0) + 1 from formula_lines where version_id = $1))`,
      [str(fd, "version_id"), str(fd, "item_id"), num(fd, "amount"), str(fd, "unit"), num(fd, "overage_pct")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function saveFormulaLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      `update formula_lines set amount = $2, unit = coalesce($3, 'mg')::dose_unit, overage_pct = coalesce($4, 0) where id = $1`,
      [str(fd, "line_id"), num(fd, "amount"), str(fd, "unit"), num(fd, "overage_pct")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

/** An offer ingredient without a stock item: choose the item (remembered for the next offers). */
export async function linkPendingLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select link_recipe_pending_line($1, $2, $3)", [str(fd, "pending_id"), str(fd, "item_id"), fd.get("remember") === "on"]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function removePendingLine(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from formula_pending_lines where id = $1", [str(fd, "pending_id")]);
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
}

export async function removeFormulaLine(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from formula_lines where id = $1", [str(fd, "line_id")]);
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
}

export async function saveFormulaVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      "update formula_versions set change_note = $2, notes = $3 where id = $1",
      [str(fd, "version_id"), str(fd, "change_note"), str(fd, "notes")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function approveFormulaVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select approve_formula_version($1)", [str(fd, "version_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/formulas", "layout");
  return { ok: true, message: t.common.saved };
}

export async function newFormulaVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const formulaId = str(fd, "formula_id");
  let version: number;
  try {
    const [row] = await q<{ version: number }>(
      user.id,
      "select version from formula_versions where id = new_formula_version($1, $2)",
      [formulaId, str(fd, "change_note")],
    );
    version = row.version;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/formulas", "layout");
  redirect(`/formulas/${formulaId}?v=${version}`);
}

export async function discardFormulaDraft(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update formula_versions set status = 'archived' where id = $1 and status = 'draft'", [str(fd, "version_id")]);
  revalidatePath("/formulas", "layout");
  redirect(`/formulas/${str(fd, "formula_id")}`);
}

export async function addFormulaClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "insert into formula_version_claims (version_id, claim_id) values ($1, $2) on conflict do nothing",
      [str(fd, "version_id"), str(fd, "claim_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function addFormulaPackaging(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      `insert into formula_packaging (version_id, item_id, qty_per_pack) values ($1, $2, coalesce($3, 1))
       on conflict (version_id, item_id) do update set qty_per_pack = excluded.qty_per_pack`,
      [str(fd, "version_id"), str(fd, "item_id"), num(fd, "qty_per_pack")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function removeFormulaPackaging(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from formula_packaging where id = $1", [str(fd, "packaging_id")]);
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
}

export async function removeFormulaClaim(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from formula_version_claims where version_id = $1 and claim_id = $2",
    [str(fd, "version_id"), str(fd, "claim_id")]);
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
}

// ----------------------------------------------------------------- offers
const offerPath = (fd: FormData) => `/offers/${str(fd, "offer_id")}`;

export async function createOffer(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      "insert into offers (client_id, project_id, formula_version_id) values ($1, $2, $3) returning id",
      [str(fd, "client_id"), str(fd, "project_id"), str(fd, "formula_version_id")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/offers");
  redirect(`/offers/${id}`);
}

export async function saveOfferTerms(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      `update offers set valid_until = $2::date, incoterm = coalesce($3, 'EXW'), deposit_pct = $4,
              balance_terms = $5::balance_terms, balance_net_days = $6, locale = $7::app_locale, notes = $8, internal_notes = $9,
              project_id = $10
        where id = $1`,
      [str(fd, "offer_id"), str(fd, "valid_until"), str(fd, "incoterm"), num(fd, "deposit_pct"), str(fd, "balance_terms"),
       num(fd, "balance_net_days"), str(fd, "locale"), str(fd, "notes"), str(fd, "internal_notes"), str(fd, "project_id")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(offerPath(fd));
  return { ok: true, message: t.common.saved };
}

export async function addOfferTier(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const price = num(fd, "unit_price");
  try {
    await q(
      user.id,
      `insert into offer_tiers (offer_id, quantity, margin_pct, unit_price, price_is_manual) values ($1, $2, $3, $4, $5)
       on conflict (offer_id, quantity) do update
         set margin_pct = excluded.margin_pct, unit_price = excluded.unit_price, price_is_manual = excluded.price_is_manual`,
      [str(fd, "offer_id"), num(fd, "quantity"), num(fd, "margin_pct"), price, price != null],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(offerPath(fd));
  return { ok: true, message: t.common.saved };
}

export async function removeOfferTier(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from offer_tiers where id = $1", [str(fd, "tier_id")]);
  revalidatePath(offerPath(fd));
}

export async function addOfferPackaging(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      `insert into offer_packaging (offer_id, item_id, qty_per_pack) values ($1, $2, coalesce($3, 1))
       on conflict (offer_id, item_id) do update set qty_per_pack = excluded.qty_per_pack`,
      [str(fd, "offer_id"), str(fd, "item_id"), num(fd, "qty_per_pack")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(offerPath(fd));
  return { ok: true, message: t.common.saved };
}

export async function removeOfferPackaging(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from offer_packaging where id = $1", [str(fd, "packaging_id")]);
  revalidatePath(offerPath(fd));
}

export async function setOfferStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "update offers set status = $2::offer_status where id = $1", [str(fd, "offer_id"), str(fd, "status")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/offers", "layout");
  return { ok: true, message: t.common.saved };
}

export async function recalcOffer(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select recalc_offer($1)", [str(fd, "offer_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(offerPath(fd));
  return { ok: true, message: t.common.saved };
}

export async function saveFormatCosting(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const rows = await q(
      user.id,
      `update format_costing set fee_per_pack = coalesce($2, 0), fee_per_1000_units = coalesce($3, 0), fee_per_kg = coalesce($4, 0),
              setup_fee = coalesce($5, 0), loss_pct = coalesce($6, 0), default_margin_pct = coalesce($7, 0), min_order_packs = $8
        where product_format = $1::product_format returning product_format`,
      [str(fd, "product_format"), num(fd, "fee_per_pack"), num(fd, "fee_per_1000_units"), num(fd, "fee_per_kg"),
       num(fd, "setup_fee"), num(fd, "loss_pct"), num(fd, "default_margin_pct"), num(fd, "min_order_packs")],
    );
    if (rows.length === 0) return { error: t.offers.costingPage.adminOnly };
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/offers/costing");
  return { ok: true, message: t.common.saved };
}

/// ----------------------------------------------------------------- orders
export async function createOrderFromOffer(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      "select create_order_from_offer($1, $2::int, $3, $4::date) as id",
      [str(fd, "offer_id"), num(fd, "quantity"), str(fd, "customer_ref"), str(fd, "requested_date")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${id}`);
}

/** Order from one or more calculator offers of a client plus extra services; starts as unpaid. */
export async function createOrderFromCalcOffers(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const n = t.orders.new;
  const clientId = str(fd, "client_id");
  const offers = fd.getAll("offer_id").filter((x): x is string => typeof x === "string" && x !== "");
  if (!clientId) return { error: n.chooseClient };
  if (offers.length === 0) return { error: n.chooseOffer };
  let services: { description: string; quantity: number; unit_price: number }[];
  try {
    services = JSON.parse(str(fd, "services") ?? "[]");
  } catch {
    return { error: n.serviceInvalid };
  }
  if (!Array.isArray(services) || services.some((s) => !s.description?.trim() || !(s.quantity > 0) || !(s.unit_price >= 0))) {
    return { error: n.serviceInvalid };
  }
  let id: string;
  try {
    // Another price level of an offer: its price is taken from the saved offer, not from the form
    const levels: { offer_id: string; quantity: number; unit_price: number }[] = [];
    const chosen = offers.filter((o) => str(fd, `level_${o}`));
    if (chosen.length) {
      const saved = await q<{ id: string; data: OfferForm; results: CalcResult }>(
        user.id, "select id, data, results from calc_offers where id = any($1::uuid[])", [chosen]);
      for (const o of saved) {
        const units = Number(str(fd, `level_${o.id}`));
        const level = offerPriceOptions(o.data, { ...o.results, complete: true }).find((l) => l.units === units);
        if (!level) return { error: n.levelMissing };
        levels.push({ offer_id: o.id, quantity: level.units, unit_price: level.price });
      }
    }
    const [row] = await q<{ id: string }>(
      user.id,
      "select create_order_from_calc_offers($1, $2::uuid[], $3::jsonb, $4, $5, $6::date, $7, $8::jsonb) as id",
      [clientId, offers, JSON.stringify(services), num(fd, "vat_pct"), str(fd, "customer_ref"), str(fd, "requested_date"), str(fd, "notes"),
        JSON.stringify(levels)],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${id}`);
}

/** Admin: the calculator line of a paid order gets its approved formula (and a project), so production can be planned. */
export async function linkOrderLineFormula(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select link_order_line_formula($1, $2)", [str(fd, "line_id"), str(fd, "formula_version_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

export async function addOrderLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const [offerId, qty] = (str(fd, "offer_quantity") ?? "|").split("|");
  try {
    await q(user.id, "select add_order_line_from_offer($1, $2, $3::int)", [str(fd, "order_id"), offerId || null, Number(qty) || null]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

export async function removeOrderLine(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from sales_order_lines where id = $1", [str(fd, "line_id")]);
  revalidatePath(`/orders/${str(fd, "order_id")}`);
}

export async function saveOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(
      user.id,
      // Payment dates: admin only (the database refuses them from others; sales keeps the stored ones)
      `update sales_orders set deposit_pct = $2,
              deposit_received_on = case when has_role('admin') then $3::date else deposit_received_on end,
              balance_received_on = case when has_role('admin') then $4::date else balance_received_on end,
              requested_date = $5::date, customer_ref = $6, notes = $7
        where id = $1`,
      [str(fd, "order_id"), num(fd, "deposit_pct"), str(fd, "deposit_received_on"), str(fd, "balance_received_on"),
       str(fd, "requested_date"), str(fd, "customer_ref"), str(fd, "notes")],
    );
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${str(fd, "order_id")}`);
  return { ok: true, message: t.common.saved };
}

export async function setOrderStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "update sales_orders set status = $2::order_status where id = $1", [str(fd, "order_id"), str(fd, "status")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

// ------------------------------------------------------------- invoices
/** "Export invoice" on a paid order: opens its invoice of that purpose (full, advance or final; a new draft the first time). */
export async function openOrderInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    id = (await q<{ id: string }>(user.id, "select create_order_invoice($1, $2) as id", [str(fd, "order_id"), str(fd, "purpose")]))[0].id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}`);
}

/** Transport of an order (EUR excl. VAT; empty = none): a line of the final proforma and invoice. */
export async function setOrderTransport(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const id = str(fd, "order_id");
  try {
    await q(user.id, "select set_order_transport($1, $2)", [id, num(fd, "transport")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/orders/${id}`);
  return { ok: true, message: t.common.saved };
}

/** Issues a draft invoice with its number and date; it is locked afterwards. */
export async function issueInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    await q(user.id, "select issue_invoice($1, $2, $3::date, $4)", [
      str(fd, "invoice_id"), str(fd, "number"), str(fd, "issue_date"), fd.get("confirm_number") === "on",
    ]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.invoices.issued };
}

/** A draft invoice with or without VAT (the order's rate, or the company's default). */
export async function setInvoiceVat(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  const id = str(fd, "invoice_id");
  try {
    await q(user.id, "select set_invoice_vat($1, $2)", [id, fd.get("with_vat") === "1"]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

// ------------------------------------------------------------- production
export async function createProductionFromLine(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      `insert into manufacturing_orders (sales_order_line_id, quantity)
       select id, quantity from sales_order_line_overview where id = $1 returning id`,
      [str(fd, "line_id")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/production/${id}`);
}

export async function createSimulation(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      `insert into manufacturing_orders (formula_version_id, project_id, quantity, planned_date)
       values ($1, $2, $3, $4::date) returning id`,
      [str(fd, "formula_version_id"), str(fd, "project_id"), num(fd, "quantity"), str(fd, "planned_date")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/production");
  redirect(`/production/${id}`);
}

const moPath = (fd: FormData) => `/production/${str(fd, "mo_id")}`;

/** Runs one production function (by name) and reports the result. */
async function moCall(fd: FormData, sql: string, params: unknown[], message?: (r: Record<string, unknown>) => string): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const [r] = await q<Record<string, unknown>>(user.id, sql, params);
    revalidatePath("/", "layout");
    return { ok: true, message: message ? message(r ?? {}) : t.common.saved };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function saveMo(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "update manufacturing_orders set quantity = coalesce($2, quantity), project_id = $3, notes = $4 where id = $1",
    [str(fd, "mo_id"), num(fd, "quantity"), str(fd, "project_id"), str(fd, "notes")]);
}

export async function addMoPackaging(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, `insert into mo_packaging (mo_id, item_id, qty_per_pack) values ($1, $2, coalesce($3, 1))
                     on conflict (mo_id, item_id) do update set qty_per_pack = excluded.qty_per_pack`,
    [str(fd, "mo_id"), str(fd, "item_id"), num(fd, "qty_per_pack")]);
}

export async function removeMoPackaging(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from mo_packaging where id = $1", [str(fd, "packaging_id")]);
  revalidatePath(moPath(fd));
}

export async function reserveMo(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getSession();
  return moCall(fd, "select reserve_mo_materials($1) as n", [str(fd, "mo_id")], (r) => fmt(t.production.detail.reservedN, { n: Number(r.n) }));
}

export async function requestPurchases(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getSession();
  return moCall(fd, "select create_purchase_requests($1) as n", [str(fd, "mo_id")], (r) => fmt(t.production.detail.requestedN, { n: Number(r.n) }));
}

export async function scheduleMo(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "select schedule_mo($1, $2::date)", [str(fd, "mo_id"), str(fd, "planned_date")]);
}

export async function releaseMo(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "select release_mo($1)", [str(fd, "mo_id")]);
}

export async function cancelMo(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "select cancel_mo($1)", [str(fd, "mo_id")]);
}

export async function startProduction(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "select start_production($1)", [str(fd, "mo_id")]);
}

export async function completeProduction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getSession();
  // One row per lot: use_<n> = "lot_id|location_id", qty_<n> = quantity used;
  // one reason per material: reason_<item_id>
  const usage: { lot_id: string; location_id: string; quantity: number }[] = [];
  const reasons: { item_id: string; reason: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (k.startsWith("reason_")) reasons.push({ item_id: k.slice(7), reason: v.trim() });
    if (!k.startsWith("use_")) continue;
    const qty = num(fd, "qty_" + k.slice(4));
    const [lot_id, location_id] = v.split("|");
    if (lot_id && location_id && qty) usage.push({ lot_id, location_id, quantity: qty });
  }
  const batch = str(fd, "batch_number") ?? "";
  const qty = num(fd, "produced_quantity");
  return moCall(fd, "select complete_production($1, $2, $3::int, $4::date, $5::jsonb, $6::jsonb)",
    [str(fd, "mo_id"), batch, qty, str(fd, "produced_on"), JSON.stringify(usage), JSON.stringify(reasons)],
    () => fmt(t.factory.order.done, { batch, qty: qty ?? 0 }));
}

/** Admin: one step back (reason required, kept in the history). */
export async function revertMo(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, "select revert_mo_status($1, $2)", [str(fd, "mo_id"), str(fd, "reason")]);
}

/** Admin: order a material of the order from a supplier (request + expected delivery). */
export async function orderMoMaterial(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getSession();
  return moCall(fd, "select order_mo_material($1, $2, $3, $4, $5, $6::date, $7)",
    [str(fd, "mo_id"), str(fd, "item_id"), num(fd, "quantity"), str(fd, "supplier_id"), num(fd, "unit_price"),
     str(fd, "expected_on"), str(fd, "location_id")],
    () => t.production.detail.orderedOk);
}

export async function addProductionInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  return moCall(fd, `insert into production_invoices (mo_id, invoice_number, invoice_date, amount) values ($1, $2, $3::date, $4)`,
    [str(fd, "mo_id"), str(fd, "invoice_number"), str(fd, "invoice_date"), num(fd, "amount")]);
}

// ------------------------------------------------------------- purchasing
export async function setPurchaseRequestStatus(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "update purchase_requests set status = $2::purchase_request_status where id = $1", [str(fd, "request_id"), str(fd, "status")]);
  revalidatePath("/deliveries");
}

// -------------------------------------------------------------- inventory
export async function receiveGoods(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const lot = await withUser(user.id, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `select receive_lot($1, $2, $3, $4, $5, $6::date, $7::date, null, $8) as id`,
        [str(fd, "item_id"), str(fd, "location_id"), num(fd, "quantity"), str(fd, "supplier_id"),
         str(fd, "supplier_lot"), str(fd, "manufactured_on"), str(fd, "expires_on"), str(fd, "reference")],
      );
      const cost = num(fd, "unit_cost");
      if (cost != null) await tx.query("select set_lot_cost($1, $2)", [r.rows[0].id, cost]);
      const l = await tx.query<{ lot_number: string }>("select lot_number from lots where id = $1", [r.rows[0].id]);
      return l.rows[0]?.lot_number ?? "";
    });
    revalidatePath("/", "layout");
    return { ok: true, message: fmt(t.receive.done, { lot }) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

// -------------------------------------------------------- items (master data)
const itemFields = (fd: FormData) => {
  const tri = (k: string) => (str(fd, k) === "true" ? true : str(fd, k) === "false" ? false : null);
  return [
    str(fd, "name"), str(fd, "name_bg"), str(fd, "latin_name"), str(fd, "novel_food_status"), str(fd, "novel_food_reference"),
    num(fd, "shelf_life_months"), num(fd, "reorder_level"), str(fd, "storage_conditions"),
    fd.getAll("allergens").filter((v): v is string => typeof v === "string"), tri("is_vegan"), tri("is_vegetarian"),
    str(fd, "regulatory_notes"), str(fd, "notes"),
  ];
};

export async function createItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      `insert into items (name, name_bg, latin_name, novel_food_status, novel_food_reference, shelf_life_months, reorder_level,
         storage_conditions, allergens, is_vegan, is_vegetarian, regulatory_notes, notes, sku, type, base_unit)
       values ($1, $2, $3, $4::novel_food_status, $5, $6, $7, $8, $9::eu_allergen[], $10, $11, $12, $13, upper($14),
         $15::item_type, $16::base_unit)
       returning id`,
      [...itemFields(fd), str(fd, "sku"), str(fd, "type"), str(fd, "base_unit")],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/inventory");
  redirect(`/inventory/items/${id}`);
}

export async function updateItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const rows = await q(
      user.id,
      `update items set name = $1, name_bg = $2, latin_name = $3, novel_food_status = $4::novel_food_status,
         novel_food_reference = $5, shelf_life_months = $6, reorder_level = $7, storage_conditions = $8,
         allergens = $9::eu_allergen[], is_vegan = $10, is_vegetarian = $11, regulatory_notes = $12, notes = $13,
         is_active = $15
       where id = $14 returning id`,
      [...itemFields(fd), str(fd, "item_id"), fd.get("is_active") === "on"],
    );
    if (rows.length === 0) return { error: t.items.readOnly };
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.items.saved };
}

// ----------------------------------------------------------- stock count
export async function countStock(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, locale, t } = await getSession();
  const [lotId, locationId] = (str(fd, "lot_location") ?? "|").split("|");
  try {
    const res = await withUser(user.id, async (tx) => {
      const diff = (await tx.query<{ diff: string }>("select count_stock($1, $2, $3, $4)::text as diff",
        [lotId || null, locationId || null, num(fd, "counted"), str(fd, "reason")])).rows[0].diff;
      // Read after the count, so available includes the correction
      const s = (await tx.query<{ base_unit: string; available: string }>(
        "select s.base_unit, s.available::text from lots l join item_stock_summary s on s.item_id = l.item_id where l.id = $1",
        [lotId])).rows[0];
      return { diff, base_unit: s?.base_unit ?? "", available: s?.available ?? "0" };
    });
    revalidatePath("/", "layout");
    const C = user.role === "production" ? t.factory.stock : t.inventory.count;
    if (!res || Number(res.diff) === 0) return { ok: true, message: C.match };
    const diff = `${Number(res.diff) > 0 ? "+" : ""}${formatQty(locale, res.diff, res.base_unit)}`;
    const msg = fmt(C.done, { diff });
    return { ok: true, message: Number(res.available) < 0 ? `${msg}. ${t.inventory.count.shortWarning}` : msg };
  } catch (e) {
    return { error: errorText(e) };
  }
}

// ----------------------------------------------------- expected deliveries
export async function createDeliveries(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const request = str(fd, "purchase_request_id");
  let n = 0;
  try {
    await withUser(user.id, async (tx) => {
      for (let i = 0; i < DELIVERY_LINES; i++) {
        const item = str(fd, `item_${i}`);
        if (!item) continue;
        await tx.query(
          "select create_expected_delivery($1, $2, $3, $4::date, $5, $6, $7, $8, $9)",
          [item, num(fd, `quantity_${i}`), str(fd, "supplier_id"), str(fd, "expected_on"), num(fd, `unit_price_${i}`),
           str(fd, "po_reference"), str(fd, "location_id"), i === 0 ? request : null, str(fd, "note")],
        );
        n++;
      }
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  if (n === 0) return { error: t.deliveries.chooseItem };
  revalidatePath("/", "layout");
  if (request) redirect("/deliveries");
  return { ok: true, message: fmt(t.deliveries.created, { n }) };
}

/**
 * Saves the uploaded files of a delivery (rows as the user, so row-level
 * security decides) and returns their storage paths. The caller removes
 * the files again if its transaction fails.
 */
async function saveDeliveryFiles(tx: Tx, deliveryId: string, files: File[], kind: string, written: string[]) {
  for (const f of files) {
    const key = newDeliveryPath(deliveryId, f.type);
    if (!key || f.size > MAX_FILE_BYTES) throw new Error(f.name);
    await tx.query(
      "insert into delivery_attachments (delivery_id, storage_path, kind, file_name, content_type, size_bytes) values ($1, $2, $3, $4, $5, $6)",
      [deliveryId, key, kind, f.name.slice(0, 200), f.type, f.size]);
    await putFile(DELIVERY_BUCKET, key, Buffer.from(await f.arrayBuffer()), f.type);
    written.push(key);
  }
}

const uploads = (fd: FormData, k: string) =>
  fd.getAll(k).filter((v): v is File => typeof v === "object" && v !== null && "size" in v && (v as File).size > 0);

export async function receiveDelivery(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, locale, t } = await getSession();
  const written: string[] = [];
  try {
    const lot = await withUser(user.id, async (tx) => {
      await saveDeliveryFiles(tx, str(fd, "delivery_id") ?? "", uploads(fd, "photos"), "waybill", written);
      const r = await tx.query<{ id: string }>(
        "select receive_expected_delivery($1, $2, $3, $4, $5::date, $6::date, $7, $8) as id",
        [str(fd, "delivery_id"), str(fd, "location_id"), num(fd, "quantity"), str(fd, "supplier_lot"),
         str(fd, "manufactured_on"), str(fd, "expires_on"), str(fd, "reference"), fd.get("close") === "on"],
      );
      const l = (await tx.query<{ lot_number: string; over: string; base_unit: string }>(
        `select l.lot_number, greatest(d.received - d.quantity, 0)::text as over, i.base_unit
           from lots l join expected_delivery_overview d on d.id = l.expected_delivery_id join items i on i.id = l.item_id
          where l.id = $1`, [r.rows[0].id])).rows[0];
      return l;
    });
    revalidatePath("/", "layout");
    const msg = fmt(user.role === "production" ? t.factory.deliveries.done : t.deliveries.receivedOk, { lot: lot?.lot_number ?? "" });
    return { ok: true, message: lot && Number(lot.over) > 0 ? `${msg}. ${fmt(t.deliveries.overWarning, { qty: formatQty(locale, lot.over, lot.base_unit) })}` : msg };
  } catch (e) {
    for (const key of written) await removeFile(DELIVERY_BUCKET, key);
    return { error: errorText(e) };
  }
}

/** Production: delete an own file within 24 hours (the database checks). */
export async function deleteDeliveryFile(fd: FormData) {
  const { user } = await getSession();
  const [row] = await q<{ storage_path: string }>(user.id,
    "delete from delivery_attachments where id = $1 returning storage_path", [str(fd, "file_id")]);
  if (row) await removeFile(DELIVERY_BUCKET, row.storage_path);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------- notifications
export async function markNotificationsRead(fd: FormData) {
  const { user } = await getSession();
  const id = num(fd, "id");
  await q(user.id, "select mark_notifications_read($1::bigint[])", [id == null ? null : [id]]);
  revalidatePath("/", "layout");
}

export async function updateDelivery(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  try {
    const rows = await withUser(user.id, async (tx) => {
      const id = str(fd, "delivery_id");
      const d = (await tx.query<{ status: string }>("select status from expected_deliveries where id = $1", [id])).rows[0];
      if (!d) return [];
      if (d.status === "open") {
        await tx.query("update expected_deliveries set expected_on = $2::date, po_reference = $3 where id = $1",
          [id, str(fd, "expected_on"), str(fd, "po_reference")]);
      }
      await tx.query("select update_delivery_terms($1, $2, $3, $4)",
        [id, str(fd, "supplier_id"), num(fd, "quantity"), num(fd, "unit_price")]);
      return [id];
    });
    if (rows.length === 0) return { error: t.deliveries.readOnly };
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t.common.saved };
}

export async function cancelDelivery(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  try {
    await q(user.id, "select cancel_expected_delivery($1)", [str(fd, "delivery_id")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
