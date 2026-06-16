/**
 * Tests for the pure comment helpers: prepareCommentBody (src/lib/comments.ts)
 * and formatRelativeTime (src/lib/format.ts). The addComment/updateComment/
 * deleteComment Server Actions hit Supabase and are covered like the others.
 */
import { describe, it, expect } from "vitest";

import { prepareCommentBody, MAX_COMMENT_LENGTH } from "@/lib/comments";
import { formatRelativeTime } from "@/lib/format";

describe("prepareCommentBody", () => {
  it("trims surrounding whitespace", () => {
    expect(prepareCommentBody("  love the pool  ")).toBe("love the pool");
  });

  it("preserves interior whitespace + newlines", () => {
    expect(prepareCommentBody("line one\n\nline two")).toBe("line one\n\nline two");
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(() => prepareCommentBody("")).toThrow();
    expect(() => prepareCommentBody("   \n  ")).toThrow();
    expect(() => prepareCommentBody(null)).toThrow();
    expect(() => prepareCommentBody(undefined)).toThrow();
  });

  it("accepts a body exactly at the limit but rejects one over it", () => {
    const atLimit = "x".repeat(MAX_COMMENT_LENGTH);
    expect(prepareCommentBody(atLimit)).toBe(atLimit);
    expect(() => prepareCommentBody("x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow();
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-06-16T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('reads "just now" for very recent times', () => {
    expect(formatRelativeTime(ago(5 * SEC), now)).toBe("just now");
    expect(formatRelativeTime(ago(44 * SEC), now)).toBe("just now");
  });

  it("scales through minutes, hours, days, and weeks", () => {
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe("5m");
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe("3h");
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe("2d");
    expect(formatRelativeTime(ago(14 * DAY), now)).toBe("2w");
  });

  it("clamps future timestamps (clock skew) to just now", () => {
    expect(formatRelativeTime(ago(-10 * SEC), now)).toBe("just now");
  });

  it("returns an empty string for missing/unparseable input", () => {
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
