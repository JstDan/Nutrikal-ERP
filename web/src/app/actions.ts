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
