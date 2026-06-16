-- Geocoded coordinates for accommodations, so the location scorer can measure the
-- distance from each candidate to the leg's places-to-visit. Until now an
-- accommodation only had a free-form `address` string (used for the keyless map
-- embed); these columns turn that address into a point.
--
-- All nullable (null until geocoded). `geocode_status` mirrors the places table:
-- 'pending' (not yet attempted / no key), 'ok' (geocoded), 'failed' (not found),
-- 'manual' (user-entered coordinates). `add column if not exists` is idempotent
-- and matches the existing accommodations-column additions, so this same block is
-- mirrored verbatim into docs/deploy/bali-cloud-setup.sql.
--
-- The accommodations table is already in the realtime publication and its grants
-- already cover all columns, so coordinate updates stream for free — no new
-- policy, grant, or publication change is needed (we're adding columns, not a
-- relation).
alter table bali.accommodations
  add column if not exists latitude       double precision,
  add column if not exists longitude      double precision,
  add column if not exists geocode_status text not null default 'pending'
    check (geocode_status in ('pending', 'ok', 'failed', 'manual')),
  add column if not exists geocoded_at    timestamptz;
