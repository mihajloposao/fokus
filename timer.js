/*
 * timer.js — logika tajmera.
 *
 * Ključna ideja: tajmer NE broji sekunde u memoriji. Umesto toga, pri startu
 * se u localStorage upiše tačan timestamp početka, a proteklo vreme se uvek
 * računa kao (sada - start). Zato tajmer preživljava refresh i zatvaranje taba:
 * pri sledećem učitavanju stranice samo pročitamo start iz storage-a i
 * nastavimo računanje.
 *
 * Pravila:
 * - Samo JEDAN tajmer može biti aktivan. Start novog prvo zaustavlja stari.
 * - Svaki start→stop par se čuva kao posebna sesija { itemId, start, end },
 *   pa ista stavka može imati više odvojenih blokova na timeline-u.
 * - Pauza odmah upiše dosadašnji deo sesije u istoriju (da se ništa ne izgubi),
 *   a nakupljeno vreme pamti u pausedElapsed da bi prikaz sesije nastavio
 *   od iste vrednosti kad se tajmer ponovo pokrene.
 */

// Pokreće tajmer za datu stavku. Ako već radi tajmer za drugu stavku,
// prvo ga zaustavlja (njegov interval se sačuva u istoriju sesija).
function pokreniTajmer(itemId, datum) {
  var aktivan = ucitajAktivniTajmer();

  if (aktivan !== null && aktivan.itemId === itemId && aktivan.start === null) {
    // Ista stavka, bila je pauzirana — samo nastavljamo sesiju.
    aktivan.start = Date.now();
    sacuvajAktivniTajmer(aktivan);
    return;
  }

  if (aktivan !== null) {
    zaustaviTajmer();
  }

  sacuvajAktivniTajmer({
    itemId: itemId,
    datum: datum,
    start: Date.now(),
    pausedElapsed: 0
  });
}

// Pauzira aktivni tajmer: dosadašnji interval sesije se odmah upiše u istoriju,
// a tajmer ostaje "izabran" (start = null) da bi se mogao nastaviti.
function pauzirajTajmer() {
  var aktivan = ucitajAktivniTajmer();
  if (aktivan === null || aktivan.start === null) {
    return;
  }

  var sada = Date.now();
  upisiSesiju(aktivan.itemId, aktivan.datum, aktivan.start, sada);

  aktivan.pausedElapsed = aktivan.pausedElapsed + (sada - aktivan.start);
  aktivan.start = null;
  sacuvajAktivniTajmer(aktivan);
}

// Zaustavlja tajmer u potpunosti: upiše tekući interval u istoriju
// i obriše aktivni tajmer iz storage-a.
function zaustaviTajmer() {
  var aktivan = ucitajAktivniTajmer();
  if (aktivan === null) {
    return;
  }

  if (aktivan.start !== null) {
    upisiSesiju(aktivan.itemId, aktivan.datum, aktivan.start, Date.now());
  }
  obrisiAktivniTajmer();
}

// Upisuje jednu završenu sesiju (start→end) u podatke dana.
// Sesija se vezuje za dan u kom je tajmer pokrenut.
function upisiSesiju(itemId, datum, start, end) {
  // Sesije kraće od jedne sekunde ne čuvamo (slučajan dupli klik).
  if (end - start < 1000) {
    return;
  }
  var dan = ucitajDan(datum);
  dan.sessions.push({ itemId: itemId, start: start, end: end });
  sacuvajDan(datum, dan);
}

// Vraća proteklo vreme TEKUĆE sesije u milisekundama
// (nakupljeno pre pauze + vreme od poslednjeg starta).
function protekloSesije(tajmer, sada) {
  var proteklo = tajmer.pausedElapsed;
  if (tajmer.start !== null) {
    proteklo = proteklo + (sada - tajmer.start);
  }
  return proteklo;
}

// Da li tajmer trenutno stvarno broji (nije pauziran)?
function tajmerRadi(tajmer) {
  return tajmer !== null && tajmer.start !== null;
}
