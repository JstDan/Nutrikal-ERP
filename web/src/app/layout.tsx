import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Nutrikal ERP",
  description: "Nutrikal ERP + CRM — sales, inventory and production",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale } = await getSession();
  return (
    // Browser extensions add attributes to <html> before React loads; ignore those (this element only)
    <html lang={locale} suppressHydrationWarning>
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
