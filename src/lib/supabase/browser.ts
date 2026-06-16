import { createClient } from "@supabase/supabase-js";

function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // App data lives in the dedicated `bali` schema (see server.ts), so it can
      // share a Supabase project without colliding with other apps' tables.
      db: { schema: "bali" },
      realtime: { params: { eventsPerSecond: 10 } },
    },
  );
}

// Inferred from makeClient so the schema-typed generics line up.
let client: ReturnType<typeof makeClient> | undefined;

/**
 * Browser Supabase client using the public ANON key. Used ONLY for Realtime
 * subscriptions, which RLS restricts to SELECT. Singleton so we never open more
 * than one websocket per tab.
 */
export function getBrowserClient() {
  if (!client) {
    client = makeClient();
  }
  return client;
}
