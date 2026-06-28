// Firebase Messaging SDK を先にインポート（バックグラウンド通知のため）
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyBf7L09bVFEpPsOY9nth0tet6FQYZgQENE',
  authDomain:        'task-calender-10990.firebaseapp.com',
  projectId:         'task-calender-10990',
  storageBucket:     'task-calender-10990.firebasestorage.app',
  messagingSenderId: '95915166506',
  appId:             '1:95915166506:web:11afad7c7f10dbc8faac53',
});

// バックグラウンド受信：FCM SDK が notification ペイロードを自動表示するので
// onBackgroundMessage で showNotification を呼ばない（呼ぶと二重表示になる）
const messaging = firebase.messaging();

// ── PWA キャッシュ（network-first / no-store）────────────────
// taskapp-v4：Firebase Messaging 対応版
const CACHE = 'taskapp-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sheets.js',
  './push.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// network-first（no-store）：常にサーバーから最新を取得
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Firebase CDN は毎回ネットから取得しない（キャッシュを活用）
  if (e.request.url.includes('firebasejs') || e.request.url.includes('gstatic.com')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
