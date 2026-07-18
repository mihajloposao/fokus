-- =============================================================================
-- Fokus: REST endpoint za izveštaj (za Claude / AI asistente)
--
-- Pravi SQL funkciju fokus_izvestaj(broj_dana) koju Supabase automatski
-- izlaže kao REST endpoint:
--
--   GET https://pvlirqcojbpbvnlsqlmz.supabase.co/rest/v1/rpc/fokus_izvestaj
--         ?apikey=<publishable-kljuc>          (podrazumevano: SVI podaci)
--         &broj_dana=30                        (opciono: suzi na poslednjih N dana)
--
-- Vraća jedan čitljiv JSON: po danima (stavke sa ciljem i odrađenim minutima,
-- sesije, obaveze, treninzi, OBROCI + dnevni zbir kalorija, proteina,
-- ugljenih hidrata i masti, ocena, beleška) + merenja kilaže i prosek
-- ishrane u istom periodu.
-- Sva vremena su u zoni Europe/Belgrade; minuti su već izračunati iz sesija.
--
-- POKRETANJE: nalepi ceo fajl u Supabase dashboard -> SQL Editor -> Run.
-- Bezbednost: funkcija čita ISTE podatke koje anon ključ već sme da čita
-- iz tabele fokus_store — ne otvara ništa novo.
-- =============================================================================

create or replace function public.fokus_izvestaj(broj_dana int default null)
returns jsonb
language sql
stable
set search_path = public
as $$
with
-- svi podaci aplikacije (jedan JSON po danima) i kilaža
podaci as (
  select coalesce(
    (select value from public.fokus_store where key = 'fokus-planovi'),
    '{}'::jsonb
  ) as v
),
kil as (
  select coalesce(
    (select value from public.fokus_store where key = 'kilaza-trening'),
    '{"unosi":{},"cilj":null}'::jsonb
  ) as v
),
-- granice perioda. Ako je broj_dana prosleđen (> 0): poslednjih N dana.
-- Ako je NULL (podrazumevano): ceo raspon — od najranijeg unosa (u planovima
-- ili kilaži) do danas (ili do najkasnijeg unosa ako je u budućnosti).
granice as (
  select
    case when broj_dana is not null and broj_dana > 0
      then (now() at time zone 'Europe/Belgrade')::date - (broj_dana - 1)
      else coalesce(mm.mn::date, (now() at time zone 'Europe/Belgrade')::date)
    end as od,
    case when broj_dana is not null and broj_dana > 0
      then (now() at time zone 'Europe/Belgrade')::date
      else greatest(coalesce(mm.mx::date, (now() at time zone 'Europe/Belgrade')::date),
                    (now() at time zone 'Europe/Belgrade')::date)
    end as dokle
  from (
    select min(k) as mn, max(k) as mx
    from (
      select jsonb_object_keys(podaci.v) as k from podaci
      union all
      select jsonb_object_keys(coalesce(kil.v -> 'unosi', '{}'::jsonb)) as k from kil
    ) kljucevi
    where k ~ '^\d{4}-\d{2}-\d{2}$'
  ) mm
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

      'treninzi', coalesce((
        select jsonb_agg(jsonb_build_object(
          'naziv', tr->>'naziv',
          'od', tr->>'od',
          'do', tr->>'do',
          'trajanjeMinuta',
            (split_part(tr->>'do', ':', 1)::int * 60 + split_part(tr->>'do', ':', 2)::int)
            - (split_part(tr->>'od', ':', 1)::int * 60 + split_part(tr->>'od', ':', 2)::int),
          'tezina', (tr->>'tezina')::int,
          'tezinaRec', (array['Lako','Umereno','Solidno','Naporno','Maksimalno'])[(tr->>'tezina')::int],
          'linije', coalesce((
            select jsonb_agg(trim(x)) filter (where trim(x) <> '')
            from unnest(string_to_array(coalesce(tr->>'linije', ''), E'\n')) x
          ), '[]'::jsonb),
          'beleska', nullif(tr->>'beleska', '')
        ))
        from jsonb_array_elements(coalesce(dan->'treninzi', '[]'::jsonb)) tr
      ), '[]'::jsonb),

      -- Pojedinačni obroci, hronološki (redosled upisa). Obroci upisani pre
      -- uvođenja masti nemaju to polje — čitamo ih kao 0.
      'obroci', coalesce((
        select jsonb_agg(jsonb_build_object(
          'opis', ob->>'opis',
          'kcal', (ob->>'kcal')::numeric,
          'protein', (ob->>'protein')::numeric,
          'ugljeni', (ob->>'ugljeni')::numeric,
          'masti', coalesce((ob->>'masti')::numeric, 0),
          'vreme', case when (ob->>'upisan') is not null
            then to_char(to_timestamp((ob->>'upisan')::numeric / 1000)
                         at time zone 'Europe/Belgrade', 'HH24:MI')
            else null end
        ) order by (ob->>'upisan')::numeric nulls last)
        from jsonb_array_elements(coalesce(dan->'obroci', '[]'::jsonb)) ob
      ), '[]'::jsonb),

      -- Dnevni zbir ishrane — već sračunat da ne mora da se sabira ručno.
      'ishrana', (
        select jsonb_build_object(
          'brojObroka', count(*),
          'ukupnoKcal', coalesce(sum((ob->>'kcal')::numeric), 0),
          'ukupnoProtein', coalesce(sum((ob->>'protein')::numeric), 0),
          'ukupnoUgljeni', coalesce(sum((ob->>'ugljeni')::numeric), 0),
          'ukupnoMasti', coalesce(sum((ob->>'masti')::numeric), 0)
        )
        from jsonb_array_elements(coalesce(dan->'obroci', '[]'::jsonb)) ob
      ),

      'ocena', case when coalesce((dan->>'ocena')::numeric, 0) > 0
                    then (dan->>'ocena')::numeric else null end,
      'beleska', nullif(dan->>'beleska', '')
    ) as red
  from po_danu
),
-- Prosek ishrane: samo po danima koji IMAJU bar jedan obrok, da dani bez
-- upisa ne obore prosek na lažno nisku vrednost.
ishrana_prosek as (
  select
    count(*) filter (where (red->'ishrana'->>'brojObroka')::int > 0) as dana_sa_unosom,
    coalesce(round(avg((red->'ishrana'->>'ukupnoKcal')::numeric)
      filter (where (red->'ishrana'->>'brojObroka')::int > 0), 0), 0) as prosek_kcal,
    coalesce(round(avg((red->'ishrana'->>'ukupnoProtein')::numeric)
      filter (where (red->'ishrana'->>'brojObroka')::int > 0), 0), 0) as prosek_protein,
    coalesce(round(avg((red->'ishrana'->>'ukupnoUgljeni')::numeric)
      filter (where (red->'ishrana'->>'brojObroka')::int > 0), 0), 0) as prosek_ugljeni,
    coalesce(round(avg((red->'ishrana'->>'ukupnoMasti')::numeric)
      filter (where (red->'ishrana'->>'brojObroka')::int > 0), 0), 0) as prosek_masti
  from sastav
)
select jsonb_build_object(
  'opis', case when broj_dana is not null and broj_dana > 0
    then 'Fokus izveštaj — aktivnosti, ishrana i kilaža za poslednjih '
         || broj_dana || ' dana'
    else 'Fokus izveštaj — svi podaci (aktivnosti, ishrana i kilaža)' end,
  'generisano', to_char(now() at time zone 'Europe/Belgrade', 'YYYY-MM-DD HH24:MI'),
  'period', (select jsonb_build_object(
      'od', to_char(od, 'YYYY-MM-DD'),
      'do', to_char(dokle, 'YYYY-MM-DD')) from granice),
  'dani', (select jsonb_agg(red order by datum desc) from sastav),
  'ishranaProsek', (select jsonb_build_object(
      'danaSaUnosom', dana_sa_unosom,
      'prosecnoKcal', prosek_kcal,
      'prosecnoProtein', prosek_protein,
      'prosecnoUgljeni', prosek_ugljeni,
      'prosecnoMasti', prosek_masti,
      'napomena', 'Prosek se računa samo po danima sa bar jednim upisanim obrokom.'
    ) from ishrana_prosek),
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
