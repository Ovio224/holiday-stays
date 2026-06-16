-- Richer parsed listing data + structured pricing for budgeting.
--
-- `details` holds best-effort parsed metadata (rating, review count, capacity).
-- `price_per_night` + `currency` are mostly entered by hand (Airbnb does not
-- expose price server-side) and drive the per-leg budget totals on each card.
alter table bali.accommodations
  add column if not exists price_per_night numeric,
  add column if not exists currency text,
  add column if not exists details jsonb not null default '{}'::jsonb;

comment on column bali.accommodations.details is
  'Parsed structured details: { rating, reviews, bedrooms, beds, baths, guests }.';

-- Existing table grants (anon SELECT, service_role ALL) and the realtime
-- publication automatically cover these new columns — no extra policy needed.
