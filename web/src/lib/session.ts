import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db/engine";
import { DEFAULT_USER_ID, DEMO_USERS, type Role } from "./db/demo-users";
import { DEFAULT_LOCALE, getDict, isLocale, LOCALE_COOKIE, type Locale } from "./i18n";

export const USER_COOKIE = "nk_demo_user";

export type SessionUser = { id: string; name: string; role: Role; locale: Locale; initials: string };

/** Current user, language and dictionary for this request. */
export const getSession = cache(async () => {
  const jar = await cookies();
  const wanted = jar.get(USER_COOKIE)?.value;
  const demo = DEMO_USERS.find((u) => u.id === wanted) ?? DEMO_USERS.find((u) => u.id === DEFAULT_USER_ID)!;

  const [profile] = await q<{ full_name: string; role: Role; locale: Locale }>(
    demo.id,
    "select full_name, role, locale from profiles where id = auth.uid()",
  );
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : profile?.locale ?? DEFAULT_LOCALE;

  const user: SessionUser = {
    id: demo.id,
    name: profile?.full_name ?? demo.name,
    role: profile?.role ?? demo.role,
    locale,
    initials: demo.initials,
  };
  return { user, locale, t: getDict(locale) };
});

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
