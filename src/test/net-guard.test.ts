import { describe, it, expect } from "vitest";
import { isBlockedAddress, assertFetchableUrl } from "@/lib/parsing/net-guard";

// SSRF guard: server-side fetches of user-submitted URLs must never reach
// private, loopback, link-local, or reserved address space — including via
// redirects. isBlockedAddress is the pure classifier at the core of that guard.
describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback / private / CGNAT / reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.1.254",
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "192.0.0.1", // IETF protocol assignments
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "255.255.255.255", // broadcast
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the cloud metadata endpoint (169.254.169.254)", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("allows public IPv4 addresses, including near the private boundaries", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "104.16.132.229",
      "11.0.0.1",
      "172.15.0.1", // just below 172.16/12
      "172.32.0.1", // just above 172.16/12
      "169.253.0.1", // just below 169.254/16
      "169.255.0.1", // just above 169.254/16
      "100.63.255.255", // just below 100.64/10
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback / unspecified / ULA / link-local / multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks IPv4-mapped IPv6 pointing at private space", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public IPv6 (incl. a public IPv4-mapped address)", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("assertFetchableUrl", () => {
  it("rejects a non-http(s) scheme", async () => {
    await expect(assertFetchableUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertFetchableUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("rejects an unparseable URL", async () => {
    await expect(assertFetchableUrl("not a url")).rejects.toThrow();
  });

  it("rejects IP-literal private/loopback hosts", async () => {
    await expect(assertFetchableUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertFetchableUrl("http://[::1]/")).rejects.toThrow();
    await expect(
      assertFetchableUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow();
  });

  it("rejects a hostname that resolves to loopback (localhost via /etc/hosts)", async () => {
    await expect(assertFetchableUrl("http://localhost:6379/")).rejects.toThrow();
  });

  it("allows a public IP literal", async () => {
    await expect(assertFetchableUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});
