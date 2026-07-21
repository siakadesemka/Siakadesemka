/**
 * Service Worker sederhana untuk SIAKAD ESEMKASA.
 * Tujuan utamanya membuat aplikasi memenuhi syarat "Installable" (bisa
 * dipasang ke HP/Laptop), plus cache ringan untuk app-shell agar tetap
 * bisa dibuka saat koneksi lambat/terputus sebentar.
 *
 * PENTING: Service worker ini SENGAJA tidak menyimpan cache untuk permintaan
 * ke Google Apps Script (data sekolah) atau ke CDN pihak ketiga - permintaan
 * itu selalu diteruskan langsung ke jaringan, supaya data absensi/jurnal
 * selalu yang terbaru dan tidak "nyangkut" di cache.
 */

const CACHE_NAME = "siakad-esemkasa-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-96.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Hanya tangani permintaan GET ke origin yang sama (app-shell).
  // Permintaan ke domain lain (Google Apps Script, CDN unpkg, dsb.)
  // dibiarkan lewat langsung ke jaringan tanpa campur tangan cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
