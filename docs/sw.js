const CACHE = "boss-v43";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDoc = req.mode === "navigate" || req.destination === "document" ||
                url.pathname.endsWith("/") || url.pathname.endsWith("index.html");

  if (isDoc) {
    // RÉSEAU D'ABORD : toujours la dernière version en ligne, repli cache hors-ligne.
    e.respondWith(
      fetch(req).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put("./index.html", cp));
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // Autres ressources : cache d'abord, réseau ensuite.
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(resp => {
      const cp = resp.clone();
      caches.open(CACHE).then(c => c.put(req, cp));
      return resp;
    }))
  );
});
