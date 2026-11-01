"use server";

// What a client does in the customer panel. The portal_ functions decide; this only passes the text on.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db/engine";
import { isPortalLocale, PORTAL_LOCALE_COOKIE } from "@/lib/i18n/portal";
import { getPortalSession } from "@/lib/session";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions";

const MIN_PASSWORD = 10;

export async function setPortalLocale(fd: FormData) {
  const locale = fd.get("locale");
  if (!isPortalLocale(locale)) return;
  (await cookies()).set(PORTAL_LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/portal", "layout");
}

export async function portalPost(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await getPortalSession();
  const S = t.portal.support;
  const body = String(fd.get("body") ?? "").trim();
  if (user.role !== "client" || !body || body.length > 4000) return { error: S.failed };
  try {
    await q(user.id, "select portal_post($1, $2)", [String(fd.get("order_id") ?? "") || null, body]);
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("portal_busy") ? S.busy : S.failed };
  }
  revalidatePath("/portal", "layout");
  return { ok: true };
}

export async function changePortalPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const { t } = await getPortalSession();
  const A = t.portal.account;
  const password = String(fd.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: A.short };
  if (password !== String(fd.get("repeat") ?? "")) return { error: A.mismatch };
  if (!supabaseConfigured()) return { error: A.liveOnly };
  const { error } = await (await supabaseServer()).auth.updateUser({ password });
  return error ? { error: A.failed } : { ok: true, message: A.saved };
}
