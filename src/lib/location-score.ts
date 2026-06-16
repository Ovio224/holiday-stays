// Pure, env-free location scoring. No DB or environment access, so it's safe to
// import on both server and client and is unit-tested in isolation (the geocoding
// + persistence live in src/actions/locations.ts and are integration-tested).
//
// The job: given a leg's candidate accommodations, the places-to-visit on that
// leg, and a travel mode, score each accommodation 0–100 on how well-placed it is
// — then fold that into a "best for X" composite alongside price, rating, and
// votes. The hard part (geocoding + routing) happens elsewhere; this module turns
// coordinates/times into explainable numbers.
//
// Design rules (see docs/feature-requests/location-aware-accommodation-scoring.md):
//  - ABSOLUTE, mode-specific time anchors (not min-max). A listing's score must
//    not move just because a neighbour was added/removed on the realtime board.
//  - Missing data is NULL, never 0. A 0 means "45+ min away" (a real bad value);
//    absence ("no address yet") is a different state the UI renders as needs-info.
//  - Aggregation drops unreachable POIs from the weighted mean rather than zeroing
//    the whole score, so one failed geocode never tanks a listing.

import { effectiveNightly } from "@/lib/prices";
import type { Place, TravelMode } from "@/lib/types";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** The four pillars a "best for X" composite blends. */
export interface PillarWeights {
  location: number;
  price: number;
  rating: number;
  votes: number;
}

/** Equal-weight "balanced" view — the Phase-1 default (no persona chosen). */
export const DEFAULT_WEIGHTS: PillarWeights = {
  location: 1,
  price: 1,
  rating: 1,
  votes: 1,
};

// ── Tunable constants ───────────────────────────────────────────────────────

// Per-mode time→sub-score anchors (minutes → 0–100), linearly interpolated and
// clamped. Foot anchors are tighter than motorised ones, so "walkability" falls
// out naturally (15 min on foot ≠ 15 min by scooter). Scooter is the Bali default;
// car shares scooter's curve — the difference between them is the TIME (from the
// per-mode speed below), since a car is often no faster than a scooter in traffic.
const ANCHORS: Record<TravelMode, readonly (readonly [number, number])[]> = {
  scooter: [[5, 100], [10, 80], [15, 60], [30, 30], [45, 0]],
  car: [[5, 100], [10, 80], [15, 60], [30, 30], [45, 0]],
  foot: [[3, 100], [7, 80], [12, 60], [20, 30], [30, 0]],
};

// Straight-line distance → estimated time, the keyless haversine fallback used
// when no routing API key is configured. Bali traffic-adjusted speeds (not
// open-road), with a 1.3× detour factor to approximate real road distance.
const SPEED_KMH: Record<TravelMode, number> = { foot: 4.5, scooter: 22, car: 25 };
const DETOUR = 1.3;

// "Covered" = reachable within this many minutes, for the coverage% companion
// metric ("4 of 5 spots within 15 min"). Matches each mode's "ok" anchor.
const COVERAGE_THRESHOLD_MIN: Record<TravelMode, number> = {
  scooter: 15,
  car: 15,
  foot: 12,
};

// Price sub-score anchors (ratio of effective nightly to the leg's MEDIAN nightly
// → 0–100). Median-relative is acceptable for price (cheapness is inherently
// comparative) but is bounded + outlier-resistant. ≤0.6× median is "a steal",
// ≥2× is "way over".
const PRICE_ANCHORS: readonly (readonly [number, number])[] = [
  [0.6, 100],
  [1.0, 70],
  [1.5, 30],
  [2.0, 0],
];

const EARTH_RADIUS_KM = 6371;

// ── Low-level pure helpers ───────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Piecewise-linear interpolation across ascending `[x, y]` anchors, flat-clamped
 * to the first/last `y` outside the anchor range.
 */
export function interpolate(
  x: number,
  anchors: readonly (readonly [number, number])[],
): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Great-circle distance in km between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated one-way travel time (minutes) from a straight-line distance. */
export function distanceToTime(km: number, mode: TravelMode): number {
  return ((km * DETOUR) / SPEED_KMH[mode]) * 60;
}

/**
 * A one-way travel TIME (minutes) → 0–100 proximity sub-score for a mode. When
 * `closerIsBetter` is false the curve inverts (farther = higher), e.g. a quiet
 * retreat that wants to be *away* from a nightlife strip. Inversion is applied
 * here at scoring time only — it never mutates stored data.
 */
export function timeToSubScore(
  minutes: number,
  mode: TravelMode,
  closerIsBetter = true,
): number {
  const raw = clamp(interpolate(minutes, ANCHORS[mode]), 0, 100);
  return closerIsBetter ? raw : 100 - raw;
}

/**
 * Price pillar (0–100) from the listing's effective nightly cost relative to the
 * leg's median. Cheaper → higher, bounded + clamped. Caller passes null medians
 * through as a null pillar (see scoreAccommodation), so this assumes a positive
 * median.
 */
export function priceSubScore(
  effectiveNightlyAmount: number,
  legMedianNightly: number,
): number {
  if (!(legMedianNightly > 0)) return 0;
  const ratio = effectiveNightlyAmount / legMedianNightly;
  return clamp(interpolate(ratio, PRICE_ANCHORS), 0, 100);
}

/** Rating pillar (0–100), normalising by the rating's scale (Airbnb /5, Booking /10). */
export function ratingSubScore(
  rating: number | null,
  ratingScale?: number | null,
): number | null {
  if (rating == null || Number.isNaN(rating)) return null;
  const scale = ratingScale && ratingScale > 0 ? ratingScale : 5;
  return clamp((rating / scale) * 100, 0, 100);
}

/**
 * Votes pillar (0–100) from the net-vote ratio. 0 votes is NEUTRAL (null/dropped),
 * never a downvote. `((net / cast) + 1) / 2 * 100`: all-yes → 100, all-no → 0,
 * even split → 50.
 */
export function votesSubScore(votes: { value: boolean }[]): number | null {
  if (!votes || votes.length === 0) return null;
  let net = 0;
  for (const v of votes) net += v.value ? 1 : -1;
  return clamp((net / votes.length + 1) / 2 * 100, 0, 100);
}

/** Median of a numeric list, or null when empty. Non-finite values are dropped. */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ── Personas ("best for X" presets) ──────────────────────────────────────────
// Plain data so they're diffable + unit-testable; the scorer takes weights as an
// argument and stays pure. Phase 1 always uses `balanced`; the persona picker UI
// arrives in Phase 3, but the multiplier/inversion math ships + is tested now.

export type PersonaKey =
  | "balanced"
  | "beach"
  | "foodie"
  | "nightlife"
  | "quiet"
  | "consensus";

export interface Persona {
  key: PersonaKey;
  label: string;
  weights: PillarWeights;
  /** Per-category importance multipliers, keyed by canonical PLACE_CATEGORIES. */
  categoryMultipliers: Record<string, number>;
  /** Categories whose curve inverts (far = good) at scoring time. */
  invertCategories: string[];
  /** A mode the persona *suggests*; the UI mode toggle always wins (Phase 2). */
  suggestedMode: TravelMode;
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  balanced: {
    key: "balanced",
    label: "Balanced",
    weights: { location: 1, price: 1, rating: 1, votes: 1 },
    categoryMultipliers: {},
    invertCategories: [],
    suggestedMode: "scooter",
  },
  beach: {
    key: "beach",
    label: "Beach lover",
    weights: { location: 0.5, price: 0.2, rating: 0.2, votes: 0.1 },
    categoryMultipliers: { beach: 1.5, surf: 1.5 },
    invertCategories: [],
    suggestedMode: "scooter",
  },
  foodie: {
    key: "foodie",
    label: "Foodie",
    weights: { location: 0.4, price: 0.2, rating: 0.25, votes: 0.15 },
    categoryMultipliers: { restaurant: 1.5, cafe: 1.5, market: 1.5 },
    invertCategories: [],
    suggestedMode: "scooter",
  },
  nightlife: {
    key: "nightlife",
    label: "Nightlife",
    weights: { location: 0.45, price: 0.2, rating: 0.15, votes: 0.2 },
    categoryMultipliers: { bar: 1.5, club: 1.5 },
    invertCategories: [],
    suggestedMode: "scooter",
  },
  quiet: {
    key: "quiet",
    label: "Quiet / remote",
    weights: { location: 0.25, price: 0.25, rating: 0.3, votes: 0.2 },
    categoryMultipliers: {},
    invertCategories: ["bar", "club"],
    suggestedMode: "scooter",
  },
  consensus: {
    key: "consensus",
    label: "Group consensus",
    weights: { location: 0.25, price: 0.25, rating: 0.2, votes: 0.3 },
    categoryMultipliers: {},
    invertCategories: [],
    suggestedMode: "scooter",
  },
};

/**
 * Resolve a place's *effective* POI weight + direction under a persona, as a pure
 * transform of (place, persona). Never mutates the stored `importance` /
 * `closer_is_better` — multipliers and inversion live only here at scoring time.
 */
export function effectivePoi(
  place: { category: string | null; importance: number; closer_is_better: boolean },
  persona: Persona,
): { importance: number; closerIsBetter: boolean } {
  const cat = place.category ?? "";
  const mult = persona.categoryMultipliers[cat] ?? 1;
  const invert = persona.invertCategories.includes(cat);
  return {
    importance: place.importance * mult,
    // A user who set closer_is_better=false stays false; a persona can only ADD
    // inversion for its categories, never undo a user's explicit choice.
    closerIsBetter: place.closer_is_better && !invert,
  };
}

// ── The composite scorer ─────────────────────────────────────────────────────

/** One POI's already-computed travel time + its (persona-adjusted) weighting. */
export interface PoiTime {
  minutes: number | null; // null = unreachable (missing coords either side, or routing failed)
  importance: number;
  closerIsBetter: boolean;
}

export type ScoreStatus = "ok" | "needs-address" | "needs-price" | "needs-info";

export interface ScoreBreakdown {
  location: number | null;
  price: number | null;
  rating: number | null;
  votes: number | null;
  missing: string[];
  completeness: number; // fraction of the 4 pillars present (0..1)
}

export interface ScoreResult {
  location: number | null;
  composite: number | null;
  coveragePct: number | null;
  /** Plain counts for the "3 of 4 spots within 15 min" coverage line (null = no reachable POIs). */
  coverageCount: { within: number; of: number } | null;
  /** Worst per-POI sub-score among reachable POIs — a sort tiebreaker. */
  worstPoi: number | null;
  breakdown: ScoreBreakdown;
  status: ScoreStatus;
}

export interface ScoreInput {
  poiTimes: PoiTime[];
  /** Whether the ACCOMMODATION itself is geocoded — drives the needs-address state. */
  accommodationHasCoords: boolean;
  effectiveNightly: number | null;
  legMedianNightly: number | null;
  rating: number | null;
  ratingScale?: number | null;
  votes: { value: boolean }[];
  mode: TravelMode;
  weights: PillarWeights;
}

/**
 * Score one accommodation. Pure: same inputs → same outputs, neighbour-independent.
 * Missing pillars are null (never 0) and the composite renormalises over only the
 * present pillars, so a listing ranked on 2 of 4 pillars is visibly less certain
 * (via `completeness`) rather than silently penalised.
 */
export function scoreAccommodation(input: ScoreInput): ScoreResult {
  const { poiTimes, accommodationHasCoords, mode, weights } = input;

  // --- Location pillar (importance-weighted mean of reachable POI sub-scores) ---
  let location: number | null = null;
  let coveragePct: number | null = null;
  let coverageCount: { within: number; of: number } | null = null;
  let worstPoi: number | null = null;

  const reachable = poiTimes.filter((p) => p.minutes != null);
  if (accommodationHasCoords && reachable.length > 0) {
    const threshold = COVERAGE_THRESHOLD_MIN[mode];
    // The location MEAN is over only the REACHABLE POIs — a POI with no travel
    // time (un-geocoded / failed) is dropped, never scored 0. But COVERAGE is a
    // share of ALL the leg's POIs, so an unreachable POI *decrements* coverage
    // (it isn't covered) rather than vanishing from the denominator — otherwise a
    // single reachable spot would read as "1/1 within 15 min" while ignoring the
    // rest. (Spec §7.2: "dropped from the weighted mean and decrements coverage".)
    const totalW = poiTimes.reduce((s, p) => s + p.importance, 0);
    let wSum = 0;
    let sSum = 0;
    let coveredW = 0;
    let withinCount = 0;
    let worst = Infinity;
    for (const p of reachable) {
      const w = p.importance;
      const s = timeToSubScore(p.minutes as number, mode, p.closerIsBetter);
      wSum += w;
      sSum += w * s;
      if ((p.minutes as number) <= threshold) {
        coveredW += w;
        withinCount += 1;
      }
      if (s < worst) worst = s;
    }
    location = wSum > 0 ? sSum / wSum : null;
    coveragePct = totalW > 0 ? (coveredW / totalW) * 100 : null;
    coverageCount = { within: withinCount, of: poiTimes.length };
    worstPoi = Number.isFinite(worst) ? worst : null;
  }

  // --- Price / rating / votes pillars (all null when absent) ---
  const price =
    input.effectiveNightly != null &&
    input.legMedianNightly != null &&
    input.legMedianNightly > 0
      ? priceSubScore(input.effectiveNightly, input.legMedianNightly)
      : null;
  const rating = ratingSubScore(input.rating, input.ratingScale);
  const votes = votesSubScore(input.votes);

  // --- Composite: renormalise over present pillars with a positive weight ---
  const pillars: [keyof PillarWeights, number | null][] = [
    ["location", location],
    ["price", price],
    ["rating", rating],
    ["votes", votes],
  ];
  let num = 0;
  let den = 0;
  for (const [key, value] of pillars) {
    if (value == null) continue;
    const w = weights[key];
    if (!(w > 0)) continue;
    num += w * value;
    den += w;
  }
  const composite = den > 0 ? num / den : null;

  // --- Breakdown + status ---
  const missing: string[] = [];
  if (location == null) missing.push("location");
  if (price == null) missing.push("price");
  if (rating == null) missing.push("rating");
  if (votes == null) missing.push("votes");
  const present = 4 - missing.length;

  let status: ScoreStatus;
  if (!accommodationHasCoords) {
    status = "needs-address";
  } else if (location == null && price == null && rating == null && votes == null) {
    status = "needs-info";
  } else if (price == null && location != null) {
    // Has a location score but no price entered — informative, not a blocker.
    status = "needs-price";
  } else {
    status = "ok";
  }

  return {
    location,
    composite,
    coveragePct,
    coverageCount,
    worstPoi,
    breakdown: { location, price, rating, votes, missing, completeness: present / 4 },
    status,
  };
}

// ── Per-POI breakdown (detail-dialog "Distances" section) ────────────────────

export interface PoiDistance {
  place: Place;
  km: number | null;
  minutes: number | null;
  subScore: number | null; // 0–100, the per-POI bar fill
}

/**
 * Per-POI distance + time + sub-score from one accommodation, for the detail
 * dialog. A null `origin` (accommodation not geocoded) or an un-geocoded POI
 * yields null measurements for that row, so the UI can show "add an address"
 * rather than empty rows.
 */
export function poiDistances(
  origin: LatLng | null,
  places: Place[],
  mode: TravelMode,
): PoiDistance[] {
  return places.map((place) => {
    if (!origin || place.latitude == null || place.longitude == null) {
      return { place, km: null, minutes: null, subScore: null };
    }
    const km = haversineKm(origin, {
      latitude: place.latitude,
      longitude: place.longitude,
    });
    const minutes = distanceToTime(km, mode);
    return {
      place,
      km,
      minutes,
      subScore: timeToSubScore(minutes, mode, place.closer_is_better),
    };
  });
}

// ── Leg-level integration (haversine path) ───────────────────────────────────

/** The minimal accommodation shape the leg scorer needs. */
export interface ScorableAccommodation {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  price_per_night: number | null;
  prices?: { amount: number }[] | null;
  rating: number | null;
  ratingScale?: number | null;
  votes: { value: boolean }[];
}

function hasCoords(x: {
  latitude?: number | null;
  longitude?: number | null;
}): x is { latitude: number; longitude: number } {
  return (
    x.latitude != null &&
    x.longitude != null &&
    Number.isFinite(x.latitude) &&
    Number.isFinite(x.longitude)
  );
}

/**
 * Score every accommodation on a leg against its places-to-visit, using the
 * keyless haversine estimate for travel times. Returns a map keyed by
 * accommodation id. Pure (no DB/IO) and the integration point the UI selector
 * calls; a real routing provider (Phase 2) swaps the time source without changing
 * any of the scoring math below.
 */
export function scoreLegAccommodations(args: {
  accommodations: ScorableAccommodation[];
  places: Place[];
  mode: TravelMode;
  weights?: PillarWeights;
  persona?: PersonaKey | null;
}): Map<string, ScoreResult> {
  const { accommodations, places, mode } = args;
  // The persona is the single source of pillar weights: an explicit `weights`
  // overrides it, otherwise we use the persona's own weights (so passing
  // persona:"foodie" without weights actually applies foodie's pillar mix, not a
  // balanced one). `balanced` weights equal DEFAULT_WEIGHTS, so the Phase-1 path
  // is unchanged.
  const persona = PERSONAS[args.persona ?? "balanced"] ?? PERSONAS.balanced;
  const weights = args.weights ?? persona.weights;

  // Leg median nightly over the priced options, the price pillar's reference.
  const nightlies = accommodations
    .map((a) => effectiveNightly(a))
    .filter((n): n is number => n != null);
  const legMedian = median(nightlies);

  // Pre-resolve each POI's coordinates + persona-adjusted weighting once.
  const poiResolved = places.map((place) => ({
    coords: hasCoords(place) ? { latitude: place.latitude, longitude: place.longitude } : null,
    weight: effectivePoi(place, persona),
  }));

  const out = new Map<string, ScoreResult>();
  for (const acc of accommodations) {
    const accHasCoords = hasCoords(acc);
    const origin = accHasCoords
      ? { latitude: acc.latitude, longitude: acc.longitude }
      : null;

    const poiTimes: PoiTime[] = poiResolved.map(({ coords, weight }) => ({
      minutes:
        origin && coords ? distanceToTime(haversineKm(origin, coords), mode) : null,
      importance: weight.importance,
      closerIsBetter: weight.closerIsBetter,
    }));

    out.set(
      acc.id,
      scoreAccommodation({
        poiTimes,
        accommodationHasCoords: accHasCoords,
        effectiveNightly: effectiveNightly(acc),
        legMedianNightly: legMedian,
        rating: acc.rating,
        ratingScale: acc.ratingScale,
        votes: acc.votes,
        mode,
        weights,
      }),
    );
  }
  return out;
}

/**
 * Deterministic comparator for the "Location" sort: location desc, then worst-POI
 * desc, then coverage% desc, then created_at asc (stable). Only used on cards that
 * HAVE a location score — needs-address cards are grouped separately by the UI.
 */
export function compareByLocation(
  a: { location: number; worstPoi: number | null; coveragePct: number | null; created_at: string },
  b: { location: number; worstPoi: number | null; coveragePct: number | null; created_at: string },
): number {
  if (b.location !== a.location) return b.location - a.location;
  const aw = a.worstPoi ?? -1;
  const bw = b.worstPoi ?? -1;
  if (bw !== aw) return bw - aw;
  const ac = a.coveragePct ?? -1;
  const bc = b.coveragePct ?? -1;
  if (bc !== ac) return bc - ac;
  return a.created_at.localeCompare(b.created_at);
}
