import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import { q } from "@/lib/db/engine";
import { closeProductionScreen, setLocale, signOut } from "@/app/actions";
import { getSession } from "@/lib/session";
import { fmt, LOCALES } from "@/lib/i18n";
import { SideNav, type NavGroup } from "./side-nav";
import { ActAsSwitch } from "./act-as-switch";
import { ThemeSwitch } from "./theme-switch";
import { MobileTabBar, type TabItem } from "./mobile-tab-bar";
import { Wordmark } from "./logo";
import { UserAvatar } from "./user-avatar";
import { NotificationBell } from "./notification-bell";
import { NotificationsSeen } from "./notifications-seen";
import { NewVersion } from "./new-version";
import { AssistantPanel } from "./assistant-panel";
import { ChatDrawer } from "./chat-drawer";
import { aiConfigured, aiModels } from "@/lib/ai/gateway";
import { LiveProvider } from "./live";
import { PushPrompt } from "./push-prompt";
import { PullRefresh } from "./pull-refresh";
import { UiTextProvider } from "./page-actions";
import { supabaseConfigured } from "@/lib/supabase/server";

export async function AppShell({ children }: { children: ReactNode }) {
  const { user, developer, screen, locale, t, local } = await getSession();
  const isProduction = user.role === "production";
  const savedTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const soon = (n: number) => `${t.common.phase} ${n}`;

  const unread = Number((await q<{ n: string | null }>(user.id, "select sum(unread) as n from chat_unread()"))[0]?.n ?? 0);
  const clientUnread = user.role === "admin" || user.role === "sales"
    ? (await q<{ n: number }>(user.id, "select count(*)::int as n from client_messages where from_client and read_at is null"))[0]?.n ?? 0 : 0;

  const groups: NavGroup[] = isProduction
    ? [
        {
          items: [
            { href: "/factory", label: t.nav.today },
            { href: "/factory/calendar", label: t.calendar.short },
            { href: "/factory/orders", label: t.nav.productionOrders },
            { href: "/factory/stock", label: t.nav.stock },
            { href: "/factory/deliveries", label: t.nav.incoming },
            { href: "/chat", label: t.nav.clientMessages, badge: unread },
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
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/catalog", label: t.nav.catalog }] : []),
          ],
        },
        {
          title: t.nav.work,
          items: [
            { href: "/my-tasks", label: t.nav.myTasks },
            { href: "/boards", label: t.nav.boards },
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/client-messages", label: t.nav.clientMessages, badge: clientUnread }] : []),
            { href: "/chat", label: t.nav.internalChat, badge: unread },
            ...((user.role === "admin" || user.role === "sales") && !user.readOnly ? [{ href: "/assistant", label: t.nav.assistant }] : []),
          ],
        },
        {
          title: t.nav.production,
          items: [
            ...(user.role === "admin" || user.role === "sales" ? [{ href: "/production/calendar", label: t.calendar.short }] : []),
            { href: "/production", label: t.nav.batches },
            { href: "/formulas", label: t.nav.formulas },
            ...(user.role === "admin" ? [{ href: "/quality", label: t.nav.quality, also: ["/traceability"] }] : []),
            ...(user.role === "sales" ? [{ href: "/traceability", label: t.nav.traceability }] : []),
            ...(user.access === "admin" ? [{ href: "/production/screen", label: t.productionScreen.title }] : []),
          ],
        },
        {
          title: t.nav.warehouse,
          items: [
            { href: "/inventory", label: t.nav.stock },
            { href: "/deliveries", label: t.nav.deliveries },
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
                { href: "/settings", label: t.nav.settings, also: ["/history"] },
              ],
            }]
          : []),
      ];

  // Designer: the client work, and to read offers and recipes and keep the catalogue's look (owner, Nov 2026)
  const shown = user.access === "designer"
    ? groups.map((g) => ({ ...g, items: g.items.filter((i) => ["/", "/chat", "/clients", "/orders", "/offers", "/catalog", "/formulas", "/my-tasks", "/boards"].includes(i.href ?? "")) })).filter((g) => g.items.length)
    : groups;

  // On a phone the main sections sit in a bar at the foot; the rest behind More (owner, Nov 2026)
  const all = shown.flatMap((g) => g.items);
  const tabs: TabItem[] = (isProduction ? ["/factory", "/factory/calendar", "/factory/orders", "/factory/stock"] : ["/", "/clients", "/orders", "/chat", "/my-tasks"])
    .map((h) => all.find((i) => i.href === h)).filter((i): i is NonNullable<typeof i> => !!i)
    // The chat's tab has a short name
    .map((i) => ({ href: i.href!, label: i.href === "/chat" ? t.chat.tab : i.label, badge: i.badge }));
  const live = supabaseConfigured()
    ? { url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim() } : null;

  // Language, theme, acting as, one's profile and signing out: in the header on a computer, under More on a phone
  const accountControls = (where: "top" | "more") => {
    const more = where === "more";
    return (
      <>
        {more && !isProduction && (
          <a href="/signature" className="flex min-h-11 min-w-0 items-center gap-3 text-sm font-semibold text-ink no-underline">
            <UserAvatar id={developer?.id ?? user.id} size={32} /><span className="min-w-0 break-words">{developer?.name ?? user.name}</span>
          </a>
        )}
        <div className={`flex flex-wrap items-center gap-3 ${more ? "" : "contents"}`}>
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
          <ThemeSwitch toDark={t.topbar.toDark} toLight={t.topbar.toLight} saved={savedTheme} />
          {!local && more && (
            <form action={signOut} className="ml-auto"><button type="submit" className="btn btn-outline">{t.topbar.signOut}</button></form>
          )}
        </div>
        {developer && (
          <ActAsSwitch
            id={more ? "act-as-more" : "act-as"}
            current={user.id}
            label={t.topbar.actAs}
            options={[
              { id: developer.id, label: fmt(t.topbar.ownProfile, { name: developer.name }) },
              ...developer.targets.map((u) => ({ id: u.id, label: `${u.full_name} · ${t.enums.role[u.role]}` })),
            ]}
          />
        )}
        {!local && !more && (
          <form action={signOut} className="flex min-w-0 items-center gap-3">
            {isProduction ? (
              <span className="min-w-0 truncate text-xs font-semibold text-ink-2">{developer?.name ?? screen?.adminName ?? user.name}</span>
            ) : (
              // One's own e-mail signature is kept under one's name
              <a href="/signature" title={t.signature.title} className="flex min-h-11 min-w-0 items-center gap-2 truncate text-xs font-semibold text-ink-2 hover:text-ink"><UserAvatar id={developer?.id ?? user.id} size={28} />{developer?.name ?? user.name}</a>
            )}
            <button type="submit" className="btn btn-outline">{t.topbar.signOut}</button>
          </form>
        )}
      </>
    );
  };

  return (
    // The live connection: messages, typing, who is online, huddles. Pings come for the account really signed in.
    <LiveProvider config={live} userId={developer?.id ?? user.id} authId={developer?.id ?? screen?.adminId ?? user.id} name={developer?.name ?? user.name}>
    <UiTextProvider moreActions={t.common.moreActions}>
    <PullRefresh label={t.common.loading} />
    <div data-readonly={user.readOnly || undefined} className="app-ui has-tabbar flex min-h-screen flex-wrap pb-[var(--tabbar)]">
      {/* On a phone the dark strip is gone (owner, Nov 2026: the header took too much of the screen); the bar at the foot stays */}
      <aside className="relative flex print:hidden w-full flex-col gap-6 bg-side px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 text-side-strong max-lg:contents lg:sticky lg:top-0 lg:h-screen lg:w-[232px] lg:shrink-0 lg:gap-3 lg:overflow-y-auto lg:py-4 lg:[scrollbar-width:none]">
        <a href={isProduction ? "/factory" : "/"} className="hidden flex-col items-start gap-x-3 gap-y-2 px-2 text-side-strong no-underline lg:flex">
          <Wordmark height={20} inverted />
          <span className="text-[11px] font-semibold tracking-[2px] text-green">{isProduction ? t.nav.productionLabel.toUpperCase() : "ERP"}</span>
          {isProduction && <span className="text-xs text-side-muted">{t.nav.partnerFacility}</span>}
        </a>
        <div className="hidden lg:block"><SideNav groups={shown} label={t.nav.main} /></div>
        <MobileTabBar tabs={tabs} groups={shown} moreLabel={t.nav.more} closeLabel={t.nav.close} navLabel={t.nav.main}
          extra={<div className="flex flex-col gap-3 rounded-md bg-paper p-3 text-ink">{accountControls("more")}</div>} accountLabel={t.topbar.account} />
      </aside>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        {/* A phone: one row, the search and the bell; language, theme, profile and signing out sit under More */}
        <header className="flex flex-nowrap print:hidden items-center gap-2 border-b border-line bg-white px-3 pt-[max(8px,env(safe-area-inset-top))] pb-2 sm:px-8 lg:flex-wrap lg:gap-3 lg:py-3">
          {isProduction && (
            <a href="/factory" className="mr-auto flex min-h-11 items-center no-underline lg:hidden"><Wordmark height={16} /></a>
          )}
          {!isProduction && (
            <form action="/search" method="get" role="search" className="flex min-w-0 flex-[1_1_260px]">
              <label htmlFor="global-search" className="sr-only">{t.topbar.search}</label>
              <input id="global-search" name="q" type="search" placeholder={t.topbar.searchPlaceholder} className="input" />
            </form>
          )}
          <div className={`flex shrink-0 items-center gap-2 lg:flex-wrap lg:gap-3 ${isProduction ? "lg:ml-auto" : ""}`}>
            {/* The phone has the Chat tab at the foot */}
            <div className="hidden lg:contents">
              <ChatDrawer unread={unread} userId={developer?.id ?? user.id} me={developer?.name ?? user.name} isAdmin={user.role === "admin"} partner={isProduction} locale={locale} text={t.chat} gifs={!!process.env.GIPHY_API_KEY} />
            </div>
            <NotificationsSeen />
            <NewVersion />
            <NotificationBell userId={user.id} label={t.topbar.notifications} unreadLabel={t.topbar.unread} />
            <div className="hidden lg:contents">{accountControls("top")}</div>
          </div>
        </header>
        {screen && (
          // Admin in the Production screen: always in sight, with the way back
          <form action={closeProductionScreen} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-ink px-4 py-2 text-sm text-white print:hidden sm:px-8">
            <span className="min-w-0 flex-[1_1_280px] break-words">
              <strong>{fmt(t.productionScreen.banner, { admin: screen.adminName, name: user.name })}</strong> {t.productionScreen.bannerNote}
            </span>
            <button type="submit" className="btn btn-outline border-white bg-white text-ink">{t.productionScreen.close}</button>
          </form>
        )}
        <main className="w-full max-w-[1360px] px-4 py-4 sm:px-8 sm:py-8">
          {user.readOnly && <p className="m-0 mb-4 text-sm font-semibold text-ink-2 print:hidden">{t.common.readOnlyNote}</p>}
          {!screen && (!developer || developer.self) && <PushPrompt publicKey={process.env.VAPID_PUBLIC_KEY?.trim() || null} T={t.push} />}
          {children}
        </main>
      </div>
      {(user.role === "admin" || user.role === "sales") && (
        <AssistantPanel models={aiModels()} configured={aiConfigured()} locale={locale} text={t.assistant} keepsNothing={user.readOnly} />
      )}
    </div>
    </UiTextProvider>
    </LiveProvider>
  );
}
