-- =============================================================================
-- Fokus: REST endpointi za DODAVANJE unosa (za Claude / AI asistente)
--
-- Pandan fajlu supabase-izvestaj.sql: dok fokus_izvestaj ČITA podatke, ove
-- funkcije ih UPISUJU — obrok, kilažu, trening, obavezu i stavku sa ciljem.
--
-- VAŽNO — ovo su POST endpointi, ne obični linkovi:
--   PostgREST dozvoljava GET samo funkcijama koje ne menjaju podatke
--   (stable/immutable). Funkcija koja upisuje mora biti "volatile", a takve
--   se zovu isključivo preko POST-a. Primer poziva:
--
--   curl -X POST \
--     "https://pvlirqcojbpbvnlsqlmz.supabase.co/rest/v1/rpc/fokus_dodaj_obrok" \
--     -H "apikey: <publishable-kljuc>" \
--     -H "Content-Type: application/json" \
--     -d '{"opis":"Piletina sa pirinčem","kcal":620,"protein":48,"ugljeni":65,"masti":12}'
--
-- Svaka funkcija vraća JSON sa upisanom stavkom (uključujući generisani id),
-- pa se odmah vidi šta je tačno ušlo u bazu.
--
-- DATUM: svugde opcion. Ako se izostavi, uzima se današnji dan po zoni
-- Europe/Belgrade. Format je "YYYY-MM-DD".
--
-- POKRETANJE: nalepi ceo fajl u Supabase dashboard -> SQL Editor -> Run.
--
-- PAŽNJA — APLIKACIJA MOŽE DA PREGAZI OVAJ UPIS:
--   Aplikacija učita sve podatke u memoriju pri pokretanju i pri svakoj izmeni
--   pošalje CEO blob nazad. Ako je app otvorena na telefonu dok Claude ovde
--   nešto doda, prvi sledeći upis iz app-a piše preko toga i dodato nestaje.
--   Zato: kad Claude nešto doda, osveži (zatvori i otvori) aplikaciju pre nego
--   što u njoj išta menjaš. Isti rizik postoji i za dva otvorena uređaja —
--   nije uveden ovim funkcijama, samo ga vredi znati.
--
-- REZERVNA KOPIJA pre prvog pokretanja (funkcije prepisuju ceo fokus-planovi):
--   insert into public.fokus_store (key, value, updated_at)
--   select 'backup-' || to_char(now(), 'YYYY-MM-DD-HH24MI'), value, now()
--   from public.fokus_store where key = 'fokus-planovi';
--
-- BEZBEDNOST: funkcije rade sa ISTIM pravima koja anon ključ već ima — app
-- iz browsera ionako upisuje u fokus_store tim istim ključem, a taj ključ je
-- javan (stoji u storage.js na GitHub-u). Dakle ništa novo se ne otvara: ko
-- god ima ključ već je mogao da piše direktno u tabelu. (Ako to ikad postane
-- problem, rešenje nije skrivanje ovih funkcija nego RLS pravilo + tajni ključ.)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Pomoćna: id u istom formatu koji pravi aplikacija (noviId u app.js):
-- milisekunde + "-" + 6 nasumičnih znakova.
-- -----------------------------------------------------------------------------
create or replace function public.fokus_novi_id()
returns text
language sql
volatile
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint::text
         || '-' || substr(md5(random()::text), 1, 6);
$$;


-- -----------------------------------------------------------------------------
-- Pomoćna: normalizuje datum — prazno/null = danas (Europe/Belgrade).
-- Baca grešku ako format nije YYYY-MM-DD, da tiho ne upiše na pogrešan dan.
-- -----------------------------------------------------------------------------
create or replace function public.fokus_datum(p_datum text)
returns text
language plpgsql
stable
as $$
begin
  if p_datum is null or btrim(p_datum) = '' then
    return to_char(now() at time zone 'Europe/Belgrade', 'YYYY-MM-DD');
  end if;
  if p_datum !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Datum mora biti u formatu YYYY-MM-DD (dobijeno: %)', p_datum;
  end if;
  -- ::date baca grešku za nepostojeće datume (npr. 2026-02-31)
  perform p_datum::date;
  return p_datum;
end;
$$;


-- -----------------------------------------------------------------------------
-- Pomoćna (srce svega): dodaje stavku u niz unutar jednog dana u "fokus-planovi".
--
-- Radi na tri nivoa "možda ne postoji":
--   1) red fokus-planovi možda ne postoji  -> kreni od {}
--   2) dan možda ne postoji             -> napravi prazan dan (isti oblik
--                                          koji pravi ucitajDan u storage.js)
--   3) niz (obroci/items/...) možda ne postoji -> kreni od []
-- Bez ovoga bi jsonb_set tiho vratio null i obrisao podatke.
-- -----------------------------------------------------------------------------
create or replace function public.fokus_dodaj_u_dan(p_datum text, p_polje text, p_stavka jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_podaci jsonb;
  v_dan jsonb;
begin
  select value into v_podaci from public.fokus_store where key = 'fokus-planovi';
  v_podaci := coalesce(v_podaci, '{}'::jsonb);

  v_dan := coalesce(
    v_podaci -> p_datum,
    '{"fixedEvents":[],"items":[],"sessions":[],"obaveze":[]}'::jsonb
  );

  v_dan := jsonb_set(v_dan, array[p_polje],
                     coalesce(v_dan -> p_polje, '[]'::jsonb) || p_stavka, true);

  v_podaci := jsonb_set(v_podaci, array[p_datum], v_dan, true);

  -- Sigurnosna kočnica: jsonb_set vraća NULL ako mu je bilo koji argument
  -- NULL. Pošto ovde upisujemo CEO blob svih dana, tih NULL bi obrisao sve
  -- podatke. Radije pukni nego da tiho progutaš istoriju.
  if v_podaci is null or jsonb_typeof(v_podaci) <> 'object' then
    raise exception 'Interna greška: rezultat nije validan JSON objekat — upis je prekinut.';
  end if;

  insert into public.fokus_store (key, value, updated_at)
  values ('fokus-planovi', v_podaci, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  return p_stavka;
end;
$$;


-- =============================================================================
-- 1) OBROK
--
--   POST /rest/v1/rpc/fokus_dodaj_obrok
--   {"opis":"Piletina sa pirinčem","kcal":620,"protein":48,"ugljeni":65,"masti":12}
--   (protein/ugljeni/masti/datum su opcioni)
-- =============================================================================
create or replace function public.fokus_dodaj_obrok(
  opis text,
  kcal numeric,
  protein numeric default 0,
  ugljeni numeric default 0,
  masti numeric default 0,
  datum text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_datum text := public.fokus_datum(datum);
  v_stavka jsonb;
begin
  if opis is null or btrim(opis) = '' then
    raise exception 'Obrok mora imati opis.';
  end if;
  if kcal is null or kcal < 0 or coalesce(protein, 0) < 0
     or coalesce(ugljeni, 0) < 0 or coalesce(masti, 0) < 0 then
    raise exception 'Kalorije i makroi moraju biti brojevi 0 ili veći.';
  end if;

  v_stavka := jsonb_build_object(
    'id', public.fokus_novi_id(),
    'opis', btrim(opis),
    'kcal', kcal,
    'protein', coalesce(protein, 0),
    'ugljeni', coalesce(ugljeni, 0),
    'masti', coalesce(masti, 0),
    'upisan', (extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  perform public.fokus_dodaj_u_dan(v_datum, 'obroci', v_stavka);
  return jsonb_build_object('ok', true, 'datum', v_datum, 'obrok', v_stavka);
end;
$$;


-- =============================================================================
-- 2) KILAŽA  (jedan unos po danu — ponovni poziv za isti dan ga prepisuje)
--
--   POST /rest/v1/rpc/fokus_upisi_kilazu
--   {"kg":82.4}
-- =============================================================================
create or replace function public.fokus_upisi_kilazu(
  kg numeric,
  datum text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_datum text := public.fokus_datum(datum);
  v_kil jsonb;
  v_kg numeric;
begin
  if kg is null or kg < 30 or kg > 300 then
    raise exception 'Kilaža mora biti između 30 i 300 kg (dobijeno: %).', kg;
  end if;
  v_kg := round(kg, 1); -- app radi na 0,1 kg

  select value into v_kil from public.fokus_store where key = 'kilaza-trening';
  v_kil := coalesce(v_kil, '{"unosi":{},"cilj":null}'::jsonb);
  if v_kil -> 'unosi' is null then
    v_kil := jsonb_set(v_kil, '{unosi}', '{}'::jsonb, true);
  end if;

  v_kil := jsonb_set(v_kil, array['unosi', v_datum], to_jsonb(v_kg), true);

  insert into public.fokus_store (key, value, updated_at)
  values ('kilaza-trening', v_kil, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'datum', v_datum, 'kg', v_kg);
end;
$$;


-- =============================================================================
-- 3) TRENING
--
--   POST /rest/v1/rpc/fokus_dodaj_trening
--   {"naziv":"Gornji deo tela","pocetak":"17:30","kraj":"18:40",
--    "linije":"Potisak s klupe — 4×8 · 60 kg\nVeslanje — 4×10 · 40 kg",
--    "tezina":3,"beleska":"Solidno je islo"}
--
--   Napomena: parametri se zovu "pocetak"/"kraj" (a ne od/do) jer je "do"
--   rezervisana reč u SQL-u. U bazi se i dalje čuvaju kao od/do, kao što
--   aplikacija očekuje.
-- =============================================================================
create or replace function public.fokus_dodaj_trening(
  naziv text,
  pocetak text,
  kraj text,
  linije text default '',
  tezina int default 3,
  beleska text default '',
  datum text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_datum text := public.fokus_datum(datum);
  v_stavka jsonb;
begin
  if naziv is null or btrim(naziv) = '' then
    raise exception 'Trening mora imati naziv.';
  end if;
  -- NULL provere idu prvo: "null !~ regex" daje NULL, a IF NULL se ponaša kao
  -- FALSE — bez ovoga bi nedostajuće vreme tiho prošlo validaciju.
  if pocetak is null or kraj is null then
    raise exception 'Trening mora imati početak i kraj (HH:MM).';
  end if;
  if pocetak !~ '^\d{2}:\d{2}$' or kraj !~ '^\d{2}:\d{2}$' then
    raise exception 'Vreme mora biti u formatu HH:MM (dobijeno: % i %).', pocetak, kraj;
  end if;
  if kraj <= pocetak then
    raise exception 'Kraj treninga mora biti posle početka.';
  end if;
  if tezina is null or tezina < 1 or tezina > 5 then
    raise exception 'Težina mora biti ceo broj 1–5 (1=Lako, 5=Maksimalno).';
  end if;

  v_stavka := jsonb_build_object(
    'id', public.fokus_novi_id(),
    'naziv', btrim(naziv),
    'od', pocetak,
    'do', kraj,
    'linije', coalesce(linije, ''),
    'tezina', tezina,
    'beleska', coalesce(beleska, '')
  );

  perform public.fokus_dodaj_u_dan(v_datum, 'treninzi', v_stavka);
  return jsonb_build_object('ok', true, 'datum', v_datum, 'trening', v_stavka);
end;
$$;


-- =============================================================================
-- 4) OBAVEZA  (bez tajmera — samo se čekira kad se uradi)
--
--   POST /rest/v1/rpc/fokus_dodaj_obavezu
--   {"naziv":"Pošalji mejl profesoru"}
-- =============================================================================
create or replace function public.fokus_dodaj_obavezu(
  naziv text,
  datum text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_datum text := public.fokus_datum(datum);
  v_stavka jsonb;
begin
  if naziv is null or btrim(naziv) = '' then
    raise exception 'Obaveza mora imati naziv.';
  end if;

  -- null::text, a ne goli null — jsonb_build_object ne ume da odredi tip
  -- netipiziranog NULL-a i pukao bi na "could not determine polymorphic type".
  v_stavka := jsonb_build_object(
    'id', public.fokus_novi_id(),
    'naziv', btrim(naziv),
    'checkedAt', null::text
  );

  perform public.fokus_dodaj_u_dan(v_datum, 'obaveze', v_stavka);
  return jsonb_build_object('ok', true, 'datum', v_datum, 'obaveza', v_stavka);
end;
$$;


-- =============================================================================
-- 5) STAVKA  ("obaveza sa tajmerom" — ima cilj u minutima i meri se tajmerom)
--
--   POST /rest/v1/rpc/fokus_dodaj_stavku
--   {"naziv":"Numerička","cilj_minuta":120}
--   {"naziv":"Numerička","cilj_minuta":120,"boja":"#3d8f6f"}
--
--   Boja je opciona; ako se izostavi, uzima se prva iz palete aplikacije.
-- =============================================================================
create or replace function public.fokus_dodaj_stavku(
  naziv text,
  cilj_minuta int,
  boja text default null,
  datum text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_datum text := public.fokus_datum(datum);
  v_boja text;
  v_stavka jsonb;
begin
  if naziv is null or btrim(naziv) = '' then
    raise exception 'Stavka mora imati naziv.';
  end if;
  if cilj_minuta is null or cilj_minuta <= 0 then
    raise exception 'Cilj mora biti veći od nule (u minutima).';
  end if;

  -- Paleta iz app.js; nepoznata boja bi se videla kao prazan krug u UI-ju.
  v_boja := coalesce(boja, '#44659e');
  if v_boja !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Boja mora biti hex, npr. #44659e (dobijeno: %).', boja;
  end if;

  v_stavka := jsonb_build_object(
    'id', public.fokus_novi_id(),
    'naziv', btrim(naziv),
    'boja', v_boja,
    'ciljMinuta', cilj_minuta
  );

  perform public.fokus_dodaj_u_dan(v_datum, 'items', v_stavka);
  return jsonb_build_object('ok', true, 'datum', v_datum, 'stavka', v_stavka);
end;
$$;


-- -----------------------------------------------------------------------------
-- Dozvoli javnom (anon) ključu da poziva funkcije.
--
-- Pomoćne funkcije takođe moraju biti dozvoljene: gornjih pet nisu SECURITY
-- DEFINER, pa se izvršavaju sa pravima pozivaoca (anon) i zovu pomoćne u
-- njegovo ime. Bez ovih grantova bi pukle na "permission denied for function".
-- -----------------------------------------------------------------------------
grant execute on function public.fokus_novi_id() to anon;
grant execute on function public.fokus_datum(text) to anon;
grant execute on function public.fokus_dodaj_u_dan(text, text, jsonb) to anon;

grant execute on function public.fokus_dodaj_obrok(text, numeric, numeric, numeric, numeric, text) to anon;
grant execute on function public.fokus_upisi_kilazu(numeric, text) to anon;
grant execute on function public.fokus_dodaj_trening(text, text, text, text, int, text, text) to anon;
grant execute on function public.fokus_dodaj_obavezu(text, text) to anon;
grant execute on function public.fokus_dodaj_stavku(text, int, text, text) to anon;
