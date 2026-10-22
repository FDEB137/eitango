// Service Worker（docs/shiyou.md 11章）。classic script。
// VERSION は js/version.js の APP_VERSION と同じ値にする（app/ を変えたら両方上げる）。
const VERSION = "1.1.2";
const CACHE_PREFIX = "eitango-";
const CACHE_NAME = CACHE_PREFIX + VERSION;

// 先にキャッシュするファイル（sw.js 自身は入れない。app/ のファイルと一致させる。tools/kokai_check.py が確かめる）
const PRECACHE = [
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./help/csv.html",
  "./help/help.js",
  "./help/tsukaikata.html",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./js/main.js",
  "./js/pwa.js",
  "./js/version.js",
  "./js/core/backup.js",
  "./js/core/constants.js",
  "./js/core/csv.js",
  "./js/core/day.js",
  "./js/core/flow.js",
  "./js/core/migrate.js",
  "./js/core/review.js",
  "./js/core/score.js",
  "./js/db/store.js",
  "./js/ui/fukushuu.js",
  "./js/ui/home.js",
  "./js/ui/io.js",
  "./js/ui/kiroku.js",
  "./js/ui/manabu.js",
  "./js/ui/matomari.js",
  "./js/ui/nigate.js",
  "./js/ui/parts.js",
  "./js/ui/shell.js",
  "./js/ui/tangochou.js",
  "./js/ui/test.js",
  "./js/ui/torikomi.js",
];

// install: 全部をキャッシュに入れる。skipWaiting はしない（更新は利用者が「更新する」を押したときだけ）
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })))),
  );
});

// activate: 古い版のキャッシュを消す
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigateResponse(url));
    return;
  }
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((hit) => hit || fetch(request)),
  );
});

// 画面遷移: その URL のファイル（クエリ・ハッシュを除く）がキャッシュにあればそれ、無ければ index.html。
// 「./」（フォルダの URL）は index.html。別の HTML ページ（help/ など）に index.html は返さない。
async function navigateResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  if (!url.pathname.endsWith("/")) {
    const hit = await cache.match(new Request(url.origin + url.pathname), { ignoreSearch: true });
    if (hit) return hit;
  }
  const index = await cache.match(new Request(new URL("./index.html", self.registration.scope).href), { ignoreSearch: true });
  return index || fetch(url.href);
}
