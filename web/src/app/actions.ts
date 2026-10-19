"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, withUser } from "@/lib/db/engine";
import { DEMO_USERS } from "@/lib/db/demo-users";
import { getSession, USER_COOKIE } from "@/lib/session";
import { fmt, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

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
  const { user } = await getSession();
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  await q(user.id, "select set_my_locale($1)", [locale]);
  revalidatePath("/", "layout");
}

export async function switchDemoUser(fd: FormData) {
  const id = fd.get("user");
  const u = DEMO_USERS.find((x) => x.id === id);
  if (!u) return;
  const jar = await cookies();
  jar.set(USER_COOKIE, u.id, { path: "/", maxAge: YEAR, sameSite: "lax" });
  jar.delete(LOCALE_COOKIE); // use that user's saved language
  redirect(u.role === "partner" ? "/partner" : "/");
}

// -------------------------------------------------------------------- CRM
export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await getSession();
  let id: string;
  try {
    const [row] = await q<{ id: string }>(
      user.id,
      `insert into clients (legal_name, trade_name, status, country_code, vat_number, company_id, address_line1, city,
         postal_code, billing_email, phone, website, preferred_locale, deposit_pct, balance_terms, balance_net_days,
         credit_limit, notes, owner_id)
       values ($1, $2, coalesce($3, 'lead')::client_status, upper(coalesce($4, 'BG')), $5, $6, $7, $8, $9, $10, $11, $12,
         coalesce($13, 'en')::app_locale, $14, $15::balance_terms, $16, $17, $18, auth.uid())
       returning id`,
      [
        str(fd, "legal_name"), str(fd, "trade_name"), str(fd, "status"), str(fd, "country_code"), str(fd, "vat_number"),
        str(fd, "company_id"), str(fd, "address_line1"), str(fd, "city"), str(fd, "postal_code"), str(fd, "billing_email"),
        str(fd, "phone"), str(fd, "website"), str(fd, "preferred_locale"), num(fd, "deposit_pct"), str(fd, "balance_terms"),
        num(fd, "balance_net_days"), num(fd, "credit_limit"), str(fd, "notes"),
      ],
    );
    id = row.id;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
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
      "update formula_versions set shelf_life_months = $2, change_note = $3, notes = $4 where id = $1",
      [str(fd, "version_id"), num(fd, "shelf_life_months"), str(fd, "change_note"), str(fd, "notes")],
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

export async function removeFormulaClaim(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "delete from formula_version_claims where version_id = $1 and claim_id = $2",
    [str(fd, "version_id"), str(fd, "claim_id")]);
  revalidatePath(`/formulas/${str(fd, "formula_id")}`);
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
      const l = await tx.query<{ lot_number: string }>("select lot_number from lots where id = $1", [r.rows[0].id]);
      return l.rows[0]?.lot_number ?? "";
    });
    revalidatePath("/", "layout");
    return { ok: true, message: fmt(t.receive.done, { lot }) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function setLotQc(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select set_lot_qc_status($1, $2::qc_status, $3)", [str(fd, "lot_id"), str(fd, "status"), str(fd, "notes")]);
  revalidatePath("/", "layout");
}

export async function decideAdjustment(fd: FormData) {
  const { user } = await getSession();
  await q(user.id, "select decide_stock_adjustment($1, $2)", [str(fd, "request_id"), fd.get("approve") === "true"]);
  revalidatePath("/", "layout");
}

export async function requestAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getSession();
  const [lotId, locationId] = (str(fd, "lot_location") ?? "|").split("|");
  try {
    await q(user.id, "select request_stock_adjustment($1, $2, $3, $4)", [lotId || null, locationId || null, num(fd, "quantity"), str(fd, "reason")]);
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/partner");
  return { ok: true, message: t.partner.sent };
}
