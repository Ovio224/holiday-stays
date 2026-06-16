// Pure, env-free logic for per-member accommodation prices. No DB or environment
// access, so it's safe to import on server and client and is unit-testable in
// isolation (the setPrice Server Action hits the DB and is integration-tested).
//
// All amounts are per NIGHT, matching accommodations.price_per_night, so member
// prices and the parsed "standard" price live in the same unit.

import type { Member } from "@/lib/types";

export interface PriceInput {
  amount: number | null;
  note?: string | null;
  currency?: string | null;
}

export interface NormalizedPrice {
  amount: number;
  note: string | null;
  currency: string | null;
}

/**
 * Validate + normalize a member's price submission, throwing a friendly Error on
 * bad input (surfaced to the user via a toast). Amount must be a finite,
 * non-negative number; it's rounded to cents. Empty note/currency become null.
 *
 * Clearing a price (amount == null) is handled by the action directly (delete),
 * so this helper is only called when there's an actual amount to store.
 */
export function preparePriceInput(input: PriceInput): NormalizedPrice {
  const { amount } = input;
  if (amount == null || Number.isNaN(amount)) {
    throw new Error("Enter the price you see.");
  }
  // Reject 0 (and negatives): a $0/night "price" is a typo or an unset field, not
  // a real deal — and it would otherwise masquerade as the cheapest and zero out
  // the budget for the whole group. Clearing a price is a separate delete path.
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a valid price.");
  }

  return {
    amount: Math.round(amount * 100) / 100,
    note: input.note?.trim() || null,
    currency: input.currency?.trim() || null,
  };
}

/** A member-priced row, resolved to its member and decorated for the chart. */
export interface MemberPriceEntry {
  member: Member;
  amount: number;
  note: string | null;
  /** True for every entry tied at the lowest amount. */
  isCheapest: boolean;
  /** 0..1 bar fill relative to the most expensive entry. */
  ratio: number;
}

export interface PriceComparison {
  /** All entered prices, resolved + sorted cheapest-first. */
  entries: MemberPriceEntry[];
  /** The cheapest entries (1+ when prices exist; >1 only on an exact tie). */
  cheapest: MemberPriceEntry[];
  min: number | null;
  max: number | null;
  count: number;
  /** True when every entered price is identical (no one has a better deal). */
  allEqual: boolean;
}

/**
 * Build the price-chart view model from raw price rows + the member directory.
 * Rows whose member is unknown (e.g. a removed person) or whose amount isn't a
 * finite number are dropped. Entries are sorted cheapest-first, ties broken by
 * member name for a stable order. The cheapest set drives the "who books"
 * callout; `ratio` drives each bar's width.
 */
export function priceComparison(
  prices: { member_id: string; amount: number; note: string | null }[],
  members: Member[],
): PriceComparison {
  const byId = new Map(members.map((m) => [m.id, m] as const));

  const valid = prices
    .map((p) => ({ member: byId.get(p.member_id), amount: Number(p.amount), note: p.note }))
    .filter(
      (p): p is { member: Member; amount: number; note: string | null } =>
        p.member != null && Number.isFinite(p.amount),
    );

  if (valid.length === 0) {
    return { entries: [], cheapest: [], min: null, max: null, count: 0, allEqual: false };
  }

  const amounts = valid.map((v) => v.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);

  const entries: MemberPriceEntry[] = valid
    .map((v) => ({
      member: v.member,
      amount: v.amount,
      note: v.note,
      isCheapest: v.amount === min,
      ratio: max > 0 ? v.amount / max : 1,
    }))
    .sort(
      (a, b) => a.amount - b.amount || a.member.name.localeCompare(b.member.name),
    );

  return {
    entries,
    cheapest: entries.filter((e) => e.isCheapest),
    min,
    max,
    count: entries.length,
    allEqual: min === max,
  };
}

/** The lowest member-entered price, or null when no member has priced it. */
export function cheapestMemberAmount(
  prices: { amount: number }[] | null | undefined,
): number | null {
  if (!prices || prices.length === 0) return null;
  const amounts = prices.map((p) => Number(p.amount)).filter((a) => Number.isFinite(a));
  return amounts.length ? Math.min(...amounts) : null;
}

/**
 * The price per night to actually budget with for an option: the cheapest member
 * price when anyone has entered one (that's the real deal someone can book),
 * otherwise the parsed standard price. Null when there's no price at all.
 */
export function effectiveNightly(acc: {
  price_per_night: number | null;
  prices?: { amount: number }[] | null;
}): number | null {
  const member = cheapestMemberAmount(acc.prices);
  if (member != null) return member;
  return acc.price_per_night != null ? Number(acc.price_per_night) : null;
}

/** The minimal candidate shape the leg-level decision signals need. */
export interface LegCandidate {
  id: string;
  votes: { value: boolean }[];
  price_per_night: number | null;
  prices?: { amount: number }[] | null;
}

/**
 * Glanceable, leg-wide verdicts the carousel paints onto exactly the right card:
 * the group's FRONT-RUNNER (the "Group favorite" ribbon) and the UNIQUE CHEAPEST
 * option (the "Best price here" badge). Both are scarce by design — at most one of
 * each per leg — so the badges keep meaning "this is the one".
 *
 * Front-runner: the candidate with the highest net yes-vote (yes − no), requiring
 * a positive net (more yes than no) so a leg no one likes crowns nothing; ties on
 * net are broken by the lower effective nightly price (the better deal wins),
 * then by input order for stability.
 *
 * Cheapest: the single lowest effective nightly price. Suppressed on a tie (two
 * options share the low) so we never imply a false "winner".
 *
 * Both are suppressed when the leg has fewer than two candidates — with nothing to
 * compare against, "favorite" and "cheapest" are meaningless.
 */
export interface LegSignals {
  frontRunnerId: string | null;
  cheapestId: string | null;
}

export function legDecisionSignals(candidates: LegCandidate[]): LegSignals {
  if (candidates.length < 2) {
    return { frontRunnerId: null, cheapestId: null };
  }

  const net = (c: LegCandidate) =>
    c.votes.reduce((sum, v) => sum + (v.value ? 1 : -1), 0);
  const nightly = (c: LegCandidate) => effectiveNightly(c);

  // Front-runner: max positive net, tie-broken by the cheaper effective nightly.
  let leader: LegCandidate | null = null;
  let leaderNet = 0;
  for (const c of candidates) {
    const n = net(c);
    if (n < 1) continue; // needs more yes than no to be a "favorite"
    if (leader == null || n > leaderNet) {
      leader = c;
      leaderNet = n;
      continue;
    }
    if (n === leaderNet) {
      const cn = nightly(c) ?? Infinity;
      const ln = nightly(leader) ?? Infinity;
      if (cn < ln) leader = c;
    }
  }

  // Cheapest: the single lowest effective nightly; null on a tie or when <2 priced.
  const priced = candidates
    .map((c) => ({ id: c.id, nightly: nightly(c) }))
    .filter((c): c is { id: string; nightly: number } => c.nightly != null);
  let cheapestId: string | null = null;
  if (priced.length >= 2) {
    const min = Math.min(...priced.map((p) => p.nightly));
    const atMin = priced.filter((p) => p.nightly === min);
    if (atMin.length === 1) cheapestId = atMin[0].id;
  }

  return { frontRunnerId: leader?.id ?? null, cheapestId };
}
