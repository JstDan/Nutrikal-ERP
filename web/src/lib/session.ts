import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db/engine";
import { DEMO_USERS, type Role } from "./db/demo-users";
import { supabaseConfigured, supabaseServer } from "./supabase/server";
import { DEFAULT_LOCALE, getDict, isLocale, LOCALE_COOKIE, type AnyLocale, type Locale } from "./i18n";
import { isPortalLocale, PORTAL_LOCALE_COOKIE, portalDict } from "./i18n/portal";

/** Developer only: the user they act as. Checked against the database on every request. */
export const ACT_AS_COOKIE = "nk_act_as";
/** Admin only: the production account whose screen Admin has open (Production > Production screen). Checked on every request. */
export const PRODUCTION_SCREEN_COOKIE = "nk_production_screen";
/** Set while Admin works in the Production screen: who Admin really is. */
export type ProductionScreen = { adminId: string; adminName: string };

/**
 * role is what the screens work with: the accountant reads what Admin reads, the bookkeeper works like Sales.
 * access is the real role. readOnly: the database refuses every change of this account.
 */
export type SessionUser = { id: string; name: string; role: Role; access: Role; readOnly: boolean; canPay: boolean; locale: Locale; initials: string };
export type ActAsTarget = { id: string; full_name: string; email: string; role: Role; locale: Locale };
/** Set when the signed-in user is a developer: on their own profile (self, with Admin rights) or acting as someone else. */
export type Developer = { id: string; name: string; targets: ActAsTarget[]; self: boolean };

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
  readOnly: access === "accountant",
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
    // Own profile (Admin rights: the database gives the developer what Admin has) unless someone else is picked
    const target = targets.find((x) => x.id === jar.get(ACT_AS_COOKIE)?.value);
    developer = { id: user.id, name: user.name, targets, self: !target };
    user = target
      ? { id: target.id, name: target.full_name, ...rights(target.role), locale: target.locale, initials: initials(target.full_name) }
      : { ...user, ...rights("admin") };
  }

  // Admin in the Production screen: every page and action runs as the production account
  let screen: ProductionScreen | null = null;
  const screenId = jar.get(PRODUCTION_SCREEN_COOKIE)?.value;
  if (screenId && user.access === "admin" && !developer) {
    const [target] = await q<ActAsTarget>(user.id, "select id, full_name, email, role, locale from production_screen_targets() where id = $1", [screenId]);
    if (target) {
      screen = { adminId: user.id, adminName: user.name };
      user = { id: target.id, name: target.full_name, ...rights(target.role), locale: user.locale, initials: initials(target.full_name) };
    }
  }

  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : developer ? profile.locale : user.locale;
  user.locale = locale;
  return { user, developer, screen, locale, t: getDict(locale), local: !supabaseConfigured() };
});

/** Like getOptionalSession, but sends signed-out visitors to the sign-in page. */
export const getSession = cache(async () => {
  const s = await getOptionalSession();
  if (!s) redirect("/login");
  // A client account has only the customer panel: every staff page and action starts here
  if (s.user.role === "client") redirect("/portal");
  return s;
});

/** The customer panel. The portal_ functions in the database limit everything to the client of the account. */
export const getPortalSession = cache(async () => {
  const s = await getOptionalSession();
  if (!s) redirect("/login");
  // Its own language choice: the panel speaks more languages than the rest of the app
  const saved = (await cookies()).get(PORTAL_LOCALE_COOKIE)?.value;
  const locale: AnyLocale = isPortalLocale(saved) ? saved : s.locale;
  const unread = async () => (await q<{ n: number }>(s.user.id, "select coalesce((portal_me() ->> 'unread')::int, 0) as n"))[0]?.n ?? 0;
  return { user: s.user, locale, t: portalDict(locale), unread };
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
export const homeFor = (role: Role) => (role === "production" ? "/factory" : role === "client" ? "/portal" : "/");

export async function requireStaff() {
  const s = await getSession();
  if (s.user.role === "production") redirect("/factory");
  return s;
}

export async function requireRole(...roles: Role[]) {
  const s = await getSession();
  if (!roles.includes(s.user.role) && !roles.includes(s.user.access)) redirect(homeFor(s.user.role));
  return s;
}
