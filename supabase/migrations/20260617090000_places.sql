-- Per-leg "places to visit" (points of interest). The group curates the spots
-- they want to be near on each leg (a temple, a beach, a favourite warung); the
-- board then scores every candidate accommodation by how close it sits to them.
--
-- Written in the repo's versioned-migration style: bare `create table` / bare
-- `create policy` (NOT idempotent — these run once on a fresh DB). The one guarded
-- construct is the realtime-publication add, which errors on a re-add. The
-- re-runnable mirror of this lives in docs/deploy/bali-cloud-setup.sql.
--
-- `latitude`/`longitude` are nullable until the address is geocoded server-side
-- (LocationIQ, or a manual coordinate entry). `category`, `closer_is_better`, and
-- `sort_order` are present from the start for forward-compat; the Phase-1 UI only
-- exercises label + address + importance. `category` is validated in the app
-- (preparePlaceInput) against a canonical enum rather than a DB check, mirroring
-- how the listing `source` enum is handled.
create table bali.places (
  id               uuid        primary key default gen_random_uuid(),
  stay_id          uuid        not null references bali.stays(id) on delete cascade,
  label            text        not null,
  category         text,
  address          text,
  latitude         double precision,
  longitude        double precision,
  geocode_status   text        not null default 'pending'
                     check (geocode_status in ('pending', 'ok', 'failed', 'manual')),
  geocoded_at      timestamptz,
  importance       smallint    not null default 2  -- 3 = must, 2 = want, 1 = nice
                     check (importance between 1 and 3),
  closer_is_better boolean     not null default true,
  sort_order       integer     not null default 0,
  submitted_by     uuid        references bali.members(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index places_stay_id_idx on bali.places (stay_id);

-- Open SELECT for the Data API roles (the gate cookie is the real boundary, no
-- write policy → anon can only read); service_role needs its OWN grant because
-- the init migration's `grant all on all tables` only covered the tables that
-- existed back then.
alter table bali.places enable row level security;
create policy "places_read" on bali.places
  for select to anon, authenticated using (true);
grant select on bali.places to anon, authenticated;
grant all    on bali.places to service_role;

-- Stream live POI changes to the browser anon client (guarded so it's safe to
-- re-run / apply on a project that predates this table).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'bali' and tablename = 'places'
  ) then
    alter publication supabase_realtime add table bali.places;
  end if;
end $$;
