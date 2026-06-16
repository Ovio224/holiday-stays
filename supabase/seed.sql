-- Seed data for local development / `supabase db reset`.
--
-- Designed to be safe to re-run: every insert is conditioned with `where not
-- exists (...)`, so running this against an already-seeded database is a no-op
-- and never creates duplicate rows. Explicit column lists are used throughout.

-- Trip legs ("stays") for a Bali itinerary, ordered by sort_order.
insert into public.stays (label, area, start_date, end_date, sort_order)
select 'Ubud', 'Bali', date '2026-08-01', date '2026-08-04', 0
where not exists (select 1 from public.stays where label = 'Ubud');

insert into public.stays (label, area, start_date, end_date, sort_order)
select 'Canggu', 'Bali', date '2026-08-04', date '2026-08-08', 1
where not exists (select 1 from public.stays where label = 'Canggu');

insert into public.stays (label, area, start_date, end_date, sort_order)
select 'Uluwatu', 'Bali', date '2026-08-08', date '2026-08-11', 2
where not exists (select 1 from public.stays where label = 'Uluwatu');

-- A couple of sample members so the board has identities to vote with.
insert into public.members (name, color)
select 'Ovidiu', '#16a7b8'
where not exists (select 1 from public.members where name = 'Ovidiu');

insert into public.members (name, color)
select 'Ana', '#f4795b'
where not exists (select 1 from public.members where name = 'Ana');
