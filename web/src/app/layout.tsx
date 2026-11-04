import type { Metadata } from "next";
import "./globals.css";
import { getLocale, getOptionalSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { CATALOG_THEME_COOKIE, THEME_COOKIE } from "@/lib/theme";
import { cookies, headers } from "next/headers";

export const metadata: Metadata = {
  title: "Nutrikal ERP",
  description: "Nutrikal ERP + CRM — sales, inventory and production",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The open catalogue has no menu and no user, also for someone signed in
  const h = await headers();
  const open = h.get("x-nk-public") === "1";
  const session = open ? null : await getOptionalSession();
  const locale = open ? (h.get("x-nk-locale") ?? "en") : await getLocale();
  const jar = await cookies();
  const saved = jar.get(THEME_COOKIE)?.value;
  // The open catalogue starts light and turns dark only with its own header button; the system setting never changes it (owner, Nov 2026)
  const theme = open ? (jar.get(CATALOG_THEME_COOKIE)?.value === "dark" ? "dark" : "light") : saved === "dark" || saved === "light" ? saved : undefined;
  return (
    // Browser extensions add attributes to <html> before React loads; ignore those (this element only)
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800&family=Noto+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        {session && session.user.role !== "client" ? <AppShell>{children}</AppShell> : children}
      </body>
    </html>
  );
}
