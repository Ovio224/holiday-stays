/**
 * Tests for the IP hashing used by the gate rate limiter.
 *
 * Only hashIp is unit-tested here — isLockedOut and recordAttempt hit Supabase
 * and are covered by integration tests, not this pure-function suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hashIp } from "@/lib/gate/ratelimit";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-do-not-use-in-prod");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hashIp", () => {
  it("is deterministic: same IP yields the same hash", () => {
    expect(hashIp("203.0.113.7")).toBe(hashIp("203.0.113.7"));
  });

  it("produces different hashes for different IPs", () => {
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("198.51.100.42"));
  });

  it("returns a 64-char lowercase hex string (sha256 digest)", () => {
    const hash = hashIp("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is salted by SESSION_SECRET: same IP differs under a new secret", () => {
    const withFirstSecret = hashIp("203.0.113.7");
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret");
    const withSecondSecret = hashIp("203.0.113.7");
    expect(withFirstSecret).not.toBe(withSecondSecret);
  });
});
