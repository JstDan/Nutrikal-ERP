import Link from "next/link";
import { signOut } from "@/app/actions";
import { Wordmark } from "@/components/logo";
import { PortalLanguage } from "@/components/portal-language";
import { PortalNav } from "@/components/portal-nav";
import { q } from "@/lib/db/engine";
import { PUBLIC_LOCALES } from "@/lib/i18n/public";
import { getPortalSession } from "@/lib/session";

const WHATSAPP = "https://wa.me/359882919140";

/** The customer panel: its own menu, for a client account only. */
export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const { user, locale, t } = await getPortalSession();
  const P = t.portal;
  const me = user.role === "client"
    ? (await q<{ d: { client: string; unread: number } | null }>(user.id, "select portal_me() as d"))[0]?.d : null;

  if (!me) {
    return (
      <div className="app-ui">
        <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
          <div className="card flex w-full max-w-[420px] flex-col gap-4 p-6">
            <Wordmark height={22} />
            <p className="m-0">{P.noAccess}</p>
            <form action={signOut}><button type="submit" className="btn btn-outline">{P.signOut}</button></form>
          </div>
        </main>
      </div>
    );
  }

  const links = [
    { href: "/portal", text: P.nav.home }, { href: "/portal/orders", text: P.nav.orders }, { href: "/portal/documents", text: P.nav.documents },
    { href: "/portal/invoices", text: P.nav.invoices }, { href: "/portal/support", text: P.nav.support }, { href: "/portal/account", text: P.nav.account },
  ];
  return (
    <div className="app-ui flex min-h-screen flex-col bg-canvas text-ink">
      <header className="p-head print:hidden">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2">
          <Link href="/portal" aria-label={P.nav.home} className="flex min-h-11 items-center"><Wordmark height={18} inverted className="!self-center" /></Link>
          <span className="p-client order-last w-full min-w-0 text-sm leading-5 font-medium break-words text-[#dfe3ea] md:order-none md:w-auto md:flex-1 md:border-l md:border-white/25 md:pl-4">{me.client}</span>
          <div className="ml-auto flex items-center gap-3">
          <PortalLanguage label={P.language} locale={locale} options={PUBLIC_LOCALES} />
          <form action={signOut}><button type="submit" className="min-h-11 text-sm text-[#c6cdd9] underline hover:text-white">{P.signOut}</button></form>
          </div>
        </div>
        <PortalNav label={P.title} links={links} unread={me.unread} />
      </header>
      <main className="mx-auto flex w-full max-w-[1100px] min-w-0 flex-1 flex-col gap-4 px-4 py-6">{children}</main>
      <footer className="border-t border-line bg-paper print:hidden">
        <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-2 px-4 py-4 text-sm text-ink-2 md:grid-cols-3">
          {[P.trust.gmp, P.trust.trace, P.trust.team].map((x) => <span key={x} className="flex items-center gap-2"><span aria-hidden="true" className="text-[#3f8a1f]">✓</span>{x}</span>)}
        </div>
        <p className="mx-auto m-0 w-full max-w-[1100px] px-4 pb-4 text-xs text-ink-2">
          <a href="mailto:sales@nutrikal.com">sales@nutrikal.com</a> · <a href={WHATSAPP} target="_blank" rel="noopener">WhatsApp</a> · <a href="tel:+359882919140">+359 882 919 140</a>
        </p>
      </footer>
    </div>
  );
}
