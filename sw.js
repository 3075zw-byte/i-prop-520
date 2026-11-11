'use strict';

// 發佈介面變更時須增加版本，讓新檔案整組快取，不混用新舊版本。
const CACHE_PREFIX = `repair-shell:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const SHELL_FILES = [
  './index.html', './style.css', './app.js', './config.js', './pwa.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const SHELL_URLS = SHELL_FILES.map((file) => new URL(file, self.registration.scope).href);
const HOME = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // CDN SDK 也需成功快取，才將此版本視為可離線開啟。
    await cache.addAll([...SHELL_URLS, SDK_URL]);
  })());
  // 不強制取代正在使用的舊版，避免打斷填表或清空輸入。
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  let cachedUrl = url.href;
  if (url.origin === self.location.origin) {
    // 僅快取應用程式檔案，不攔截其他頁面，也不快取資料庫或使用者內容。
    url.search = '';
    url.hash = '';
    cachedUrl = url.href;
    if (cachedUrl === self.registration.scope) cachedUrl = HOME;
    if (!SHELL_URLS.includes(cachedUrl)) return;
  } else if (cachedUrl !== SDK_URL) {
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cachedUrl);
    return cached || fetch(request);
  })());
});
