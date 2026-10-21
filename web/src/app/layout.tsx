import type { Metadata } from "next";
import "./globals.css";
import { getLocale, getOptionalSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { THEME_COOKIE } from "@/lib/theme";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Nutrikal ERP",
  description: "Nutrikal ERP + CRM — sales, inventory and production",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalSession();
  const locale = await getLocale();
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  return (
    // Browser extensions add attributes to <html> before React loads; ignore those (this element only)
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>
        {session ? <AppShell>{children}</AppShell> : children}
      </body>
    </html>
  );
}
