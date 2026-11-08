import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLocale, getOptionalSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { PwaRegister } from "@/components/pwa-register";
import { CATALOG_THEME_COOKIE, THEME_COOKIE } from "@/lib/theme";
import { cookies, headers } from "next/headers";
import { Inter, Montserrat, Noto_Sans, Poppins } from "next/font/google";

// The fonts come from the app itself (owner, Nov 2026: a faster phone app): no trip to Google before a page shows,
// and the phone keeps them. Inter for the signed-in app; Poppins (Montserrat for Cyrillic, Noto Sans for Greek) for the open catalogue.
const inter = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--nk-inter", display: "swap" });
const poppins = Poppins({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"], variable: "--nk-poppins", display: "swap", preload: false });
const montserrat = Montserrat({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--nk-montserrat", display: "swap", preload: false });
const noto = Noto_Sans({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], variable: "--nk-noto", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Nutrikal ERP",
  description: "Nutrikal ERP + CRM — sales, inventory and production",
  // Installed on a phone it opens full screen with its own icon (owner, Nov 2026)
  appleWebApp: { capable: true, title: "Nutrikal", statusBarStyle: "black-translucent" },
  icons: { apple: "/app/apple-touch-icon.png" },
};

// cover: the bar at the foot keeps clear of the iPhone home line itself (env(safe-area-inset-bottom))
// resizes-content: the phone's keyboard makes the page shorter, so the chat's box and buttons stay above it
export const viewport: Viewport = { themeColor: "#222831", viewportFit: "cover", interactiveWidget: "resizes-content" };

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
    <html lang={locale} data-theme={theme} suppressHydrationWarning className={`${inter.variable} ${poppins.variable} ${montserrat.variable} ${noto.variable}`}>
      <body>
        {!open && <PwaRegister />}
        {session && session.user.role !== "client" ? <AppShell>{children}</AppShell> : children}
      </body>
    </html>
  );
}
