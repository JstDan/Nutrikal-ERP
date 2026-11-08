// Nutrikal service worker: installable app, push notifications, and a fast start on phones (owner, Nov 2026).
// Pages are never cached: every page is per user and always fresh from the server. The app's own files
// (scripts, styles, fonts, icons: their names change with every release) are kept, so the app opens at once.
const STATIC = "nk-static-v2";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  // The host serves /offline.html as /offline (a redirect); a redirected answer cannot stand for a page, so a clean copy is kept
  event.waitUntil((async () => {
    try {
      const res = await fetch(OFFLINE);
      if (res.ok) await (await caches.open(STATIC)).put(OFFLINE, new Response(await res.blob(), { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    } catch {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== STATIC) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

const immutable = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/app/") || url.pathname.startsWith("/emoji/") ||
   /\.(?:woff2?|ttf)$/.test(url.pathname));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // The app's files: from the phone at once, from the network the first time
  if (immutable(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  // A page: always the network (with the head start of navigation preload); without a network, the offline page
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const pre = await event.preloadResponse;
        if (pre) return pre;
        return await fetch(req);
      } catch {
        return (await caches.match(OFFLINE)) || new Response("Offline", { status: 503 });
      }
    })());
  }
});

// A push from the server: { title, body, link, tag }
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    const link = new URL(data.link || "/notifications", self.location.origin);
    // The person is looking at that very conversation: no notification needed
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const channel = link.pathname === "/chat" ? link.searchParams.get("c") : null;
    if (channel && wins.some((w) => w.focused && w.visibilityState === "visible" && new URL(w.url).searchParams.get("c") === channel)) return;
    await self.registration.showNotification(data.title || "Nutrikal", {
      body: data.body || "",
      icon: "/app/icon-192.png",
      badge: "/app/badge-96.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      vibrate: [80, 40, 80],
      timestamp: Date.now(),
      data: { link: link.href },
    });
  })());
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
