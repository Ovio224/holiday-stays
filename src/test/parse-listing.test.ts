import { describe, it, expect } from "vitest";
import { parseListing } from "@/lib/parsing/parse-listing";

describe("parseListing > URL title fallback (blocked/empty pages)", () => {
  it("derives a Booking.com hotel name from the URL slug when the page is empty", () => {
    const result = parseListing(
      "",
      "https://www.booking.com/hotel/id/padma-resort-ubud.html",
    );
    expect(result.title).toBe("Padma Resort Ubud");
    expect(result.details.rating).toBeNull();
  });

  it("uses the URL slug when a challenge page carries no metadata", () => {
    const challenge = "<html><head><title></title></head><body></body></html>";
    const result = parseListing(
      challenge,
      "https://www.booking.com/hotel/fr/le-petit-jardin.html",
    );
    expect(result.title).toBe("Le Petit Jardin");
  });

  it("returns null title for opaque numeric ids (e.g. Airbnb rooms)", () => {
    const result = parseListing("", "https://www.airbnb.com/rooms/12345678");
    expect(result.title).toBeNull();
  });

  it("returns null for Booking share links / non-hotel paths", () => {
    expect(
      parseListing("", "https://www.booking.com/Share-CKsPv8").title,
    ).toBeNull();
    expect(
      parseListing("", "https://www.booking.com/searchresults.html").title,
    ).toBeNull();
  });

  it("prefers real page data over the URL slug when both exist", () => {
    const html = `<meta property="og:title" content="Real Page Name" />`;
    const result = parseListing(
      html,
      "https://www.booking.com/hotel/id/some-slug.html",
    );
    expect(result.title).toBe("Real Page Name");
  });
});

// A realistic Booking.com-style page: og: meta tags + a JSON-LD price block.
const BOOKING_HTML = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>The Lagoon Villa, Bali &#8212; Booking.com</title>
    <meta property="og:image" content="https://cf.bstatic.com/images/hotel/max1024x768/lagoon-villa.jpg" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Hotel",
        "name": "The Lagoon Villa",
        "description": "A breezy 3-bed villa with a private pool, 5 min from the beach.",
        "priceRange": "$$",
        "offers": {
          "@type": "Offer",
          "price": "1234000",
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

// A realistic Airbnb-style page: VacationRental JSON-LD with name +
// aggregateRating, an og:title carrying the "★ · N bedrooms · ..." summary, and
// NO offers/price (the Airbnb reality — price is entered manually).
const AIRBNB_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Villa in Ceningan Island - Airbnb</title>
    <meta property="og:title" content="Villa in Ceningan Island · ★4.82 · 4 bedrooms · 5 beds · 4 private baths" />
    <meta property="og:description" content="Cliffside Cloud · Ocean View Villa" />
    <meta property="og:image" content="https://a0.muscache.com/im/pictures/ceningan.jpg?aki_policy=large" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "VacationRental",
        "name": "Cliffside Cloud · Ocean View Villa",
        "description": "Wake up above the reef in a glass-walled villa.",
        "image": ["https://a0.muscache.com/im/pictures/ceningan.jpg"],
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": 4.82,
          "ratingCount": "103"
        },
        "containsPlace": {
          "@type": "Accommodation",
          "occupancy": { "@type": "QuantitativeValue", "maxValue": 8 }
        }
      }
    </script>
  </head>
  <body>
    <div data-testid="price"><span>$120</span><span>per night</span></div>
  </body>
</html>
`;

describe("parseListing", () => {
  describe("Booking-like fixture", () => {
    const result = parseListing(BOOKING_HTML, "https://www.booking.com/hotel");

    it("uses the JSON-LD name as the title", () => {
      expect(result.title).toBe("The Lagoon Villa");
    });

    it("extracts og:image", () => {
      expect(result.imageUrl).toBe(
        "https://cf.bstatic.com/images/hotel/max1024x768/lagoon-villa.jpg",
      );
    });

    it("extracts the JSON-LD description", () => {
      expect(result.description).toBe(
        "A breezy 3-bed villa with a private pool, 5 min from the beach.",
      );
    });

    it("reads price + currency from JSON-LD offers", () => {
      expect(result.pricePerNight).toBe(1234000);
      expect(result.currency).toBe("IDR");
      expect(result.priceText).toBe("IDR 1234000");
    });
  });

  describe("Airbnb-like fixture", () => {
    const result = parseListing(AIRBNB_HTML, "https://www.airbnb.com/rooms/1");

    it("uses the JSON-LD name as the title (not the og:title summary)", () => {
      expect(result.title).toBe("Cliffside Cloud · Ocean View Villa");
    });

    it("reads the rating from aggregateRating.ratingValue", () => {
      expect(result.details.rating).toBe(4.82);
    });

    it("reads the review count from aggregateRating.ratingCount", () => {
      expect(result.details.reviews).toBe(103);
    });

    it("parses bedrooms / beds / baths from the og:title summary", () => {
      expect(result.details.bedrooms).toBe(4);
      expect(result.details.beds).toBe(5);
      expect(result.details.baths).toBe(4);
    });

    it("reads guests from containsPlace.occupancy.maxValue", () => {
      expect(result.details.guests).toBe(8);
    });

    it("extracts og:image including its query string", () => {
      expect(result.imageUrl).toBe(
        "https://a0.muscache.com/im/pictures/ceningan.jpg?aki_policy=large",
      );
    });

    it("leaves price null when Airbnb has no JSON-LD offers", () => {
      expect(result.pricePerNight).toBeNull();
      expect(result.currency).toBeNull();
      expect(result.priceText).toBeNull();
    });
  });

  describe("rating scale (bestRating)", () => {
    // Booking's real JSON-LD: a Hotel with aggregateRating on a /10 scale and
    // NO offers (nightly price is date-dependent, so it isn't in static HTML).
    const BOOKING_REAL = `
      <meta property="og:title" content="Padma Resort Ubud, Payangan, Indonesia" />
      <meta property="og:image" content="https://r-xx.bstatic.com/xdata/images/hotel/608x352/799975956.webp" />
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Hotel",
          "name": "Padma Resort Ubud",
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": 9.5,
            "bestRating": 10,
            "reviewCount": 554
          }
        }
      </script>
    `;
    const booking = parseListing(
      BOOKING_REAL,
      "https://www.booking.com/hotel/id/padma-resort-ubud.html",
    );

    it("reads bestRating into details.ratingScale (Booking is /10)", () => {
      expect(booking.details.rating).toBe(9.5);
      expect(booking.details.ratingScale).toBe(10);
      expect(booking.details.reviews).toBe(554);
    });

    it("still extracts the title and image from the real Booking structure", () => {
      expect(booking.title).toBe("Padma Resort Ubud");
      expect(booking.imageUrl).toBe(
        "https://r-xx.bstatic.com/xdata/images/hotel/608x352/799975956.webp",
      );
    });

    it("leaves price null when Booking has no JSON-LD offers (date-dependent)", () => {
      expect(booking.pricePerNight).toBeNull();
      expect(booking.currency).toBeNull();
    });

    it("leaves ratingScale null when bestRating is absent (Airbnb /5)", () => {
      const result = parseListing(AIRBNB_HTML, "https://www.airbnb.com/rooms/1");
      expect(result.details.rating).toBe(4.82);
      expect(result.details.ratingScale).toBeNull();
    });
  });

  describe("capacity is never scraped from arbitrary page text", () => {
    // A real Booking hotel page: og:title carries NO capacity summary, but the
    // body HTML contains stray strings — an asset label "0026 Beds" and a room
    // blurb "1 bathroom". The old whole-HTML fallback turned these into a bogus
    // "26 beds · 1 bath" chip. A hotel has no listing-level capacity, so these
    // must all be null.
    const html = `
      <meta property="og:title" content="The Mesare Eco Resort, Nusa Penida, Indonesia" />
      <script type="application/ld+json">
        {
          "@type": "Hotel",
          "name": "The Mesare Eco Resort",
          "aggregateRating": { "@type": "AggregateRating", "ratingValue": 8.8, "bestRating": 10, "reviewCount": 1033 }
        }
      </script>
      <body>
        <img alt="0026 Beds" />
        <div>Deluxe Bungalow · 1 bathroom · 1 bed · sleeps 4 guests</div>
      </body>
    `;
    const result = parseListing(
      html,
      "https://www.booking.com/hotel/id/the-mesare-resort.html",
    );

    it("does not invent bedrooms/beds/baths/guests from body text", () => {
      expect(result.details.beds).toBeNull();
      expect(result.details.baths).toBeNull();
      expect(result.details.bedrooms).toBeNull();
      expect(result.details.guests).toBeNull();
    });

    it("still extracts the real title + rating from a Booking hotel page", () => {
      expect(result.title).toBe("The Mesare Eco Resort");
      expect(result.details.rating).toBe(8.8);
      expect(result.details.ratingScale).toBe(10);
      expect(result.details.reviews).toBe(1033);
    });
  });

  describe("og:title summary stripping + rating fallback", () => {
    // When there's no JSON-LD name, fall back to a cleaned og:title and parse
    // the rating out of the ★ marker.
    const html = `
      <meta property="og:title" content="Cabin in Asheville · ★4.95 · 2 bedrooms · 3 beds · 1.5 baths" />
    `;
    const result = parseListing(html, "https://www.airbnb.com/rooms/2");

    it("strips the trailing summary from og:title", () => {
      expect(result.title).toBe("Cabin in Asheville");
    });

    it("parses the rating from the ★ marker", () => {
      expect(result.details.rating).toBe(4.95);
    });

    it("parses fractional baths", () => {
      expect(result.details.baths).toBe(1.5);
    });
  });

  describe("JSON-LD @graph + array handling", () => {
    it("flattens a top-level array of LD objects", () => {
      const html = `
        <script type="application/ld+json">
          [
            { "@type": "BreadcrumbList" },
            { "@type": "Product", "name": "Beach Bungalow" }
          ]
        </script>
      `;
      const result = parseListing(html, "https://example.com");
      expect(result.title).toBe("Beach Bungalow");
    });

    it("flattens an @graph array of LD objects", () => {
      const html = `
        <script type="application/ld+json">
          { "@graph": [ { "@type": "Place", "name": "Mountain Lodge" } ] }
        </script>
      `;
      const result = parseListing(html, "https://example.com");
      expect(result.title).toBe("Mountain Lodge");
    });

    it("tolerates a malformed JSON-LD block without throwing", () => {
      const html = `
        <script type="application/ld+json">{ not valid json,, }</script>
        <meta property="og:title" content="Fallback Title" />
      `;
      const result = parseListing(html, "https://example.com");
      expect(result.title).toBe("Fallback Title");
    });
  });

  describe("entity decoding", () => {
    it("decodes named, decimal, and hex entities together in the name", () => {
      const html = `
        <script type="application/ld+json">
          { "@type": "Product", "name": "Bed &amp; Breakfast &#39;Sunrise&#39; &#x2014; cliff &quot;view&quot;" }
        </script>
      `;
      const { title } = parseListing(html, "https://example.com");
      expect(title).toBe("Bed & Breakfast 'Sunrise' — cliff \"view\"");
    });
  });

  describe("title fallback", () => {
    it("falls back to og:description when there is no JSON-LD name", () => {
      const html = `<meta property="og:description" content="A Catchy Listing Name" />`;
      const { title } = parseListing(html, "https://example.com");
      expect(title).toBe("A Catchy Listing Name");
    });
  });

  describe("graceful nulls", () => {
    const ALL_NULL = {
      title: null,
      imageUrl: null,
      description: null,
      priceText: null,
      pricePerNight: null,
      currency: null,
      details: {
        rating: null,
        ratingScale: null,
        reviews: null,
        bedrooms: null,
        beds: null,
        baths: null,
        guests: null,
      },
    };

    it("returns a fully-null ParsedListing for an empty string", () => {
      expect(parseListing("", "https://example.com")).toEqual(ALL_NULL);
    });

    it("returns all-null fields for garbage HTML with no useful data", () => {
      const result = parseListing(
        "<html><body><p>nothing useful here</p></body></html>",
        "https://example.com",
      );
      expect(result).toEqual(ALL_NULL);
    });

    it("always returns the seven top-level keys with a full details object", () => {
      const result = parseListing(AIRBNB_HTML, "https://example.com");
      expect(Object.keys(result).sort()).toEqual(
        [
          "currency",
          "description",
          "details",
          "imageUrl",
          "pricePerNight",
          "priceText",
          "title",
        ].sort(),
      );
      expect(Object.keys(result.details).sort()).toEqual(
        ["bedrooms", "beds", "baths", "guests", "rating", "ratingScale", "reviews"].sort(),
      );
    });
  });
});
