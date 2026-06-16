import { describe, it, expect } from "vitest";
import { formatRating } from "@/lib/format";

// Ratings come on different scales across sources: Airbnb is /5 (4.82), Booking
// is /10 (9.5). The star pill implies /5, so we annotate any non-5 scale with a
// "/N" suffix and otherwise show the bare number.
describe("formatRating", () => {
  it("returns null when there is no rating", () => {
    expect(formatRating(null)).toBeNull();
    expect(formatRating(Number.NaN)).toBeNull();
  });

  it("shows a bare /5 score with no suffix (Airbnb)", () => {
    expect(formatRating(4.82)).toBe("4.82");
    expect(formatRating(4.82, 5)).toBe("4.82");
    // A null/unknown scale is treated as the default /5 — no suffix.
    expect(formatRating(4.9, null)).toBe("4.9");
  });

  it("appends the scale suffix for a non-5 scale (Booking /10)", () => {
    expect(formatRating(9.5, 10)).toBe("9.5/10");
  });

  it("trims trailing zeros from the score", () => {
    expect(formatRating(9.0, 10)).toBe("9/10");
    expect(formatRating(4.8, 5)).toBe("4.8");
  });
});
