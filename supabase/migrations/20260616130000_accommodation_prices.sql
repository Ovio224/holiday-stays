-- Per-person price comparison: each member can record the real price THEY see for
-- a given accommodation (Booking Genius, loyalty, regional pricing, coupons…),
-- layered on top of the parsed "standard" price_per_night. One row per member per
-- accommodation, upserted exactly like bali.votes, and streamed live the same way.
--
-- Amounts are stored per NIGHT (same unit as accommodations.price_per_night) so
-- the comparison is apples-to-apples and the budget can reuse price × nights.

-- 1. Table ------------------------------------------------------------------
-- Mirrors bali.votes: a (accommodation, member) unique pair, cascade-deleted with
-- either parent, defaulting updated_at itself.
create table bali.accommodation_prices (
  id                uuid        primary key default gen_random_uuid(),
  accommodation_id  uuid        not null references bali.accommodations(id) on delete cascade,
  member_id         uuid        not null references bali.members(id) on delete cascade,
  amount            numeric     not null check (amount > 0), -- per night; 0 = unset, rejected
  currency          text,       -- usually the accommodation's currency; uniform for now
  note              text,       -- optional, e.g. "Genius L2", "with coupon"
  updated_at        timestamptz not null default now(),
  unique (accommodation_id, member_id)
);

create index accommodation_prices_accommodation_id_idx
  on bali.accommodation_prices (accommodation_id);

-- 2. Row Level Security -----------------------------------------------------
-- Open SELECT for the Data API roles (same model as votes): the gate cookie is
-- the real boundary, and there is NO write policy, so the anon key can only read.
alter table bali.accommodation_prices enable row level security;
create policy "accommodation_prices_read" on bali.accommodation_prices
  for select to anon, authenticated using (true);

-- 3. Grants -----------------------------------------------------------------
-- IMPORTANT: the init migration's `grant all on all tables ... to service_role`
-- only covered tables that existed then, so this NEW table needs its own grant or
-- the service-role writes in the server action would fail with "permission denied".
grant select on bali.accommodation_prices to anon, authenticated;
grant all    on bali.accommodation_prices to service_role;

-- 4. Realtime ---------------------------------------------------------------
-- Stream price changes to the browser anon client, like accommodations/votes.
-- Guarded so the publication add is safe to re-run. Replica identity stays at the
-- default (primary key), which carries `id` in DELETE payloads — enough for the
-- client to drop a cleared price by id, matching the votes handler.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'bali' and tablename = 'accommodation_prices'
  ) then
    alter publication supabase_realtime add table bali.accommodation_prices;
  end if;
end $$;
