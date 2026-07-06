/*
 * app.js — stanje aplikacije, kalkulacije i render funkcije.
 *
 * Princip: svi prikazi se računaju iz sirovih podataka (sesije + planovi)
 * pri svakom renderu. Ništa izračunato se ne čuva u storage, pa ne može
 * doći do neusklađenosti.
 *
 * Redosled u fajlu: konstante → datumi → formatiranje → kalkulacije →
 * navigacija → render po ekranu → akcije korisnika → init.
 */

/* ===================== KONSTANTE ===================== */

// Paleta boja za stavke ("Ink + Paper" dizajn). Boja se bira pri dodavanju
// stavke i koristi se svuda: dot pored naziva, blok na traci, linija u statistici.
var PALETA = ["#44659e", "#3d8f6f", "#b3833f", "#7b6cb2", "#3f8ea3", "#b25b5b"];

var DANI = ["Nedelja", "Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota"];
var DANI_KRATKO = ["NED", "PON", "UTO", "SRE", "ČET", "PET", "SUB"];
var MESECI = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];
var MESECI_KRATKO = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Avg", "Sep", "Okt", "Nov", "Dec"];

/* ===================== STANJE UI ===================== */

// Sve što UI pamti između rendera, a NE čuva se u localStorage.
var stanje = {
  sekcija: "danas",          // koja je sekcija otvorena: danas | plan | istorija | detalj
  planDatum: null,            // datum koji se planira (postavlja se u init)
  detaljDatum: null,          // datum otvoren na ekranu Detalj dana
  mesecOffset: 0,             // 0 = tekući mesec u Istoriji, -1 = prethodni...
  formaDogadjajOtvorena: false, // da li je otvorena forma za novi fiksni događaj
  novaBoja: PALETA[0]         // izabrana boja za novu stavku na Plan ekranu
};

/* ===================== DATUMI ===================== */

// Pravi ključ "YYYY-MM-DD" od Date objekta, u LOKALNOJ vremenskoj zoni
// (namerno ne koristimo toISOString jer on radi u UTC pa može da "pomeri" dan).
function dateKey(d) {
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var dan = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + dan;
}

// Današnji datum kao ključ.
function danasKey() {
  return dateKey(new Date());
}

// Pravi Date objekat od ključa "YYYY-MM-DD" (u lokalnoj zoni).
function datumIzKljuca(kljuc) {
  var delovi = kljuc.split("-");
  return new Date(Number(delovi[0]), Number(delovi[1]) - 1, Number(delovi[2]));
}

// Pomera datum-ključ za dati broj dana (npr. +1 za sutra, -1 za juče).
function pomeriDatum(kljuc, brojDana) {
  var d = datumIzKljuca(kljuc);
  d.setDate(d.getDate() + brojDana);
  return dateKey(d);
}

// "2026-07-04" → "Subota, 4. jul"
function imeDatuma(kljuc) {
  var d = datumIzKljuca(kljuc);
  return DANI[d.getDay()] + ", " + d.getDate() + ". " + MESECI[d.getMonth()];
}

/* ===================== FORMATIRANJE VREMENA ===================== */

// Milisekunde → "0:38:11" (za veliki prikaz tajmera).
function formatHMS(ms) {
  var ukupnoSek = Math.floor(ms / 1000);
  var h = Math.floor(ukupnoSek / 3600);
  var m = Math.floor((ukupnoSek % 3600) / 60);
  var s = ukupnoSek % 60;
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Minuti → "3h 53m", "45m" ili "0m" (za zbirove vremena).
function formatTrajanje(minuti) {
  minuti = Math.round(minuti);
  var h = Math.floor(minuti / 60);
  var m = minuti % 60;
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}

// Minuti → kompaktan zapis "1h38", "4h", "45m" (za redove stavki, kao u dizajnu).
function formatKratko(minuti) {
  minuti = Math.round(minuti);
  var h = Math.floor(minuti / 60);
  var m = minuti % 60;
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h" + String(m).padStart(2, "0");
}

// "09:00" → broj minuta od ponoći (540). Za pozicioniranje na traci.
function vremeUMinute(tekst) {
  var delovi = tekst.split(":");
  return Number(delovi[0]) * 60 + Number(delovi[1]);
}

// Timestamp (ms) → broj minuta od ponoći TOG dana. Za pozicioniranje sesija na traci.
function timestampUMinute(ts) {
  var d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Timestamp → "15:08"
function formatSatMinut(ts) {
  var d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Sprečava ubacivanje HTML-a kroz nazive koje korisnik unosi.
function escapeHtml(tekst) {
  var div = document.createElement("div");
  div.textContent = tekst;
  return div.innerHTML;
}

/* ===================== KALKULACIJE IZ SIROVIH PODATAKA ===================== */

// Ukupno odrađeno za jednu stavku datog dana, u minutima.
// Sabira sve završene sesije + tekuću sesiju aktivnog tajmera ako pripada toj stavci.
function minutiStavke(datum, itemId, sada) {
  var dan = ucitajDan(datum);
  var ms = 0;
  for (var i = 0; i < dan.sessions.length; i++) {
    var s = dan.sessions[i];
    if (s.itemId === itemId) {
      ms += s.end - s.start;
    }
  }
  var tajmer = ucitajAktivniTajmer();
  if (tajmer !== null && tajmer.itemId === itemId && tajmer.datum === datum && tajmer.start !== null) {
    ms += sada - tajmer.start;
  }
  return ms / 60000;
}

// Ukupno odrađeno vreme celog dana (sve stavke), u minutima.
function ukupnoMinutaDana(datum, sada) {
  var dan = ucitajDan(datum);
  var ukupno = 0;
  for (var i = 0; i < dan.items.length; i++) {
    ukupno += minutiStavke(datum, dan.items[i].id, sada);
  }
  return ukupno;
}

// Zbir ciljeva svih stavki dana, u minutima (fiksni događaji se NE računaju).
function ukupnoCiljaDana(datum) {
  var dan = ucitajDan(datum);
  var ukupno = 0;
  for (var i = 0; i < dan.items.length; i++) {
    ukupno += dan.items[i].ciljMinuta;
  }
  return ukupno;
}

// Broj stavki dana koje su dostigle svoj cilj.
function brojZavrsenihStavki(datum, sada) {
  var dan = ucitajDan(datum);
  var broj = 0;
  for (var i = 0; i < dan.items.length; i++) {
    if (minutiStavke(datum, dan.items[i].id, sada) >= dan.items[i].ciljMinuta) {
      broj++;
    }
  }
  return broj;
}

// Status dana za kalendar u Istoriji:
//   "ispunjen"  — plan postoji i SVE stavke su dostigle cilj
//   "delimican" — plan postoji, bar nešto je rađeno, ali nisu sve stavke na cilju
//   "bez-plana" — za taj dan nema plana (ili plan bez ijedne stavke)
function statusDana(datum) {
  if (!danImaPlan(datum)) {
    return "bez-plana";
  }
  var sada = Date.now();
  var dan = ucitajDan(datum);
  if (brojZavrsenihStavki(datum, sada) === dan.items.length) {
    return "ispunjen";
  }
  return "delimican";
}

// Procenat ispunjenja dana: prosek po stavkama od min(odrađeno/cilj, 1).
// Višak preko cilja se ne računa preko 100% da jedna stavka ne maskira druge.
function procenatDana(datum) {
  var dan = ucitajDan(datum);
  if (dan.items.length === 0) return 0;
  var sada = Date.now();
  var zbir = 0;
  for (var i = 0; i < dan.items.length; i++) {
    var odnos = minutiStavke(datum, dan.items[i].id, sada) / dan.items[i].ciljMinuta;
    zbir += Math.min(odnos, 1);
  }
  return (zbir / dan.items.length) * 100;
}

// Trenutni niz dana zaredom u planu (streak).
// Kriterijum "ispoštovan dan": dan ima plan i SVE stavke su dostigle cilj.
// Brojimo unazad od danas; ako danas još nije ispunjen, danas se preskače
// (dan nije gotov), pa se broji od juče. Dan bez plana prekida niz.
function izracunajStreak() {
  var streak = 0;
  var datum = danasKey();

  if (statusDana(datum) === "ispunjen") {
    streak = 1;
  }
  datum = pomeriDatum(datum, -1);

  while (statusDana(datum) === "ispunjen") {
    streak++;
    datum = pomeriDatum(datum, -1);
  }
  return streak;
}

// Prosečan procenat ispunjenja za dati mesec: prosek procenata svih dana
// tog meseca koji imaju plan (dani bez plana se ne računaju).
function prosekMeseca(godina, mesec) {
  var brojDanaUMesecu = new Date(godina, mesec + 1, 0).getDate();
  var zbir = 0;
  var brojDana = 0;
  for (var dan = 1; dan <= brojDanaUMesecu; dan++) {
    var kljuc = dateKey(new Date(godina, mesec, dan));
    if (danImaPlan(kljuc)) {
      zbir += procenatDana(kljuc);
      brojDana++;
    }
  }
  if (brojDana === 0) return null;
  return Math.round(zbir / brojDana);
}

// Nalazi stavku po id-u u podacima datog dana. Vraća null ako ne postoji.
function nadjiStavku(datum, itemId) {
  var dan = ucitajDan(datum);
  for (var i = 0; i < dan.items.length; i++) {
    if (dan.items[i].id === itemId) {
      return dan.items[i];
    }
  }
  return null;
}

/* ===================== NAVIGACIJA ===================== */

// Prikazuje jednu sekciju (ekran), krije ostale i osveži njen sadržaj.
function prikaziSekciju(naziv) {
  stanje.sekcija = naziv;

  var sekcije = document.querySelectorAll("main > section");
  for (var i = 0; i < sekcije.length; i++) {
    sekcije[i].hidden = sekcije[i].id !== "sekcija-" + naziv;
  }

  // Bottom nav: "detalj" nije tab, pa tada ostaje označena Istorija.
  var navTab = naziv === "detalj" ? "istorija" : naziv;
  var dugmad = document.querySelectorAll(".nav-dugme");
  for (var j = 0; j < dugmad.length; j++) {
    dugmad[j].classList.toggle("aktivan", dugmad[j].dataset.sekcija === navTab);
  }

  osveziAktivnuSekciju();
}

// Ponovo iscrtava sadržaj trenutno otvorene sekcije.
function osveziAktivnuSekciju() {
  if (stanje.sekcija === "danas") renderDanas();
  if (stanje.sekcija === "plan") renderPlan();
  if (stanje.sekcija === "istorija") renderIstorija();
  if (stanje.sekcija === "detalj") renderDetalj();
}

/* ===================== RENDER: DANAS ===================== */

// Glavni ekran: header sa zbirom, veliki tajmer (ako radi), traka dana, lista stavki.
function renderDanas() {
  var datum = danasKey();
  var sada = Date.now();
  var dan = ucitajDan(datum);

  var d = new Date();
  document.getElementById("danas-datum").textContent =
    DANI[d.getDay()].toUpperCase() + " · " + d.getDate() + ". " + MESECI[d.getMonth()].toUpperCase();
  document.getElementById("danas-ukupno").textContent = formatTrajanje(ukupnoMinutaDana(datum, sada));

  renderTajmerPanel(sada);
  renderVertikalnuTraku(document.getElementById("danas-traka"), datum, sada, true);
  renderListuStavkiDanas(datum, sada);
}

// Kompaktna kartica tajmera (ring + info + dugmad). Prikazuje se samo dok je
// neka stavka izabrana (tajmer radi ili je pauziran).
function renderTajmerPanel(sada) {
  var panel = document.getElementById("tajmer-panel");
  var prazan = document.getElementById("tajmer-prazan");
  var tajmer = ucitajAktivniTajmer();

  var stavka = null;
  if (tajmer !== null) {
    stavka = nadjiStavku(tajmer.datum, tajmer.itemId);
    // Stavka je u međuvremenu obrisana — tajmer više nema smisla.
    if (stavka === null) {
      obrisiAktivniTajmer();
      tajmer = null;
    }
  }

  // Nema aktivnog tajmera → prazno stanje koje objašnjava gde se pokreće.
  if (tajmer === null) {
    panel.hidden = true;
    prazan.hidden = false;
    var imaStavki = ucitajDan(danasKey()).items.length > 0;
    document.getElementById("tajmer-prazan-naslov").textContent =
      imaStavki ? "Spremno za fokus" : "Nema plana za danas";
    document.getElementById("tajmer-prazan-opis").textContent = imaStavki
      ? "Izaberi stavku iz liste ispod i pritisni ▶ da pokreneš tajmer."
      : "Otvori karticu Plan i dodaj stavke koje želiš da pratiš.";
    return;
  }

  panel.hidden = false;
  prazan.hidden = true;
  var radi = tajmerRadi(tajmer);

  // Klasa "radi" pali animacije (talasi, kometa, disanje statusa) samo dok
  // tajmer stvarno broji; --boja daje animacijama boju aktivne stavke.
  panel.classList.toggle("radi", radi);
  panel.style.setProperty("--boja", stavka.boja);

  var odradjeno = minutiStavke(tajmer.datum, stavka.id, sada);
  var progres = Math.min(odradjeno / stavka.ciljMinuta, 1);

  // Ring: krug poluprečnika 90 → obim 2*PI*90. Popunjenost preko dashoffset.
  var obim = 2 * Math.PI * 90;
  document.getElementById("ring-progres").style.strokeDasharray = obim;
  document.getElementById("ring-progres").style.strokeDashoffset = obim * (1 - progres);
  document.getElementById("ring-progres").style.stroke = stavka.boja;

  // Redni broj tekuće sesije = broj već zabeleženih sesija te stavke danas
  // (+1 ako trenutno teče, jer se tekuća sesija upisuje tek na pauzu/stop).
  var dan = ucitajDan(tajmer.datum);
  var brojPrethodnih = 0;
  for (var i = 0; i < dan.sessions.length; i++) {
    if (dan.sessions[i].itemId === stavka.id) brojPrethodnih++;
  }
  var sesijaBroj = radi ? brojPrethodnih + 1 : Math.max(brojPrethodnih, 1);

  document.getElementById("tajmer-status").textContent = radi ? "● U TOKU" : "❙❙ PAUZA";
  document.getElementById("tajmer-vreme").textContent = formatHMS(protekloSesije(tajmer, sada));
  document.getElementById("tajmer-cilj").textContent =
    formatKratko(odradjeno) + " / " + formatKratko(stavka.ciljMinuta);
  document.getElementById("tajmer-naziv").textContent = stavka.naziv;
  document.getElementById("tajmer-detalj").textContent =
    "cilj " + formatKratko(stavka.ciljMinuta) + " · " + sesijaBroj + ". sesija";

  // Dugme "Pauziraj" postaje "Nastavi" (▶) kad je tajmer pauziran.
  var pauzaBtn = document.getElementById("dugme-pauza");
  pauzaBtn.innerHTML = radi
    ? '<span class="ikona">❙❙</span> Pauziraj'
    : '<span class="ikona">▶</span> Nastavi';
  pauzaBtn.title = radi ? "Pauziraj" : "Nastavi";
}

// Lista stavki iz današnjeg plana, svaka sa play/pauza dugmetom i napretkom.
function renderListuStavkiDanas(datum, sada) {
  var dan = ucitajDan(datum);
  var tajmer = ucitajAktivniTajmer();
  var kontejner = document.getElementById("danas-stavke");

  document.getElementById("danas-brojac").textContent =
    brojZavrsenihStavki(datum, sada) + " / " + dan.items.length;

  if (dan.items.length === 0) {
    kontejner.innerHTML =
      '<p class="prazno">Nema plana za danas. Napravi ga na kartici <strong>Plan</strong>.</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < dan.items.length; i++) {
    var stavka = dan.items[i];
    var odradjeno = minutiStavke(datum, stavka.id, sada);
    var zavrsena = odradjeno >= stavka.ciljMinuta;
    var ovaRadi = tajmer !== null && tajmer.itemId === stavka.id && tajmer.start !== null;

    // Završena stavka prikazuje višak ("+12m"), ostale "odrađeno/cilj".
    var desno;
    if (zavrsena) {
      var visak = Math.round(odradjeno - stavka.ciljMinuta);
      desno = visak > 0 ? "+" + formatKratko(visak) : "✓";
    } else {
      desno = formatKratko(odradjeno) + "/" + formatKratko(stavka.ciljMinuta);
    }

    html +=
      '<div class="stavka-red' + (zavrsena ? " zavrsena" : "") + (ovaRadi ? " aktivna" : "") + '">' +
        '<button class="play-dugme" data-item="' + stavka.id + '" style="' +
          (ovaRadi ? "background:" + stavka.boja : "") + '" title="' + (ovaRadi ? "Pauziraj" : "Pokreni") + '">' +
          (ovaRadi ? "❙❙" : "▶") +
        "</button>" +
        (zavrsena
          ? '<span class="dot kvacica" style="background:' + stavka.boja + '">✓</span>'
          : '<span class="dot" style="background:' + stavka.boja + '"></span>') +
        '<span class="stavka-naziv">' + escapeHtml(stavka.naziv) + "</span>" +
        '<span class="stavka-vreme">' + desno + "</span>" +
      "</div>";
  }
  kontejner.innerHTML = html;

  // Play/pauza po stavci: pokreće tajmer za tu stavku, ili je pauzira ako već radi.
  var dugmad = kontejner.querySelectorAll(".play-dugme");
  for (var j = 0; j < dugmad.length; j++) {
    dugmad[j].addEventListener("click", function () {
      klikPlayStavke(this.dataset.item);
    });
  }
}

/* ===================== TRAKA: RASPON VREMENA ===================== */

// Računa vremenski raspon trake za dati dan: podrazumevano 08–16h,
// prošireno da obuhvati sve fiksne događaje, sesije i trenutno vreme.
// Koristi ga vertikalni timeline (renderVertikalnuTraku).
function rasponTrake(datum, sada) {
  var dan = ucitajDan(datum);
  var min = 8 * 60;
  var max = 16 * 60;

  for (var i = 0; i < dan.fixedEvents.length; i++) {
    min = Math.min(min, vremeUMinute(dan.fixedEvents[i].od));
    max = Math.max(max, vremeUMinute(dan.fixedEvents[i].do));
  }
  for (var j = 0; j < dan.sessions.length; j++) {
    min = Math.min(min, timestampUMinute(dan.sessions[j].start));
    max = Math.max(max, timestampUMinute(dan.sessions[j].end));
  }
  var tajmer = ucitajAktivniTajmer();
  if (tajmer !== null && tajmer.datum === datum && tajmer.start !== null) {
    min = Math.min(min, timestampUMinute(tajmer.start));
    max = Math.max(max, timestampUMinute(sada));
  }
  // Ako je danas, traka prati trenutno vreme.
  if (datum === danasKey()) {
    max = Math.max(max, timestampUMinute(sada));
  }

  // Zaokruži na cele sate.
  return { od: Math.floor(min / 60) * 60, do: Math.ceil(max / 60) * 60 };
}

/* ===================== RENDER: PLAN ===================== */

// Ekran za planiranje dana (danas ili sutra): fiksni događaji, stavke sa
// ciljem, ukupno planirano. Sve izmene se odmah čuvaju u localStorage;
// dugme "Sačuvaj plan" samo potvrđuje i vraća na Danas.
function renderPlan() {
  var datum = stanje.planDatum;
  var dan = ucitajDan(datum);

  document.getElementById("plan-datum").textContent = imeDatuma(datum);
  document.getElementById("plan-tab-danas").classList.toggle("aktivan", datum === danasKey());
  document.getElementById("plan-tab-sutra").classList.toggle("aktivan", datum === pomeriDatum(danasKey(), 1));

  renderFiksneDogadjaje(dan);
  renderPlanStavke(dan);

  document.getElementById("plan-ukupno").textContent = formatTrajanje(ukupnoCiljaDana(datum));
}

// Lista fiksnih događaja + forma za dodavanje novog.
function renderFiksneDogadjaje(dan) {
  var kontejner = document.getElementById("plan-dogadjaji");
  var html = "";

  for (var i = 0; i < dan.fixedEvents.length; i++) {
    var ev = dan.fixedEvents[i];
    html +=
      '<div class="dogadjaj-red">' +
        '<span class="dogadjaj-naziv">' + escapeHtml(ev.naziv) + "</span>" +
        '<span class="dogadjaj-vreme">' + ev.od + "–" + ev.do + "</span>" +
        '<button class="obrisi-dugme" data-index="' + i + '" title="Obriši">×</button>' +
      "</div>";
  }
  kontejner.innerHTML = html;

  var dugmad = kontejner.querySelectorAll(".obrisi-dugme");
  for (var j = 0; j < dugmad.length; j++) {
    dugmad[j].addEventListener("click", function () {
      obrisiFiksniDogadjaj(Number(this.dataset.index));
    });
  }

  // Forma za novi događaj se pokazuje tek na klik dugmeta "+ fiksni događaj".
  document.getElementById("forma-dogadjaj").hidden = !stanje.formaDogadjajOtvorena;
  document.getElementById("dugme-novi-dogadjaj").hidden = stanje.formaDogadjajOtvorena;
}

// Lista fleksibilnih stavki (naziv + boja + cilj) + red za dodavanje nove.
function renderPlanStavke(dan) {
  var kontejner = document.getElementById("plan-stavke");
  var html = "";

  for (var i = 0; i < dan.items.length; i++) {
    var stavka = dan.items[i];
    html +=
      '<div class="stavka-red">' +
        '<span class="dot" style="background:' + stavka.boja + '"></span>' +
        '<span class="stavka-naziv">' + escapeHtml(stavka.naziv) + "</span>" +
        '<span class="cilj-oznaka" style="background:' + stavka.boja + '22;color:' + stavka.boja + '">' +
          formatKratko(stavka.ciljMinuta) +
        "</span>" +
        '<button class="obrisi-dugme" data-id="' + stavka.id + '" title="Obriši">×</button>' +
      "</div>";
  }
  kontejner.innerHTML = html;

  var dugmad = kontejner.querySelectorAll(".obrisi-dugme");
  for (var j = 0; j < dugmad.length; j++) {
    dugmad[j].addEventListener("click", function () {
      obrisiStavku(this.dataset.id);
    });
  }

  // Izbor boje za novu stavku: šest tačkica, izabrana je uokvirena.
  var birac = document.getElementById("biranje-boje");
  var bojeHtml = "";
  for (var k = 0; k < PALETA.length; k++) {
    bojeHtml +=
      '<button class="boja-dugme' + (PALETA[k] === stanje.novaBoja ? " izabrana" : "") +
      '" style="background:' + PALETA[k] + '" data-boja="' + PALETA[k] + '"></button>';
  }
  birac.innerHTML = bojeHtml;

  var bojeDugmad = birac.querySelectorAll(".boja-dugme");
  for (var m = 0; m < bojeDugmad.length; m++) {
    bojeDugmad[m].addEventListener("click", function () {
      stanje.novaBoja = this.dataset.boja;
      renderPlanStavke(ucitajDan(stanje.planDatum));
    });
  }
}

/* ===================== RENDER: ISTORIJA ===================== */

// Pregled meseca: streak, prosek ispunjenja, mini kalendar, poslednji dani.
function renderIstorija() {
  var danas = new Date();
  var prikaz = new Date(danas.getFullYear(), danas.getMonth() + stanje.mesecOffset, 1);
  var godina = prikaz.getFullYear();
  var mesec = prikaz.getMonth();

  document.getElementById("istorija-mesec").textContent =
    MESECI[mesec].charAt(0).toUpperCase() + MESECI[mesec].slice(1) +
    (godina !== danas.getFullYear() ? " " + godina : "");

  document.getElementById("istorija-streak").textContent = izracunajStreak();

  var prosek = prosekMeseca(godina, mesec);
  document.getElementById("istorija-prosek").textContent = prosek === null ? "—" : prosek + "%";

  renderKalendar(godina, mesec);
  renderPoslednjeDane();
}

// Mini kalendar meseca (Pon–Ned) sa danima obojenim po statusu.
function renderKalendar(godina, mesec) {
  var kontejner = document.getElementById("istorija-kalendar");
  var danasKljuc = danasKey();
  var brojDana = new Date(godina, mesec + 1, 0).getDate();

  // getDay() vraća 0 za nedelju; nama treba ponedeljak = kolona 0.
  var prviDan = new Date(godina, mesec, 1).getDay();
  var pomak = (prviDan + 6) % 7;

  var html = "";
  var slova = ["P", "U", "S", "Č", "P", "S", "N"];
  for (var z = 0; z < 7; z++) {
    html += '<span class="kal-zaglavlje">' + slova[z] + "</span>";
  }
  for (var p = 0; p < pomak; p++) {
    html += "<span></span>";
  }
  for (var dan = 1; dan <= brojDana; dan++) {
    var kljuc = dateKey(new Date(godina, mesec, dan));
    var status = statusDana(kljuc);
    var buducnost = kljuc > danasKljuc;
    var klase = "kal-dan " + (buducnost ? "bez-plana" : status) + (kljuc === danasKljuc ? " danas" : "");
    html += '<button class="' + klase + '" data-datum="' + kljuc + '">' + dan + "</button>";
  }
  kontejner.innerHTML = html;

  // Klik na dan sa planom otvara Detalj dana.
  var dugmad = kontejner.querySelectorAll(".kal-dan");
  for (var i = 0; i < dugmad.length; i++) {
    dugmad[i].addEventListener("click", function () {
      if (danImaPlan(this.dataset.datum)) {
        otvoriDetalj(this.dataset.datum);
      }
    });
  }
}

// Lista poslednjih dana koji imaju plan (do 14 dana unazad, bez današnjeg
// ako za danas još ništa nije rađeno). Klik otvara Detalj dana.
function renderPoslednjeDane() {
  var kontejner = document.getElementById("istorija-dani");
  var sada = Date.now();
  var html = "";
  var kljuc = danasKey();

  for (var i = 0; i < 14; i++) {
    if (danImaPlan(kljuc)) {
      var dan = ucitajDan(kljuc);
      var d = datumIzKljuca(kljuc);
      var zavrseno = brojZavrsenihStavki(kljuc, sada);

      // Mini trake: po jedna linija za svaku stavku, širina = odrađeno/cilj.
      var trake = "";
      for (var j = 0; j < dan.items.length; j++) {
        var odnos = Math.min(minutiStavke(kljuc, dan.items[j].id, sada) / dan.items[j].ciljMinuta, 1);
        trake +=
          '<span class="mini-traka" style="background:' + dan.items[j].boja + "33" + '">' +
            '<span style="width:' + odnos * 100 + "%;background:" + dan.items[j].boja + '"></span>' +
          "</span>";
      }

      html +=
        '<button class="dan-red" data-datum="' + kljuc + '">' +
          '<span class="dan-broj">' + String(d.getDate()).padStart(2, "0") +
            "<small>" + DANI_KRATKO[d.getDay()] + "</small></span>" +
          '<span class="dan-info">' +
            "<strong>" + zavrseno + " od " + dan.items.length + " stavke</strong>" +
            '<span class="mini-trake">' + trake + "</span>" +
          "</span>" +
          '<span class="dan-vreme">' + formatTrajanje(ukupnoMinutaDana(kljuc, sada)) + "</span>" +
        "</button>";
    }
    kljuc = pomeriDatum(kljuc, -1);
  }

  kontejner.innerHTML = html === "" ? '<p class="prazno">Još nema sačuvanih dana.</p>' : html;

  var dugmad = kontejner.querySelectorAll(".dan-red");
  for (var k = 0; k < dugmad.length; k++) {
    dugmad[k].addEventListener("click", function () {
      otvoriDetalj(this.dataset.datum);
    });
  }
}

/* ===================== RENDER: DETALJ DANA ===================== */

// Otvara ekran sa detaljima jednog dana iz istorije.
function otvoriDetalj(datum) {
  stanje.detaljDatum = datum;
  prikaziSekciju("detalj");
}

// Detalj dana: ukupno vreme, vertikalni timeline, poređenje cilj vs odrađeno.
function renderDetalj() {
  var datum = stanje.detaljDatum;
  var sada = Date.now();
  var d = datumIzKljuca(datum);

  document.getElementById("detalj-dan").textContent = DANI[d.getDay()].toUpperCase();
  document.getElementById("detalj-datum").textContent = d.getDate() + ". " + MESECI[d.getMonth()];
  document.getElementById("detalj-ukupno").textContent = formatTrajanje(ukupnoMinutaDana(datum, sada));
  document.getElementById("detalj-plan").textContent = "od " + formatTrajanje(ukupnoCiljaDana(datum)) + " plana";

  renderVertikalnuTraku(document.getElementById("detalj-traka"), datum, sada, false);
  renderCiljVsOdradjeno(datum, sada);
}

// Vertikalni timeline dana: oznake sati levo, blokovi pozicionirani tačno po
// vremenu kad su rađeni. Koristi se na dva mesta:
//   - Danas ekran (zivo = true): dodaje blok sesije u toku i crvenu "sada" liniju.
//   - Detalj dana (zivo = false): read-only istorijski prikaz.
function renderVertikalnuTraku(kontejner, datum, sada, zivo) {
  var dan = ucitajDan(datum);
  var raspon = rasponTrake(datum, sada);
  var PIKSELA_PO_SATU = 60; // veći razmak da kratke sesije imaju mesta
  var MIN_VISINA = 30;      // najmanja visina bloka da naslov stane
  var KOMPAKT_PRAG = 54;    // niži blokovi prikazuju naziv i vreme u jednom redu
  var visina = ((raspon.do - raspon.od) / 60) * PIKSELA_PO_SATU;

  // Pozicija minuta-u-danu kao piksel od vrha.
  function vrh(minuti) {
    return ((minuti - raspon.od) / 60) * PIKSELA_PO_SATU;
  }

  // 1) Sakupi sve blokove (fiksni događaji + sesije + tekuća sesija) u jednu
  //    listu. Svaki blok pamti svoj piksel-opseg da bismo mogli da ih rasporedimo.
  var blokovi = [];

  for (var i = 0; i < dan.fixedEvents.length; i++) {
    var ev = dan.fixedEvents[i];
    var evTop = vrh(vremeUMinute(ev.od));
    blokovi.push({
      top: evTop,
      visina: Math.max(vrh(vremeUMinute(ev.do)) - evTop, MIN_VISINA),
      klasa: "zauzeto",
      boja: null,
      naslov: escapeHtml(ev.naziv),
      podnaslov: ev.od + "–" + ev.do + " · zauzeto"
    });
  }

  for (var j = 0; j < dan.sessions.length; j++) {
    var s = dan.sessions[j];
    var stavka = nadjiStavku(datum, s.itemId);
    if (stavka === null) continue;
    var sTop = vrh(timestampUMinute(s.start));
    var trajanjeMin = Math.round((s.end - s.start) / 60000);
    // Kvačica ako je stavka (ukupno danas) dostigla svoj cilj.
    var zavrsena = minutiStavke(datum, stavka.id, sada) >= stavka.ciljMinuta;
    blokovi.push({
      top: sTop,
      visina: Math.max(vrh(timestampUMinute(s.end)) - sTop, MIN_VISINA),
      klasa: "sesija",
      boja: stavka.boja,
      naslov: escapeHtml(stavka.naziv) +
        (zavrsena ? ' <span class="cek" style="color:' + stavka.boja + '">✓</span>' : ""),
      podnaslov: formatSatMinut(s.start) + "–" + formatSatMinut(s.end) + " · " + formatTrajanje(trajanjeMin)
    });
  }

  // Tekuća sesija (samo Danas): posebna, uokvirena, u boji stavke.
  if (zivo) {
    var tajmer = ucitajAktivniTajmer();
    if (tajmer !== null && tajmer.datum === datum && tajmer.start !== null) {
      var stavkaA = nadjiStavku(datum, tajmer.itemId);
      if (stavkaA !== null) {
        var aTop = vrh(timestampUMinute(tajmer.start));
        blokovi.push({
          top: aTop,
          visina: Math.max(vrh(timestampUMinute(sada)) - aTop, MIN_VISINA),
          klasa: "sesija aktivna",
          boja: stavkaA.boja,
          aktivna: true,
          naslov: escapeHtml(stavkaA.naziv),
          podnaslov: formatSatMinut(tajmer.start) + "–" + formatSatMinut(sada)
        });
      }
    }
  }

  // 2) Rasporedi blokove u kolone da se preklapajući prikazuju jedan pored drugog.
  rasporediUKolone(blokovi);

  // 3) Iscrtaj: prvo oznake sati, pa blokovi, pa "sada" linija na vrhu.
  var html = '<div class="vtraka" style="height:' + visina + 'px">';

  for (var sat = raspon.od; sat <= raspon.do; sat += 60) {
    html +=
      '<div class="vtraka-sat" style="top:' + vrh(sat) + 'px">' +
        "<span>" + String(sat / 60).padStart(2, "0") + "</span>" +
      "</div>";
  }

  for (var b = 0; b < blokovi.length; b++) {
    var blok = blokovi[b];
    // Širina i pomak kolone: jedan blok = puna širina; više preklapajućih deli prostor.
    var left = 0;
    var sirina = 100;
    if (blok.brojKolona > 1) {
      var kol = 100 / blok.brojKolona;
      left = blok.kolona * kol;
      sirina = kol - 2; // 2% razmaka između kolona
    }

    var stil = "top:" + blok.top + "px;height:" + blok.visina +
      "px;left:" + left + "%;width:" + sirina + "%;";
    if (blok.boja) {
      stil += blok.aktivna
        ? "border-color:" + blok.boja + ";background:" + blok.boja + "22;"
        : "border-left-color:" + blok.boja + ";background:" + blok.boja + "15;";
    }

    html +=
      '<div class="vtraka-blok ' + blok.klasa + (blok.visina < KOMPAKT_PRAG ? " kompakt" : "") +
        '" style="' + stil + '">' +
        "<strong>" + blok.naslov + "</strong>" +
        "<small>" + blok.podnaslov + "</small>" +
      "</div>";
  }

  if (zivo) {
    var sadaMin = timestampUMinute(sada);
    if (sadaMin >= raspon.od && sadaMin <= raspon.do) {
      html +=
        '<div class="vtraka-sada" style="top:' + vrh(sadaMin) + 'px">' +
          "<span>" + formatSatMinut(sada) + "</span>" +
        "</div>";
    }
  }

  html += "</div>";
  kontejner.innerHTML = html;
}

// Raspoređuje blokove timeline-a u kolone (kao kalendar): oni čiji se prikazani
// piksel-opsezi preklapaju dobijaju susedne kolone umesto da se pokrivaju.
// Svakom bloku upisuje .kolona (indeks kolone) i .brojKolona (koliko kolona
// ima njegova grupa preklapanja).
function rasporediUKolone(blokovi) {
  blokovi.sort(function (a, b) { return a.top - b.top; });

  var grupa = [];       // blokovi tekuće grupe preklapanja
  var krajKolone = [];  // donja ivica poslednjeg bloka u svakoj koloni

  // Kad grupa preklapanja završi, upiši svima koliko je kolona imala.
  function zatvoriGrupu() {
    for (var i = 0; i < grupa.length; i++) {
      grupa[i].brojKolona = krajKolone.length;
    }
    grupa = [];
    krajKolone = [];
  }

  for (var i = 0; i < blokovi.length; i++) {
    var blok = blokovi[i];

    // Ako blok počinje ispod svih tekućih kolona, prethodna grupa je gotova.
    if (grupa.length > 0 && blok.top >= Math.max.apply(null, krajKolone)) {
      zatvoriGrupu();
    }

    // Nađi prvu kolonu koja se oslobodila (donja ivica iznad vrha ovog bloka).
    var k = 0;
    while (k < krajKolone.length && krajKolone[k] > blok.top) {
      k++;
    }
    blok.kolona = k;
    krajKolone[k] = blok.top + blok.visina;
    grupa.push(blok);
  }
  zatvoriGrupu();
}

// "CILJ VS ODRAĐENO": za svaku stavku dana uporedna traka i brojevi.
// Kad je odrađeno više od cilja, traka je puna a brojevi to pokazuju (35m/30m).
function renderCiljVsOdradjeno(datum, sada) {
  var kontejner = document.getElementById("detalj-poredjenje");
  var dan = ucitajDan(datum);
  var html = "";

  for (var i = 0; i < dan.items.length; i++) {
    var stavka = dan.items[i];
    var odradjeno = minutiStavke(datum, stavka.id, sada);
    var odnos = Math.min(odradjeno / stavka.ciljMinuta, 1);
    html +=
      '<div class="poredjenje-red">' +
        '<span class="poredjenje-naziv" style="color:' + stavka.boja + '">' + escapeHtml(stavka.naziv) + "</span>" +
        '<span class="poredjenje-traka"><span style="width:' + odnos * 100 + "%;background:" + stavka.boja + '"></span></span>' +
        '<span class="poredjenje-brojevi">' + formatKratko(odradjeno) + "/" + formatKratko(stavka.ciljMinuta) + "</span>" +
      "</div>";
  }

  kontejner.innerHTML = html === "" ? '<p class="prazno">Nema stavki za ovaj dan.</p>' : html;
}

/* ===================== AKCIJE KORISNIKA ===================== */

// Play/pauza na stavci u listi: ako ta stavka već radi — pauziraj je;
// inače pokreni njen tajmer (prethodni aktivni se automatski zaustavlja).
function klikPlayStavke(itemId) {
  var tajmer = ucitajAktivniTajmer();
  if (tajmer !== null && tajmer.itemId === itemId && tajmer.start !== null) {
    pauzirajTajmer();
  } else {
    pokreniTajmer(itemId, danasKey());
  }
  renderDanas();
}

// Dugme "Pauziraj/Nastavi" ispod velikog tajmera.
function klikPauza() {
  var tajmer = ucitajAktivniTajmer();
  if (tajmer === null) return;
  if (tajmer.start !== null) {
    pauzirajTajmer();
  } else {
    pokreniTajmer(tajmer.itemId, tajmer.datum);
  }
  renderDanas();
}

// Dugme "Zaustavi": sesija se upisuje u istoriju, veliki tajmer nestaje.
function klikStop() {
  zaustaviTajmer();
  renderDanas();
}

// Dodaje novi fiksni događaj iz forme na Plan ekranu.
function dodajFiksniDogadjaj() {
  var naziv = document.getElementById("dogadjaj-naziv").value.trim();
  var od = document.getElementById("dogadjaj-od").value;
  var doVreme = document.getElementById("dogadjaj-do").value;

  if (naziv === "" || od === "" || doVreme === "") {
    alert("Popuni naziv, vreme početka i vreme kraja.");
    return;
  }
  if (vremeUMinute(doVreme) <= vremeUMinute(od)) {
    alert("Vreme kraja mora biti posle vremena početka.");
    return;
  }

  var dan = ucitajDan(stanje.planDatum);
  dan.fixedEvents.push({ naziv: naziv, od: od, do: doVreme });
  // Događaji sortirani po vremenu početka, radi preglednosti.
  dan.fixedEvents.sort(function (a, b) { return vremeUMinute(a.od) - vremeUMinute(b.od); });
  sacuvajDan(stanje.planDatum, dan);

  document.getElementById("dogadjaj-naziv").value = "";
  document.getElementById("dogadjaj-od").value = "";
  document.getElementById("dogadjaj-do").value = "";
  stanje.formaDogadjajOtvorena = false;
  renderPlan();
}

// Briše fiksni događaj po rednom broju u listi.
function obrisiFiksniDogadjaj(index) {
  var dan = ucitajDan(stanje.planDatum);
  dan.fixedEvents.splice(index, 1);
  sacuvajDan(stanje.planDatum, dan);
  renderPlan();
}

// Dodaje novu stavku (naziv + boja + cilj) u plan.
function dodajStavku() {
  var naziv = document.getElementById("stavka-naziv").value.trim();
  var sati = Number(document.getElementById("stavka-sati").value) || 0;
  var minuti = Number(document.getElementById("stavka-minuti").value) || 0;
  var cilj = sati * 60 + minuti;

  if (naziv === "") {
    alert("Upiši naziv stavke.");
    return;
  }
  if (cilj <= 0) {
    alert("Cilj mora biti veći od nule.");
    return;
  }

  var dan = ucitajDan(stanje.planDatum);
  dan.items.push({
    // Jedinstven id: vreme + slučajni deo, dovoljno za jednokorisničku app.
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    naziv: naziv,
    boja: stanje.novaBoja,
    ciljMinuta: cilj
  });
  sacuvajDan(stanje.planDatum, dan);

  document.getElementById("stavka-naziv").value = "";
  document.getElementById("stavka-sati").value = "";
  document.getElementById("stavka-minuti").value = "";
  renderPlan();
}

// Briše stavku iz plana, zajedno sa njenim sesijama tog dana.
function obrisiStavku(itemId) {
  var stavka = nadjiStavku(stanje.planDatum, itemId);
  if (stavka === null) return;
  if (!confirm('Obrisati stavku "' + stavka.naziv + '" i njeno izmereno vreme?')) {
    return;
  }

  // Ako baš za ovu stavku radi tajmer, ugasi ga bez čuvanja (podaci se brišu).
  var tajmer = ucitajAktivniTajmer();
  if (tajmer !== null && tajmer.itemId === itemId) {
    obrisiAktivniTajmer();
  }

  var dan = ucitajDan(stanje.planDatum);
  dan.items = dan.items.filter(function (s) { return s.id !== itemId; });
  dan.sessions = dan.sessions.filter(function (s) { return s.itemId !== itemId; });
  sacuvajDan(stanje.planDatum, dan);
  renderPlan();
}

// "Sačuvaj plan": izmene su već sačuvane pri svakom unosu, pa ovo dugme
// samo potvrđuje korisniku i vodi ga na Danas ekran.
function sacuvajPlanKlik() {
  var dugme = document.getElementById("dugme-sacuvaj-plan");
  dugme.textContent = "Plan sačuvan ✓";
  setTimeout(function () {
    dugme.textContent = "Sačuvaj plan";
    prikaziSekciju("danas");
  }, 600);
}

/* ===================== INIT ===================== */

// Povezuje sve statične kontrole (nav, dugmad, forme) i pokreće prvi render.
function init() {
  stanje.planDatum = danasKey();

  // Bottom navigacija.
  var navDugmad = document.querySelectorAll(".nav-dugme");
  for (var i = 0; i < navDugmad.length; i++) {
    navDugmad[i].addEventListener("click", function () {
      prikaziSekciju(this.dataset.sekcija);
    });
  }

  // Veliki tajmer.
  document.getElementById("dugme-pauza").addEventListener("click", klikPauza);
  document.getElementById("dugme-stop").addEventListener("click", klikStop);

  // Plan: izbor dana koji se planira.
  document.getElementById("plan-tab-danas").addEventListener("click", function () {
    stanje.planDatum = danasKey();
    renderPlan();
  });
  document.getElementById("plan-tab-sutra").addEventListener("click", function () {
    stanje.planDatum = pomeriDatum(danasKey(), 1);
    renderPlan();
  });

  // Plan: fiksni događaji.
  document.getElementById("dugme-novi-dogadjaj").addEventListener("click", function () {
    stanje.formaDogadjajOtvorena = true;
    renderPlan();
  });
  document.getElementById("dogadjaj-otkazi").addEventListener("click", function () {
    stanje.formaDogadjajOtvorena = false;
    renderPlan();
  });
  document.getElementById("dogadjaj-dodaj").addEventListener("click", dodajFiksniDogadjaj);

  // Plan: nove stavke i čuvanje.
  document.getElementById("stavka-dodaj").addEventListener("click", dodajStavku);
  document.getElementById("dugme-sacuvaj-plan").addEventListener("click", sacuvajPlanKlik);

  // Istorija: listanje meseci.
  document.getElementById("mesec-nazad").addEventListener("click", function () {
    stanje.mesecOffset--;
    renderIstorija();
  });
  document.getElementById("mesec-napred").addEventListener("click", function () {
    stanje.mesecOffset++;
    renderIstorija();
  });

  // Detalj: povratak na Istoriju.
  document.getElementById("detalj-nazad").addEventListener("click", function () {
    prikaziSekciju("istorija");
  });

  // Otkucaj jednom u sekundi: dok tajmer radi, Danas ekran se osvežava
  // da bi veliki sat, traka i zbirovi rasli uživo.
  setInterval(function () {
    if (stanje.sekcija === "danas" && tajmerRadi(ucitajAktivniTajmer())) {
      renderDanas();
    }
  }, 1000);

  // Ako je tajmer preživeo refresh (postoji u storage-u), Danas ekran će ga
  // sam pokupiti i nastaviti prikaz — dovoljno je da uradimo prvi render.
  prikaziSekciju("danas");
}

document.addEventListener("DOMContentLoaded", init);
