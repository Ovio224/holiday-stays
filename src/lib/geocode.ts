// Server-only geocoding (address string → coordinates) via LocationIQ. Reads a
// server-only API key and uses fetch, so this must NEVER be imported by a client
// component — only by Server Actions in src/actions/locations.ts.
//
// The whole feature is designed to degrade, never crash: with no key configured
// the result is 'pending' (the UI shows "Needs address" and the scorer falls back
// to manual coordinates + haversine). A genuine miss is 'failed' (offer a manual
// coordinate entry); a rate-limit/5xx is 'pending'/transient (offer a retry) —
// the two are deliberately distinct so the UI copy can differ (see §4.1/§9).

import { env } from "@/lib/env";
import type { GeocodeStatus } from "@/lib/types";

export type GeocodeOutcome =
  | { status: "ok"; latitude: number; longitude: number }
  | { status: "failed" } // genuine not-found — let the user set coordinates
  | { status: "pending"; reason: "no-key" | "transient" }; // skipped / retryable

/**
 * Forward-geocode a free-form address. Returns a discriminated outcome rather than
 * throwing, so the caller can persist the right `geocode_status` in one place.
 */
export async function geocodeAddress(address: string): Promise<GeocodeOutcome> {
  const key = env.locationiqApiKey();
  if (!key) return { status: "pending", reason: "no-key" };

  const q = address.trim();
  if (!q) return { status: "failed" };

  try {
    const url =
      `https://us1.locationiq.com/v1/search?key=${encodeURIComponent(key)}` +
      `&q=${encodeURIComponent(q)}&format=json&limit=1`;
    // Bound the wait: geocoding runs inline inside mutating Server Actions, so a
    // hung upstream must not block the user's save. An abort lands in the catch
    // below as a retryable 'pending', which is the correct degraded outcome.
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    // 404 = "Unable to geocode" (genuine miss). 429/5xx = transient (retry).
    if (res.status === 404) return { status: "failed" };
    if (!res.ok) return { status: "pending", reason: "transient" };

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { status: "failed" };

    const first = data[0] as { lat?: unknown; lon?: unknown };
    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { status: "failed" };
    }
    return { status: "ok", latitude, longitude };
  } catch {
    // Network error / abort — retryable, not a genuine miss.
    return { status: "pending", reason: "transient" };
  }
}

/** The geocode-related columns shared by `places` and `accommodations`. */
export interface GeocodeColumns {
  geocode_status: GeocodeStatus;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
}

/**
 * Geocode an address into the DB column shape (the single source of this mapping,
 * used by every action). A null/empty address → 'pending' with no coords; a
 * genuine miss → 'failed'; a transient/no-key result → 'pending' with no coords.
 */
export async function geocodeToColumns(address: string | null): Promise<GeocodeColumns> {
  if (!address) {
    return { geocode_status: "pending", latitude: null, longitude: null, geocoded_at: null };
  }
  const outcome = await geocodeAddress(address);
  if (outcome.status === "ok") {
    return {
      geocode_status: "ok",
      latitude: outcome.latitude,
      longitude: outcome.longitude,
      geocoded_at: new Date().toISOString(),
    };
  }
  if (outcome.status === "failed") {
    return { geocode_status: "failed", latitude: null, longitude: null, geocoded_at: null };
  }
  return { geocode_status: "pending", latitude: null, longitude: null, geocoded_at: null };
}
