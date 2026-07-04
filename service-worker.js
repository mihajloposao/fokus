/*
 * service-worker.js — minimalni keš da aplikacija radi offline.
 *
 * Strategija "cache-first": pri instalaciji se svi fajlovi aplikacije snime
 * u keš, a svaki zahtev se prvo služi iz keša (pa tek onda sa mreže).
 * Podaci korisnika NISU ovde — oni žive u localStorage.
 *
 * VAŽNO: kad izmeniš bilo koji fajl aplikacije, povećaj broj verzije u
 * KES_NAZIV (npr. "fokus-v2") da bi korisnici dobili novu verziju.
 */

var KES_NAZIV = "fokus-v1";

var FAJLOVI = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./timer.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Pri instalaciji: snimi sve fajlove aplikacije u keš.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(KES_NAZIV).then(function (kes) {
      return kes.addAll(FAJLOVI);
    })
  );
  self.skipWaiting();
});

// Pri aktivaciji: obriši keševe starih verzija.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (nazivi) {
      return Promise.all(
        nazivi
          .filter(function (naziv) { return naziv !== KES_NAZIV; })
          .map(function (naziv) { return caches.delete(naziv); })
      );
    })
  );
  self.clients.claim();
});

// Svaki zahtev: prvo iz keša, ako nema — sa mreže.
self.addEventListener("fetch", function (event) {
  event.respondWith(
    caches.match(event.request).then(function (odgovor) {
      return odgovor || fetch(event.request);
    })
  );
});
