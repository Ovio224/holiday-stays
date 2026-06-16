-- Add bali.stays to the realtime publication so leg (stay) changes stream to
-- the browser anon client, the same way accommodations/votes/members already do.
--
-- Guarded so the migration is safe to re-run: only add the table when it isn't
-- already a member of supabase_realtime. Replica identity is left at the default
-- (primary key), which already carries `id` in DELETE payloads — enough for the
-- client to drop a deleted leg, matching the existing handlers.
--
-- Reads via the anon key are already permitted (stays_read SELECT policy), so no
-- new RLS policies or grants are required.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'bali' and tablename = 'stays'
  ) then
    alter publication supabase_realtime add table bali.stays;
  end if;
end $$;
