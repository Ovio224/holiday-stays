-- User-entered detail fields for an accommodation: a free-form address (used to
-- power the keyless Google Maps embed in the detail dialog) and an amenities list.
--
-- Both are nullable and added idempotently. The existing table grants (anon
-- SELECT, service_role ALL) and the realtime publication automatically cover
-- these new columns — no extra policy, grant, or replica-identity change needed.
alter table bali.accommodations add column if not exists address   text;
alter table bali.accommodations add column if not exists amenities text[];
