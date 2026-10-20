import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db/engine";
import { DEFAULT_USER_ID, DEMO_USERS, type Role } from "./db/demo-users";
import { DEFAULT_LOCALE, getDict, isLocale, LOCALE_COOKIE, type Locale } from "./i18n";

export const USER_COOKIE = "nk_demo_user";
/** Developer only: the user they act as. Checked against the database on every request. */
export const ACT_AS_COOKIE = "nk_act_as";

export type SessionUser = { id: string; name: string; role: Role; locale: Locale; initials: string };
export type ActAsTarget = { id: string; full_name: string; email: string; role: Role; locale: Locale };
/** Set when the signed-in user is a developer acting as someone else. */
export type Developer = { id: string; name: string; targets: ActAsTarget[] };

/**
 * Current user, language and dictionary for this request. For a developer,
 * `user` is the person they act as (every query then runs as that person)
 * and `developer` holds the developer and the users they can pick.
 */
export const getSession = cache(async () => {
  const jar = await cookies();
  const wanted = jar.get(USER_COOKIE)?.value;
  const demo = DEMO_USERS.find((u) => u.id === wanted) ?? DEMO_USERS.find((u) => u.id === DEFAULT_USER_ID)!;

  const [profile] = await q<{ full_name: string; role: Role; locale: Locale }>(
    demo.id,
    "select full_name, role, locale from profiles where id = auth.uid()",
  );
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;

  let user: SessionUser = {
    id: demo.id,
    name: profile?.full_name ?? demo.name,
    role: profile?.role ?? demo.role,
    locale: profile?.locale ?? DEFAULT_LOCALE,
    initials: demo.initials,
  };
  let developer: Developer | null = null;
  if (user.role === "developer") {
    const targets = await q<ActAsTarget>(user.id, "select id, full_name, email, role, locale from impersonation_targets()");
    const target = targets.find((x) => x.id === jar.get(ACT_AS_COOKIE)?.value) ?? targets[0];
    developer = { id: user.id, name: user.name, targets };
    if (target) user = { id: target.id, name: target.full_name, role: target.role, locale: target.locale, initials: initials(target.full_name) };
  }

  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : developer ? profile?.locale ?? DEFAULT_LOCALE : user.locale;
  user.locale = locale;
  return { user, developer, locale, t: getDict(locale) };
});

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export async function requireStaff() {
  const s = await getSession();
  if (s.user.role === "partner") redirect("/partner");
  return s;
}

export async function requireRole(...roles: Role[]) {
  const s = await getSession();
  if (!roles.includes(s.user.role)) redirect(s.user.role === "partner" ? "/partner" : "/");
  return s;
}
