/* ============================================================
   NOCTURNE — Service Worker
   Стратегии:
   • Навигация (HTML)      → network-first, офлайн-фоллбек на кэш оболочки
   • Статика своего origin → stale-while-revalidate
   • Запросы к API и всё кросс-доменное → не перехватываем вовсе
   ============================================================ */

const CACHE_PREFIX = "nocturne";
const CACHE_VERSION = "v1";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${CACHE_VERSION}`;

/** Минимальная оболочка: без неё приложение не откроется офлайн. */
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/images/nocturne-home.svg",
];

/** Пути, которые кэшировать нельзя ни при каких условиях. */
const NEVER_CACHE = ["/api/", "/.netlify/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      // Кэшируем по одному ресурсу: одна 404-ка не должна ломать установку.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (error) {
            console.warn("[SW] Не удалось закэшировать ресурс оболочки:", url, error);
          }
        })
      );

      // Не активируемся сами: ждём решения пользователя (кнопка «Обновить»).
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((key) => {
          const isOurs = key.startsWith(`${CACHE_PREFIX}-`);
          const isCurrent = key === SHELL_CACHE || key === ASSET_CACHE;
          return isOurs && !isCurrent ? caches.delete(key) : Promise.resolve(false);
        })
      );

      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable();
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;

  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data && data.type === "GET_VERSION") {
    event.ports?.[0]?.postMessage({ version: CACHE_VERSION });
  }
});

function isCacheableRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith(NEVER_CACHE[0]) || url.pathname.startsWith(NEVER_CACHE[1])) {
    return false;
  }
  if (request.headers.has("authorization") || request.headers.has("range")) return false;

  try {
    const cacheControl = request.cache;
    if (cacheControl === "no-store" || cacheControl === "reload") return false;
  } catch {
    /* некоторые движки не дают читать request.cache — не критично */
  }

  return true;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      cache.put("/index.html", response.clone()).catch(() => {});
    }

    return response;
  } catch {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match("/index.html")) ||
      (await cache.match("/"));

    if (cached) {
      return cached;
    }

    return new Response(
      "<!doctype html><meta charset=utf-8><title>NOCTURNE</title>" +
        '<body style="margin:0;background:#090b10;color:#f2f3f8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100dvh">' +
        '<div style="text-align:center;padding:24px"><h1 style="font-size:20px;margin:0 0 8px">Нет соединения</h1>' +
        '<p style="color:#9da6b9;font-size:14px;margin:0">Откройте приложение один раз онлайн — дальше оно работает без сети.</p></div></body>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function staleWhileRevalidate(request, url) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Не ждём сеть: отдаём кэш и обновляем его в фоне.
    network.catch(() => {});
    return cached;
  }

  const response = await network;

  if (response) return response;

  return new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(NEVER_CACHE[0]) || url.pathname.startsWith(NEVER_CACHE[1])) return;

  // Навигация — отдельная ветка: у запроса нет смысла кэшировать query.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!isCacheableRequest(request, url)) return;

  event.respondWith(staleWhileRevalidate(request, url));
});
