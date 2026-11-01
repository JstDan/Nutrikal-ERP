import Link from "next/link";
import { setLocale, signOut } from "@/app/actions";
import { Wordmark } from "@/components/logo";
import { q } from "@/lib/db/engine";
import { LOCALES } from "@/lib/i18n";
import { getPortalSession } from "@/lib/session";

/** The customer panel: its own menu, for a client account only. */
export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const { user, locale, t } = await getPortalSession();
  const P = t.portal;
  const me = user.role === "client"
    ? (await q<{ d: { client: string; unread: number } | null }>(user.id, "select portal_me() as d"))[0]?.d : null;

  const notice = (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="card flex w-full max-w-[420px] flex-col gap-4 p-6">
        <Wordmark height={22} />
        <p className="m-0">{P.noAccess}</p>
        <form action={signOut}><button type="submit" className="btn btn-outline">{P.signOut}</button></form>
      </div>
    </main>
  );
  if (!me) return <div className="app-ui">{notice}</div>;

  const links: [string, string][] = [
    ["/portal", P.nav.home], ["/portal/orders", P.nav.orders], ["/portal/documents", P.nav.documents],
    ["/portal/invoices", P.nav.invoices], ["/portal/support", P.nav.support], ["/portal/account", P.nav.account],
  ];
  return (
    <div className="app-ui flex min-h-screen flex-col bg-canvas text-ink">
      <header className="border-b border-line bg-paper print:hidden">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <Link href="/portal" aria-label={P.nav.home} className="flex min-h-11 items-center"><Wordmark height={18} /></Link>
          <span className="min-w-0 flex-1 text-sm text-ink-2 break-words">{me.client}</span>
          <form action={setLocale} className="flex">
            {LOCALES.map((l) => (
              <button key={l} type="submit" name="locale" value={l} aria-pressed={l === locale}
                className={`min-h-11 min-w-11 px-2 text-xs font-semibold uppercase ${l === locale ? "text-ink" : "text-ink-2"}`}>{l}</button>
            ))}
          </form>
          <form action={signOut}><button type="submit" className="min-h-11 text-sm text-ink-2 underline">{P.signOut}</button></form>
        </div>
        <nav aria-label={P.title} className="mx-auto flex w-full max-w-[1100px] flex-wrap gap-x-5 px-4">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink no-underline hover:underline">
              {label}
              {href === "/portal/support" && me.unread > 0 && <span className="rounded-full bg-ink px-1.5 text-xs text-white">{me.unread}</span>}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1100px] min-w-0 flex-1 flex-col gap-4 px-4 py-6">{children}</main>
    </div>
  );
}
