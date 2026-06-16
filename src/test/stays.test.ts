/**
 * Tests for prepareStayInput — the pure validation/normalization for trip legs.
 *
 * Only this pure helper is unit-tested here; the Server Actions in
 * src/actions/stays.ts hit Supabase and are covered by integration tests, like
 * the rate-limiter's isLockedOut/recordAttempt.
 */
import { describe, it, expect } from "vitest";
import { prepareStayInput } from "@/lib/stays";

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
