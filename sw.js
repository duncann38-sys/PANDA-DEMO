/* Panda PWA service worker — minimal app-shell cache so the installed app
   opens instantly and works even on a flaky connection. */
const CACHE = "panda-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.json",
  "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache API/venue data or cross-origin calls — always go to network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("venues.json") || url.pathname.includes("/api/")) return;

  // App shell: network-first, fall back to cache when offline.
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match("./index.html")))
  );
});
