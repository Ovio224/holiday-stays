-- Initial schema for the accommodation-comparison board.
--
-- The app is a small, invite-only board shared by ONE friend group, gated by a
-- single shared code. There is NO Supabase Auth: the gate cookie issued by the
-- Next.js server is the real authorization boundary. The browser uses the anon
-- key purely for Realtime + reads; all writes go through the service role on the
-- server (which bypasses RLS). RLS is therefore configured to allow open reads
-- but deny all anon writes by default.

-- 1. Extensions -------------------------------------------------------------
-- pgcrypto provides gen_random_uuid() used as the default for every primary key.
create extension if not exists pgcrypto;

-- 2. Tables -----------------------------------------------------------------

-- People in the friend group. They are lightweight identities (no auth user),
-- chosen on the client after the gate is passed.
create table public.members (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  color      text        not null default '#16a7b8',
  created_at timestamptz not null default now()
);

-- A leg of the trip ("stay") that accommodations are grouped under.
create table public.stays (
  id         uuid        primary key default gen_random_uuid(),
  label      text        not null,
  area       text,
  start_date date,
  end_date   date,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

-- A candidate listing (Airbnb / Booking / other link) submitted under a stay.
create table public.accommodations (
  id           uuid        primary key default gen_random_uuid(),
  stay_id      uuid        not null references public.stays(id) on delete cascade,
  url          text        not null,
  source       text        not null default 'other'
                 check (source in ('airbnb', 'booking', 'other')),
  title        text,
  image_url    text,
  price_text   text,
  notes        text,
  submitted_by uuid        references public.members(id) on delete set null,
  parse_status text        not null default 'pending'
                 check (parse_status in ('pending', 'ok', 'failed', 'manual')),
  parsed_at    timestamptz,
  created_at   timestamptz not null default now()
);

-- One yes/no vote per member per accommodation (value: true = yes, false = no).
create table public.votes (
  id                uuid        primary key default gen_random_uuid(),
  accommodation_id  uuid        not null references public.accommodations(id) on delete cascade,
  member_id         uuid        not null references public.members(id) on delete cascade,
  value             boolean     not null,
  updated_at        timestamptz not null default now(),
  unique (accommodation_id, member_id)
);

-- Audit/rate-limit log for gate-code attempts. Only the service role ever reads
-- or writes this table (used to enforce gateMaxAttempts within gateWindowMinutes).
create table public.gate_attempts (
  id           uuid        primary key default gen_random_uuid(),
  ip_hash      text        not null,
  success      boolean     not null,
  attempted_at timestamptz not null default now()
);

-- 3. Indexes ----------------------------------------------------------------
-- Speed up the common board query (accommodations grouped by stay) and the
-- per-accommodation vote lookups, plus the gate rate-limit window scan.
create index accommodations_stay_id_idx on public.accommodations (stay_id);
create index votes_accommodation_id_idx on public.votes (accommodation_id);
create index gate_attempts_ip_hash_attempted_at_idx
  on public.gate_attempts (ip_hash, attempted_at);

-- 4. Row Level Security -----------------------------------------------------
-- Enabled on every table. With RLS on and no permissive write policy, anon and
-- authenticated roles cannot insert/update/delete — only the service role can.
alter table public.members        enable row level security;
alter table public.stays          enable row level security;
alter table public.accommodations enable row level security;
alter table public.votes          enable row level security;
alter table public.gate_attempts  enable row level security;

-- 5. Policies ---------------------------------------------------------------
-- This is a deliberately SHARED internal board. The gate cookie (enforced in the
-- Next.js layer) is the actual access boundary, not RLS. Once a visitor is past
-- the gate they may read everything, so we expose an open SELECT policy on the
-- four content tables for the Data API roles. We intentionally create NO
-- insert/update/delete policies: RLS denies writes by default, so the anon key
-- (used by the browser for Realtime/reads) can never mutate data. All writes are
-- performed server-side with the service role, which bypasses RLS entirely.

create policy "members_read" on public.members
  for select to anon, authenticated using (true);
comment on policy "members_read" on public.members is
  'Intentional open read: the shared gate cookie is the real access boundary. No write policies exist, so only the service role can mutate this table.';

create policy "stays_read" on public.stays
  for select to anon, authenticated using (true);
comment on policy "stays_read" on public.stays is
  'Intentional open read: the shared gate cookie is the real access boundary. No write policies exist, so only the service role can mutate this table.';

create policy "accommodations_read" on public.accommodations
  for select to anon, authenticated using (true);
comment on policy "accommodations_read" on public.accommodations is
  'Intentional open read: the shared gate cookie is the real access boundary. No write policies exist, so only the service role can mutate this table.';

create policy "votes_read" on public.votes
  for select to anon, authenticated using (true);
comment on policy "votes_read" on public.votes is
  'Intentional open read: the shared gate cookie is the real access boundary. No write policies exist, so only the service role can mutate this table.';

-- gate_attempts intentionally has NO policies of any kind. With RLS enabled and
-- no policy, anon/authenticated are denied all access; only the service role
-- (which bypasses RLS) touches it. It is also never exposed via the Data API
-- grants below.

-- 6. Grants for the Data API ------------------------------------------------
-- PostgREST checks both RLS and table privileges. Grant SELECT on the four
-- content tables to the Data API roles so the open-read policies take effect.
-- gate_attempts is deliberately NOT granted to anyone but the service role.
grant select on public.members        to anon, authenticated;
grant select on public.stays          to anon, authenticated;
grant select on public.accommodations to anon, authenticated;
grant select on public.votes          to anon, authenticated;

-- The Next.js server performs ALL writes (and the gate rate-limit read/write)
-- with the service role. It bypasses RLS, but Postgres still enforces table-level
-- privileges, so grant it full access on every table explicitly rather than
-- relying on Supabase's implicit default privileges (which are not guaranteed to
-- apply to migration-created tables across CLI/setups).
grant all on all tables in schema public to service_role;
grant usage on schema public to service_role;

-- 7. Realtime ---------------------------------------------------------------
-- Add the live-collaboration tables to the supabase_realtime publication so the
-- browser anon client receives INSERT/UPDATE/DELETE change events. gate_attempts
-- is excluded — it is server-only and not part of the live board.
alter publication supabase_realtime
  add table public.accommodations, public.votes, public.members;
