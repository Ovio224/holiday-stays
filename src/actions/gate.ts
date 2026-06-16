"use server";

/**
 * Gate Server Action — the front door to the whole app.
 *
 * The entire experience is locked behind ONE shared code. This action verifies
 * a submitted code, throttles brute-force guessing per source IP, and on success
 * mints a signed gate token into an httpOnly cookie. Every protected action then
 * relies on that cookie via assertGate().
 */
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { GATE_COOKIE, createGateToken } from "@/lib/gate/session";
import { hashIp, isLockedOut, recordAttempt } from "@/lib/gate/ratelimit";

/**
 * Verify the shared gate code from a submitted form.
 *
 * Flow:
 *  1. Resolve the caller's IP (first hop of x-forwarded-for) and hash it.
 *  2. Bail out early if that IP is currently locked out.
 *  3. On a correct code: record the success, set the gate cookie (30 days),
 *     and report ok.
 *  4. On a wrong code: record the failure and report a friendly error.
 *
 * Never throws — always resolves to a small, serializable result the client
 * form can act on.
 */
export async function verifyGateCode(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const code = String(formData.get("code") ?? "");

  // Identify the caller for rate-limiting. We only ever store a salted hash of
  // the IP, never the raw address. "unknown" is a safe shared bucket when the
  // proxy header is absent (e.g. local dev).
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const ipHash = hashIp(ip);

  // Stop brute force before we even compare the code.
  if (await isLockedOut(ipHash)) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }

  if (code === env.gateCode()) {
    // Log the success for accounting, then hand out the signed gate token.
    await recordAttempt(ipHash, true);

    const cookieStore = await cookies();
    cookieStore.set(GATE_COOKIE, await createGateToken(), {
      httpOnly: true,
      // secure only in production — over http://localhost the browser would
      // silently drop a secure cookie, causing an infinite /gate redirect loop.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return { ok: true };
  }

  // Wrong code: count it toward the lockout window and tell the user.
  await recordAttempt(ipHash, false);
  return { ok: false, error: "That code is not right." };
}
