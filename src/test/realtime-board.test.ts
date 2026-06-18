/**
 * Tests for the pure local-apply reducer that backs optimistic voting in the live
 * board (src/hooks/use-realtime-board.ts). `applyMemberVote` folds the acting
 * user's own vote into board state immediately, so the card doesn't depend on the
 * realtime echo arriving (the bug: a vote "undid itself" when no echo came back).
 *
 * It must mirror castVote's server semantics by (accommodation_id, member_id):
 * cast/flip replaces this member's single vote on that card; a toggle-off (vote =
 * null) removes it. It must also be idempotent with the realtime echo that may
 * follow — applying the same result twice converges to the same state.
 */
import { describe, it, expect } from "vitest";

import { applyMemberVote } from "@/hooks/use-realtime-board";
import type { AccommodationWithVotes, Vote } from "@/lib/types";

function acc(id: string, votes: Vote[]): AccommodationWithVotes {
  return {
    id,
    stay_id: "stay-1",
    url: "https://example.com",
    source: "other",
    title: id,
    image_url: null,
    price_text: null,
    price_per_night: null,
    currency: "$",
    details: null,
    address: null,
    amenities: null,
    notes: null,
    submitted_by: null,
    parse_status: "ok",
    parsed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    votes,
    prices: [],
    comments: [],
  };
}

function vote(partial: Partial<Vote> & Pick<Vote, "id" | "member_id" | "value">): Vote {
  return {
    accommodation_id: "a1",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("applyMemberVote", () => {
  it("adds a fresh vote for a member who hadn't voted", () => {
    const list = [acc("a1", [])];
    const v = vote({ id: "v1", member_id: "m1", value: true });

    const next = applyMemberVote(list, "a1", "m1", v);

    expect(next[0].votes).toEqual([v]);
  });

  it("replaces this member's vote on a flip (no duplicate row)", () => {
    const existing = vote({ id: "v1", member_id: "m1", value: true });
    const list = [acc("a1", [existing])];
    const flipped = vote({ id: "v1", member_id: "m1", value: false });

    const next = applyMemberVote(list, "a1", "m1", flipped);

    expect(next[0].votes).toHaveLength(1);
    expect(next[0].votes[0]).toEqual(flipped);
  });

  it("removes this member's vote on a toggle-off (vote = null)", () => {
    const existing = vote({ id: "v1", member_id: "m1", value: true });
    const list = [acc("a1", [existing])];

    const next = applyMemberVote(list, "a1", "m1", null);

    expect(next[0].votes).toEqual([]);
  });

  it("keeps OTHER members' votes on the same card", () => {
    const mine = vote({ id: "v1", member_id: "m1", value: true });
    const theirs = vote({ id: "v2", member_id: "m2", value: false });
    const list = [acc("a1", [mine, theirs])];

    const next = applyMemberVote(list, "a1", "m1", null);

    expect(next[0].votes).toEqual([theirs]);
  });

  it("never touches a different accommodation", () => {
    const other = vote({ id: "v9", accommodation_id: "a2", member_id: "m1", value: true });
    const list = [acc("a1", []), acc("a2", [other])];

    const next = applyMemberVote(list, "a1", "m1", vote({ id: "v1", member_id: "m1", value: true }));

    expect(next[1].votes).toEqual([other]);
  });

  it("is idempotent with the realtime echo (applying the same result twice)", () => {
    const list = [acc("a1", [])];
    const v = vote({ id: "v1", member_id: "m1", value: true });

    const once = applyMemberVote(list, "a1", "m1", v);
    const twice = applyMemberVote(once, "a1", "m1", v);

    expect(twice[0].votes).toEqual([v]);
  });
});
