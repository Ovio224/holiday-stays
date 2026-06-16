/**
 * Tests for the pure accommodation-edit logic in src/lib/accommodations.ts:
 * prepareAccommodationEdit (trim→null, amenities array+string parsing/dedupe,
 * price + capacity validation, bad image URL, fractional baths) and the keyless
 * map helpers (encoding, address-vs-title preference, null when empty).
 *
 * The updateAccommodation Server Action hits Supabase and is covered by
 * integration tests, like the other actions.
 */
import { describe, it, expect } from "vitest";

import {
  prepareAccommodationEdit,
  mapQuery,
  mapEmbedUrl,
  mapLinkUrl,
} from "@/lib/accommodations";

describe("prepareAccommodationEdit", () => {
  it("trims text fields to null when empty", () => {
    const result = prepareAccommodationEdit({
      title: "  ",
      notes: "",
      address: "   ",
      currency: " ",
    });
    expect(result.title).toBeNull();
    expect(result.notes).toBeNull();
    expect(result.address).toBeNull();
    expect(result.currency).toBeNull();
  });

  it("trims and keeps non-empty text fields", () => {
    const result = prepareAccommodationEdit({
      title: "  Cliffside villa ",
      notes: " Walk to beach ",
      address: " Jl. Raya Ubud ",
      currency: " € ",
    });
    expect(result.title).toBe("Cliffside villa");
    expect(result.notes).toBe("Walk to beach");
    expect(result.address).toBe("Jl. Raya Ubud");
    expect(result.currency).toBe("€");
  });

  it("treats undefined fields as null/omitted", () => {
    const result = prepareAccommodationEdit({});
    expect(result).toEqual({
      title: null,
      image_url: null,
      notes: null,
      address: null,
      amenities: null,
      price_per_night: null,
      currency: null,
      details: {},
    });
  });

  describe("amenities", () => {
    it("parses a newline/comma string, trimming and dropping empties", () => {
      const result = prepareAccommodationEdit({
        amenities: "Pool\n Fast Wi-Fi , \n AC \n",
      });
      expect(result.amenities).toEqual(["Pool", "Fast Wi-Fi", "AC"]);
    });

    it("accepts an array as-is (after trimming)", () => {
      const result = prepareAccommodationEdit({
        amenities: ["Pool ", " Gym", ""],
      });
      expect(result.amenities).toEqual(["Pool", "Gym"]);
    });

    it("dedupes case-insensitively, keeping the first occurrence + order", () => {
      const result = prepareAccommodationEdit({
        amenities: ["Pool", "POOL", "Wi-Fi", "pool", "wi-fi"],
      });
      expect(result.amenities).toEqual(["Pool", "Wi-Fi"]);
    });

    it("normalizes an empty amenities value to null", () => {
      expect(prepareAccommodationEdit({ amenities: "   \n , " }).amenities).toBeNull();
      expect(prepareAccommodationEdit({ amenities: [] }).amenities).toBeNull();
      expect(prepareAccommodationEdit({ amenities: null }).amenities).toBeNull();
    });
  });

  describe("price", () => {
    it("rounds a valid price to cents", () => {
      expect(prepareAccommodationEdit({ pricePerNight: 120.456 }).price_per_night).toBe(120.46);
      expect(prepareAccommodationEdit({ pricePerNight: "99.9" }).price_per_night).toBe(99.9);
    });

    it("allows zero (a free/unset reference price, unlike member prices)", () => {
      expect(prepareAccommodationEdit({ pricePerNight: 0 }).price_per_night).toBe(0);
    });

    it("nulls an empty price", () => {
      expect(prepareAccommodationEdit({ pricePerNight: "" }).price_per_night).toBeNull();
      expect(prepareAccommodationEdit({ pricePerNight: null }).price_per_night).toBeNull();
    });

    it("throws on a negative or non-numeric price", () => {
      expect(() => prepareAccommodationEdit({ pricePerNight: -5 })).toThrow("Enter a valid price.");
      expect(() => prepareAccommodationEdit({ pricePerNight: "abc" })).toThrow("Enter a valid price.");
    });
  });

  describe("image URL", () => {
    it("keeps a valid http(s) image link", () => {
      expect(
        prepareAccommodationEdit({ imageUrl: " https://img.test/a.jpg " }).image_url,
      ).toBe("https://img.test/a.jpg");
    });

    it("nulls an empty image link", () => {
      expect(prepareAccommodationEdit({ imageUrl: "  " }).image_url).toBeNull();
    });

    it("throws on a non-http(s) image link", () => {
      expect(() => prepareAccommodationEdit({ imageUrl: "javascript:alert(1)" })).toThrow(
        "Enter a valid image link.",
      );
      expect(() => prepareAccommodationEdit({ imageUrl: "not a url" })).toThrow(
        "Enter a valid image link.",
      );
    });
  });

  describe("capacity details", () => {
    it("rounds integer fields and only includes edited keys", () => {
      const result = prepareAccommodationEdit({ guests: "6", bedrooms: 3.4 });
      expect(result.details).toEqual({ guests: 6, bedrooms: 3 });
    });

    it("keeps fractional baths", () => {
      expect(prepareAccommodationEdit({ baths: "1.5" }).details).toEqual({ baths: 1.5 });
    });

    it("omits empty capacity fields (so existing values are untouched)", () => {
      expect(prepareAccommodationEdit({ guests: "", beds: null }).details).toEqual({});
    });

    it("throws on negative or non-numeric capacity", () => {
      expect(() => prepareAccommodationEdit({ guests: -1 })).toThrow("Enter valid room details.");
      expect(() => prepareAccommodationEdit({ beds: "two" })).toThrow("Enter valid room details.");
    });
  });
});

describe("mapQuery", () => {
  it("prefers the address over the title, appending the area", () => {
    expect(
      mapQuery({ title: "Villa Bayu", address: "Jl. Raya Ubud", area: "Ubud" }),
    ).toBe("Jl. Raya Ubud, Ubud");
  });

  it("falls back to the title when there is no address", () => {
    expect(mapQuery({ title: "Villa Bayu", address: null, area: "Ubud" })).toBe(
      "Villa Bayu, Ubud",
    );
  });

  it("uses just the primary when there is no area", () => {
    expect(mapQuery({ title: "Villa Bayu", address: null, area: null })).toBe("Villa Bayu");
  });

  it("trims whitespace and ignores blank parts", () => {
    expect(mapQuery({ title: "  ", address: "  Jl. Raya  ", area: "  " })).toBe("Jl. Raya");
  });

  it("returns null when nothing is usable", () => {
    expect(mapQuery({ title: null, address: null, area: null })).toBeNull();
    expect(mapQuery({ title: "   ", address: "", area: "  " })).toBeNull();
  });
});

describe("mapEmbedUrl / mapLinkUrl", () => {
  it("URL-encodes the query into the embed src", () => {
    expect(mapEmbedUrl("Jl. Raya Ubud, Bali")).toBe(
      "https://www.google.com/maps?q=Jl.%20Raya%20Ubud%2C%20Bali&output=embed",
    );
  });

  it("URL-encodes the query into the external link", () => {
    expect(mapLinkUrl("Jl. Raya Ubud, Bali")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Jl.%20Raya%20Ubud%2C%20Bali",
    );
  });
});
