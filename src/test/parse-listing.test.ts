import { describe, it, expect } from "vitest";
import { parseListing } from "@/lib/parsing/parse-listing";

// A realistic Booking.com-style page: og: meta tags + a JSON-LD price block.
const BOOKING_HTML = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>The Lagoon Villa, Bali &#8212; Booking.com</title>
    <meta property="og:title" content="The Lagoon Villa &amp; Spa, Bali" />
    <meta property="og:image" content="https://cf.bstatic.com/images/hotel/max1024x768/lagoon-villa.jpg" />
    <meta property="og:description" content="A breezy 3-bed villa with a private pool, 5 min from the beach. Guest&#39;s favourite." />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Hotel",
        "name": "The Lagoon Villa",
        "priceRange": "$$",
        "offers": {
          "@type": "Offer",
          "price": "1.234.000",
          "priceCurrency": "IDR"
        }
      }
    </script>
  </head>
  <body>
    <h1>The Lagoon Villa &amp; Spa, Bali</h1>
    <div class="price">Rp 1.234.000 per night</div>
  </body>
</html>
`;

// A realistic Airbnb-style page: og: tags + an inline "$120 / night" price,
// no JSON-LD offer block.
const AIRBNB_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Cozy Treehouse Retreat - Houses for Rent in Asheville - Airbnb</title>
    <meta name="og:title" content="Cozy Treehouse Retreat &amp; Hot Tub" />
    <meta property="og:image" content="https://a0.muscache.com/im/pictures/treehouse.jpg?aki_policy=large" />
    <meta property="og:description" content="Wake up in the canopy. Sleeps 4. &quot;Magical&quot; — past guests." />
  </head>
  <body>
    <div data-testid="price">
      <span>$120</span>
      <span>per night</span>
    </div>
    <div>$1,440 total before taxes</div>
  </body>
</html>
`;

describe("parseListing", () => {
  describe("Booking-like fixture", () => {
    const result = parseListing(BOOKING_HTML, "https://www.booking.com/hotel");

    it("prefers og:title and decodes the &amp; entity", () => {
      expect(result.title).toBe("The Lagoon Villa & Spa, Bali");
    });

    it("extracts og:image", () => {
      expect(result.imageUrl).toBe(
        "https://cf.bstatic.com/images/hotel/max1024x768/lagoon-villa.jpg",
      );
    });

    it("extracts og:description and decodes the numeric &#39; entity", () => {
      expect(result.description).toBe(
        "A breezy 3-bed villa with a private pool, 5 min from the beach. Guest's favourite.",
      );
    });

    it("reads price + currency from JSON-LD", () => {
      // priceCurrency IDR + price 1.234.000.
      expect(result.priceText).toBe("IDR 1.234.000");
    });
  });

  describe("Airbnb-like fixture", () => {
    const result = parseListing(AIRBNB_HTML, "https://www.airbnb.com/rooms/1");

    it("uses the name='og:title' variant and decodes entities", () => {
      expect(result.title).toBe("Cozy Treehouse Retreat & Hot Tub");
    });

    it("extracts og:image including its query string", () => {
      expect(result.imageUrl).toBe(
        "https://a0.muscache.com/im/pictures/treehouse.jpg?aki_policy=large",
      );
    });

    it("extracts og:description and decodes &quot; entities", () => {
      expect(result.description).toBe(
        'Wake up in the canopy. Sleeps 4. "Magical" — past guests.',
      );
    });

    it("finds a currency amount near a price keyword when no JSON-LD exists", () => {
      // Should pick a $ amount near "per night"/"night"/"total" from the body.
      expect(result.priceText).toMatch(/\$1?[,.]?[0-9]/);
      expect(result.priceText).toContain("$");
    });
  });

  describe("entity decoding", () => {
    it("decodes named, decimal, and hex entities together", () => {
      const html = `<meta property="og:title" content="Bed &amp; Breakfast &#39;Sunrise&#39; &#x2014; cliff &quot;view&quot;" />`;
      const { title } = parseListing(html, "https://example.com");
      expect(title).toBe("Bed & Breakfast 'Sunrise' — cliff \"view\"");
    });

    it("collapses internal whitespace and trims", () => {
      const html = `<title>   Sea\n\t  Breeze   Cottage   </title>`;
      const { title } = parseListing(html, "https://example.com");
      expect(title).toBe("Sea Breeze Cottage");
    });
  });

  describe("title fallback", () => {
    it("falls back to the <title> element when og:title is missing", () => {
      const html = `<head><title>Plain Title Only</title></head>`;
      const { title } = parseListing(html, "https://example.com");
      expect(title).toBe("Plain Title Only");
    });
  });

  describe("graceful nulls", () => {
    it("returns all-null keys for an empty string", () => {
      expect(parseListing("", "https://example.com")).toEqual({
        title: null,
        imageUrl: null,
        priceText: null,
        description: null,
      });
    });

    it("returns all-null keys for garbage HTML with no useful data", () => {
      const result = parseListing(
        "<html><body><p>nothing useful here</p></body></html>",
        "https://example.com",
      );
      expect(result.title).toBeNull();
      expect(result.imageUrl).toBeNull();
      expect(result.priceText).toBeNull();
      expect(result.description).toBeNull();
    });

    it("always returns exactly the four expected keys", () => {
      const result = parseListing(BOOKING_HTML, "https://example.com");
      expect(Object.keys(result).sort()).toEqual(
        ["description", "imageUrl", "priceText", "title"].sort(),
      );
    });
  });
});
