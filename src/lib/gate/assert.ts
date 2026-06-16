/**
 * The authorization boundary.
 *
 * Every Server Action / server data fetch that touches trip data must first
 * call `assertGate()`. There is no Supabase Auth here — the gate cookie IS the
 * authorization. RLS is bypassed by the service-role client, so this check is
 * the only thing standing between a request and the database.
 */
import { cookies } from "next/headers";
import { GATE_COOKIE, verifyGateToken } from "@/lib/gate/session";

/**
 * Is the current request gated-in? Reads the GATE_COOKIE from the request
 * cookies (async in Next.js 16) and verifies its signature/expiry/payload.
 */
export async function isGateOk(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(GATE_COOKIE)?.value;
  return verifyGateToken(token);
}

/**
 * Throw unless the request has passed the gate. Use at the top of every
 * protected Server Action. The thrown Error halts the action before any
 * service-role DB access happens.
 */
export async function assertGate(): Promise<void> {
  if (!(await isGateOk())) {
    throw new Error("Not authorized — gate code required");
  }
}
