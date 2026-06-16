/**
 * Tests for the gate session token (sign + verify round-trip).
 *
 * SESSION_SECRET is read lazily inside createGateToken/verifyGateToken (env.ts
 * uses getter functions), so stubbing it before the calls is sufficient. We
 * still set it via vi.stubEnv in beforeEach so each test is hermetic.
 *
 * Runs in the Node environment: jose's HS256 signing checks `instanceof
 * Uint8Array`, which fails across the jsdom/Node realm boundary under the
 * default jsdom test environment.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGateToken, verifyGateToken } from "@/lib/gate/session";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-do-not-use-in-prod");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gate session tokens", () => {
  it("round-trips: a freshly created token verifies as true", async () => {
    const token = await createGateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    await expect(verifyGateToken(token)).resolves.toBe(true);
  });

  it("returns false when no token is provided", async () => {
    await expect(verifyGateToken(undefined)).resolves.toBe(false);
  });

  it("returns false for a garbage / non-JWT string", async () => {
    await expect(verifyGateToken("not-a-real-token")).resolves.toBe(false);
  });

  it("returns false for a tampered token (mutated payload segment)", async () => {
    const token = await createGateToken();
    const [header, , signature] = token.split(".");
    // Swap in a forged payload while keeping the original signature -> invalid.
    const forgedPayload = Buffer.from(
      JSON.stringify({ ok: true, admin: true }),
    ).toString("base64url");
    const tampered = `${header}.${forgedPayload}.${signature}`;
    await expect(verifyGateToken(tampered)).resolves.toBe(false);
  });

  it("returns false for a token signed with a different secret", async () => {
    const token = await createGateToken();
    // Re-stub with a different secret, then verify the old token.
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret");
    await expect(verifyGateToken(token)).resolves.toBe(false);
  });
});
