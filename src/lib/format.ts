// Pure formatting + identity-color helpers shared across server and client.
// No side effects, no env access — safe to import anywhere.

import type { AccommodationSource, ListingDetails } from "@/lib/types";

/**
 * The tropical palette assigned to members. Stable order matters: pickColor()
 * indexes into this array, so colors must never be reordered without a reason.
 */
export const MEMBER_COLORS: string[] = [
  "#16a7b8", // lagoon
  "#f4795b", // coral
  "#34b27b", // palm
  "#f6b23d", // mango
  "#e85d8a", // hibiscus
  "#4f7cc4", // ocean
  "#d98c3f", // sand
  "#2bb6a6", // teal
];

/**
 * Deterministically pick a color from MEMBER_COLORS for a given seed (e.g. a
 * member id or name). Uses a small DJB2-style hash so the same seed always maps
 * to the same color, regardless of platform.
 */
export function pickColor(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    // hash * 33 + charCode, kept in 32-bit space via |0.
    hash = (hash * 33 + seed.charCodeAt(i)) | 0;
  }
  // Force non-negative before modulo so the index is always valid.
  const index = Math.abs(hash) % MEMBER_COLORS.length;
  return MEMBER_COLORS[index];
}

/**
 * Whole nights between two ISO date strings (end - start). Returns null if
 * either bound is missing. Never returns a negative number.
 */
export function nights(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;

  const MS_PER_NIGHT = 1000 * 60 * 60 * 24;
  const diff = Math.round((endMs - startMs) / MS_PER_NIGHT);
  return diff > 0 ? diff : 0;
}

/**
 * Render a friendly date range like "Aug 1 - 4" (compact when both dates share
 * a month) or "Aug 28 - Sep 2" (when they span months). Returns "" gracefully
 * when either date is missing or unparseable. Uses UTC to stay stable across
 * server/client timezones and avoid hydration mismatches.
 */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "";
  }

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const startMonth = MONTHS[startDate.getUTCMonth()];
  const startDay = startDate.getUTCDate();
  const endMonth = MONTHS[endDate.getUTCMonth()];
  const endDay = endDate.getUTCDate();

  // Same month: only show the month once -> "Aug 1 - 4".
  if (startDate.getUTCMonth() === endDate.getUTCMonth() &&
      startDate.getUTCFullYear() === endDate.getUTCFullYear()) {
    return `${startMonth} ${startDay} - ${endDay}`;
  }

  // Spans months -> "Aug 28 - Sep 2".
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

/**
 * 1-2 letter initials from a person's name. Picks the first letter of the first
 * and last words; falls back to a single letter for one-word names, and "?" for
 * empty input.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();

  const first = words[0].charAt(0);
  const last = words[words.length - 1].charAt(0);
  return (first + last).toUpperCase();
}

/** Human label for an accommodation source. */
export function sourceLabel(source: AccommodationSource): string {
  switch (source) {
    case "airbnb":
      return "Airbnb";
    case "booking":
      return "Booking.com";
    default:
      return "Link";
  }
}

/** "4.82" (two decimals) or null when there's no rating. */
export function formatRating(rating: number | null): string | null {
  if (rating == null || Number.isNaN(rating)) return null;
  return rating.toFixed(2);
}

/**
 * Compact capacity chips from parsed details, e.g.
 * ["6 guests", "4 bedrooms", "5 beds", "4 baths"]. Missing fields are omitted.
 */
export function detailChips(details: ListingDetails | null): string[] {
  if (!details) return [];
  const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
  const chips: string[] = [];
  if (details.guests != null) chips.push(plural(details.guests, "guest"));
  if (details.bedrooms != null) chips.push(plural(details.bedrooms, "bedroom"));
  if (details.beds != null) chips.push(plural(details.beds, "bed"));
  if (details.baths != null) {
    chips.push(`${details.baths} ${details.baths === 1 ? "bath" : "baths"}`);
  }
  return chips;
}

/**
 * Format a money amount with its currency: "$165" for a symbol, "165 USD" for a
 * 3-letter code. Returns null when there's no amount. Drops trailing ".00".
 */
export function formatMoney(
  amount: number | null,
  currency: string | null,
): string | null {
  if (amount == null || Number.isNaN(amount)) return null;
  const cur = (currency || "$").trim();
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return /^[A-Za-z]{2,}$/.test(cur) ? `${n} ${cur}` : `${cur}${n}`;
}

/** Nightly price × nights, or null if either is missing. */
export function nightlyTotal(
  pricePerNight: number | null,
  nightCount: number | null,
): number | null {
  if (pricePerNight == null || nightCount == null) return null;
  return Math.round(pricePerNight * nightCount * 100) / 100;
}

/** Pull a leading numeric amount out of a free-form price string. */
export function parsePriceAmount(text: string | null): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
