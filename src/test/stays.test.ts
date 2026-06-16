/**
 * Tests for prepareStayInput — the pure validation/normalization for trip legs.
 *
 * Only this pure helper is unit-tested here; the Server Actions in
 * src/actions/stays.ts hit Supabase and are covered by integration tests, like
 * the rate-limiter's isLockedOut/recordAttempt.
 */
import { describe, it, expect } from "vitest";
import { addNights, planConsecutiveInsert, prepareStayInput } from "@/lib/stays";

describe("prepareStayInput", () => {
  it("trims the label", () => {
    const result = prepareStayInput({ label: "  Ubud  " });
    expect(result.label).toBe("Ubud");
  });

  it("throws on an empty label", () => {
    expect(() => prepareStayInput({ label: "" })).toThrow("Give the leg a name.");
  });

  it("throws on a whitespace-only label", () => {
    expect(() => prepareStayInput({ label: "   " })).toThrow(
      "Give the leg a name.",
    );
  });

  it("normalizes empty area and dates to null", () => {
    const result = prepareStayInput({
      label: "Ubud",
      area: "   ",
      startDate: "",
      endDate: "",
    });
    expect(result.area).toBeNull();
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
  });

  it("treats undefined area/dates as null", () => {
    const result = prepareStayInput({ label: "Ubud" });
    expect(result).toEqual({
      label: "Ubud",
      area: null,
      start_date: null,
      end_date: null,
    });
  });

  it("rejects a malformed date", () => {
    expect(() =>
      prepareStayInput({ label: "Ubud", startDate: "2026-6-1" }),
    ).toThrow("Enter a valid date.");
    expect(() =>
      prepareStayInput({ label: "Ubud", endDate: "next week" }),
    ).toThrow("Enter a valid date.");
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      prepareStayInput({
        label: "Ubud",
        startDate: "2026-08-10",
        endDate: "2026-08-04",
      }),
    ).toThrow("The end date can't be before the start date.");
  });

  it("accepts a valid full input", () => {
    const result = prepareStayInput({
      label: "Ubud",
      area: "Jungle",
      startDate: "2026-08-01",
      endDate: "2026-08-04",
    });
    expect(result).toEqual({
      label: "Ubud",
      area: "Jungle",
      start_date: "2026-08-01",
      end_date: "2026-08-04",
    });
  });

  it("accepts equal start and end dates", () => {
    const result = prepareStayInput({
      label: "Ubud",
      startDate: "2026-08-01",
      endDate: "2026-08-01",
    });
    expect(result.start_date).toBe("2026-08-01");
    expect(result.end_date).toBe("2026-08-01");
  });

  it("accepts a label-only input", () => {
    const result = prepareStayInput({ label: "Canggu" });
    expect(result.label).toBe("Canggu");
    expect(result.area).toBeNull();
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
  });
});

describe("addNights", () => {
  it("adds whole nights within a month", () => {
    expect(addNights("2026-08-01", 3)).toBe("2026-08-04");
  });

  it("rolls over a month boundary", () => {
    expect(addNights("2026-08-30", 3)).toBe("2026-09-02");
  });

  it("rolls over a year boundary", () => {
    expect(addNights("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("treats 0 nights as the same day", () => {
    expect(addNights("2026-08-01", 0)).toBe("2026-08-01");
  });

  it("handles a leap day", () => {
    expect(addNights("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns null for a malformed date", () => {
    expect(addNights("2026-8-1", 3)).toBeNull();
    expect(addNights("not-a-date", 3)).toBeNull();
  });

  it("returns null for negative or non-integer nights", () => {
    expect(addNights("2026-08-01", -1)).toBeNull();
    expect(addNights("2026-08-01", 1.5)).toBeNull();
    expect(addNights("2026-08-01", Number.NaN)).toBeNull();
  });
});

describe("planConsecutiveInsert", () => {
  const seq = [
    { id: "a", sort_order: 0 },
    { id: "b", sort_order: 1 },
    { id: "c", sort_order: 2 },
  ];

  it("inserts after the first leg and shifts the rest", () => {
    expect(planConsecutiveInsert(seq, "a")).toEqual({
      newSortOrder: 1,
      shifts: [
        { id: "b", sort_order: 2 },
        { id: "c", sort_order: 3 },
      ],
    });
  });

  it("inserts after a middle leg, shifting only what follows", () => {
    expect(planConsecutiveInsert(seq, "b")).toEqual({
      newSortOrder: 2,
      shifts: [{ id: "c", sort_order: 3 }],
    });
  });

  it("appends after the last leg with no shifts", () => {
    expect(planConsecutiveInsert(seq, "c")).toEqual({
      newSortOrder: 3,
      shifts: [],
    });
  });

  it("is robust to gaps in sort_order", () => {
    const gappy = [
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 5 },
      { id: "c", sort_order: 10 },
    ];
    expect(planConsecutiveInsert(gappy, "a")).toEqual({
      newSortOrder: 1,
      shifts: [
        { id: "b", sort_order: 2 },
        { id: "c", sort_order: 3 },
      ],
    });
  });

  it("throws when the anchor leg is missing", () => {
    expect(() => planConsecutiveInsert(seq, "zzz")).toThrow(
      "Could not find the leg to add after.",
    );
  });
});
