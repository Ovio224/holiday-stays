-- Initial schema for the accommodation-comparison ("Bali Stays") board.
--
-- Everything lives in a dedicated `bali` schema so this app can share an
-- EXISTING Supabase project without ever colliding with other apps' public
-- tables. There is NO Supabase Auth: the Next.js gate cookie is the real
-- authorization boundary. The browser anon key is used only for Realtime +
-- reads (RLS: open SELECT); all writes go through the service role on the server.

-- 1. Schema + extensions ----------------------------------------------------
create schema if not exists bali;
create extension if not exists pgcrypto;

-- 2. Tables -----------------------------------------------------------------

-- People in the friend group (lightweight identities, chosen after the gate).
create table bali.members (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  color      text        not null default '#16a7b8',
  created_at timestamptz not null default now()
);

-- A leg of the trip ("stay") that accommodations are grouped under.
create table bali.stays (
  id         uuid        primary key default gen_random_uuid(),
  label      text        not null,
  area       text,
  start_date date,
  end_date   date,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

-- A candidate listing (Airbnb / Booking / other link) submitted under a stay.
create table bali.accommodations (
  id           uuid        primary key default gen_random_uuid(),
  stay_id      uuid        not null references bali.stays(id) on delete cascade,
  url          text        not null,
  source       text        not null default 'other'
                 check (source in ('airbnb', 'booking', 'other')),
  title        text,
  image_url    text,
  price_text   text,
  notes        text,
  submitted_by uuid        references bali.members(id) on delete set null,
  parse_status text        not null default 'pending'
                 check (parse_status in ('pending', 'ok', 'failed', 'manual')),
  parsed_at    timestamptz,
  created_at   timestamptz not null default now()
);

-- One yes/no vote per member per accommodation (value: true = yes, false = no).
create table bali.votes (
  id                uuid        primary key default gen_random_uuid(),
  accommodation_id  uuid        not null references bali.accommodations(id) on delete cascade,
  member_id         uuid        not null references bali.members(id) on delete cascade,
  value             boolean     not null,
  updated_at        timestamptz not null default now(),
  unique (accommodation_id, member_id)
);

-- Audit/rate-limit log for gate-code attempts. Service role only.
create table bali.gate_attempts (
  id           uuid        primary key default gen_random_uuid(),
  ip_hash      text        not null,
  success      boolean     not null,
  attempted_at timestamptz not null default now()
);

-- 3. Indexes ----------------------------------------------------------------
create index accommodations_stay_id_idx on bali.accommodations (stay_id);
create index votes_accommodation_id_idx on bali.votes (accommodation_id);
create index gate_attempts_ip_hash_attempted_at_idx
  on bali.gate_attempts (ip_hash, attempted_at);

-- 4. Row Level Security -----------------------------------------------------
-- RLS on every table. With no permissive write policy, anon/authenticated can
-- only SELECT the content tables; only the service role can mutate.
alter table bali.members        enable row level security;
alter table bali.stays          enable row level security;
alter table bali.accommodations enable row level security;
alter table bali.votes          enable row level security;
alter table bali.gate_attempts  enable row level security;

-- 5. Policies ---------------------------------------------------------------
-- Deliberately SHARED internal board: the gate cookie is the real access
-- boundary, so the four content tables expose an open SELECT for the Data API
-- roles. NO insert/update/delete policies exist, so the anon key can never
-- mutate data — all writes are server-side with the service role.
create policy "members_read" on bali.members
  for select to anon, authenticated using (true);
create policy "stays_read" on bali.stays
  for select to anon, authenticated using (true);
create policy "accommodations_read" on bali.accommodations
  for select to anon, authenticated using (true);
create policy "votes_read" on bali.votes
  for select to anon, authenticated using (true);
-- bali.gate_attempts intentionally has NO policies (service role only).

-- 6. Schema usage + grants --------------------------------------------------
-- PostgREST checks both RLS and table privileges. Expose the `bali` schema and
-- grant SELECT on the content tables to the Data API roles; gate_attempts is
-- never granted to anon/authenticated. The server (service role) gets full
-- access on the whole schema explicitly.
grant usage on schema bali to anon, authenticated, service_role;
grant select on bali.members, bali.stays, bali.accommodations, bali.votes
  to anon, authenticated;
grant all on all tables in schema bali to service_role;
grant all on all sequences in schema bali to service_role;

-- 7. Realtime ---------------------------------------------------------------
-- Stream live changes on the board tables to the browser anon client. The
-- client subscribes with schema "bali"; gate_attempts is excluded.
alter publication supabase_realtime
  add table bali.accommodations, bali.votes, bali.members;
