// SSRF guard for server-side fetches of user-submitted URLs.
//
// fetchAndParse() fetches arbitrary links and follows redirects. Without a guard
// an attacker could submit (or redirect to) http://127.0.0.1, http://[::1], or
// the cloud metadata endpoint http://169.254.169.254 and have the server fetch
// internal resources. This module rejects non-http(s) URLs and any host that is
// — or resolves to — private / loopback / link-local / reserved address space.
//
// Caveat: resolve-then-fetch leaves a narrow DNS-rebinding (TOCTOU) window, since
// the OS re-resolves at connect time. Pinning the resolved IP into the socket
// would close it but needs a custom undici dispatcher; for this gated, internal
// app the resolve-and-block check is the proportionate mitigation.

import net from "node:net";
import { lookup } from "node:dns/promises";

// IPv4 CIDRs that must never be reachable from a server-side fetch.
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (incl. 255.255.255.255 broadcast)
];

/** Parse a dotted IPv4 string to a uint32, or null when not a valid IPv4. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** True when a dotted IPv4 falls inside any blocked CIDR. */
function blockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value == null) return false;
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === ((ipv4ToInt(base) as number) & mask);
  });
}

/**
 * True when an IP literal points at private / loopback / link-local / reserved
 * address space (IPv4, IPv6, and IPv4-mapped IPv6). Returns false for public
 * addresses and for anything that isn't a recognizable IP literal (a hostname —
 * the caller resolves those and re-checks each result).
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();

  if (net.isIPv4(addr)) return blockedV4(addr);

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 (dotted) or ::ffff:7f00:1 (hex).
  if (addr.startsWith("::ffff:")) {
    const tail = addr.slice("::ffff:".length);
    if (net.isIPv4(tail)) return blockedV4(tail);
    const hextets = tail.split(":");
    if (
      hextets.length === 2 &&
      /^[0-9a-f]{1,4}$/.test(hextets[0]) &&
      /^[0-9a-f]{1,4}$/.test(hextets[1])
    ) {
      const hi = parseInt(hextets[0], 16);
      const lo = parseInt(hextets[1], 16);
      const dotted = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return blockedV4(dotted);
    }
  }

  if (net.isIPv6(addr)) {
    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    const first = addr.split(":")[0];
    const lead = first === "" ? 0 : parseInt(first, 16);
    if (Number.isFinite(lead)) {
      // fc00::/7 (unique-local): first byte fc or fd.
      if ((lead & 0xff00) === 0xfc00 || (lead & 0xff00) === 0xfd00) return true;
      // fe80::/10 (link-local).
      if ((lead & 0xffc0) === 0xfe80) return true;
      // ff00::/8 (multicast).
      if ((lead & 0xff00) === 0xff00) return true;
    }
    return false;
  }

  return false; // not an IP literal — treated as a hostname by the caller
}

/**
 * Throw unless `rawUrl` is safe to fetch server-side: it must be http(s) and
 * neither be, nor resolve to, a blocked address. Call this for the initial URL
 * AND every redirect target (a public URL can redirect into private space).
 */
export async function assertFetchableUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Refusing to fetch invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to fetch non-http(s) URL: ${parsed.protocol}`);
  }

  // Strip the [...] brackets URL uses around IPv6 literals.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`Refusing to fetch private address: ${host}`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Refusing to fetch unresolvable host: ${host}`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `Refusing to fetch host that resolves to a private address: ${host} -> ${address}`,
      );
    }
  }
}
