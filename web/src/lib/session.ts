import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db/engine";
import { DEMO_USERS, type Role } from "./db/demo-users";
import { supabaseConfigured, supabaseServer } from "./supabase/server";
import { DEFAULT_LOCALE, getDict, isLocale, LOCALE_COOKIE, type Locale } from "./i18n";

/** Developer only: the user they act as. Checked against the database on every request. */
export const ACT_AS_COOKIE = "nk_act_as";

/**
 * role is what the screens work with: the accountant reads what Admin reads, the bookkeeper works like Sales.
 * access is the real role. readOnly: the database refuses every change of this account.
 */
export type SessionUser = { id: string; name: string; role: Role; access: Role; readOnly: boolean; canPay: boolean; locale: Locale; initials: string };
export type ActAsTarget = { id: string; full_name: string; email: string; role: Role; locale: Locale };
/** Set when the signed-in user is a developer acting as someone else. */
export type Developer = { id: string; name: string; targets: ActAsTarget[] };

/** Local development without Supabase: always the demo developer (who can act as any demo user). */
const LOCAL_USER = DEMO_USERS.find((u) => u.role === "developer")!;

/** The signed-in Supabase user (verified), or null. */
export const getAuthUser = cache(async (): Promise<{ id: string; email: string | null } | null> => {
  await cookies(); // per-request: never pre-rendered at build time
  if (!supabaseConfigured()) return { id: LOCAL_USER.id, email: null };
  const { data } = await (await supabaseServer()).auth.getClaims();
  const sub = data?.claims?.sub;
  return sub ? { id: sub, email: (data.claims.email as string | undefined) ?? null } : null;
});

const rights = (access: Role) => ({
  access,
  role: (access === "accountant" ? "admin" : access === "bookkeeper" ? "sales" : access) as Role,
  readOnly: access === "accountant" || access === "designer",
  canPay: access === "admin" || access === "bookkeeper",
});

/**
 * Current user, language and dictionary for this request, or null when
 * nobody is signed in or the account has no active profile. For a
 * developer, `user` is the person they act as (every query then runs as
 * that person) and `developer` holds the developer and the users they can pick.
 */
export const getOptionalSession = cache(async () => {
  const auth = await getAuthUser();
  if (!auth) return null;
  const jar = await cookies();
  const [profile] = await q<{ full_name: string; role: Role; locale: Locale; is_active: boolean }>(
    auth.id,
    "select full_name, role, locale, is_active from profiles where id = auth.uid()",
  );
  if (!profile?.is_active) return null;
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;

  let user: SessionUser = { id: auth.id, name: profile.full_name, ...rights(profile.role), locale: profile.locale, initials: initials(profile.full_name) };
  let developer: Developer | null = null;
  if (user.role === "developer") {
    const targets = await q<ActAsTarget>(user.id, "select id, full_name, email, role, locale from impersonation_targets()");
    const target = targets.find((x) => x.id === jar.get(ACT_AS_COOKIE)?.value) ?? targets[0];
    developer = { id: user.id, name: user.name, targets };
    if (target) user = { id: target.id, name: target.full_name, ...rights(target.role), locale: target.locale, initials: initials(target.full_name) };
  }

  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : developer ? profile.locale : user.locale;
  user.locale = locale;
  return { user, developer, locale, t: getDict(locale), local: !supabaseConfigured() };
});

/** Like getOptionalSession, but sends signed-out visitors to the sign-in page. */
export const getSession = cache(async () => {
  const s = await getOptionalSession();
  if (!s) redirect("/login");
  return s;
});

/** Language for pages without a session (sign-in): the saved choice or Bulgarian. */
export async function getLocale(): Promise<Locale> {
  const s = await getOptionalSession();
  if (s) return s.locale;
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(c) ? c : DEFAULT_LOCALE;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/** Start page of a role: Production works in its own portal. */
export const homeFor = (role: Role) => (role === "production" ? "/factory" : "/");

export async function requireStaff() {
  const s = await getSession();
  if (s.user.role === "production") redirect("/factory");
  return s;
}

export async function requireRole(...roles: Role[]) {
  const s = await getSession();
  if (!roles.includes(s.user.role)) redirect(homeFor(s.user.role));
  return s;
}
