import type { ReactNode } from "react";
import { setLocale } from "@/app/actions";
import { DEMO_USERS } from "@/lib/db/demo-users";
import { getSession } from "@/lib/session";
import { LOCALES } from "@/lib/i18n";
import { SideNav, type NavGroup } from "./side-nav";
import { DemoUserSwitch } from "./demo-user-switch";
import { MobileMenu } from "./mobile-menu";
import { Wordmark } from "./logo";

export async function AppShell({ children }: { children: ReactNode }) {
  const { user, locale, t } = await getSession();
  const isPartner = user.role === "partner";
  const soon = (n: number) => `${t.common.phase} ${n}`;

  const groups: NavGroup[] = isPartner
    ? [
        {
          items: [
            { href: "/partner", label: t.nav.today },
            { href: "/partner/production", label: t.nav.production },
            { href: "/partner/receive", label: t.nav.receiveGoods },
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
        ...(user.role === "admin" || user.role === "inventory"
          ? [{
              title: t.nav.reports,
              items: [
                { href: "/accounting", label: t.nav.accounting },
                ...(user.role === "admin" ? [{ href: "/history", label: t.nav.history }] : []),
              ],
            }]
          : []),
      ];

  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="relative flex print:hidden w-full flex-col gap-6 bg-ink px-4 py-5 text-white lg:w-[248px] lg:shrink-0 lg:py-6">
        <a href={isPartner ? "/partner" : "/"} className="flex flex-col gap-2 px-2 text-white no-underline">
          <Wordmark height={20} inverted />
          <span className="text-[11px] font-semibold tracking-[2px] text-green">{isPartner ? t.nav.productionLabel.toUpperCase() : "ERP"}</span>
          {isPartner && <span className="text-xs text-side-muted">{t.nav.partnerFacility}</span>}
        </a>
        <MobileMenu label={t.nav.menu} closeLabel={t.nav.close}>
          <SideNav groups={groups} label={t.nav.main} />
        </MobileMenu>
      </aside>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <header className="flex flex-wrap print:hidden items-center gap-3 border-b border-line bg-white px-4 py-3 sm:px-8">
          {!isPartner && (
            <form action="/clients" method="get" role="search" className="flex min-w-0 flex-[1_1_260px]">
              <label htmlFor="global-search" className="sr-only">{t.topbar.search}</label>
              <input id="global-search" name="q" type="search" placeholder={t.topbar.searchPlaceholder} className="input" />
            </form>
          )}
          <div className={`flex flex-wrap items-center gap-3 ${isPartner ? "ml-auto" : ""}`}>
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
            <DemoUserSwitch
              current={user.id}
              label={t.topbar.viewingAs}
              options={DEMO_USERS.map((u) => ({ id: u.id, label: t.enums.role[u.role] }))}
            />
          </div>
        </header>
        <main className="w-full max-w-[1360px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
