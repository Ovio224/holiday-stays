/**
 * Tests for the pure location-scoring module. The scorer is the heart of the
 * feature and the bulk of the confidence — geocoding/routing happen elsewhere and
 * are integration-tested. The §7.7 worked example from the feature request is
 * pinned here as a FROZEN fixture (location 81, price 85, rating 94, votes 80,
 * Foodie 84.9); changing the curve must break these on purpose.
 */
import { describe, it, expect } from "vitest";
import {
  compareByLocation,
  distanceToTime,
  effectivePoi,
  haversineKm,
  interpolate,
  median,
  PERSONAS,
  priceSubScore,
  ratingSubScore,
  scoreAccommodation,
  scoreLegAccommodations,
  timeToSubScore,
  votesSubScore,
  type PoiTime,
} from "@/lib/location-score";
import type { Place } from "@/lib/types";

// A bare place with sensible defaults, overridable per test.
function place(overrides: Partial<Place>): Place {
  return {
    id: overrides.id ?? "p1",
    stay_id: "s1",
    label: overrides.label ?? "Spot",
    category: overrides.category ?? null,
    address: overrides.address ?? null,
    latitude: overrides.latitude ?? null,
    longitude: overrides.longitude ?? null,
    geocode_status: overrides.geocode_status ?? "ok",
    geocoded_at: null,
    importance: overrides.importance ?? 2,
    closer_is_better: overrides.closer_is_better ?? true,
    sort_order: overrides.sort_order ?? 0,
    submitted_by: null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("interpolate", () => {
  it("returns the first anchor's y below the range", () => {
    expect(interpolate(2, [[5, 100], [10, 80]])).toBe(100);
  });
  it("returns the last anchor's y above the range", () => {
    expect(interpolate(20, [[5, 100], [10, 80]])).toBe(80);
  });
  it("interpolates linearly inside a segment", () => {
    expect(interpolate(7.5, [[5, 100], [10, 80]])).toBeCloseTo(90, 6);
  });
  it("hits anchors exactly", () => {
    expect(interpolate(5, [[5, 100], [10, 80]])).toBe(100);
    expect(interpolate(10, [[5, 100], [10, 80]])).toBe(80);
  });
});

describe("haversineKm", () => {
  it("is ~111 km per degree of latitude", () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
  });
  it("is ~111 km per degree of longitude at the equator", () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.19, 1);
  });
  it("is zero for identical points", () => {
    expect(haversineKm({ latitude: -8.5, longitude: 115.2 }, { latitude: -8.5, longitude: 115.2 })).toBe(0);
  });
});

describe("distanceToTime", () => {
  it("applies the detour factor and per-mode speed", () => {
    // 11 km by scooter: (11 * 1.3 / 22) * 60 = 39 min
    expect(distanceToTime(11, "scooter")).toBeCloseTo(39, 6);
  });
  it("walking is much slower than scooter for the same distance", () => {
    expect(distanceToTime(5, "foot")).toBeGreaterThan(distanceToTime(5, "scooter"));
  });
  it("car is slightly faster than scooter per km (but time still close)", () => {
    expect(distanceToTime(10, "car")).toBeLessThan(distanceToTime(10, "scooter"));
  });
});

describe("timeToSubScore", () => {
  it("matches the frozen worked-example sub-scores (scooter)", () => {
    expect(timeToSubScore(6, "scooter")).toBeCloseTo(96, 6); // Monkey Forest
    expect(timeToSubScore(18, "scooter")).toBeCloseTo(54, 6); // Rice Terraces
    expect(timeToSubScore(4, "scooter")).toBe(100); // Warung (≤5)
    expect(timeToSubScore(11, "scooter")).toBeCloseTo(76, 6); // Campuhan
  });
  it("clamps to 100 at 0 min and 0 beyond the far anchor", () => {
    expect(timeToSubScore(0, "scooter")).toBe(100);
    expect(timeToSubScore(60, "scooter")).toBe(0);
  });
  it("uses tighter foot anchors (walkability)", () => {
    expect(timeToSubScore(3, "foot")).toBe(100);
    expect(timeToSubScore(12, "foot")).toBeCloseTo(60, 6);
    // 12 min on foot scores lower than 12 min by scooter
    expect(timeToSubScore(12, "foot")).toBeLessThan(timeToSubScore(12, "scooter"));
  });
  it("inverts the curve when closer_is_better is false (far = good)", () => {
    expect(timeToSubScore(6, "scooter", false)).toBeCloseTo(4, 6); // 100 - 96
    expect(timeToSubScore(60, "scooter", false)).toBe(100);
  });
});

describe("priceSubScore", () => {
  it("derives the frozen worked-example price (52 vs median 65 → 85)", () => {
    expect(priceSubScore(52, 65)).toBeCloseTo(85, 6);
  });
  it("scores the median itself at 70", () => {
    expect(priceSubScore(65, 65)).toBeCloseTo(70, 6);
  });
  it("caps a steal at 100 and a 2x premium at 0", () => {
    expect(priceSubScore(30, 65)).toBe(100); // ratio < 0.6
    expect(priceSubScore(130, 65)).toBe(0); // ratio = 2.0
    expect(priceSubScore(300, 65)).toBe(0); // beyond
  });
});

describe("ratingSubScore", () => {
  it("normalizes a /5 rating (4.7 → 94)", () => {
    expect(ratingSubScore(4.7, null)).toBeCloseTo(94, 6);
  });
  it("normalizes by an explicit scale (9.0 / 10 → 90)", () => {
    expect(ratingSubScore(9.0, 10)).toBeCloseTo(90, 6);
  });
  it("returns null when there is no rating", () => {
    expect(ratingSubScore(null)).toBeNull();
    expect(ratingSubScore(Number.NaN)).toBeNull();
  });
});

describe("votesSubScore", () => {
  it("maps 4 yes / 1 no to 80", () => {
    const votes = [true, true, true, true, false].map((value) => ({ value }));
    expect(votesSubScore(votes)).toBeCloseTo(80, 6);
  });
  it("is 100 for unanimous yes, 0 for unanimous no, 50 for an even split", () => {
    expect(votesSubScore([{ value: true }, { value: true }])).toBe(100);
    expect(votesSubScore([{ value: false }, { value: false }])).toBe(0);
    expect(votesSubScore([{ value: true }, { value: false }])).toBe(50);
  });
  it("returns null (neutral) when there are no votes — never a downvote", () => {
    expect(votesSubScore([])).toBeNull();
  });
});

describe("median", () => {
  it("is the middle of an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middles of an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("is null for an empty list and drops non-finite values", () => {
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 4, 2])).toBe(3);
  });
});

describe("scoreAccommodation — frozen worked example (§7.7, Ubud villa)", () => {
  const poiTimes: PoiTime[] = [
    { minutes: 6, importance: 3, closerIsBetter: true }, // Monkey Forest (must) → 96
    { minutes: 18, importance: 2, closerIsBetter: true }, // Rice Terraces (want) → 54
    { minutes: 4, importance: 1, closerIsBetter: true }, // Warung (nice) → 100
    { minutes: 11, importance: 2, closerIsBetter: true }, // Campuhan (want) → 76
  ];
  const base = {
    poiTimes,
    accommodationHasCoords: true,
    effectiveNightly: 52,
    legMedianNightly: 65,
    rating: 4.7,
    ratingScale: null,
    votes: [true, true, true, true, false].map((value) => ({ value })),
    mode: "scooter" as const,
  };

  it("computes location 81 as the importance-weighted mean", () => {
    const r = scoreAccommodation({ ...base, weights: PERSONAS.balanced.weights });
    expect(r.location).toBeCloseTo(81, 6);
  });

  it("computes coverage 75% (weighted share ≤15 min)", () => {
    const r = scoreAccommodation({ ...base, weights: PERSONAS.balanced.weights });
    expect(r.coveragePct).toBeCloseTo(75, 6);
  });

  it("produces the frozen pillar breakdown", () => {
    const r = scoreAccommodation({ ...base, weights: PERSONAS.balanced.weights });
    expect(r.breakdown.location).toBeCloseTo(81, 6);
    expect(r.breakdown.price).toBeCloseTo(85, 6);
    expect(r.breakdown.rating).toBeCloseTo(94, 6);
    expect(r.breakdown.votes).toBeCloseTo(80, 6);
    expect(r.breakdown.missing).toEqual([]);
    expect(r.breakdown.completeness).toBe(1);
    expect(r.status).toBe("ok");
  });

  it("blends the Foodie composite to 84.9", () => {
    const r = scoreAccommodation({ ...base, weights: PERSONAS.foodie.weights });
    expect(r.composite).toBeCloseTo(84.9, 6);
  });

  it("blends the balanced composite to 85 (mean of the four pillars)", () => {
    const r = scoreAccommodation({ ...base, weights: PERSONAS.balanced.weights });
    expect(r.composite).toBeCloseTo(85, 6);
  });
});

describe("scoreAccommodation — missing data (absence ≠ 0)", () => {
  const poiTimes: PoiTime[] = [
    { minutes: 6, importance: 3, closerIsBetter: true },
    { minutes: 18, importance: 2, closerIsBetter: true },
    { minutes: 4, importance: 1, closerIsBetter: true },
    { minutes: 11, importance: 2, closerIsBetter: true },
  ];

  it("tags needs-address and renormalizes when the accommodation has no coords", () => {
    const r = scoreAccommodation({
      poiTimes,
      accommodationHasCoords: false,
      effectiveNightly: 52,
      legMedianNightly: 65,
      rating: 4.7,
      ratingScale: null,
      votes: [true, true, true, true, false].map((value) => ({ value })),
      mode: "scooter",
      weights: PERSONAS.foodie.weights,
    });
    expect(r.location).toBeNull(); // NOT 0
    expect(r.status).toBe("needs-address");
    expect(r.breakdown.missing).toContain("location");
    // Renormalized over price+rating+votes: (.2·85 + .25·94 + .15·80)/.6 = 87.5
    expect(r.composite).toBeCloseTo(87.5, 6);
  });

  it("returns null pillars (not 0) when price/rating/votes are absent", () => {
    const r = scoreAccommodation({
      poiTimes,
      accommodationHasCoords: true,
      effectiveNightly: null,
      legMedianNightly: null,
      rating: null,
      votes: [],
      mode: "scooter",
      weights: PERSONAS.balanced.weights,
    });
    expect(r.breakdown.price).toBeNull();
    expect(r.breakdown.rating).toBeNull();
    expect(r.breakdown.votes).toBeNull();
    expect(r.location).not.toBeNull(); // location still computes from POIs
    expect(r.breakdown.completeness).toBe(0.25); // only location present
  });

  it("returns status needs-info and a null composite when every pillar is absent", () => {
    const r = scoreAccommodation({
      poiTimes: [],
      accommodationHasCoords: true,
      effectiveNightly: null,
      legMedianNightly: null,
      rating: null,
      votes: [],
      mode: "scooter",
      weights: PERSONAS.balanced.weights,
    });
    expect(r.location).toBeNull();
    expect(r.composite).toBeNull();
    expect(r.status).toBe("needs-info");
  });

  it("drops a single unreachable POI from the mean instead of zeroing the score", () => {
    const withGap: PoiTime[] = [
      { minutes: 6, importance: 3, closerIsBetter: true },
      { minutes: null, importance: 2, closerIsBetter: true }, // ungeocoded POI
    ];
    const r = scoreAccommodation({
      poiTimes: withGap,
      accommodationHasCoords: true,
      effectiveNightly: null,
      legMedianNightly: null,
      rating: null,
      votes: [],
      mode: "scooter",
      weights: PERSONAS.balanced.weights,
    });
    // Only the reachable POI (96) contributes to the MEAN — not dragged to ~0.
    expect(r.location).toBeCloseTo(96, 6);
    // But coverage counts ALL the leg's POIs: the un-geocoded one decrements it
    // (1 of 2 spots), it isn't hidden. coveredW=3 (the 6-min, importance 3) over
    // totalW=5 → 60%.
    expect(r.coverageCount).toEqual({ within: 1, of: 2 });
    expect(r.coveragePct).toBeCloseTo(60, 6);
  });
});

describe("compareByLocation — deterministic tie-breaking", () => {
  const mk = (location: number, worstPoi: number, coveragePct: number, created_at: string) => ({
    location,
    worstPoi,
    coveragePct,
    created_at,
  });

  it("orders by location descending", () => {
    expect(compareByLocation(mk(70, 0, 0, "a"), mk(80, 0, 0, "b"))).toBeGreaterThan(0);
    expect(compareByLocation(mk(80, 0, 0, "a"), mk(70, 0, 0, "b"))).toBeLessThan(0);
  });
  it("breaks a location tie by worst-POI (higher first)", () => {
    expect(compareByLocation(mk(80, 50, 75, "a"), mk(80, 60, 50, "b"))).toBeGreaterThan(0);
  });
  it("breaks a location+worst tie by coverage (higher first)", () => {
    expect(compareByLocation(mk(80, 50, 60, "a"), mk(80, 50, 75, "b"))).toBeGreaterThan(0);
  });
  it("breaks a full tie by created_at ascending (stable)", () => {
    expect(
      compareByLocation(mk(80, 50, 75, "2026-02-01"), mk(80, 50, 75, "2026-01-01")),
    ).toBeGreaterThan(0);
  });
});

describe("effectivePoi — persona transforms (never mutate stored data)", () => {
  it("leaves importance + direction untouched under the balanced persona", () => {
    const r = effectivePoi({ category: "restaurant", importance: 2, closer_is_better: true }, PERSONAS.balanced);
    expect(r).toEqual({ importance: 2, closerIsBetter: true });
  });
  it("applies the Foodie category multiplier (restaurant ×1.5)", () => {
    const r = effectivePoi({ category: "restaurant", importance: 2, closer_is_better: true }, PERSONAS.foodie);
    expect(r.importance).toBeCloseTo(3, 6);
  });
  it("does not multiply an unrelated category", () => {
    const r = effectivePoi({ category: "temple", importance: 2, closer_is_better: true }, PERSONAS.foodie);
    expect(r.importance).toBe(2);
  });
  it("inverts bar/club at scoring time for the Quiet persona", () => {
    const bar = effectivePoi({ category: "bar", importance: 2, closer_is_better: true }, PERSONAS.quiet);
    expect(bar.closerIsBetter).toBe(false);
    const nature = effectivePoi({ category: "nature", importance: 2, closer_is_better: true }, PERSONAS.quiet);
    expect(nature.closerIsBetter).toBe(true);
  });
  it("keeps a user's explicit closer_is_better=false regardless of persona", () => {
    const r = effectivePoi({ category: "beach", importance: 2, closer_is_better: false }, PERSONAS.beach);
    expect(r.closerIsBetter).toBe(false);
  });
});

describe("scoreLegAccommodations — haversine integration", () => {
  const here = { latitude: -8.5069, longitude: 115.2625 }; // a POI in Ubud
  const near = { latitude: -8.5079, longitude: 115.2635 }; // ~150 m away
  const far = { latitude: -8.62, longitude: 115.18 }; // several km away

  const places: Place[] = [place({ id: "poi1", ...here, importance: 3 })];

  it("scores a nearer accommodation above a farther one, and groups un-geocoded as needs-address", () => {
    const scores = scoreLegAccommodations({
      mode: "scooter",
      places,
      accommodations: [
        { id: "near", latitude: near.latitude, longitude: near.longitude, price_per_night: 60, prices: [], rating: 4.5, ratingScale: null, votes: [] },
        { id: "far", latitude: far.latitude, longitude: far.longitude, price_per_night: 60, prices: [], rating: 4.5, ratingScale: null, votes: [] },
        { id: "noaddr", price_per_night: 60, prices: [], rating: 4.5, ratingScale: null, votes: [] },
      ],
    });

    const nearScore = scores.get("near")!;
    const farScore = scores.get("far")!;
    const noaddr = scores.get("noaddr")!;

    expect(nearScore.location).not.toBeNull();
    expect(farScore.location).not.toBeNull();
    expect(nearScore.location!).toBeGreaterThan(farScore.location!);
    expect(noaddr.location).toBeNull();
    expect(noaddr.status).toBe("needs-address");
  });

  it("applies the persona's pillar weights when no explicit weights are passed", () => {
    const acc = [
      {
        id: "a",
        latitude: near.latitude,
        longitude: near.longitude,
        price_per_night: 100,
        prices: [],
        rating: 5,
        ratingScale: null,
        votes: [{ value: true }],
      },
    ];
    const balanced = scoreLegAccommodations({ mode: "scooter", places, accommodations: acc, persona: "balanced" }).get("a")!;
    const foodie = scoreLegAccommodations({ mode: "scooter", places, accommodations: acc, persona: "foodie" }).get("a")!;
    // Same pillars present, but foodie weights {loc .4, price .2, rating .25, votes .15}
    // ≠ balanced {1,1,1,1}, so the composite must differ (persona weights ARE used).
    expect(foodie.composite).not.toBeCloseTo(balanced.composite as number, 5);
  });

  it("uses the leg median for the price pillar", () => {
    const scores = scoreLegAccommodations({
      mode: "scooter",
      places,
      accommodations: [
        { id: "cheap", latitude: near.latitude, longitude: near.longitude, price_per_night: 40, prices: [], rating: null, votes: [] },
        { id: "mid", latitude: near.latitude, longitude: near.longitude, price_per_night: 80, prices: [], rating: null, votes: [] },
      ],
    });
    // Median of {40, 80} = 60. Cheaper option scores higher on the price pillar.
    expect(scores.get("cheap")!.breakdown.price!).toBeGreaterThan(scores.get("mid")!.breakdown.price!);
  });
});
