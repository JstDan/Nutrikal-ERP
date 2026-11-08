import type { MetadataRoute } from "next";
import { headers } from "next/headers";

// The app installs on a phone or computer like an app (owner, Nov 2026): its own icon, full screen, no browser bar.
// The same manifest serves the team (app.nutrikal.com) and clients (portal.nutrikal.com: "/" opens the customer panel).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // The customer panel has none of the team's places
  const host = ((await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  const portal = host === (process.env.PORTAL_HOST?.trim() || "portal.nutrikal.com");
  return {
    name: "Nutrikal",
    short_name: "Nutrikal",
    description: "Nutrikal ERP + CRM",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    // Long press on the app icon (Android): straight to the most used places
    shortcuts: portal ? [] : [
      { name: "Чат · Chat", short_name: "Chat", url: "/chat", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "Поръчки · Orders", short_name: "Orders", url: "/orders", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "Моите задачи · My tasks", short_name: "Tasks", url: "/my-tasks", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
      { name: "Известия · Notifications", short_name: "Alerts", url: "/notifications", icons: [{ src: "/app/icon-192.png", sizes: "192x192" }] },
    ],
    categories: ["business", "productivity"],
    background_color: "#222831",
    theme_color: "#222831",
    icons: [
      { src: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
