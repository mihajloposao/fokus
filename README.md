# Fokus

Lična aplikacija za praćenje dnevnog rasporeda učenja tokom ispitnih rokova.
Jednokorisnička, bez logina i bez servera — svi podaci žive u `localStorage`
browsera. Plain HTML + CSS + vanilla JavaScript, bez frameworka i build alata.

## Struktura fajlova

| Fajl                | Šta radi |
|---------------------|----------|
| `index.html`        | Sav markup: 4 ekrana (Danas, Plan, Istorija, Detalj dana) + donja navigacija |
| `style.css`         | Svi stilovi, "Ink + Paper" vizuelni identitet, mobile-first |
| `app.js`            | Stanje UI-ja, kalkulacije iz sirovih podataka i render funkcije po ekranu |
| `storage.js`        | Čitanje/pisanje `localStorage`-a — jedini fajl koji zna kako se podaci čuvaju |
| `timer.js`          | Logika tajmera (start/pauza/stop) sa "preživljavanjem" refresh-a |
| `manifest.json`     | PWA manifest — omogućava "Dodaj na početni ekran" na telefonu |
| `service-worker.js` | Minimalni keš da aplikacija radi offline |
| `icon-192.png`, `icon-512.png` | Ikonice aplikacije |

## Kako radi tajmer (najvažniji deo)

Pri startu se u `localStorage` upiše **tačan timestamp početka**, a proteklo
vreme se uvek računa kao `sada - start`. Zato refresh ili zatvaranje taba ne
gube ništa: pri sledećem učitavanju se start pročita iz storage-a i prikaz
nastavlja odatle. Svaki start→stop par se čuva kao posebna sesija, pa timeline
može da prikaže više odvojenih blokova za istu stavku.

## Pokretanje lokalno

Bilo koji statički server, npr:

```
python -m http.server 8000
```

pa otvori `http://localhost:8000`. (Može i duplim klikom na `index.html`,
samo tada ne radi service worker / offline režim.)

## Objavljivanje nove verzije

Kad izmeniš bilo koji fajl, povećaj verziju keša u `service-worker.js`
(`fokus-v1` → `fokus-v2`) da bi instalirane kopije povukle novu verziju.

## Deploy (Netlify ili Vercel, besplatno)

Vidi uputstvo na dnu ovog fajla ili u poruci uz projekat:

1. Napravi GitHub nalog (ako ga nemaš) i nov repozitorijum, npr. `fokus`.
2. U folderu projekta pokreni:
   ```
   git init
   git add .
   git commit -m "Fokus aplikacija"
   git branch -M main
   git remote add origin https://github.com/TVOJ-NALOG/fokus.git
   git push -u origin main
   ```
3. Na [netlify.com](https://netlify.com) (ili [vercel.com](https://vercel.com)) napravi nalog — najlakše "Sign up with GitHub".
4. Klikni **Add new site → Import an existing project** (Netlify), tj. **Add New → Project** (Vercel).
5. Izaberi svoj `fokus` repozitorijum.
6. Build podešavanja ostavi prazna (nema build komande, publish directory je koren repozitorijuma).
7. Klikni **Deploy** — za minut dobijaš javni URL (npr. `fokus.netlify.app`).
8. Otvori taj URL na telefonu i izaberi **Add to Home Screen / Dodaj na početni ekran** — aplikacija se instalira kao PWA.
9. Za svaku sledeću izmenu: povećaj verziju u `service-worker.js`, pa `git add . && git commit -m "opis" && git push` — sajt se sam ponovo objavi.

> Alternativa bez git-a: na Netlify postoji i "Deploy manually" (drag & drop) —
> samo prevuci ceo folder u browser. Mana: svaku izmenu moraš ručno ponovo da prevučeš.
