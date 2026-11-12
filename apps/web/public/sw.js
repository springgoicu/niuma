/*
 * 牛马 NIOMA · 直通 Service Worker
 *
 * Chromium 的可安装判据要求站点有一份「带 fetch 处理器」的 SW，但园区不需要离线：
 * 这里只注册监听，不调用 respondWith、不写任何缓存，所有请求照常走网络。
 *
 * 因此它不会和 BuildWatcher 的 `?__v=` 强刷、`/api/version` 轮询以及图集的
 * `no-cache` 策略打架——SW 从不返回旧响应。文件字节一变浏览器就会更新它。
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 空监听：不 respondWith 等于透明放行；仅用于满足安装判据。
self.addEventListener('fetch', () => {});
