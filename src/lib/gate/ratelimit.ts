/**
 * Gate rate limiting (brute-force protection).
 *
 * Because the whole app is protected by a single shared code, the obvious
 * attack is to just guess it repeatedly. We throttle that per source IP using
 * a sliding window of failed attempts recorded in the `gate_attempts` table.
 *
 * IPs are never stored in the clear — we keep a salted SHA-256 hash so the
 * attempts log can't be used to reconstruct who tried what. SERVER ONLY (uses
 * the service-role Supabase client, which bypasses RLS).
 */
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Hash an IP address for storage. Salted with SESSION_SECRET so the digest is
 * stable across requests (same IP -> same hash, enabling counting) but not
 * reversible without the secret. Returns lowercase hex.
 */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + ":" + env.sessionSecret())
    .digest("hex");
}

/**
 * Has this IP exhausted its allowance of failed attempts within the window?
 *
 * Counts rows in `gate_attempts` for this ip_hash where success = false and
 * attempted_at falls inside the last `gateWindowMinutes()` minutes. Locked out
 * when that count is at or above `gateMaxAttempts()`.
 */
export async function isLockedOut(ipHash: string): Promise<boolean> {
  const windowMs = env.gateWindowMinutes() * 60 * 1000;
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from("gate_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("success", false)
    .gte("attempted_at", windowStart);

  // Fail OPEN on read errors: a flaky DB shouldn't permanently lock out the
  // whole friend group. recordAttempt still logs, so abuse is still bounded.
  if (error) {
    console.error("[gate] isLockedOut query failed:", error);
    return false;
  }

  return (count ?? 0) >= env.gateMaxAttempts();
}

/**
 * Record a gate attempt (success or failure) for rate-limiting accounting.
 * Logging must never break the request flow, so any insert failure is swallowed
 * and merely logged to the server console.
 */
export async function recordAttempt(
  ipHash: string,
  success: boolean,
): Promise<void> {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("gate_attempts")
      .insert({ ip_hash: ipHash, success });
    if (error) console.error("[gate] recordAttempt insert failed:", error);
  } catch (err) {
    console.error("[gate] recordAttempt threw:", err);
  }
}
