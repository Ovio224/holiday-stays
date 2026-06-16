// Pure formatting + identity-color helpers shared across server and client.
// No side effects, no env access — safe to import anywhere.

import type { AccommodationSource, ListingDetails } from "@/lib/types";
import { effectiveNightly } from "@/lib/prices";

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
 * A single date range covering the whole trip: earliest start_date → latest
 * end_date across all stays, rendered via formatDateRange. Returns "" when no
 * dated stays exist. Pure — derives the live trip-dates banner in the board.
 */
export function tripDateRange(
  stays: { start_date: string | null; end_date: string | null }[],
): string {
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const stay of stays) {
    if (stay.start_date && (!earliest || stay.start_date < earliest)) {
      earliest = stay.start_date;
    }
    if (stay.end_date && (!latest || stay.end_date > latest)) {
      latest = stay.end_date;
    }
  }

  return formatDateRange(earliest, latest);
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

/**
 * Format a rating for the star pill: "4.82" (Airbnb /5) or "9.5/10" (Booking).
 * The star icon implies a /5 scale, so we annotate any other scale with a "/N"
 * suffix; a 5 or unknown (null) scale shows the bare number. Trailing zeros are
 * trimmed ("9.50" -> "9.5", "9.00" -> "9"). Returns null when there's no rating.
 */
export function formatRating(
  rating: number | null,
  scale?: number | null,
): string | null {
  if (rating == null || Number.isNaN(rating)) return null;
  // Round to 2 decimals, then drop trailing zeros via Number's own toString.
  const value = Number(rating.toFixed(2)).toString();
  return scale != null && scale !== 5 ? `${value}/${scale}` : value;
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

export interface TripBudget {
  /** Sum across legs of the *leading* pick's cost (most net yes votes). */
  leadingTotal: number | null;
  /** Sum across legs of the cheapest priced option. */
  cheapestTotal: number | null;
  currency: string;
  pricedLegs: number; // legs that contributed a price
  totalLegs: number;
}

interface BudgetLeg {
  nights: number | null;
  accommodations: {
    price_per_night: number | null;
    currency: string | null;
    votes: { value: boolean }[];
    /** Per-member prices (per night). When present, the cheapest one is used. */
    prices?: { amount: number }[] | null;
  }[];
}

/**
 * Estimate the whole-trip cost from each leg's candidates. For every leg with at
 * least one priced option (and a known night count) we take both the cheapest
 * option and the "leading" pick (highest net yes-votes, ties broken by price),
 * each costed as price/night × the leg's nights, and sum them across legs.
 *
 * Each option is costed at its *effective* nightly price: the cheapest price any
 * member has entered for it (the real, bookable deal), falling back to the parsed
 * standard price when no one has. Currencies are assumed uniform (the first priced
 * leg's currency is used; no conversion is performed).
 */
export function tripBudget(legs: BudgetLeg[]): TripBudget {
  let leadingTotal = 0;
  let cheapestTotal = 0;
  let pricedLegs = 0;
  let currency = "$";
  let currencySet = false;

  for (const leg of legs) {
    const nightCount = leg.nights ?? 0;
    if (nightCount <= 0) continue;

    const priced = leg.accommodations
      .map((a) => ({ a, nightly: effectiveNightly(a) }))
      .filter((x): x is { a: (typeof leg.accommodations)[number]; nightly: number } =>
        x.nightly != null,
      );
    if (priced.length === 0) continue;

    if (!currencySet) {
      currency = priced[0].a.currency || "$";
      currencySet = true;
    }

    const costed = priced.map(({ a, nightly }) => ({
      cost: nightly * nightCount,
      net: a.votes.reduce((s, v) => s + (v.value ? 1 : -1), 0),
    }));

    const cheapest = Math.min(...costed.map((c) => c.cost));
    const leading = costed.reduce((best, c) =>
      c.net > best.net || (c.net === best.net && c.cost < best.cost) ? c : best,
    );

    cheapestTotal += cheapest;
    leadingTotal += leading.cost;
    pricedLegs += 1;
  }

  return {
    leadingTotal: pricedLegs > 0 ? Math.round(leadingTotal * 100) / 100 : null,
    cheapestTotal: pricedLegs > 0 ? Math.round(cheapestTotal * 100) / 100 : null,
    currency,
    pricedLegs,
    totalLegs: legs.length,
  };
}
