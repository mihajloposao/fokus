/*
 * storage.js — čuvanje i čitanje podataka iz localStorage.
 *
 * Ovaj fajl NE zna ništa o UI-ju. Samo čita i piše sirove podatke.
 *
 * Struktura podataka u localStorage:
 *
 * Ključ "fokus-data" — objekat po danima, ključ je datum "YYYY-MM-DD":
 *   {
 *     "2026-07-04": {
 *       fixedEvents: [ { naziv, od: "09:00", do: "10:30" } ],
 *       items:       [ { id, naziv, boja, ciljMinuta } ],
 *       sessions:    [ { itemId, start: timestamp_ms, end: timestamp_ms } ],
 *       obaveze:     [ { id, naziv, checkedAt: timestamp_ms | null } ],
 *       ocena:       0,     // ocena dana 0–5 (opciono; 0 = neocenjeno)
 *       beleska:     ""     // beleška o danu (opciono)
 *     }
 *   }
 *
 * Obaveza je aktivnost bez tajmera — samo se čekira; checkedAt pamti tačan
 * trenutak čekiranja (null = još nije urađena).
 *
 * Ključ "fokus-active-timer" — trenutno aktivan tajmer ili null:
 *   { itemId, datum, start: timestamp_ms | null, pausedElapsed: ms }
 *   - start je pravi timestamp početka tekuće sesije (da tajmer preživi refresh)
 *   - start === null znači da je tajmer pauziran
 *   - pausedElapsed je vreme sesije nakupljeno PRE poslednje pauze
 */

var KLJUC_PODACI = "fokus-data";
var KLJUC_TAJMER = "fokus-active-timer";

// Učitava ceo objekat sa svim danima. Ako ništa nije sačuvano, vraća prazan objekat.
function ucitajSvePodatke() {
  var sirovo = localStorage.getItem(KLJUC_PODACI);
  if (sirovo === null) {
    return {};
  }
  return JSON.parse(sirovo);
}

// Snima ceo objekat sa svim danima nazad u localStorage.
function sacuvajSvePodatke(podaci) {
  localStorage.setItem(KLJUC_PODACI, JSON.stringify(podaci));
}

// Vraća podatke za jedan dan. Ako dan ne postoji, vraća prazan dan
// (ne upisuje ga u storage — upis se dešava tek kad se nešto stvarno doda).
function ucitajDan(datum) {
  var podaci = ucitajSvePodatke();
  if (podaci[datum]) {
    return podaci[datum];
  }
  return { fixedEvents: [], items: [], sessions: [], obaveze: [] };
}

// Snima podatke za jedan dan.
function sacuvajDan(datum, dan) {
  var podaci = ucitajSvePodatke();
  podaci[datum] = dan;
  sacuvajSvePodatke(podaci);
}

// Da li za dati datum postoji sačuvan plan (bar jedna stavka ili obaveza)?
// Koristi se u Istoriji da se razlikuje "bez plana" od "plan postoji".
function danImaPlan(datum) {
  var podaci = ucitajSvePodatke();
  var dan = podaci[datum];
  if (!dan) return false;
  return dan.items.length > 0 || (dan.obaveze && dan.obaveze.length > 0);
}

// Vraća aktivni tajmer ili null ako nijedan tajmer ne radi.
function ucitajAktivniTajmer() {
  var sirovo = localStorage.getItem(KLJUC_TAJMER);
  if (sirovo === null) {
    return null;
  }
  return JSON.parse(sirovo);
}

// Snima aktivni tajmer.
function sacuvajAktivniTajmer(tajmer) {
  localStorage.setItem(KLJUC_TAJMER, JSON.stringify(tajmer));
}

// Briše aktivni tajmer (poziva se kad se tajmer zaustavi).
function obrisiAktivniTajmer() {
  localStorage.removeItem(KLJUC_TAJMER);
}

/*
 * Kilaža (praćenje težine) — poseban ključ, nezavisan od dnevnog plana:
 *   { unosi: { "YYYY-MM-DD": kg }, cilj: number | null }
 * Jedan unos po danu; cilj je opciona ciljna težina (null = nije postavljen).
 */
var KLJUC_KILAZA = "fokus-kilaza";

// Učitava ceo objekat kilaže; ako ništa nije sačuvano, vraća prazan.
function ucitajKilazu() {
  var sirovo = localStorage.getItem(KLJUC_KILAZA);
  if (sirovo === null) {
    return { unosi: {}, cilj: null };
  }
  var o = JSON.parse(sirovo);
  if (!o.unosi) o.unosi = {};
  if (o.cilj === undefined) o.cilj = null;
  return o;
}

// Snima ceo objekat kilaže.
function sacuvajKilazu(kilaza) {
  localStorage.setItem(KLJUC_KILAZA, JSON.stringify(kilaza));
}
