import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import { q } from "@/lib/db/engine";
import { setLocale, signOut } from "@/app/actions";
import { getSession } from "@/lib/session";
import { LOCALES } from "@/lib/i18n";
import { SideNav, type NavGroup } from "./side-nav";
import { ActAsSwitch } from "./act-as-switch";
import { ThemeSwitch } from "./theme-switch";
import { MobileMenu } from "./mobile-menu";
import { Wordmark } from "./logo";
import { NotificationBell } from "./notification-bell";
import { AssistantPanel } from "./assistant-panel";
import { ChatDrawer } from "./chat-drawer";
import { aiConfigured, aiModels } from "@/lib/ai/gateway";

export async function AppShell({ children }: { children: ReactNode }) {
  const { user, developer, locale, t, local } = await getSession();
  const isProduction = user.role === "production";
  const savedTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const soon = (n: number) => `${t.common.phase} ${n}`;

  const unread = Number((await q<{ n: string | null }>(user.id, "select sum(unread) as n from chat_unread()"))[0]?.n ?? 0);

  const groups: NavGroup[] = isProduction
    ? [
        {
          items: [
            { href: "/factory", label: t.nav.today },
            { href: "/chat", label: t.nav.chat, badge: unread },
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
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/offers", label: t.nav.offers, also: ["/calculator"] }] : []),
            { href: "/orders", label: t.nav.orders },
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/invoices", label: t.nav.invoices }] : []),
          ],
        },
        {
          title: t.nav.tools,
          items: [
            ...((user.role === "admin" || user.role === "sales") && !user.readOnly ? [{ href: "/assistant", label: t.nav.assistant }] : []),
            { href: "/chat", label: t.nav.chat, badge: unread },
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/catalog", label: t.nav.catalog }] : []),
          ],
        },
        {
          title: t.nav.operations,
          items: [
            { href: "/inventory", label: t.nav.inventory },
            { href: "/formulas", label: t.nav.formulas },
            { href: "/deliveries", label: t.nav.deliveries },
            { href: "/production", label: t.nav.production },
            ...(user.role === "admin" ? [{ href: "/quality", label: t.nav.quality }] : []),
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/traceability", label: t.nav.traceability }] : []),
          ],
        },
        ...(user.access === "bookkeeper"
          ? [{ title: t.nav.reports, items: [{ href: "/admin", label: t.nav.adminDashboard }, { href: "/accounting", label: t.nav.accounting }] }]
          : []),
        ...(user.role === "admin"
          ? [{
              title: t.nav.reports,
              items: [
                { href: "/admin", label: t.nav.adminDashboard },
                { href: "/accounting", label: t.nav.accounting },
                ...(user.role === "admin" ? [{ href: "/inventory/corrections", label: t.nav.corrections }] : []),
                ...(user.role === "admin" ? [{ href: "/history", label: t.nav.history }] : []),
                { href: "/settings", label: t.nav.settings },
              ],
            }]
          : []),
      ];

  // Designer: the client work only
  const shown = user.access === "designer"
    ? groups.map((g) => ({ ...g, items: g.items.filter((i) => ["/", "/chat", "/clients", "/orders"].includes(i.href ?? "")) })).filter((g) => g.items.length)
    : groups;

  return (
    <div data-readonly={user.readOnly || undefined} className="flex min-h-screen flex-wrap">
      <aside className="relative flex print:hidden w-full flex-col gap-6 bg-side px-4 py-5 text-side-strong lg:w-[248px] lg:shrink-0 lg:py-6">
        <a href={isProduction ? "/factory" : "/"} className="flex flex-col gap-2 px-2 text-side-strong no-underline">
          <Wordmark height={20} inverted />
          <span className="text-[11px] font-semibold tracking-[2px] text-green">{isProduction ? t.nav.productionLabel.toUpperCase() : "ERP"}</span>
          {isProduction && <span className="text-xs text-side-muted">{t.nav.partnerFacility}</span>}
        </a>
        <MobileMenu label={t.nav.menu} closeLabel={t.nav.close}>
          <SideNav groups={shown} label={t.nav.main} />
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
            <ChatDrawer unread={unread} userId={user.id} me={user.name} isAdmin={user.role === "admin"} partner={isProduction} locale={locale} text={t.chat} />
            <NotificationBell userId={user.id} label={t.topbar.notifications} unreadLabel={t.topbar.unread} />
            <ThemeSwitch toDark={t.topbar.toDark} toLight={t.topbar.toLight} saved={savedTheme} />
            {developer && (
              <ActAsSwitch
                current={user.id}
                label={t.topbar.actAs}
                options={developer.targets.map((u) => ({ id: u.id, label: `${u.full_name} · ${t.enums.role[u.role]}` }))}
              />
            )}
            {!local && (
              <form action={signOut} className="flex min-w-0 items-center gap-3">
                <span className="hidden min-w-0 truncate text-xs font-semibold text-ink-2 lg:block">{developer?.name ?? user.name}</span>
                <button type="submit" className="btn btn-outline">{t.topbar.signOut}</button>
              </form>
            )}
          </div>
        </header>
        <main className="w-full max-w-[1360px] px-4 py-6 sm:px-8 sm:py-8">
          {user.readOnly && <p className="m-0 mb-4 text-sm font-semibold text-ink-2 print:hidden">{t.common.readOnlyNote}</p>}
          {children}
        </main>
      </div>
      {(user.role === "admin" || user.role === "sales") && (
        <AssistantPanel models={aiModels()} configured={aiConfigured()} locale={locale} text={t.assistant} keepsNothing={user.readOnly} />
      )}
    </div>
  );
}
