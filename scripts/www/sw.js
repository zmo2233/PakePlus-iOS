/* 卡路里交易所 · Service Worker
   目的只有两个：
   1) 断网也能打开（地铁里记账不该等网络）
   2) 装到桌面后浏览器不会把站点当"临时数据"回收，本地记录更不容易被清掉

   策略刻意简单：
   - 页面导航 / index.html：网络优先，失败才用缓存 —— 这样更新完刷新就是新版，不会被旧缓存锁死
   - 图标等静态资源：缓存优先
   - 跨域请求（比如拍照识别的 CDN）：完全不碰，直接放行

   注意：缓存里只有程序文件，用户的记账数据在 localStorage，不在这里。
*/

const CACHE = 'calex-shell-v1';
const SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 跨域一律不接管

  const isDoc = req.mode === 'navigate' || req.destination === 'document';

  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
    )
  );
});
