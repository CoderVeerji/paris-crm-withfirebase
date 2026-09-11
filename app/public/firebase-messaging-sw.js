/* Service worker — FCM background push + basic offline app-shell fallback.
   Same file poore scope (/) ko control karta hai, isliye dono kaam yahi karte hain
   (do alag service worker rakhne se scope clash ho jaata — ek hi kaafi hai). */

importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDp1I8EluT0vn5F5buuiEaT0Q0Uv_XM47w',
  authDomain: 'paris-crm.firebaseapp.com',
  projectId: 'paris-crm',
  storageBucket: 'paris-crm.firebasestorage.app',
  messagingSenderId: '806081881341',
  appId: '1:806081881341:web:3de692cb64bd952b7e0a94',
});

const messaging = firebase.messaging();

// App band ho ya background mein ho — yahan se lock-screen notification dikhता hai.
// (Server sirf "data" bhejta hai, "notification" nahi — warna browser khud bhi ek dikha deta,
// duplicate ho jaata. Isi wajah se yahan title/body payload.data se padhte hain.)
messaging.onBackgroundMessage((payload) => {
  const title = payload.data?.title || 'Paris CRM';
  const body = payload.data?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
  });
});

// Notification pe tap -> app khol do (ya focus karo agar pehle se khuli hai). Agar notification
// kisi lead se judi hai (data.leadId) to seedha wahi lead khol do.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const leadId = (event.notification.data && event.notification.data.leadId) || '';
  const target = leadId ? `/?lead=${encodeURIComponent(leadId)}` : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (leadId && c.postMessage) c.postMessage({ type: 'open-lead', leadId });
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});

// ---------- basic offline fallback (app-shell) ----------
// Cache version — is file ka koi bhi change (jaise ye string) naya SW install trigger karta hai,
// jo purana cache saaf karke fresh '/' rakh leta hai. Deploy pe bump kar dena.
const SHELL_CACHE = 'paris-crm-shell-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // fresh index.html cache karo (HTTP cache bypass)
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.add(new Request('/', { cache: 'reload' }))).catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // index.html / navigation: HAMESHA network (fresh bundle-hash ke liye) — sirf offline pe cached.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {}); }
        return res;
      }).catch(() => caches.match('/')),
    );
    return;
  }

  // hashed assets (assets/index-XXXX.js) — content-hashed, kabhi badalte nahi: cache-first, tez.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
        return res;
      })),
    );
    return;
  }

  // baaki: network-first, offline pe cache.
  event.respondWith(
    fetch(request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(request)),
  );
});
