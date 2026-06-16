import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Browser Supabase client using the public ANON key. Used ONLY for Realtime
 * subscriptions, which RLS restricts to SELECT. Singleton so we never open more
 * than one websocket per tab.
 */
export function getBrowserClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { realtime: { params: { eventsPerSecond: 10 } } },
    );
  }
  return client;
}
