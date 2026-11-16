'use strict';

// 發佈介面變更時建議增加版本；連網時一律先向伺服器取得最新檔案，離線才使用快取。
const CACHE_PREFIX = `leave-shell:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v9`;
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const SHELL_FILES = [
  './index.html', './style.css', './app.js', './config.js', './pwa.js',
  './manifest.webmanifest', './icons/icon-192.png',
  './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const SHELL_URLS = SHELL_FILES.map((file) => new URL(file, self.registration.scope).href);
const HOME = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // CDN SDK 也需成功快取，才將此版本視為可離線開啟。
    await cache.addAll([...SHELL_URLS, SDK_URL]);
    // 立即接手，避免舊版 Service Worker 繼續從快取提供過期介面。
    // 已開啟的頁面不會被重新載入，正在填寫的內容不受影響。
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      // 同時清除改版前「報修登記」「加班申請」留下的舊快取。
      const legacy = ['repair-shell', 'overtime-shell'].some((prefix) => name.startsWith(`${prefix}:${self.registration.scope}:`));
      if ((name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) || legacy) await caches.delete(name);
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
    // 網路優先：連網時向伺服器重新驗證並更新快取，確保看到最新版本；離線時才使用快取。
    try {
      const response = await fetch(cachedUrl, { cache: 'no-cache' });
      if (response.ok) await cache.put(cachedUrl, response.clone());
      return response;
    } catch {
      const cached = await cache.match(cachedUrl);
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});
