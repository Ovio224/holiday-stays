// Lightweight "who am I" helper. Since the app skips Supabase Auth, a member's
// identity is just an id stored in a cookie after they join via the gate code.

import { cookies } from "next/headers";

/** Cookie name holding the current member's id. */
export const MEMBER_COOKIE = "bali_member";

/**
 * Read the current member's id from the request cookies. Returns null when no
 * member cookie is set (e.g. the visitor has passed the gate but not yet
 * created/selected a member). cookies() is async in Next.js 16 — always await.
 */
export async function getCurrentMemberId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(MEMBER_COOKIE)?.value || null;
}
