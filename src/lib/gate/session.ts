/**
 * Gate session tokens.
 *
 * The whole app is gated behind ONE shared code. Once a visitor proves they
 * know the code, we hand them a signed JWT that lives in an httpOnly cookie.
 * The token payload is intentionally tiny — `{ ok: true }` — because it does
 * not identify a user; it only asserts "this browser passed the gate". The
 * signature (HS256 over SESSION_SECRET) is what makes it unforgeable.
 *
 * Uses jose v6 (SignJWT / jwtVerify). All crypto is async.
 */
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

/** Cookie name that holds the signed gate token. */
export const GATE_COOKIE = "bali_gate";

/**
 * Derive the HMAC signing key from SESSION_SECRET. Computed inside a function
 * (never at module top-level) so a missing env var throws at request time with
 * a clear message instead of crashing the build.
 */
function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret());
}

/**
 * Mint a fresh gate token. Signed with HS256, valid for 30 days. Callers store
 * the returned string in the GATE_COOKIE (httpOnly) after a successful gate.
 */
export async function createGateToken(): Promise<string> {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

/**
 * Verify a gate token. Returns true ONLY when the signature is valid, the token
 * is unexpired, and the payload's `ok` flag is exactly `true`. Any problem —
 * missing token, bad signature, expiry, tampering — resolves to false.
 */
export async function verifyGateToken(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.ok === true;
  } catch {
    return false;
  }
}
