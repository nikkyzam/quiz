/* Service worker (spec 10.6, 11.1).

   Two deliberate rules:
   - The app shell is cached so it opens offline.
   - API responses are NEVER cached. A cached answer or a stale progress
     figure would be worse than an honest "you are offline", and a cached
     question could be replayed to game the grader. Offline practice packs
     live in IndexedDB (src/offline.ts), fetched explicitly by the learner,
     not by this worker.
*/
const SHELL = "mathquest-shell-v2";
const SHELL_FILES = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

/* The built shell: Vite fingerprints its JS and CSS, so the asset names are
   read out of index.html at install time rather than listed here. A missing
   asset must not fail the install; it is fetched and cached on first use. */
async function precacheBuiltShell(cache) {
  try {
    const res = await fetch("/index.html", { cache: "no-cache" });
    if (!res.ok) return;
    const html = await res.text();
    const assets = new Set();
    for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assets.add(m[1]);
    await Promise.all([...assets].map(a => cache.add(a).catch(() => {})));
  } catch { /* offline at install time: the shell files already cached still work */ }
}

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES).then(() => precacheBuiltShell(c)))
      .then(() => self.skipWaiting())
  );
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
