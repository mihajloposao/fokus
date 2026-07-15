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

// Reč uz ocenu dana (indeks = broj zvezdica). 0 = još neocenjeno.
var OCENA_LABELE = ["Oceni dan", "Težak dan", "Ispod proseka", "Solidno", "Dobar dan", "Odličan dan"];

// Reč uz težinu trening-sesije (indeks = broj tegova 1–5).
var TRENING_LABELE = ["", "Lako", "Umereno", "Solidno", "Naporno", "Maksimalno"];

// Bronzana boja treninga (ista kao paleta[2]) — blok na traci i akcenti.
var TRENING_BOJA = "#b3833f";

/* ===================== STANJE UI ===================== */

// Sve što UI pamti između rendera, a NE čuva se u localStorage.
var stanje = {
  sekcija: "danas",          // koja je sekcija otvorena: danas | plan | istorija | detalj
  planDatum: null,            // datum koji se planira (postavlja se u init)
  detaljDatum: null,          // datum otvoren na ekranu Detalj dana
  mesecOffset: 0,             // 0 = tekući mesec u Istoriji, -1 = prethodni...
  formaDogadjajOtvorena: false, // da li je otvorena forma za novi fiksni događaj
  novaBoja: PALETA[0],        // izabrana boja za novu stavku na Plan ekranu
  ocenaOtvorena: false,       // da li je editor ocene dana raširen (Detalj ekran)
  kilazaOpseg: "30d",         // opseg grafika kilaže: 7d | 30d | sve
  kilazaDraft: null,          // vrednost u steperu (kg) pre čuvanja; null = tek otvoreno
  kilazaSacuvano: false,      // prolazno: "Sačuvano ✓" posle upisa
  treningTezina: 3,           // izabrana težina (1–5) u formi za novi trening
  treningDatum: null,         // datum treninga otvorenog na Trening ekranu
  treningId: null,            // id treninga otvorenog na Trening ekranu
  // Draft forme za obrok (Kilaža). Čuva se u stanju da se ne izgubi kad
  // renderKilaza ponovo iscrta ekran (npr. posle koraka na steperu).
  obrokDraft: { opis: "", kcal: "", protein: "", ugljeni: "", masti: "" }
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

// Jedinstven id (vreme + slučajni deo) — dovoljno za jednokorisničku app.
// Koristi se za stavke, obaveze i treninge.
function noviId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
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

// Broj završenih jedinica dana: stavke koje su dostigle cilj + čekirane obaveze.
// (Čekirana obaveza računa se kao ispunjena stavka.)
function brojZavrsenih(datum, sada) {
  var dan = ucitajDan(datum);
  var broj = 0;
  for (var i = 0; i < dan.items.length; i++) {
    if (minutiStavke(datum, dan.items[i].id, sada) >= dan.items[i].ciljMinuta) {
      broj++;
    }
  }
  var obaveze = dan.obaveze || [];
  for (var j = 0; j < obaveze.length; j++) {
    if (obaveze[j].checkedAt) broj++;
  }
  return broj;
}

// Ukupan broj jedinica dana: stavke sa ciljem + obaveze.
function brojJedinica(datum) {
  var dan = ucitajDan(datum);
  return dan.items.length + (dan.obaveze ? dan.obaveze.length : 0);
}

// Zbir svih obroka dana: kalorije, makroi i broj obroka. Stariji obroci
// nemaju upisane masti — "|| 0" ih tretira kao nulu umesto da zbir postane NaN.
function zbirObroka(datum) {
  var obroci = ucitajObroke(datum);
  var zbir = { kcal: 0, protein: 0, ugljeni: 0, masti: 0, broj: obroci.length };
  for (var i = 0; i < obroci.length; i++) {
    zbir.kcal += obroci[i].kcal || 0;
    zbir.protein += obroci[i].protein || 0;
    zbir.ugljeni += obroci[i].ugljeni || 0;
    zbir.masti += obroci[i].masti || 0;
  }
  return zbir;
}

// "1.850 kcal" — hiljade sa tačkom da se veliki brojevi lakše čitaju.
function formatKcal(n) {
  return Math.round(n).toLocaleString("sr-RS");
}

// Grami: bez decimala ("42 g"), jer se unose kao celi brojevi.
function formatGrami(n) {
  return Math.round(n) + " g";
}

// Status dana za kalendar u Istoriji:
//   "ispunjen"  — plan postoji i SVE jedinice (stavke + obaveze) su gotove
//   "delimican" — plan postoji, bar nešto je gotovo, ali ne sve
//   "bez-plana" — za taj dan nema plana (ni stavki ni obaveza)
function statusDana(datum) {
  if (!danImaPlan(datum)) {
    return "bez-plana";
  }
  var sada = Date.now();
  if (brojZavrsenih(datum, sada) === brojJedinica(datum)) {
    return "ispunjen";
  }
  return "delimican";
}

// Procenat ispunjenja dana: prosek po jedinicama. Stavka doprinosi
// min(odrađeno/cilj, 1), a obaveza 1 (čekirana) ili 0 (nečekirana).
function procenatDana(datum) {
  var uk = brojJedinica(datum);
  if (uk === 0) return 0;
  var dan = ucitajDan(datum);
  var sada = Date.now();
  var zbir = 0;
  for (var i = 0; i < dan.items.length; i++) {
    var odnos = minutiStavke(datum, dan.items[i].id, sada) / dan.items[i].ciljMinuta;
    zbir += Math.min(odnos, 1);
  }
  var obaveze = dan.obaveze || [];
  for (var j = 0; j < obaveze.length; j++) {
    if (obaveze[j].checkedAt) zbir += 1;
  }
  return (zbir / uk) * 100;
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

  // Svaki ulazak na Kilažu kreće sa skupljenim/neizmenjenim steperom i
  // opsegom po izboru — draft se re-inicijalizuje iz podataka pri renderu.
  if (naziv === "kilaza") {
    stanje.kilazaDraft = null;
    stanje.kilazaSacuvano = false;
  }

  // Bottom nav: "detalj" nije tab (ostaje Istorija), "trening" ostaje Plan.
  var navTab = naziv === "detalj" ? "istorija" : (naziv === "trening" ? "plan" : naziv);
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
  if (stanje.sekcija === "kilaza") renderKilaza();
  if (stanje.sekcija === "trening") renderTrening();
}

// Kači "click" handler na sve elemente koji odgovaraju selektoru unutar
// kontejnera. Handler se poziva sa elementom kao "this" (npr. this.dataset.item).
// Objedinjuje obrazac koji se ponavlja u svim render funkcijama koje prave
// listu dugmadi kroz innerHTML.
function poveziKlik(kontejner, selektor, handler) {
  var elementi = kontejner.querySelectorAll(selektor);
  for (var i = 0; i < elementi.length; i++) {
    elementi[i].addEventListener("click", handler);
  }
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

  // Klasa "radi" pali animacije (talasi, oreol, disanje statusa) samo dok
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

// Objedinjena lista dana (dizajn "obaveze" 2a): stavke sa ciljem (▶) i obaveze
// (checkbox) u jednoj listi — nedovršeno gore, završeno prigušeno ispod
// razdelnika "ZAVRŠENO". Čekiranje obaveze pamti tačan trenutak.
function renderListuStavkiDanas(datum, sada) {
  var dan = ucitajDan(datum);
  var obaveze = dan.obaveze || [];
  var tajmer = ucitajAktivniTajmer();
  var kontejner = document.getElementById("danas-stavke");

  document.getElementById("danas-brojac").textContent =
    brojZavrsenih(datum, sada) + " / " + brojJedinica(datum) + " završeno";

  if (dan.items.length === 0 && obaveze.length === 0) {
    kontejner.innerHTML =
      '<p class="prazno">Nema plana za danas. Napravi ga na kartici <strong>Plan</strong>.</p>';
    return;
  }

  // HTML jednog reda stavke sa tajmerom (play/pauza + napredak).
  function stavkaHtml(stavka) {
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

    return '<div class="stavka-red' + (zavrsena ? " zavrsena" : "") + (ovaRadi ? " aktivna" : "") + '">' +
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

  // HTML jednog reda obaveze (kvadratni checkbox + naziv + oznaka čekiranja).
  function obavezaHtml(ob) {
    var cekirana = !!ob.checkedAt;
    return '<div class="stavka-red obaveza' + (cekirana ? " on" : "") + '">' +
        '<button class="obaveza-box' + (cekirana ? " on" : "") + '" data-ob="' + ob.id +
          '" title="' + (cekirana ? "Poništi" : "Čekiraj") + '">' + (cekirana ? "✓" : "") + "</button>" +
        '<span class="stavka-naziv">' + escapeHtml(ob.naziv) + "</span>" +
        '<span class="obaveza-tag' + (cekirana ? "" : " blago") + '">' +
          (cekirana ? "✓ " + formatSatMinut(ob.checkedAt) : "čekiraj") +
        "</span>" +
      "</div>";
  }

  // Podeli u nedovršeno / završeno, čuvajući redosled (prvo stavke, pa obaveze).
  var nedovrseno = "";
  var zavrseno = "";
  for (var i = 0; i < dan.items.length; i++) {
    var s = dan.items[i];
    if (minutiStavke(datum, s.id, sada) >= s.ciljMinuta) zavrseno += stavkaHtml(s);
    else nedovrseno += stavkaHtml(s);
  }
  for (var j = 0; j < obaveze.length; j++) {
    if (obaveze[j].checkedAt) zavrseno += obavezaHtml(obaveze[j]);
    else nedovrseno += obavezaHtml(obaveze[j]);
  }

  kontejner.innerHTML = nedovrseno +
    (zavrseno ? '<div class="lista-razdelnik">ZAVRŠENO</div>' + zavrseno : "");

  // Play/pauza po stavci; klik na checkbox čekira/poništava obavezu.
  poveziKlik(kontejner, ".play-dugme", function () {
    klikPlayStavke(this.dataset.item);
  });
  poveziKlik(kontejner, ".obaveza-box", function () {
    cekirajObavezu(datum, this.dataset.ob);
    renderDanas();
  });
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
  // Čekirane obaveze (markeri na traci) takođe šire raspon.
  var obaveze = dan.obaveze || [];
  for (var o = 0; o < obaveze.length; o++) {
    if (obaveze[o].checkedAt) {
      var t = timestampUMinute(obaveze[o].checkedAt);
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }
  // Treninzi (blokovi na traci) šire raspon svojim terminom.
  var treninzi = dan.treninzi || [];
  for (var w = 0; w < treninzi.length; w++) {
    min = Math.min(min, vremeUMinute(treninzi[w].od));
    max = Math.max(max, vremeUMinute(treninzi[w].do));
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
  renderPlanObaveze(dan);
  renderPlanTreninzi(dan);

  // "Ukupno planirano": vreme ciljeva + broj obaveza (koje nemaju cilj).
  var ukupnoTekst = formatTrajanje(ukupnoCiljaDana(datum));
  var brObaveza = (dan.obaveze || []).length;
  if (brObaveza > 0) {
    ukupnoTekst += " + " + brObaveza + " " + recObaveze(brObaveza);
  }
  document.getElementById("plan-ukupno").textContent = ukupnoTekst;
}

// Srpska množina reči "obaveza": 1 → obaveza, 2–4 → obaveze, ostalo → obaveza.
function recObaveze(n) {
  var d = n % 10, dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "obaveze";
  return "obaveza";
}

// Lista obaveza na Plan ekranu + brisanje. (Dodavanje je preko forme u init-u.)
function renderPlanObaveze(dan) {
  var kontejner = document.getElementById("plan-obaveze");
  var obaveze = dan.obaveze || [];
  var html = "";

  for (var i = 0; i < obaveze.length; i++) {
    html +=
      '<div class="stavka-red obaveza">' +
        '<span class="obaveza-box"></span>' +
        '<span class="stavka-naziv">' + escapeHtml(obaveze[i].naziv) + "</span>" +
        '<button class="obrisi-dugme" data-id="' + obaveze[i].id + '" title="Obriši">×</button>' +
      "</div>";
  }
  kontejner.innerHTML = html;

  poveziKlik(kontejner, ".obrisi-dugme", function () {
    obrisiObavezu(stanje.planDatum, this.dataset.id);
    renderPlan();
  });
}

/* ===================== TRENING ===================== */

// Ikonica bučice (koristi se u naslovu, redu i bloku na traci).
function treningIkonaSvg() {
  return '<svg class="teg-ikona" viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}

// Trajanje treninga (od–do) u minutima.
function treningMinuta(t) {
  return vremeUMinute(t.do) - vremeUMinute(t.od);
}

// Mali prikaz tegova (5 stubića) popunjenih do date težine.
// klasa: "teg-mini" (red/traka) ili "teg-veliki" (detalj ekran).
function tegoviHtml(tezina, klasa) {
  var s = "";
  for (var i = 1; i <= 5; i++) {
    s += '<span class="teg-bar' + (i <= tezina ? " puna" : "") + '"></span>';
  }
  return '<span class="' + klasa + '">' + s + "</span>";
}

// Lista treninga na Plan ekranu (tap otvara detalj) + teg-birač u formi.
function renderPlanTreninzi(dan) {
  var kontejner = document.getElementById("plan-treninzi");
  var treninzi = dan.treninzi || [];
  var html = "";

  for (var i = 0; i < treninzi.length; i++) {
    var t = treninzi[i];
    html +=
      '<button type="button" class="trening-red" data-id="' + t.id + '">' +
        '<span class="trening-tacka"></span>' +
        '<span class="trening-red-info">' +
          '<span class="trening-red-naziv">' + escapeHtml(t.naziv) + "</span>" +
          '<span class="trening-red-vreme">' + t.od + "–" + t.do + " · " + formatTrajanje(treningMinuta(t)) + "</span>" +
        "</span>" +
        tegoviHtml(t.tezina, "teg-mini") +
        '<span class="trening-strelica">›</span>' +
      "</button>";
  }
  kontejner.innerHTML = html;

  poveziKlik(kontejner, ".trening-red", function () {
    otvoriTrening(stanje.planDatum, this.dataset.id);
  });

  crtajTegBirac();
}

// (Pre)crta 5 tegova u formi + reč težine. Poziva se pri renderu i pri tapu
// (u mestu — ne dira ostala polja forme koja korisnik popunjava).
function crtajTegBirac() {
  var birac = document.getElementById("trening-tezina");
  if (!birac) return;
  var t = stanje.treningTezina;
  var html = "";
  for (var i = 1; i <= 5; i++) {
    html += '<button type="button" class="teg-dugme' + (i <= t ? " puna" : "") + '" data-teg="' + i + '"></button>';
  }
  html += '<span class="teg-oznaka">' + TRENING_LABELE[t] + " · " + t + "/5</span>";
  birac.innerHTML = html;

  poveziKlik(birac, ".teg-dugme", function () {
    stanje.treningTezina = Number(this.dataset.teg);
    crtajTegBirac();
  });
}

// Otvara detaljni ekran jednog treninga.
function otvoriTrening(datum, id) {
  stanje.treningDatum = datum;
  stanje.treningId = id;
  prikaziSekciju("trening");
}

// Detaljni ekran treninga: termin, težina (tegovi), šta sam radio, beleška.
function renderTrening() {
  var kontejner = document.getElementById("trening-sadrzaj");
  var t = nadjiTrening(stanje.treningDatum, stanje.treningId);
  if (t === null) { // obrisan u međuvremenu
    prikaziSekciju("plan");
    return;
  }
  var d = datumIzKljuca(stanje.treningDatum);

  // Linije "šta sam radio": svaka se deli na "—" (levo naziv, desno detalj).
  var linijeHtml = "";
  var redovi = (t.linije || "").split("\n");
  for (var i = 0; i < redovi.length; i++) {
    var red = redovi[i].trim();
    if (red === "") continue;
    var delovi = red.split("—");
    var levo = delovi[0].trim();
    var desno = delovi.length > 1 ? delovi.slice(1).join("—").trim() : "";
    linijeHtml +=
      '<div class="trening-vezba">' +
        '<span class="trening-vezba-naziv">' + escapeHtml(levo) + "</span>" +
        (desno ? '<span class="trening-vezba-detalj">' + escapeHtml(desno) + "</span>" : "") +
      "</div>";
  }

  var html =
    '<header class="ekran-zaglavlje">' +
      "<div>" +
        '<button class="nazad-dugme" id="trening-nazad">‹ Plan</button>' +
        '<p class="nadnaslov">TRENING · ' + DANI[d.getDay()].toUpperCase() + "</p>" +
        "<h1>" + escapeHtml(t.naziv) + "</h1>" +
      "</div>" +
      '<div class="zbir">' +
        "<strong>" + formatTrajanje(treningMinuta(t)) + "</strong>" +
        "<small>" + t.od + "–" + t.do + "</small>" +
      "</div>" +
    "</header>" +

    '<p class="naslov-sekcije">TERMIN</p>' +
    '<div class="trening-termin">' +
      '<span class="trening-termin-vreme">' + t.od + "</span>" +
      '<span class="trening-termin-traka"></span>' +
      '<span class="trening-termin-vreme">' + t.do + "</span>" +
    "</div>" +

    '<p class="naslov-sekcije">TEŽINA SESIJE</p>' +
    '<div class="trening-tezina-kartica">' +
      tegoviHtml(t.tezina, "teg-veliki") +
      '<p class="trening-tezina-oznaka">' + TRENING_LABELE[t.tezina] +
        ' <span>· ' + t.tezina + "/5</span></p>" +
    "</div>";

  if (linijeHtml) {
    html += '<p class="naslov-sekcije">ŠTA SAM RADIO</p><div class="lista">' + linijeHtml + "</div>";
  }
  if (t.beleska && t.beleska.trim() !== "") {
    html += '<p class="naslov-sekcije">BELEŠKA</p>' +
      '<div class="trening-beleska">' + escapeHtml(t.beleska) + "</div>";
  }

  html += '<button class="obrisi-trening" id="trening-obrisi">Obriši trening</button>';

  kontejner.innerHTML = html;
  document.getElementById("trening-nazad").addEventListener("click", function () {
    prikaziSekciju("plan");
  });
  document.getElementById("trening-obrisi").addEventListener("click", function () {
    if (confirm('Obrisati trening "' + t.naziv + '"?')) {
      obrisiTrening(stanje.treningDatum, stanje.treningId);
      prikaziSekciju("plan");
    }
  });
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

  poveziKlik(kontejner, ".obrisi-dugme", function () {
    obrisiFiksniDogadjaj(Number(this.dataset.index));
  });

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

  poveziKlik(kontejner, ".obrisi-dugme", function () {
    obrisiStavku(this.dataset.id);
  });

  // Izbor boje za novu stavku: šest tačkica, izabrana je uokvirena.
  var birac = document.getElementById("biranje-boje");
  var bojeHtml = "";
  for (var k = 0; k < PALETA.length; k++) {
    bojeHtml +=
      '<button class="boja-dugme' + (PALETA[k] === stanje.novaBoja ? " izabrana" : "") +
      '" style="background:' + PALETA[k] + '" data-boja="' + PALETA[k] + '"></button>';
  }
  birac.innerHTML = bojeHtml;

  poveziKlik(birac, ".boja-dugme", function () {
    stanje.novaBoja = this.dataset.boja;
    renderPlanStavke(ucitajDan(stanje.planDatum));
  });
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

  // Klik na dan sa planom (ili bar upisanim obrocima) otvara Detalj dana.
  poveziKlik(kontejner, ".kal-dan", function () {
    if (danImaPlan(this.dataset.datum) || danImaObroke(this.dataset.datum)) {
      otvoriDetalj(this.dataset.datum);
    }
  });
}

// Lista poslednjih dana koji imaju plan (do 14 dana unazad, bez današnjeg
// ako za danas još ništa nije rađeno). Klik otvara Detalj dana.
function renderPoslednjeDane() {
  var kontejner = document.getElementById("istorija-dani");
  var sada = Date.now();
  var html = "";
  var kljuc = danasKey();

  for (var i = 0; i < 14; i++) {
    // Dan sa samo obrocima (bez plana) takođe ulazi u listu — da se kalorije
    // vide i za dane kad ništa nije planirano.
    if (danImaPlan(kljuc) || danImaObroke(kljuc)) {
      var dan = ucitajDan(kljuc);
      var d = datumIzKljuca(kljuc);
      var zavrseno = brojZavrsenih(kljuc, sada);
      var zbir = zbirObroka(kljuc);

      // Mini trake: po jedna linija za svaku stavku, širina = odrađeno/cilj.
      var trake = "";
      for (var j = 0; j < dan.items.length; j++) {
        var odnos = Math.min(minutiStavke(kljuc, dan.items[j].id, sada) / dan.items[j].ciljMinuta, 1);
        trake +=
          '<span class="mini-traka" style="background:' + dan.items[j].boja + "33" + '">' +
            '<span style="width:' + odnos * 100 + "%;background:" + dan.items[j].boja + '"></span>' +
          "</span>";
      }

      var naslovRed = danImaPlan(kljuc)
        ? zavrseno + " od " + brojJedinica(kljuc) + " gotovo"
        : "bez plana";

      html +=
        '<button class="dan-red" data-datum="' + kljuc + '">' +
          '<span class="dan-broj">' + String(d.getDate()).padStart(2, "0") +
            "<small>" + DANI_KRATKO[d.getDay()] + "</small></span>" +
          '<span class="dan-info">' +
            "<strong>" + naslovRed + "</strong>" +
            '<span class="mini-trake">' + trake + "</span>" +
            (zbir.broj
              ? '<span class="dan-kcal">' + formatKcal(zbir.kcal) + " kcal · " + zbir.broj + " " + recObroka(zbir.broj) + "</span>"
              : "") +
          "</span>" +
          '<span class="dan-vreme">' + formatTrajanje(ukupnoMinutaDana(kljuc, sada)) + "</span>" +
        "</button>";
    }
    kljuc = pomeriDatum(kljuc, -1);
  }

  kontejner.innerHTML = html === "" ? '<p class="prazno">Još nema sačuvanih dana.</p>' : html;

  poveziKlik(kontejner, ".dan-red", function () {
    otvoriDetalj(this.dataset.datum);
  });
}

/* ===================== RENDER: DETALJ DANA ===================== */

// Otvara ekran sa detaljima jednog dana iz istorije.
function otvoriDetalj(datum) {
  stanje.detaljDatum = datum;
  stanje.ocenaOtvorena = false; // svaki dan počinje sa skupljenom ocenom
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

  renderOcenaDana(datum);
  renderVertikalnuTraku(document.getElementById("detalj-traka"), datum, sada, false);
  renderCiljVsOdradjeno(datum, sada);
  renderDetaljObroke(datum);
}

// Obroci jednog dana u istoriji: zbir kalorija/makroa + spisak obroka.
// Read-only — unos i brisanje idu preko Kilaže.
function renderDetaljObroke(datum) {
  var kontejner = document.getElementById("detalj-obroci");
  var obroci = ucitajObroke(datum);

  if (!obroci.length) {
    kontejner.innerHTML = "";
    return;
  }

  var zbir = zbirObroka(datum);
  var html = '<p class="naslov-sekcije"><span class="obrok-naslov">' + obrokIkonaSvg() +
    " OBROCI</span><span class=\"desno\">" + zbir.broj + " " + recObroka(zbir.broj) + "</span></p>";

  html += zbirObrokaHtml(zbir, "kcal ukupno");

  html += '<div class="lista obroci-lista">';
  for (var i = 0; i < obroci.length; i++) {
    var o = obroci[i];
    html += '<div class="obrok-red staticni">' +
      '<span class="obrok-info">' +
        '<span class="obrok-opis">' + escapeHtml(o.opis) + "</span>" +
        obrokMakroiHtml(o) +
      "</span>" +
    "</div>";
  }
  html += "</div>";

  kontejner.innerHTML = html;
}

/* ===================== RENDER: OCENA DANA ===================== */

// Upisuje broj zvezdica (0–5) za dati dan.
function postaviOcenu(datum, broj) {
  var dan = ucitajDan(datum);
  dan.ocena = broj;
  sacuvajDan(datum, dan);
}

// Upisuje tekst beleške za dati dan.
function postaviBelesku(datum, tekst) {
  var dan = ucitajDan(datum);
  dan.beleska = tekst;
  sacuvajDan(datum, dan);
}

// Ocena dana na Detalj ekranu. Dva stanja:
//   - skupljeno: tanak red-kartica sa mini zvezdicama i rečju, klik ga otvara;
//   - otvoreno: veliki izbor zvezdica (sa hover pregledom) + beleška koja se
//     čuva pri svakom kucanju. Zvezdice i beleška se osvežavaju "u mestu" da
//     kucanje u belešci ne prekida hover, i obrnuto.
function renderOcenaDana(datum) {
  var kontejner = document.getElementById("detalj-ocena");
  var dan = ucitajDan(datum);
  var ocena = dan.ocena || 0;
  var beleska = dan.beleska || "";

  // ---- Skupljeno stanje ----
  if (!stanje.ocenaOtvorena) {
    var mini = "";
    for (var i = 1; i <= 5; i++) {
      mini += '<span class="ocena-zvezda-mini' + (i <= ocena ? " puna" : "") + '">' +
        (i <= ocena ? "★" : "☆") + "</span>";
    }
    kontejner.innerHTML =
      '<button type="button" class="ocena-skupljeno">' +
        '<span class="ocena-skupljeno-levo">' +
          '<span class="ocena-naslov">OCENA DANA</span>' +
          '<span class="ocena-skupljeno-red">' +
            '<span class="ocena-zvezde-mini">' + mini + "</span>" +
            '<span class="ocena-oznaka">' +
              (ocena ? OCENA_LABELE[ocena] : "Dodaj ocenu dana") +
            "</span>" +
          "</span>" +
        "</span>" +
        '<span class="ocena-strelica">›</span>' +
      "</button>";
    kontejner.querySelector(".ocena-skupljeno").addEventListener("click", function () {
      stanje.ocenaOtvorena = true;
      renderOcenaDana(datum);
    });
    return;
  }

  // ---- Otvoreno stanje ----
  var zvezde = "";
  for (var j = 1; j <= 5; j++) {
    zvezde += '<button type="button" class="ocena-zvezda' + (j <= ocena ? " puna" : "") +
      '" data-n="' + j + '">' + (j <= ocena ? "★" : "☆") + "</button>";
  }
  kontejner.innerHTML =
    '<div class="ocena-otvoreno">' +
      '<div class="ocena-otvoreno-zaglavlje">' +
        '<p class="ocena-naslov">OCENA DANA</p>' +
        '<button type="button" class="ocena-sakrij" title="Sakrij">⌃</button>' +
      "</div>" +
      '<div class="ocena-zvezde">' + zvezde + "</div>" +
      '<p class="ocena-oznaka-centar">' + OCENA_LABELE[ocena] + "</p>" +
      '<textarea class="ocena-belezka" maxlength="500" placeholder="Beleška o danu (opciono)…">' +
        escapeHtml(beleska) +
      "</textarea>" +
      '<p class="ocena-auto">čuva se automatski</p>' +
    "</div>";

  var oznaka = kontejner.querySelector(".ocena-oznaka-centar");
  var dugmad = kontejner.querySelectorAll(".ocena-zvezda");

  // Oboji zvezdice do datog broja i osveži reč ispod njih.
  function prikaziDo(broj) {
    for (var k = 0; k < dugmad.length; k++) {
      var n = k + 1;
      dugmad[k].textContent = n <= broj ? "★" : "☆";
      dugmad[k].classList.toggle("puna", n <= broj);
    }
    oznaka.textContent = OCENA_LABELE[broj];
  }

  poveziKlik(kontejner, ".ocena-zvezda", function () {
    ocena = Number(this.dataset.n);
    postaviOcenu(datum, ocena);
    prikaziDo(ocena);
  });
  for (var m = 0; m < dugmad.length; m++) {
    dugmad[m].addEventListener("mouseenter", function () {
      prikaziDo(Number(this.dataset.n));
    });
  }
  // Kad miš napusti red zvezdica, vrati prikaz na stvarnu (sačuvanu) ocenu.
  kontejner.querySelector(".ocena-zvezde").addEventListener("mouseleave", function () {
    prikaziDo(ocena);
  });

  kontejner.querySelector(".ocena-sakrij").addEventListener("click", function () {
    stanje.ocenaOtvorena = false;
    renderOcenaDana(datum);
  });

  kontejner.querySelector(".ocena-belezka").addEventListener("input", function () {
    postaviBelesku(datum, this.value);
  });
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

  // Treninzi: bronzani blokovi sa tegovima (dizajn "trening").
  var treninzi = dan.treninzi || [];
  for (var w = 0; w < treninzi.length; w++) {
    var tr = treninzi[w];
    var trTop = vrh(vremeUMinute(tr.od));
    blokovi.push({
      top: trTop,
      visina: Math.max(vrh(vremeUMinute(tr.do)) - trTop, MIN_VISINA),
      klasa: "trening",
      boja: null,
      html:
        '<div class="trening-blok-info">' +
          "<strong>" + treningIkonaSvg() + escapeHtml(tr.naziv) + "</strong>" +
          "<small>" + tr.od + "–" + tr.do + " · " + formatTrajanje(treningMinuta(tr)) + "</small>" +
        "</div>" +
        tegoviHtml(tr.tezina, "teg-mini")
    });
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

    // Trening blok ima svoj raspored (bronza + tegovi), ostali klasičan strong/small.
    var kompakt = blok.klasa.indexOf("trening") === -1 && blok.visina < KOMPAKT_PRAG;
    html +=
      '<div class="vtraka-blok ' + blok.klasa + (kompakt ? " kompakt" : "") +
        '" style="' + stil + '">' +
        (blok.html ? blok.html : "<strong>" + blok.naslov + "</strong><small>" + blok.podnaslov + "</small>") +
      "</div>";
  }

  // Čekirane obaveze: tanka isprekidana linija preko cele širine u tačnom
  // trenutku čekiranja (dizajn "obaveze" 2a).
  var obaveze = dan.obaveze || [];
  for (var o = 0; o < obaveze.length; o++) {
    var ob = obaveze[o];
    if (!ob.checkedAt) continue;
    html +=
      '<div class="vtraka-obaveza" style="top:' + vrh(timestampUMinute(ob.checkedAt)) + 'px">' +
        '<span class="knob">✓</span>' +
        '<span class="rule"></span>' +
        '<span class="lab">' + escapeHtml(ob.naziv) +
          " <small>" + formatSatMinut(ob.checkedAt) + "</small></span>" +
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

/* ===================== OBROCI (unos na Kilaži) ===================== */

// Ikonica obroka (viljuška i nož) — koristi se uz naslove sekcija.
function obrokIkonaSvg() {
  return '<svg class="obrok-ikona" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.7 1-2.5 3-2.5 5.5S16.3 13 18 13v8"/></svg>';
}

// Kartica zbira: velike kalorije levo, makroi desno. Koristi je i Kilaža
// ("kcal danas") i Detalj dana ("kcal ukupno").
function zbirObrokaHtml(zbir, oznakaKcal) {
  return '<div class="obrok-zbir">' +
    '<div class="obrok-zbir-glavno"><b>' + formatKcal(zbir.kcal) + "</b><small>" + oznakaKcal + "</small></div>" +
    '<div class="obrok-zbir-makroi">' +
      "<span><b>" + formatGrami(zbir.protein) + "</b><small>proteini</small></span>" +
      "<span><b>" + formatGrami(zbir.ugljeni) + "</b><small>ugljeni h.</small></span>" +
      "<span><b>" + formatGrami(zbir.masti) + "</b><small>masti</small></span>" +
    "</div>" +
  "</div>";
}

// Makroi jednog obroka (P / UH / M) — isti red se koristi na Kilaži i u Detalju.
function obrokMakroiHtml(o) {
  return '<span class="obrok-makroi">' +
    "<b>" + formatKcal(o.kcal) + " kcal</b>" +
    "<span>P " + formatGrami(o.protein) + "</span>" +
    "<span>UH " + formatGrami(o.ugljeni) + "</span>" +
    "<span>M " + formatGrami(o.masti || 0) + "</span>" +
  "</span>";
}

// Jedan red obroka u listi (opis + makroi + dugme za brisanje).
function obrokRedHtml(o) {
  return '<div class="obrok-red" data-id="' + o.id + '">' +
    '<span class="obrok-info">' +
      '<span class="obrok-opis">' + escapeHtml(o.opis) + "</span>" +
      obrokMakroiHtml(o) +
    "</span>" +
    '<button class="obrok-obrisi" title="Obriši obrok" aria-label="Obriši obrok">×</button>' +
  "</div>";
}

// Cela sekcija obroka na Kilaži: zbir dana, lista i forma za novi unos.
function renderObrociHtml() {
  var datum = danasKey();
  var obroci = ucitajObroke(datum);
  var zbir = zbirObroka(datum);
  var d = stanje.obrokDraft;

  var html = '<div class="obroci-blok">';

  html += '<p class="naslov-sekcije"><span class="obrok-naslov">' + obrokIkonaSvg() +
    " OBROCI · " + kratakDatum(datum).toUpperCase() + "</span>" +
    '<span class="desno">' + zbir.broj + " " + recObroka(zbir.broj) + "</span></p>";

  // Zbir dana — prikazujemo ga i kad je nula, da unos ima jasan cilj.
  html += zbirObrokaHtml(zbir, "kcal danas");

  if (obroci.length) {
    html += '<div class="lista obroci-lista">';
    for (var i = 0; i < obroci.length; i++) html += obrokRedHtml(obroci[i]);
    html += "</div>";
  }

  html += '<div class="kartica-forma istaknuta obrok-forma">' +
    '<input class="obrok-opis-polje" type="text" maxlength="60" ' +
      'placeholder="Obrok — npr. Piletina sa pirinčem" value="' + escapeHtml(d.opis) + '">' +
    '<div class="red-polja obrok-brojevi">' +
      '<label>kcal <input class="obrok-kcal" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.kcal) + '"></label>' +
      '<label>P (g) <input class="obrok-protein" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.protein) + '"></label>' +
      '<label>UH (g) <input class="obrok-ugljeni" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.ugljeni) + '"></label>' +
      '<label>M (g) <input class="obrok-masti" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.masti) + '"></label>' +
    "</div>" +
    '<button class="obrok-dodaj glavno-dugme">+ Dodaj obrok</button>' +
  "</div>";

  return html + "</div>";
}

// "obrok" / "obroka" — da zaglavlje sekcije zvuči prirodno.
function recObroka(n) {
  return n === 1 ? "obrok" : "obroka";
}

// Čita broj iz polja forme: prazno = 0, zarez radi kao decimalna tačka.
// Vraća null ako je uneto nešto što nije broj ili je negativno.
function brojIzPolja(tekst) {
  var t = String(tekst).trim().replace(",", ".");
  if (t === "") return 0;
  var v = parseFloat(t);
  if (isNaN(v) || v < 0) return null;
  return v;
}

// Povezuje formu i listu obroka (poziva se iz renderKilaza posle innerHTML).
function poveziObroke(kontejner) {
  var d = stanje.obrokDraft;

  // Draft se pamti na svaki otkucaj da re-render (npr. stepper) ne obriše unos.
  var polja = [
    [".obrok-opis-polje", "opis"],
    [".obrok-kcal", "kcal"],
    [".obrok-protein", "protein"],
    [".obrok-ugljeni", "ugljeni"],
    [".obrok-masti", "masti"]
  ];
  polja.forEach(function (par) {
    var el = kontejner.querySelector(par[0]);
    if (el) el.addEventListener("input", function () { d[par[1]] = this.value; });
  });

  poveziKlik(kontejner, ".obrok-dodaj", function () {
    var opis = d.opis.trim();
    if (opis === "") {
      alert("Upiši šta si jeo.");
      return;
    }
    var kcal = brojIzPolja(d.kcal);
    var protein = brojIzPolja(d.protein);
    var ugljeni = brojIzPolja(d.ugljeni);
    var masti = brojIzPolja(d.masti);
    if (kcal === null || protein === null || ugljeni === null || masti === null) {
      alert("Kalorije, proteini, ugljeni hidrati i masti moraju biti brojevi (0 ili više).");
      return;
    }

    dodajObrok(danasKey(), {
      id: noviId(),
      opis: opis,
      kcal: kcal,
      protein: protein,
      ugljeni: ugljeni,
      masti: masti,
      upisan: Date.now()
    });

    stanje.obrokDraft = { opis: "", kcal: "", protein: "", ugljeni: "", masti: "" };
    renderKilaza();
  });

  poveziKlik(kontejner, ".obrok-obrisi", function () {
    var red = this.closest(".obrok-red");
    obrisiObrok(danasKey(), red.dataset.id);
    renderKilaza();
  });
}

/* ===================== RENDER: KILAŽA ===================== */

// Prolazni tajmer za "Sačuvano ✓" poruku posle upisa kilaže.
var kilazaTajmer = null;

// Kilaža → "72,4" (srpski decimalni zapis).
function formatKg(v) {
  return v.toFixed(1).replace(".", ",");
}

// "2026-07-04" → "4. jul" (za oznake na grafiku i naslov stepera).
function kratakDatum(kljuc) {
  var d = datumIzKljuca(kljuc);
  return d.getDate() + ". " + MESECI[d.getMonth()];
}

// Svi unosi kilaže kao niz [{datum, kg}], rastuće po datumu.
function kilazaNiz() {
  var k = ucitajKilazu();
  return Object.keys(k.unosi).sort().map(function (d) {
    return { datum: d, kg: k.unosi[d] };
  });
}

// Unosi vidljivi u datom opsegu (7d / 30d / sve), po kalendarskom prozoru.
function kilazaVidljivi(opseg, svi) {
  if (opseg === "sve") return svi;
  var dana = opseg === "7d" ? 7 : 30;
  var granica = pomeriDatum(danasKey(), -(dana - 1));
  return svi.filter(function (u) { return u.datum >= granica; });
}

// Upisuje kilažu za dati dan (jedan unos po danu; ponovni upis je izmena).
function upisiKilazu(datum, kg) {
  var k = ucitajKilazu();
  k.unosi[datum] = kg;
  sacuvajKilazu(k);
}

// Postavlja (ili uklanja, kg = null) ciljnu kilažu. baza = trenutna težina u
// trenutku postavljanja (određuje smer: mršavljenje ili gojenje).
function postaviCiljKilaze(kg, baza) {
  var k = ucitajKilazu();
  k.cilj = kg;
  k.ciljBaza = kg === null ? null : baza;
  sacuvajKilazu(k);
}

// Zaokruži na 0,1 kg i ograniči na razuman opseg.
function clampKilaza(v) {
  return Math.round(Math.min(300, Math.max(30, v)) * 10) / 10;
}

// Dugme opsega grafika (7d/30d/sve) sa oznakom aktivnog.
function opsegDugme(o) {
  return '<button data-opseg="' + o + '"' + (stanje.kilazaOpseg === o ? ' class="on"' : "") +
    ">" + o + "</button>";
}

// Crta SVG grafik kilaže iz vidljivih unosa: površina + linija težine,
// tanka isprekidana linija 7-dnevnog proseka, ciljna linija i poslednja tačka.
function buildKilazaChart(vidljivi, cilj) {
  var W = 340, H = 172, L = 16, RG = 328, T = 18, B = 148;
  var n = vidljivi.length;
  var vr = vidljivi.map(function (u) { return u.kg; });

  var minV = Math.min.apply(null, vr);
  var maxV = Math.max.apply(null, vr);
  var dmin = (cilj !== null ? Math.min(minV, cilj) : minV) - 0.3;
  var dmax = (cilj !== null ? Math.max(maxV, cilj) : maxV) + 0.3;

  function x(i) { return L + (RG - L) * (n === 1 ? 0.5 : i / (n - 1)); }
  function y(v) { return B - (B - T) * ((v - dmin) / (dmax - dmin)); }

  // 7-dnevni klizni prosek (prozor po indeksu vidljivog niza).
  var prosek = vr.map(function (_, i) {
    var w = vr.slice(Math.max(0, i - 6), i + 1);
    return w.reduce(function (a, b) { return a + b; }, 0) / w.length;
  });

  var linija = vr.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
  var prosekLin = prosek.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
  var povrsina = "M " + x(0).toFixed(1) + "," + B + " L " +
    vr.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" L ") +
    " L " + x(n - 1).toFixed(1) + "," + B + " Z";

  var svg = '<svg class="kilaza-grafik" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik kilaže">';
  for (var k = 0; k < 4; k++) {
    var yy = T + (B - T) * k / 3;
    var val = dmax - (dmax - dmin) * k / 3;
    svg += '<line class="kg-grid" x1="' + L + '" y1="' + yy.toFixed(1) + '" x2="' + RG + '" y2="' + yy.toFixed(1) + '"></line>';
    svg += '<text class="kg-yl" x="0" y="' + (yy + 3).toFixed(1) + '">' + formatKg(val) + "</text>";
  }
  svg += '<path d="' + povrsina + '" fill="#232f4b" fill-opacity="0.08"></path>';
  svg += '<polyline class="kg-prosek" points="' + prosekLin + '"></polyline>';
  if (cilj !== null) {
    var gy = y(cilj);
    svg += '<line class="kg-cilj" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (RG - 44) + '" y2="' + gy.toFixed(1) + '"></line>';
    svg += '<text class="kg-cilj-l" x="' + RG + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">cilj ' + formatKg(cilj) + "</text>";
  }
  svg += '<polyline class="kg-linija" points="' + linija + '"></polyline>';
  svg += '<circle class="kg-tacka" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(vr[n - 1]).toFixed(1) + '" r="4"></circle>';

  var idxs = [0, Math.floor((n - 1) / 2), n - 1];
  var anchors = ["start", "middle", "end"];
  for (var m = 0; m < 3; m++) {
    svg += '<text class="kg-xl" x="' + x(idxs[m]).toFixed(1) + '" y="167" text-anchor="' + anchors[m] + '">' +
      kratakDatum(vidljivi[idxs[m]].datum) + "</text>";
  }
  svg += "</svg>";
  return svg;
}

// Ceo Kilaža ekran: zaglavlje sa težinom i opsegom, cilj-traka, grafik,
// statistika i stepper za unos današnje kilaže. Prazna i "jedan unos" stanja
// su posebno obrađena.
function renderKilaza() {
  var kontejner = document.getElementById("kilaza-sadrzaj");
  var kilaza = ucitajKilazu();
  var cilj = kilaza.cilj;
  var svi = kilazaNiz();

  // Inicijalizuj stepper: današnji unos → poslednji → 70,0 kg.
  if (stanje.kilazaDraft === null) {
    if (kilaza.unosi[danasKey()] !== undefined) stanje.kilazaDraft = kilaza.unosi[danasKey()];
    else if (svi.length) stanje.kilazaDraft = svi[svi.length - 1].kg;
    else stanje.kilazaDraft = 70.0;
  }

  var vidljivi = kilazaVidljivi(stanje.kilazaOpseg, svi);
  if (vidljivi.length < 2 && svi.length >= 2) vidljivi = svi; // izbegni grafik sa jednom tačkom
  var poslednja = svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft;

  var html = "";

  // ---- Zaglavlje: težina + delta + prekidač opsega ----
  html += '<header class="ekran-zaglavlje kilaza-zaglavlje"><div>' +
    '<p class="nadnaslov">KILAŽA</p>' +
    '<div class="kilaza-veliko"><b>' + formatKg(poslednja) + "</b><em>kg</em></div>";
  if (vidljivi.length >= 2) {
    var delta = poslednja - vidljivi[0].kg;
    html += '<p class="kilaza-delta ' + (delta <= 0 ? "dole" : "gore") + '">' +
      (delta <= 0 ? "▼ " : "▲ ") + formatKg(Math.abs(delta)) + " kg za " + vidljivi.length + " dana</p>";
  }
  html += "</div>";
  if (svi.length >= 2) {
    html += '<div class="kilaza-opseg">' + opsegDugme("7d") + opsegDugme("30d") + opsegDugme("sve") + "</div>";
  }
  html += "</header>";

  // ---- Cilj: traka napretka ili poziv da se postavi ----
  if (svi.length >= 1) {
    if (cilj !== null) {
      // Bazna težina (kad je cilj postavljen) određuje smer. Za stare ciljeve
      // bez zabeležene baze, uzmi prvi unos kao razuman početak.
      var baza = kilaza.ciljBaza;
      if (baza === null || baza === undefined) baza = svi.length ? svi[0].kg : poslednja;

      var smerNanize = cilj < baza; // cilj ispod baze = mršavljenje, iznad = gojenje
      var postignuto = smerNanize ? (poslednja <= cilj + 0.0001) : (poslednja >= cilj - 0.0001);
      var preostalo = Math.abs(poslednja - cilj);
      var pct = cilj === baza
        ? (postignuto ? 100 : 0)
        : Math.max(0, Math.min(100, ((poslednja - baza) / (cilj - baza)) * 100));

      html += '<button class="kilaza-cilj-red" title="Promeni cilj">' +
        '<span class="kilaza-cilj-oznaka">CILJ ' + formatKg(cilj) + " kg</span>" +
        '<span class="kilaza-cilj-traka"><span style="width:' + pct.toFixed(0) + '%"></span></span>' +
        '<span class="kilaza-cilj-preostalo">' +
          (postignuto ? "cilj postignut" : "još " + formatKg(preostalo) + " kg") +
        "</span>" +
      "</button>";
    } else {
      html += '<button class="kilaza-cilj-postavi">+ Postavi cilj kilaže</button>';
    }
  }

  // ---- Grafik / prazna stanja ----
  if (vidljivi.length >= 2) {
    html += buildKilazaChart(vidljivi, cilj);
  } else if (svi.length === 0) {
    html += '<div class="kilaza-prazno"><strong>Još nema unosa kilaže</strong>' +
      "<p>Unesi svoju težinu ispod da počneš da pratiš trend kroz vreme.</p></div>";
  } else {
    html += '<div class="kilaza-prazno"><strong>Samo jedan unos do sada</strong>' +
      "<p>Grafik se pojavljuje kad uneseš kilažu za bar dva dana.</p></div>";
  }

  // ---- Statistika ----
  if (svi.length >= 1) {
    var sveKg = svi.map(function (u) { return u.kg; });
    var minSvi = Math.min.apply(null, sveKg);
    var prosek = vidljivi.reduce(function (a, u) { return a + u.kg; }, 0) / vidljivi.length;
    var prosekLabel = "prosek " + stanje.kilazaOpseg;
    html += '<div class="kilaza-stat-red">' +
      '<div class="kilaza-stat tamna"><b>' + formatKg(poslednja) + '<small> kg</small></b><small>trenutna</small></div>' +
      '<div class="kilaza-stat"><b>' + formatKg(prosek) + "</b><small>" + prosekLabel + "</small></div>" +
      '<div class="kilaza-stat"><b>' + formatKg(minSvi) + "</b><small>najniža</small></div>" +
    "</div>";
  }

  // ---- Stepper: unos današnje kilaže ----
  var danasImaUnos = kilaza.unosi[danasKey()] !== undefined;
  html += '<div class="kilaza-step-wrap">' +
    '<p class="cap">DANAŠNJA KILAŽA · ' + kratakDatum(danasKey()).toUpperCase() + "</p>" +
    '<div class="kilaza-stepper">' +
      '<button class="kilaza-korak" data-korak="-1">−</button>' +
      '<span class="val"><input class="kilaza-vrednost" type="text" inputmode="decimal" ' +
        'value="' + formatKg(stanje.kilazaDraft) + '" aria-label="Kilaža u kg"><small>kg</small></span>' +
      '<button class="kilaza-korak" data-korak="1">+</button>' +
    "</div>" +
    '<button class="kilaza-sacuvaj"' + (stanje.kilazaSacuvano ? ' style="background:#3d8f6f"' : "") + ">" +
      (stanje.kilazaSacuvano ? "Sačuvano ✓" : (danasImaUnos ? "Ažuriraj za danas" : "Sačuvaj za danas")) +
    "</button>" +
  "</div>";

  // ---- Obroci: današnji unosi + forma ----
  html += renderObrociHtml();

  kontejner.innerHTML = html;

  // ---- Interakcije ----
  poveziKlik(kontejner, ".kilaza-opseg button", function () {
    stanje.kilazaOpseg = this.dataset.opseg;
    renderKilaza();
  });
  poveziKlik(kontejner, ".kilaza-korak", function () {
    stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft + Number(this.dataset.korak) * 0.1);
    stanje.kilazaSacuvano = false;
    renderKilaza();
  });
  poveziKlik(kontejner, ".kilaza-sacuvaj", function () {
    stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft);
    upisiKilazu(danasKey(), stanje.kilazaDraft);
    stanje.kilazaSacuvano = true;
    renderKilaza();
    clearTimeout(kilazaTajmer);
    kilazaTajmer = setTimeout(function () {
      stanje.kilazaSacuvano = false;
      if (stanje.sekcija === "kilaza") renderKilaza();
    }, 1600);
  });

  // Polje kilaže: klik + kucanje, Enter/blur potvrđuje, skrol menja za 0,1 kg.
  var polje = kontejner.querySelector(".kilaza-vrednost");
  if (polje) {
    polje.addEventListener("focus", function () { this.select(); });
    polje.addEventListener("input", function () {
      var v = parseFloat(this.value.replace(",", "."));
      if (!isNaN(v)) {
        stanje.kilazaDraft = v;
        stanje.kilazaSacuvano = false;
        ponistiOznakuCuvanja(kontejner, danasImaUnos);
      }
    });
    polje.addEventListener("change", function () {
      stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft);
      stanje.kilazaSacuvano = false;
      renderKilaza();
    });
    polje.addEventListener("keydown", function (e) {
      if (e.key === "Enter") this.blur();
    });
    polje.addEventListener("wheel", function (e) {
      e.preventDefault();
      stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft + (e.deltaY < 0 ? 0.1 : -0.1));
      stanje.kilazaSacuvano = false;
      this.value = formatKg(stanje.kilazaDraft);
      ponistiOznakuCuvanja(kontejner, danasImaUnos);
    }, { passive: false });
  }

  var ciljEl = kontejner.querySelector(".kilaza-cilj-red, .kilaza-cilj-postavi");
  if (ciljEl) ciljEl.addEventListener("click", klikKilazaCilj);

  poveziObroke(kontejner);
}

// Ako je dugme još u stanju "Sačuvano ✓", vrati ga u normalno (kad se draft
// promeni skrolom/kucanjem bez punog re-rendera).
function ponistiOznakuCuvanja(kontejner, danasImaUnos) {
  var b = kontejner.querySelector(".kilaza-sacuvaj");
  if (b && b.textContent.indexOf("Sačuvano") !== -1) {
    b.textContent = danasImaUnos ? "Ažuriraj za danas" : "Sačuvaj za danas";
    b.removeAttribute("style");
  }
}

// Postavljanje/menjanje ciljne kilaže (prompt; prazan unos uklanja cilj).
function klikKilazaCilj() {
  var k = ucitajKilazu();
  var unos = prompt("Ciljna kilaža (kg):", k.cilj !== null ? formatKg(k.cilj) : "");
  if (unos === null) return;
  unos = unos.trim().replace(",", ".");
  if (unos === "") {
    postaviCiljKilaze(null);
    renderKilaza();
    return;
  }
  var v = parseFloat(unos);
  if (isNaN(v) || v < 30 || v > 300) {
    alert("Unesi broj između 30 i 300 kg.");
    return;
  }
  // Bazna težina = poslednji unos (ili trenutna vrednost stepera ako još nema unosa).
  var svi = kilazaNiz();
  var baza = svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft;
  postaviCiljKilaze(Math.round(v * 10) / 10, baza);
  renderKilaza();
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
    id: noviId(),
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

// Dodaje novu obavezu (samo naziv — bez boje i bez cilja) u plan dana.
function dodajObavezu(datum, naziv) {
  var dan = ucitajDan(datum);
  if (!dan.obaveze) dan.obaveze = [];
  dan.obaveze.push({
    id: noviId(),
    naziv: naziv,
    checkedAt: null
  });
  sacuvajDan(datum, dan);
}

// Briše obavezu iz dana.
function obrisiObavezu(datum, id) {
  var dan = ucitajDan(datum);
  dan.obaveze = (dan.obaveze || []).filter(function (o) { return o.id !== id; });
  sacuvajDan(datum, dan);
}

// Čekira/poništava obavezu: čekiranje pamti tačan trenutak (checkedAt), a
// poništavanje ga vraća na null.
function cekirajObavezu(datum, id) {
  var dan = ucitajDan(datum);
  var obaveze = dan.obaveze || [];
  for (var i = 0; i < obaveze.length; i++) {
    if (obaveze[i].id === id) {
      obaveze[i].checkedAt = obaveze[i].checkedAt ? null : Date.now();
      break;
    }
  }
  dan.obaveze = obaveze;
  sacuvajDan(datum, dan);
}

// Dodavanje obaveze iz forme na Plan ekranu.
function dodajObavezuKlik() {
  var input = document.getElementById("obaveza-naziv");
  var naziv = input.value.trim();
  if (naziv === "") {
    alert("Upiši naziv obaveze.");
    return;
  }
  dodajObavezu(stanje.planDatum, naziv);
  input.value = "";
  renderPlan();
}

// Dodaje trening u dan (naziv + termin + slobodne linije + težina + beleška).
function dodajTrening(datum, t) {
  var dan = ucitajDan(datum);
  if (!dan.treninzi) dan.treninzi = [];
  dan.treninzi.push({
    id: noviId(),
    naziv: t.naziv, od: t.od, do: t.do,
    linije: t.linije, tezina: t.tezina, beleska: t.beleska
  });
  sacuvajDan(datum, dan);
}

// Briše trening iz dana.
function obrisiTrening(datum, id) {
  var dan = ucitajDan(datum);
  dan.treninzi = (dan.treninzi || []).filter(function (x) { return x.id !== id; });
  sacuvajDan(datum, dan);
}

// Nalazi trening po id-u; vraća null ako ne postoji.
function nadjiTrening(datum, id) {
  var lista = ucitajDan(datum).treninzi || [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].id === id) return lista[i];
  }
  return null;
}

// Dodavanje treninga iz forme na Plan ekranu.
function dodajTreningKlik() {
  var naziv = document.getElementById("trening-naziv").value.trim();
  var od = document.getElementById("trening-od").value;
  var doVreme = document.getElementById("trening-do").value;

  if (naziv === "") { alert("Upiši naziv treninga."); return; }
  if (od === "" || doVreme === "") { alert("Upiši termin (od i do)."); return; }
  if (vremeUMinute(doVreme) <= vremeUMinute(od)) {
    alert("Vreme kraja mora biti posle vremena početka.");
    return;
  }

  dodajTrening(stanje.planDatum, {
    naziv: naziv,
    od: od,
    do: doVreme,
    linije: document.getElementById("trening-linije").value,
    tezina: stanje.treningTezina,
    beleska: document.getElementById("trening-beleska").value.trim()
  });

  document.getElementById("trening-naziv").value = "";
  document.getElementById("trening-od").value = "";
  document.getElementById("trening-do").value = "";
  document.getElementById("trening-linije").value = "";
  document.getElementById("trening-beleska").value = "";
  stanje.treningTezina = 3;
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

  // Plan: nove obaveze (Enter u polju takođe dodaje).
  document.getElementById("obaveza-dodaj").addEventListener("click", dodajObavezuKlik);
  document.getElementById("obaveza-naziv").addEventListener("keydown", function (e) {
    if (e.key === "Enter") dodajObavezuKlik();
  });

  // Plan: novi trening. (Teg-birač se povezuje u crtajTegBirac pri svakom renderu.)
  document.getElementById("trening-dodaj").addEventListener("click", dodajTreningKlik);

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

// Pokretanje: prvo se podaci učitaju sa servera (Supabase) u memorijski keš,
// pa tek onda kreće aplikacija — tako sve sinhrone funkcije rade nad podacima
// koji su već tu. Bez mreže: prikaži poruku umesto praznog ekrana.
function pokreniAplikaciju() {
  var ekran = document.getElementById("ucitavanje");
  ucitajSveIzBaze().then(function () {
    if (ekran) ekran.hidden = true;
    init();
  }).catch(function (e) {
    console.error("Ne mogu da učitam podatke sa servera:", e);
    if (ekran) {
      ekran.innerHTML =
        '<div class="ucit-poruka">' +
          "<strong>Nema veze sa serverom</strong>" +
          "<p>Proveri internet konekciju pa pokušaj ponovo.</p>" +
          '<button onclick="location.reload()">Pokušaj ponovo</button>' +
        "</div>";
    }
  });
}

document.addEventListener("DOMContentLoaded", pokreniAplikaciju);
