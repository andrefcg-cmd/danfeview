'use strict';

// Cache apenas do "app shell" (interface). Nunca cacheia chamadas ao agente
// (localhost:7890) nem dados fiscais — esses precisam ser sempre frescos.
const CACHE = 'isapaes-nfe-v18';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Deixa passar direto qualquer chamada ao agente local
  if (url.port === '7890' || url.hostname === 'localhost') return;
  // App shell: cache-first
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
