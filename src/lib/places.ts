// Pure, env-free validation + normalization for "places to visit" (per-leg POIs)
// and for manual coordinate entry. No DB or environment access, so it's safe to
// import on server and client and is unit-tested in isolation (the submitPlace /
// setManualLocation Server Actions hit the DB and are integration-tested), exactly
// like prepareStayInput and prepareAccommodationEdit.

import type { LatLng } from "@/lib/location-score";

/**
 * The canonical POI category enum — one source of truth shared by the POI form's
 * select, the persona category multipliers (src/lib/location-score.ts), and this
 * validator. Locking it here prevents the "three mismatched lists" trap where a
 * persona multiplies on a category the UI can never produce. `category` is stored
 * as plain text (no DB check), validated app-side like the listing `source` enum.
 */
export const PLACE_CATEGORIES = [
  "beach",
  "surf",
  "restaurant",
  "cafe",
  "market",
  "bar",
  "club",
  "nature",
  "temple",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export interface PlaceInput {
  label: string;
  category?: string | null;
  address?: string | null;
  importance?: number | string | null; // 1 nice / 2 want / 3 must
  closerIsBetter?: boolean | null;
}

export interface NormalizedPlace {
  label: string;
  category: string | null;
  address: string | null;
  importance: 1 | 2 | 3;
  closer_is_better: boolean;
}

/** Trim → lowercase → validate against the canonical enum. Empty → null. */
function normalizeCategory(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  if (!(PLACE_CATEGORIES as readonly string[]).includes(trimmed)) {
    throw new Error("Pick a category from the list.");
  }
  return trimmed;
}

/**
 * Importance → 1 | 2 | 3 (nice / want / must). Empty/null defaults to 2 (want).
 * Out-of-range values are clamped (a 0 or a 7 still saves, as the nearest bound)
 * rather than rejected; only a non-numeric value throws a friendly error.
 */
function normalizeImportance(value: number | string | null | undefined): 1 | 2 | 3 {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return 2;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error("Pick how important this place is.");
  }
  return Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3;
}

/**
 * Validate + normalize a raw place form input into the columns the DB expects,
 * throwing a friendly Error on bad input (surfaced to the user via a toast).
 * `label` is required + trimmed; `category` is validated against PLACE_CATEGORIES
 * (Phase 1 doesn't expose the select yet, but the action validates anyway);
 * `address` trims to null; `importance` clamps to 1–3; `closer_is_better` defaults
 * to true.
 */
export function preparePlaceInput(input: PlaceInput): NormalizedPlace {
  const label = input.label?.trim();
  if (!label) {
    throw new Error("Give the place a name.");
  }
  // Bound both fields: the label is stored, and the address crosses a trust
  // boundary (it's URL-encoded into the third-party geocoder query), so cap it
  // for hygiene + to avoid oversized rows / a 414 from the geocoder.
  if (label.length > 200) {
    throw new Error("That name is too long.");
  }
  const address = input.address?.trim() || null;
  if (address && address.length > 500) {
    throw new Error("That address is too long.");
  }

  return {
    label,
    category: normalizeCategory(input.category),
    address,
    importance: normalizeImportance(input.importance),
    closer_is_better: input.closerIsBetter ?? true,
  };
}

/**
 * Parse a manual location the user pastes: either bare "lat,lng" or a Google Maps
 * link (…/@lat,lng,… or ?q=lat,lng / ?ll=lat,lng). Returns null when nothing
 * valid is found or the coordinates are out of range — so the action can reject
 * it with a clear message rather than storing garbage. This is the Phase-1 escape
 * hatch for a bad geocode; true interactive pin-drop is a later phase (the keyless
 * map iframe can't capture clicks).
 */
export function parseCoordinates(text: string | null | undefined): LatLng | null {
  if (!text) return null;
  const t = text.trim();

  const num = "(-?\\d+(?:\\.\\d+)?)";
  const at = t.match(new RegExp(`@${num},${num}`));
  const query = t.match(new RegExp(`[?&](?:q|ll|query)=${num},${num}`, "i"));
  const plain = t.match(new RegExp(`^\\s*${num}\\s*,\\s*${num}\\s*$`));

  const m = at ?? query ?? plain;
  if (!m) return null;

  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}
