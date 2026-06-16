-- Per-card discussion: a Notion-style comment thread on each accommodation, so the
-- group can say WHY they're leaning yes/no rather than just casting a silent vote.
-- Unlike bali.votes / bali.accommodation_prices there is NO (accommodation, member)
-- unique pair — a member can leave many comments. Comments stream live the same way
-- and cascade-delete with their accommodation (or their author).

-- 1. Table ------------------------------------------------------------------
create table bali.accommodation_comments (
  id                uuid        primary key default gen_random_uuid(),
  accommodation_id  uuid        not null references bali.accommodations(id) on delete cascade,
  member_id         uuid        not null references bali.members(id) on delete cascade,
  body              text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Read a card's thread oldest-first; the index covers the common (card, time) sort.
create index accommodation_comments_accommodation_id_created_at_idx
  on bali.accommodation_comments (accommodation_id, created_at);

-- 2. Row Level Security -----------------------------------------------------
-- Same model as votes/prices: open SELECT for the Data API roles (the gate cookie
-- is the real boundary), and NO write policy, so the anon key can only read.
alter table bali.accommodation_comments enable row level security;
create policy "accommodation_comments_read" on bali.accommodation_comments
  for select to anon, authenticated using (true);

-- 3. Grants -----------------------------------------------------------------
-- The init migration's `grant all on all tables` only covered tables that existed
-- then, so this NEW table needs its own service_role grant or the server-action
-- writes would fail with "permission denied".
grant select on bali.accommodation_comments to anon, authenticated;
grant all    on bali.accommodation_comments to service_role;

-- 4. Realtime ---------------------------------------------------------------
-- Stream comment inserts/edits/deletes to the browser anon client, like the other
-- board tables. Guarded so the publication add is safe to re-run. Replica identity
-- stays at the default (primary key), which carries `id` in DELETE payloads —
-- enough for the client to drop a removed comment by id.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'bali' and tablename = 'accommodation_comments'
  ) then
    alter publication supabase_realtime add table bali.accommodation_comments;
  end if;
end $$;
