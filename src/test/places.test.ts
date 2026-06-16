/**
 * Tests for preparePlaceInput + parseCoordinates — the pure validation for POIs
 * and manual coordinate entry. The submitPlace / setManualLocation Server Actions
 * hit Supabase and are integration-tested separately, like prepareStayInput.
 */
import { describe, it, expect } from "vitest";
import { parseCoordinates, preparePlaceInput, PLACE_CATEGORIES } from "@/lib/places";

describe("preparePlaceInput", () => {
  it("trims the label", () => {
    expect(preparePlaceInput({ label: "  Monkey Forest  " }).label).toBe("Monkey Forest");
  });

  it("throws on an empty or whitespace-only label", () => {
    expect(() => preparePlaceInput({ label: "" })).toThrow("Give the place a name.");
    expect(() => preparePlaceInput({ label: "   " })).toThrow("Give the place a name.");
  });

  it("defaults importance to 2 (want) when missing", () => {
    expect(preparePlaceInput({ label: "Beach" }).importance).toBe(2);
    expect(preparePlaceInput({ label: "Beach", importance: "" }).importance).toBe(2);
    expect(preparePlaceInput({ label: "Beach", importance: null }).importance).toBe(2);
  });

  it("clamps importance into 1–3 and rounds", () => {
    expect(preparePlaceInput({ label: "x", importance: 0 }).importance).toBe(1);
    expect(preparePlaceInput({ label: "x", importance: 7 }).importance).toBe(3);
    expect(preparePlaceInput({ label: "x", importance: 2.4 }).importance).toBe(2);
    expect(preparePlaceInput({ label: "x", importance: "3" }).importance).toBe(3);
  });

  it("throws on a non-numeric importance", () => {
    expect(() => preparePlaceInput({ label: "x", importance: "soon" })).toThrow(
      "Pick how important this place is.",
    );
  });

  it("normalizes the address to null when empty", () => {
    expect(preparePlaceInput({ label: "x", address: "   " }).address).toBeNull();
    expect(preparePlaceInput({ label: "x" }).address).toBeNull();
    expect(preparePlaceInput({ label: "x", address: " Jl. Raya Ubud " }).address).toBe("Jl. Raya Ubud");
  });

  it("accepts and lowercases a valid category, null when empty", () => {
    expect(preparePlaceInput({ label: "x", category: "Beach" }).category).toBe("beach");
    expect(preparePlaceInput({ label: "x", category: "" }).category).toBeNull();
    expect(preparePlaceInput({ label: "x" }).category).toBeNull();
  });

  it("rejects a category outside the canonical enum", () => {
    expect(() => preparePlaceInput({ label: "x", category: "nightclub" })).toThrow(
      "Pick a category from the list.",
    );
  });

  it("validates every canonical category", () => {
    for (const c of PLACE_CATEGORIES) {
      expect(preparePlaceInput({ label: "x", category: c }).category).toBe(c);
    }
  });

  it("defaults closer_is_better to true and respects an explicit false", () => {
    expect(preparePlaceInput({ label: "x" }).closer_is_better).toBe(true);
    expect(preparePlaceInput({ label: "x", closerIsBetter: false }).closer_is_better).toBe(false);
  });

  it("rejects an over-long name or address (bounds the geocoder query)", () => {
    expect(() => preparePlaceInput({ label: "x".repeat(201) })).toThrow("That name is too long.");
    expect(() =>
      preparePlaceInput({ label: "ok", address: "y".repeat(501) }),
    ).toThrow("That address is too long.");
    // A normal-length address is unaffected.
    expect(preparePlaceInput({ label: "ok", address: "Jl. Monkey Forest Rd, Ubud" }).address).toBe(
      "Jl. Monkey Forest Rd, Ubud",
    );
  });
});

describe("parseCoordinates", () => {
  it("parses a bare 'lat,lng' pair", () => {
    expect(parseCoordinates("-8.5069, 115.2625")).toEqual({ latitude: -8.5069, longitude: 115.2625 });
    expect(parseCoordinates("-8.5069,115.2625")).toEqual({ latitude: -8.5069, longitude: 115.2625 });
  });

  it("parses a Google Maps /@lat,lng link", () => {
    expect(
      parseCoordinates("https://www.google.com/maps/place/Ubud/@-8.5069,115.2625,15z"),
    ).toEqual({ latitude: -8.5069, longitude: 115.2625 });
  });

  it("parses a ?q= / ?ll= query link", () => {
    expect(parseCoordinates("https://maps.google.com/?q=-8.5069,115.2625")).toEqual({
      latitude: -8.5069,
      longitude: 115.2625,
    });
    expect(parseCoordinates("geo:0,0?ll=-8.5,115.2")).toEqual({ latitude: -8.5, longitude: 115.2 });
  });

  it("returns null for non-coordinate text", () => {
    expect(parseCoordinates("Jl. Raya Ubud, Bali")).toBeNull();
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates(null)).toBeNull();
    expect(parseCoordinates(undefined)).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseCoordinates("100,200")).toBeNull(); // lat > 90, lng > 180
    expect(parseCoordinates("-91, 0")).toBeNull();
  });
});
