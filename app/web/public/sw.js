/* Service worker (spec 10.6, 11.1).

   Two deliberate rules:
   - The app shell is cached so it opens offline.
   - API responses are NEVER cached. A cached answer or a stale progress
     figure would be worse than an honest "you are offline", and a cached
     question could be replayed to game the grader.
*/
const SHELL = "mathquest-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;               // never touch writes
  if (url.pathname.startsWith("/api/")) return;          // never cache API data

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match("/index.html")))
  );
});
