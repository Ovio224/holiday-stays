/**
 * Tests for the pure per-member pricing logic in src/lib/prices.ts plus the
 * member-price path through tripBudget. The setPrice Server Action hits Supabase
 * and is covered by integration tests, like the other actions.
 */
import { describe, it, expect } from "vitest";

import {
  preparePriceInput,
  priceComparison,
  cheapestMemberAmount,
  effectiveNightly,
} from "@/lib/prices";
import { tripBudget } from "@/lib/format";
import type { Member } from "@/lib/types";

// Tiny member factory so tests read cleanly.
function member(id: string, name: string, color = "#16a7b8"): Member {
  return { id, name, color, created_at: "2026-06-16T00:00:00Z" };
}

const ana = member("m-ana", "Ana", "#f4795b");
const bob = member("m-bob", "Bob", "#16a7b8");
const cara = member("m-cara", "Cara", "#34b27b");
const MEMBERS = [ana, bob, cara];

// A raw price row as priceComparison consumes it.
function price(memberId: string, amount: number, note: string | null = null) {
  return { member_id: memberId, amount, note };
}

describe("preparePriceInput", () => {
  it("rounds the amount to cents and nulls empty note/currency", () => {
    const result = preparePriceInput({ amount: 120.456, note: "  ", currency: "" });
    expect(result).toEqual({ amount: 120.46, note: null, currency: null });
  });

  it("trims note and currency", () => {
    const result = preparePriceInput({ amount: 90, note: "  Genius L2 ", currency: " € " });
    expect(result).toEqual({ amount: 90, note: "Genius L2", currency: "€" });
  });

  it("throws on a missing amount", () => {
    expect(() => preparePriceInput({ amount: null })).toThrow("Enter the price you see.");
    expect(() => preparePriceInput({ amount: NaN })).toThrow("Enter the price you see.");
  });

  it("throws on zero, negative, or non-finite amounts", () => {
    // 0 is a typo / unset field, not a real deal — it must not pass validation,
    // or it would masquerade as the cheapest price and zero out the budget.
    expect(() => preparePriceInput({ amount: 0 })).toThrow("Enter a valid price.");
    expect(() => preparePriceInput({ amount: -5 })).toThrow("Enter a valid price.");
    expect(() => preparePriceInput({ amount: Infinity })).toThrow("Enter a valid price.");
  });
});

describe("priceComparison", () => {
  it("returns an empty comparison when there are no prices", () => {
    const c = priceComparison([], MEMBERS);
    expect(c).toEqual({
      entries: [],
      cheapest: [],
      min: null,
      max: null,
      count: 0,
      allEqual: false,
    });
  });

  it("sorts cheapest-first and tags the single cheapest as the booker", () => {
    const c = priceComparison(
      [price(bob.id, 150), price(ana.id, 120), price(cara.id, 180)],
      MEMBERS,
    );
    expect(c.entries.map((e) => e.member.name)).toEqual(["Ana", "Bob", "Cara"]);
    expect(c.min).toBe(120);
    expect(c.max).toBe(180);
    expect(c.cheapest.map((e) => e.member.name)).toEqual(["Ana"]);
    expect(c.entries[0].isCheapest).toBe(true);
    expect(c.entries[1].isCheapest).toBe(false);
    expect(c.allEqual).toBe(false);
  });

  it("computes bar ratios relative to the most expensive", () => {
    const c = priceComparison([price(ana.id, 100), price(bob.id, 200)], MEMBERS);
    const ratios = Object.fromEntries(c.entries.map((e) => [e.member.name, e.ratio]));
    expect(ratios.Ana).toBeCloseTo(0.5);
    expect(ratios.Bob).toBeCloseTo(1);
  });

  it("marks every tied-cheapest entry, broken by name for stable order", () => {
    const c = priceComparison(
      [price(cara.id, 120), price(ana.id, 120), price(bob.id, 200)],
      MEMBERS,
    );
    expect(c.cheapest.map((e) => e.member.name)).toEqual(["Ana", "Cara"]);
    expect(c.entries.map((e) => e.member.name)).toEqual(["Ana", "Cara", "Bob"]);
  });

  it("flags allEqual when every price is identical", () => {
    const c = priceComparison([price(ana.id, 100), price(bob.id, 100)], MEMBERS);
    expect(c.allEqual).toBe(true);
    expect(c.cheapest).toHaveLength(2);
  });

  it("drops prices for unknown members and non-finite amounts", () => {
    const c = priceComparison(
      [price("ghost", 50), price(ana.id, Number.NaN), price(bob.id, 90)],
      MEMBERS,
    );
    expect(c.count).toBe(1);
    expect(c.entries[0].member.name).toBe("Bob");
  });

  it("coerces numeric strings (PostgREST may serialize numeric as a string)", () => {
    const c = priceComparison(
      [price(ana.id, "120" as unknown as number), price(bob.id, "90" as unknown as number)],
      MEMBERS,
    );
    expect(c.min).toBe(90);
    expect(c.cheapest[0].member.name).toBe("Bob");
  });
});

describe("cheapestMemberAmount / effectiveNightly", () => {
  it("returns the lowest member amount, or null when none", () => {
    expect(cheapestMemberAmount([{ amount: 150 }, { amount: 120 }])).toBe(120);
    expect(cheapestMemberAmount([])).toBeNull();
    expect(cheapestMemberAmount(null)).toBeNull();
  });

  it("prefers the cheapest member price over the standard price", () => {
    expect(
      effectiveNightly({ price_per_night: 200, prices: [{ amount: 140 }, { amount: 160 }] }),
    ).toBe(140);
  });

  it("falls back to the standard price when no member has priced it", () => {
    expect(effectiveNightly({ price_per_night: 200, prices: [] })).toBe(200);
    expect(effectiveNightly({ price_per_night: 200 })).toBe(200);
  });

  it("is null when there is neither a member price nor a standard price", () => {
    expect(effectiveNightly({ price_per_night: null, prices: [] })).toBeNull();
  });
});

describe("tripBudget with member prices", () => {
  const yes = (n: number) => Array.from({ length: n }, () => ({ value: true }));

  it("costs each option at its cheapest member price, not the standard", () => {
    const budget = tripBudget([
      {
        nights: 2,
        accommodations: [
          // Standard $200/night, but Ana sees $140 → effective 140.
          { price_per_night: 200, currency: "$", votes: [], prices: [{ amount: 140 }] },
          // Standard $160/night, no member price → effective 160.
          { price_per_night: 160, currency: "$", votes: [], prices: [] },
        ],
      },
    ]);
    // Cheapest option = 140/night × 2 = 280 (beats the 160 option's 320).
    expect(budget.cheapestTotal).toBe(280);
    expect(budget.pricedLegs).toBe(1);
    expect(budget.currency).toBe("$");
  });

  it("uses the effective price for the vote-leading pick too", () => {
    const budget = tripBudget([
      {
        nights: 3,
        accommodations: [
          // Leading (2 yes), standard 300 but a member sees 210 → effective 210.
          { price_per_night: 300, currency: "$", votes: yes(2), prices: [{ amount: 210 }] },
          // Cheaper standard but fewer votes.
          { price_per_night: 150, currency: "$", votes: yes(1), prices: [] },
        ],
      },
    ]);
    // Leading pick costed at its member price: 210 × 3 = 630.
    expect(budget.leadingTotal).toBe(630);
    // Cheapest across options: min(210, 150) × 3 = 150 × 3 = 450.
    expect(budget.cheapestTotal).toBe(450);
  });

  it("counts a leg as priced when only a member price (no standard) exists", () => {
    const budget = tripBudget([
      {
        nights: 4,
        accommodations: [
          { price_per_night: null, currency: null, votes: [], prices: [{ amount: 100 }] },
        ],
      },
    ]);
    expect(budget.pricedLegs).toBe(1);
    expect(budget.cheapestTotal).toBe(400);
  });

  it("skips legs with no price at all", () => {
    const budget = tripBudget([
      {
        nights: 3,
        accommodations: [{ price_per_night: null, currency: null, votes: [], prices: [] }],
      },
    ]);
    expect(budget.pricedLegs).toBe(0);
    expect(budget.cheapestTotal).toBeNull();
    expect(budget.leadingTotal).toBeNull();
  });
});
