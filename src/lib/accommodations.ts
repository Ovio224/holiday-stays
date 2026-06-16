// Pure, env-free validation + normalization for editing an accommodation, plus
// the keyless Google Maps helpers used by the detail dialog. No DB or environment
// access, so this is safe to import on both server and client and is unit-testable
// in isolation (the updateAccommodation Server Action hits the DB and is
// integration-tested instead, like the other actions).

import type { ListingDetails } from "@/lib/types";

export interface AccommodationEditInput {
  title?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  address?: string | null;
  amenities?: string[] | string | null; // array or newline/comma text from the form
  pricePerNight?: number | string | null;
  currency?: string | null;
  guests?: number | string | null;
  bedrooms?: number | string | null;
  beds?: number | string | null;
  baths?: number | string | null; // may be fractional
}

export interface NormalizedAccommodationEdit {
  title: string | null;
  image_url: string | null;
  notes: string | null;
  address: string | null;
  amenities: string[] | null; // null when empty
  price_per_night: number | null;
  currency: string | null;
  details: Partial<ListingDetails>; // only the capacity keys we let users edit
}

/** Trim a free-form text field → null when empty. */
function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalize a raw amenities value: accept an array OR a string (split on newlines
 * and commas). Each entry is trimmed; empties are dropped, then duplicates are
 * removed case-insensitively (keeping the first occurrence) while order is
 * preserved. An empty result becomes null.
 */
function normalizeAmenities(
  value: string[] | string | null | undefined,
): string[] | null {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value : value.split(/[\n,]/);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result.length > 0 ? result : null;
}

/**
 * Validate an editable price/night. Empty/null → null. Otherwise it must parse to
 * a finite, non-negative number (rounded to cents); anything else throws.
 */
function normalizePrice(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter a valid price.");
  }
  return Math.round(n * 100) / 100;
}

/**
 * Validate one editable capacity field. Empty/null → undefined (so the key is
 * omitted from the details patch and the existing value is left untouched).
 * Otherwise it must be finite and non-negative; `baths` may be fractional while
 * the others are rounded to integers. Invalid input throws.
 */
function normalizeCapacity(
  value: number | string | null | undefined,
  { fractional }: { fractional: boolean },
): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;

  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter valid room details.");
  }
  return fractional ? n : Math.round(n);
}

/** True when a present string is a valid http(s) URL (mirrors submitAccommodation). */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate + normalize an accommodation edit into the columns the DB expects,
 * throwing a friendly Error on bad input (surfaced to the user via a toast).
 * Text fields are trimmed to null; the image URL (when present) must be http(s);
 * the price + capacity follow the rules above. `details` carries only the
 * capacity keys the user actually edited, so the action can overlay them without
 * clobbering parsed rating/reviews.
 */
export function prepareAccommodationEdit(
  input: AccommodationEditInput,
): NormalizedAccommodationEdit {
  const image_url = trimToNull(input.imageUrl);
  if (image_url && !isHttpUrl(image_url)) {
    throw new Error("Enter a valid image link.");
  }

  const details: Partial<ListingDetails> = {};
  const guests = normalizeCapacity(input.guests, { fractional: false });
  const bedrooms = normalizeCapacity(input.bedrooms, { fractional: false });
  const beds = normalizeCapacity(input.beds, { fractional: false });
  const baths = normalizeCapacity(input.baths, { fractional: true });
  if (guests !== undefined) details.guests = guests;
  if (bedrooms !== undefined) details.bedrooms = bedrooms;
  if (beds !== undefined) details.beds = beds;
  if (baths !== undefined) details.baths = baths;

  return {
    title: trimToNull(input.title),
    image_url,
    notes: trimToNull(input.notes),
    address: trimToNull(input.address),
    amenities: normalizeAmenities(input.amenities),
    price_per_night: normalizePrice(input.pricePerNight),
    currency: trimToNull(input.currency),
    details,
  };
}

// ── Keyless Google Maps helpers ──────────────────────────────────────
// The detail dialog embeds a search-based map with no API key. We build a single
// query string from the listing's address (preferred) or title, plus the leg's
// area, then feed it to the embed + external-link URLs.

/**
 * Build a map query from a listing: prefer its address, else its title, joined
 * with the leg's area (", " separated). Returns null when nothing is usable, so
 * the dialog can hide the map entirely.
 */
export function mapQuery(opts: {
  title: string | null;
  address: string | null;
  area: string | null;
}): string | null {
  const primary = opts.address?.trim() || opts.title?.trim() || null;
  const area = opts.area?.trim() || null;

  const parts = [primary, area].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Embeddable (iframe src) Google Maps search URL for a query. */
export function mapEmbedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

/** A shareable "open in Google Maps" link for a query. */
export function mapLinkUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
