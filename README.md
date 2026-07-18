# Fokus

Lična aplikacija za praćenje dnevnog rasporeda učenja tokom ispitnih rokova.
Jednokorisnička, bez logina i bez servera — svi podaci žive u `localStorage`
browsera. Plain HTML + CSS + vanilla JavaScript, bez frameworka i build alata.

## Struktura fajlova

| Fajl                | Šta radi |
|---------------------|----------|
| `index.html`        | Sav markup: 4 ekrana (Danas, Plan, Istorija, Detalj dana) + donja navigacija |
| `style.css`         | Svi stilovi, "Ink + Paper" vizuelni identitet, mobile-first |
| `app.js`            | **Deo 1 (planovi)** — stanje UI-ja, kalkulacije iz sirovih podataka i render funkcije po ekranu |
| `kilaza-trening.js` | **Deo 2 (izdvojeno, ne učitava se)** — kilaža, treninzi i obroci; vidi „Dva dela" niže |
| `storage.js`        | Čitanje/pisanje podataka — jedini fajl koji zna kako se podaci čuvaju |
| `timer.js`          | Logika tajmera (start/pauza/stop) sa "preživljavanjem" refresh-a |
| `manifest.json`     | PWA manifest — omogućava "Dodaj na početni ekran" na telefonu |
| `service-worker.js` | Minimalni keš da aplikacija radi offline |
| `icon-192.png`, `icon-512.png` | Ikonice aplikacije |

## Dva dela: planovi (aktivno) i kilaža/trening (izdvojeno)

Aplikacija je namerno podeljena na dva dela:

- **Deo 1 — planovi (poenta aplikacije, jedino što se prikazuje).** Danas, Plan
  (fiksni događaji, stavke sa ciljem, obaveze), Istorija i Detalj dana. Ceo kod
  je u `app.js` + `index.html`.
- **Deo 2 — kilaža, treninzi i obroci (izdvojeno, ne prikazuje se).** Sav kod je
  premešten u `kilaza-trening.js`, koji se **ne učitava** u `index.html`. Zato se
  ovi delovi ne vide, ali ništa nije obrisano — kod stoji netaknut, a podaci i
  dalje žive u bazi (Supabase), pa se ne gube.

Kako su spojeni: `app.js` nikad ne poziva Deo 2 direktno, već kroz proveru
`deo2Aktivan()` (`typeof renderKilaza === "function"`). Dok `kilaza-trening.js`
nije učitan, ta provera je `false` i svi „kuke" za kilažu/trening/obroke se
preskaču. Zavisnost ide samo u jednom smeru: Deo 2 sme da koristi funkcije iz
Dela 1, nikad obrnuto.

**Da ponovo uključiš Deo 2** (ako opet zatrebaju kilaža/trening/obroci):

1. U `index.html` otkomentariši `<script src="kilaza-trening.js"></script>`
   (stoji odmah ispod `<script src="app.js">`).
2. U `index.html` otkomentariši HTML blokove označene sa `DEO 2 (sakriveno)`:
   dugme „Kilaža" u donjoj navigaciji, sekcije `#sekcija-kilaza` i
   `#sekcija-trening`, TRENING blok na Plan ekranu i `#detalj-obroci`.
3. Povećaj verziju keša u `service-worker.js` i dodaj `kilaza-trening.js` u
   listu `FAJLOVI`.

U `app.js` ništa ne treba dirati — kuke se same aktiviraju čim se skripta učita.

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
