import { describe, it, expect } from "vitest";
import { detectSource } from "@/lib/parsing/source";

describe("detectSource", () => {
  describe("airbnb", () => {
    it("detects a standard airbnb.com listing URL", () => {
      expect(
        detectSource("https://www.airbnb.com/rooms/12345678?guests=2"),
      ).toBe("airbnb");
    });

    it("detects airbnb on a non-.com TLD", () => {
      expect(detectSource("https://www.airbnb.co.uk/rooms/99")).toBe("airbnb");
      expect(detectSource("https://airbnb.fr/rooms/1")).toBe("airbnb");
    });

    it("detects airbnb regardless of subdomain", () => {
      expect(detectSource("https://gp1.airbnb.com/rooms/5")).toBe("airbnb");
    });

    it("detects the abnb.me share short-link domain", () => {
      expect(detectSource("https://abnb.me/abcDEF123")).toBe("airbnb");
      expect(detectSource("https://www.abnb.me/xyz")).toBe("airbnb");
    });

    it("is not fooled by airbnb appearing only in the path", () => {
      // Host is example.com — airbnb is just a path segment, so NOT airbnb.
      expect(detectSource("https://example.com/airbnb.com/rooms/1")).toBe(
        "other",
      );
    });
  });

  describe("booking", () => {
    it("detects a booking.com hotel URL", () => {
      expect(
        detectSource("https://www.booking.com/hotel/id/the-place.html"),
      ).toBe("booking");
    });

    it("detects booking.com on the secure subdomain", () => {
      expect(detectSource("https://secure.booking.com/book.html")).toBe(
        "booking",
      );
    });

    it("does not treat a lookalike domain as booking", () => {
      expect(detectSource("https://booking.com.evil.example/x")).toBe("other");
      expect(detectSource("https://notbooking.com/x")).toBe("other");
    });
  });

  describe("other", () => {
    it("returns other for an unrelated host", () => {
      expect(detectSource("https://www.vrbo.com/12345")).toBe("other");
      expect(detectSource("https://example.com")).toBe("other");
    });
  });

  describe("invalid / defensive", () => {
    it("returns other for an empty string", () => {
      expect(detectSource("")).toBe("other");
    });

    it("returns other for a non-URL string", () => {
      expect(detectSource("not a url at all")).toBe("other");
      expect(detectSource("airbnb.com")).toBe("other"); // missing scheme -> invalid URL
    });

    it("returns other for garbage input", () => {
      expect(detectSource("://///")).toBe("other");
      expect(detectSource("javascript:void(0)")).toBe("other");
    });

    it("tolerates surrounding whitespace on a valid URL", () => {
      expect(detectSource("  https://www.airbnb.com/rooms/1  ")).toBe("airbnb");
    });
  });
});
