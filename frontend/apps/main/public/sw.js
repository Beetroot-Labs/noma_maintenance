const CACHE_VERSION = "__CACHE_VERSION__";
const resolvedVersion = CACHE_VERSION === "__CACHE_VERSION__" ? "dev" : CACHE_VERSION;
const CACHE_NAME = `noma-maintenance-${resolvedVersion}`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.json",
  "./favicon.ico",
  "./logo-white.webp",
  "./app-images/android/android-launchericon-192-192.png",
  "./app-images/android/android-launchericon-512-512.png",
  "./app-images/ios/180.png",
  "./app-images/ios/32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  const isNavigationRequest =
    event.request.mode === "navigate" || event.request.destination === "document";

  event.respondWith(
    (async () => {
      if (isNavigationRequest) {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, response.clone());
          }
          return response;
        } catch {
          const cachedNavigation = await caches.match(event.request);
          if (cachedNavigation) return cachedNavigation;
          const cachedIndex = await caches.match("./index.html");
          return cachedIndex ?? Response.error();
        }
      }

      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const responseClone = response.clone();
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, responseClone);
        }
        return response;
      } catch {
        return cached ?? Response.error();
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((key) => caches.delete(key))),
      ),
    );
    self.skipWaiting();
  }
});
