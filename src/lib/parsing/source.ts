// Source detection — figure out which booking provider a URL points at.
// Pure + defensive: any unparseable input falls back to "other".

import type { AccommodationSource } from "@/lib/types";

/**
 * Inspect a URL's host and classify it as an accommodation source.
 *
 * Rules:
 * - airbnb.* (any TLD, any subdomain) and the abnb.me short-link domain -> "airbnb"
 * - booking.com (any subdomain) -> "booking"
 * - everything else (and any invalid/unparseable URL) -> "other"
 */
export function detectSource(url: string): AccommodationSource {
  let host: string;
  try {
    // The URL constructor throws on malformed input — caught below.
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "other";
  }

  // Strip a leading "www." so subdomain checks are simpler.
  const bareHost = host.replace(/^www\./, "");

  // Airbnb: the registrable domain is "airbnb" regardless of TLD
  // (airbnb.com, airbnb.co.uk, airbnb.fr, ...), plus the abnb.me share links.
  // Match either the exact host or any subdomain of it.
  if (
    bareHost === "abnb.me" ||
    bareHost.endsWith(".abnb.me") ||
    bareHost === "airbnb" ||
    /(^|\.)airbnb\.[a-z.]+$/.test(bareHost)
  ) {
    return "airbnb";
  }

  // Booking.com and any of its subdomains (secure.booking.com, www.booking.com).
  if (bareHost === "booking.com" || bareHost.endsWith(".booking.com")) {
    return "booking";
  }

  return "other";
}
