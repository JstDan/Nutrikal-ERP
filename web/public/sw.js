// Nutrikal service worker: makes the app installable and shows push notifications (owner, Nov 2026).
// Pages are never cached: every page is per user and always fresh from the server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A push from the server: { title, body, link, tag }
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Nutrikal", {
    body: data.body || "",
    icon: "/app/icon-192.png",
    badge: "/app/icon-192.png",
    tag: data.tag || undefined,
    data: { link: data.link || "/notifications" },
  }));
});

// Opening a notification goes to what it is about, in an open window of the app when there is one
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && "navigate" in w) {
        await w.focus();
        return w.navigate(link);
      }
    }
    return self.clients.openWindow(link);
  })());
});
