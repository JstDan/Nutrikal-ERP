import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import { setLocale } from "@/app/actions";
import { DEMO_USERS } from "@/lib/db/demo-users";
import { getSession } from "@/lib/session";
import { LOCALES } from "@/lib/i18n";
import { SideNav, type NavGroup } from "./side-nav";
import { DemoUserSwitch } from "./demo-user-switch";
import { ActAsSwitch } from "./act-as-switch";
import { ThemeSwitch } from "./theme-switch";
import { MobileMenu } from "./mobile-menu";
import { Wordmark } from "./logo";
import { NotificationBell } from "./notification-bell";

export async function AppShell({ children }: { children: ReactNode }) {
  const { user, developer, locale, t } = await getSession();
  const isProduction = user.role === "production";
  const savedTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const soon = (n: number) => `${t.common.phase} ${n}`;

  const groups: NavGroup[] = isProduction
    ? [
        {
          items: [
            { href: "/factory", label: t.nav.today },
            { href: "/factory/orders", label: t.nav.productionOrders },
            { href: "/factory/stock", label: t.nav.stock },
            { href: "/factory/deliveries", label: t.nav.incoming },
            { href: "/notifications", label: t.nav.notifications },
          ],
        },
      ]
    : [
        {
          title: t.nav.sales,
          items: [
            { href: "/", label: t.nav.dashboard },
            { href: "/clients", label: t.nav.clients },
            { href: "/projects", label: t.nav.projects },
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/calculator", label: t.nav.calculator }] : []),
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/offers", label: t.nav.offers }] : []),
            { href: "/orders", label: t.nav.orders },
            { label: t.nav.invoices, soon: soon(4) },
          ],
        },
        {
          title: t.nav.operations,
          items: [
            { href: "/inventory", label: t.nav.inventory },
            { href: "/qc", label: t.nav.qc },
            { href: "/formulas", label: t.nav.formulas },
            { href: "/purchasing", label: t.nav.purchasing },
            { href: "/deliveries", label: t.nav.deliveries },
            { href: "/production", label: t.nav.production },
          ],
        },
        ...(user.role === "admin"
          ? [{
              title: t.nav.reports,
              items: [
                { href: "/accounting", label: t.nav.accounting },
                ...(user.role === "admin" ? [{ href: "/inventory/corrections", label: t.nav.corrections }] : []),
                ...(user.role === "admin" ? [{ href: "/history", label: t.nav.history }] : []),
              ],
            }]
          : []),
      ];

  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="relative flex print:hidden w-full flex-col gap-6 bg-side px-4 py-5 text-side-strong lg:w-[248px] lg:shrink-0 lg:py-6">
        <a href={isProduction ? "/factory" : "/"} className="flex flex-col gap-2 px-2 text-side-strong no-underline">
          <Wordmark height={20} inverted />
          <span className="text-[11px] font-semibold tracking-[2px] text-green">{isProduction ? t.nav.productionLabel.toUpperCase() : "ERP"}</span>
          {isProduction && <span className="text-xs text-side-muted">{t.nav.partnerFacility}</span>}
        </a>
        <MobileMenu label={t.nav.menu} closeLabel={t.nav.close}>
          <SideNav groups={groups} label={t.nav.main} />
        </MobileMenu>
      </aside>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <header className="flex flex-wrap print:hidden items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-8">
          {!isProduction && (
            <form action="/clients" method="get" role="search" className="flex min-w-0 flex-[1_1_260px]">
              <label htmlFor="global-search" className="sr-only">{t.topbar.search}</label>
              <input id="global-search" name="q" type="search" placeholder={t.topbar.searchPlaceholder} className="input" />
            </form>
          )}
          <div className={`flex flex-wrap items-center gap-3 ${isProduction ? "ml-auto" : ""}`}>
            <form action={setLocale} role="group" aria-label={t.topbar.language} className="flex overflow-hidden rounded-sm border border-line-strong">
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="submit"
                  name="locale"
                  value={l}
                  aria-pressed={locale === l}
                  lang={l}
                  title={t.enums.locale[l]}
                  className={`h-[42px] min-w-12 border-0 text-xs font-semibold tracking-[1.5px] ${locale === l ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-canvas"}`}
                >
                  {l === "bg" ? "БГ" : "EN"}
                </button>
              ))}
            </form>
            <NotificationBell userId={user.id} label={t.topbar.notifications} unreadLabel={t.topbar.unread} />
            <ThemeSwitch toDark={t.topbar.toDark} toLight={t.topbar.toLight} saved={savedTheme} />
            <DemoUserSwitch
              current={developer?.id ?? user.id}
              label={t.topbar.viewingAs}
              options={DEMO_USERS.map((u) => ({ id: u.id, label: t.enums.role[u.role] }))}
            />
            {developer && (
              <ActAsSwitch
                current={user.id}
                label={t.topbar.actAs}
                options={developer.targets.map((u) => ({ id: u.id, label: `${u.full_name} · ${t.enums.role[u.role]}` }))}
              />
            )}
          </div>
        </header>
        <main className="w-full max-w-[1360px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
