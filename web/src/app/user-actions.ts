"use server";

// Accounts, Admin only: the row-level rules of profiles decide; the sign-in account is made with the server key.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { q, withUser } from "@/lib/db/engine";
import { fmt, getDict } from "@/lib/i18n";
import { getSession, requireRole } from "@/lib/session";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions";

const READ_ONLY = `${getDict("bg").common.readOnly} / ${getDict("en").common.readOnly}`;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const ROLES = ["admin", "sales", "bookkeeper", "accountant", "designer", "production"];
const password = () => randomBytes(9).toString("base64url");

/** Admin who may change data: the accountant reads the same pages, without these. */
async function admin() {
  const s = await requireRole("admin");
  return s.user.readOnly ? null : s;
}

export async function saveUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  if (!s) return { error: READ_ONLY };
  if (!ROLES.includes(text(fd, "role"))) return { error: s.t.adminSettings.users.failed };
  try {
    await q(s.user.id, "update profiles set full_name = $2, role = $3::app_role, can_see_purchase_prices = $4, is_active = $5 where id = $1 and role not in ('developer', 'client')",
      [text(fd, "id"), text(fd, "full_name"), text(fd, "role"), fd.get("prices") === "on", fd.get("active") === "on"]);
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/settings/users");
  return { ok: true, message: s.t.common.saved };
}

export async function createUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  if (!s) return { error: READ_ONLY };
  const U = s.t.adminSettings.users;
  if (!supabaseConfigured()) return { error: U.liveOnly };
  if (!ROLES.includes(text(fd, "role"))) return { error: U.failed };
  const first = password();
  const email = text(fd, "email");
  const { data, error } = await supabaseAdmin().auth.admin.createUser({ email, password: first, email_confirm: true });
  if (error || !data.user) return { error: error?.message ?? U.failed };
  try {
    await q(s.user.id, "insert into profiles (id, full_name, email, role, can_see_purchase_prices) values ($1, $2, $3, $4::app_role, $5)",
      [data.user.id, text(fd, "full_name"), email, text(fd, "role"), ["sales", "bookkeeper"].includes(text(fd, "role"))]);
  } catch (e) {
    // No sign-in account without its profile
    await supabaseAdmin().auth.admin.deleteUser(data.user.id);
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/settings/users");
  return { ok: true, message: fmt(U.created, { password: first }) };
}

export async function resetUserPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  if (!s) return { error: READ_ONLY };
  const U = (await getSession()).t.adminSettings.users;
  const [target] = await q<{ role: string }>(s.user.id, "select role::text from profiles where id = $1", [text(fd, "id")]);
  if (!target || target.role === "developer") return { error: U.failed };
  const first = password();
  const { error } = await supabaseAdmin().auth.admin.updateUserById(text(fd, "id"), { password: first });
  if (error) return { error: error.message };
  return { ok: true, message: fmt(U.created, { password: first }) };
}

/** An account of a client for the customer panel: the first password is shown once, like for staff. */
export async function createClientUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  if (!s) return { error: READ_ONLY };
  const U = s.t.adminSettings.users;
  if (!supabaseConfigured()) return { error: U.liveOnly };
  const first = password();
  const email = text(fd, "email");
  const { data, error } = await supabaseAdmin().auth.admin.createUser({ email, password: first, email_confirm: true });
  if (error || !data.user) return { error: error?.message ?? U.failed };
  try {
    await withUser(s.user.id, async (tx) => {
      await tx.query("insert into profiles (id, full_name, email, role, locale) select $1, $2, $3, 'client', preferred_locale from clients where id = $4",
        [data.user.id, text(fd, "full_name"), email, text(fd, "client_id")]);
      await tx.query("select client_user_connect($1, $2)", [data.user.id, text(fd, "client_id")]);
    });
  } catch (e) {
    await supabaseAdmin().auth.admin.deleteUser(data.user.id);
    return { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  revalidatePath("/clients", "layout");
  return { ok: true, message: fmt(s.t.portal.staff.created, { password: first }) };
}

export async function setClientUserActive(fd: FormData) {
  const s = await admin();
  if (!s) return;
  await q(s.user.id, "select client_user_active($1, $2)", [text(fd, "id"), fd.get("active") === "on"]);
  revalidatePath("/clients", "layout");
}
