-- =============================================================================
-- Fokus: REST endpoint za izveštaj (za Claude / AI asistente)
--
-- Pravi SQL funkciju fokus_izvestaj(broj_dana) koju Supabase automatski
-- izlaže kao REST endpoint:
--
--   GET https://pvlirqcojbpbvnlsqlmz.supabase.co/rest/v1/rpc/fokus_izvestaj
--         ?apikey=<publishable-kljuc>          (podrazumevano: 10 dana)
--         &broj_dana=30                        (opciono: drugi period)
--
-- Vraća jedan čitljiv JSON: po danima (stavke sa ciljem i odrađenim minutima,
-- sesije, obaveze, ocena, beleška) + merenja kilaže u istom periodu.
-- Sva vremena su u zoni Europe/Belgrade; minuti su već izračunati iz sesija.
--
-- POKRETANJE: nalepi ceo fajl u Supabase dashboard -> SQL Editor -> Run.
-- Bezbednost: funkcija čita ISTE podatke koje anon ključ već sme da čita
-- iz tabele fokus_store — ne otvara ništa novo.
-- =============================================================================

create or replace function public.fokus_izvestaj(broj_dana int default 10)
returns jsonb
language sql
stable
set search_path = public
as $$
with
-- svi podaci aplikacije (jedan JSON po danima) i kilaža
podaci as (
  select coalesce(
    (select value from public.fokus_store where key = 'fokus-data'),
    '{}'::jsonb
  ) as v
),
kil as (
  select coalesce(
    (select value from public.fokus_store where key = 'fokus-kilaza'),
    '{"unosi":{},"cilj":null}'::jsonb
  ) as v
),
-- granice perioda: poslednjih N dana, računato u lokalnoj zoni
granice as (
  select
    (now() at time zone 'Europe/Belgrade')::date - (greatest(broj_dana, 1) - 1) as od,
    (now() at time zone 'Europe/Belgrade')::date as dokle
),
dani as (
  select to_char(d, 'YYYY-MM-DD') as datum
  from granice, generate_series(granice.od, granice.dokle, interval '1 day') d
),
po_danu as (
  select dani.datum, podaci.v -> dani.datum as dan
  from dani, podaci
),
-- jedan JSON red po danu
sastav as (
  select
    datum,
    jsonb_build_object(
      'datum', datum,

      'fiksniDogadjaji', coalesce((
        select jsonb_agg(jsonb_build_object(
          'naziv', e->>'naziv', 'od', e->>'od', 'do', e->>'do'))
        from jsonb_array_elements(coalesce(dan->'fixedEvents', '[]'::jsonb)) e
      ), '[]'::jsonb),

      'stavke', coalesce((
        select jsonb_agg(jsonb_build_object(
          'naziv', it->>'naziv',
          'ciljMinuta', (it->>'ciljMinuta')::numeric,
          'odradjenoMinuta', odr.minuta,
          'ispunjena', odr.minuta >= (it->>'ciljMinuta')::numeric
        ))
        from jsonb_array_elements(coalesce(dan->'items', '[]'::jsonb)) it
        cross join lateral (
          select coalesce(round(sum(
            ((s->>'end')::numeric - (s->>'start')::numeric)) / 60000.0), 0) as minuta
          from jsonb_array_elements(coalesce(dan->'sessions', '[]'::jsonb)) s
          where s->>'itemId' = it->>'id'
        ) odr
      ), '[]'::jsonb),

      'sesije', coalesce((
        select jsonb_agg(jsonb_build_object(
          'stavka', coalesce((
            select it2->>'naziv'
            from jsonb_array_elements(coalesce(dan->'items', '[]'::jsonb)) it2
            where it2->>'id' = s->>'itemId'
            limit 1), '?'),
          'od', to_char(to_timestamp((s->>'start')::numeric / 1000)
                        at time zone 'Europe/Belgrade', 'HH24:MI'),
          'do', to_char(to_timestamp((s->>'end')::numeric / 1000)
                        at time zone 'Europe/Belgrade', 'HH24:MI'),
          'minuta', round(((s->>'end')::numeric - (s->>'start')::numeric) / 60000.0)
        ) order by (s->>'start')::numeric)
        from jsonb_array_elements(coalesce(dan->'sessions', '[]'::jsonb)) s
      ), '[]'::jsonb),

      'obaveze', coalesce((
        select jsonb_agg(jsonb_build_object(
          'naziv', o->>'naziv',
          'uradjena', (o->>'checkedAt') is not null,
          'vreme', case when (o->>'checkedAt') is not null
            then to_char(to_timestamp((o->>'checkedAt')::numeric / 1000)
                         at time zone 'Europe/Belgrade', 'HH24:MI')
            else null end
        ))
        from jsonb_array_elements(coalesce(dan->'obaveze', '[]'::jsonb)) o
      ), '[]'::jsonb),

      'ocena', case when coalesce((dan->>'ocena')::numeric, 0) > 0
                    then (dan->>'ocena')::numeric else null end,
      'beleska', nullif(dan->>'beleska', '')
    ) as red
  from po_danu
)
select jsonb_build_object(
  'opis', 'Fokus izveštaj — aktivnosti i kilaža za poslednjih '
          || greatest(broj_dana, 1) || ' dana',
  'generisano', to_char(now() at time zone 'Europe/Belgrade', 'YYYY-MM-DD HH24:MI'),
  'period', (select jsonb_build_object(
      'od', to_char(od, 'YYYY-MM-DD'),
      'do', to_char(dokle, 'YYYY-MM-DD')) from granice),
  'dani', (select jsonb_agg(red order by datum desc) from sastav),
  'kilaza', (select jsonb_build_object(
      'ciljKg', v->'cilj',
      'unosi', coalesce((
        select jsonb_agg(jsonb_build_object('datum', u.key, 'kg', u.value)
                         order by u.key desc)
        from jsonb_each(coalesce(v->'unosi', '{}'::jsonb)) u, granice
        where u.key >= to_char(granice.od, 'YYYY-MM-DD')
          and u.key <= to_char(granice.dokle, 'YYYY-MM-DD')
      ), '[]'::jsonb)
    ) from kil)
);
$$;

-- Dozvoli javnom (anon) ključu da poziva funkciju.
grant execute on function public.fokus_izvestaj(int) to anon;
