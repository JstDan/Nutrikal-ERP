import type { MetadataRoute } from "next";

// The app installs on a phone or computer like an app (owner, Nov 2026): its own icon, full screen, no browser bar.
// The same manifest serves the team (app.nutrikal.com) and clients (portal.nutrikal.com: "/" opens the customer panel).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nutrikal",
    short_name: "Nutrikal",
    description: "Nutrikal ERP + CRM",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#222831",
    theme_color: "#222831",
    icons: [
      { src: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
