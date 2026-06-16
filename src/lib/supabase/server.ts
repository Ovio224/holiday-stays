import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Server-only Supabase client using the SERVICE ROLE key. This bypasses RLS,
 * so it must ONLY ever be used inside gated Server Actions / server code —
 * never import this from a client component. The service key is not exposed to
 * the browser (no NEXT_PUBLIC_ prefix).
 */
export function getServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
