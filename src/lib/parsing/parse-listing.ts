// HTML -> ParsedListing extraction. PURE function: no network, no DOM.
// We parse JSON-LD structured data (the richest, most reliable signal) and fall
// back to og: meta tags + regex over the raw HTML. Everything runs over the raw
// string so it works anywhere (tests, edge, node) and stays deterministic.

import type { ListingDetails, ParsedListing } from "@/lib/types";

/**
 * Decode the handful of HTML entities that actually show up in og: tags and
 * titles. We intentionally keep this small and explicit rather than pulling in
 * a full entity table — these cover the realistic cases (ampersands, quotes,
 * apostrophes, non-breaking spaces) plus generic numeric references.
 */
function decodeEntities(input: string): string {
  return (
    input
      // Numeric (decimal) references: &#39; -> '
      .replace(/&#(\d+);/g, (_, dec: string) => {
        const code = Number(dec);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      // Numeric (hex) references: &#x27; -> '
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      // Named references we care about. &amp; is done LAST so that an already
      // double-encoded "&amp;quot;" still resolves sensibly in one pass.
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
  );
}

/**
 * Collapse runs of whitespace into single spaces and trim. Returns null for
 * anything that's empty after cleaning so callers get a consistent "missing"
 * signal.
 */
function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const decoded = decodeEntities(value).replace(/\s+/g, " ").trim();
  return decoded.length > 0 ? decoded : null;
}

/**
 * Pull the `content` attribute of a `<meta property="og:..." content="...">`
 * (or the name="" variant). Handles either attribute order and single or
 * double quotes.
 */
function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Case A: property/name comes before content.
  const before = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${escapedKey}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (before?.[1]) return clean(before[1]);

  // Case B: content comes before property/name.
  const after = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${escapedKey}["']`,
    "i",
  ).exec(html);
  if (after?.[1]) return clean(after[1]);

  return null;
}

// A JSON-LD object after parsing — keys are unknown, so we treat it loosely.
type LdObject = Record<string, unknown>;

/** The listing @types we care about, lower-cased for comparison. */
const LISTING_TYPES = new Set([
  "vacationrental",
  "product",
  "hotel",
  "lodgingbusiness",
  "place",
]);

/** True when an object's @type (string or array) matches a listing type. */
function isListingType(obj: LdObject): boolean {
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === "string" && LISTING_TYPES.has(t.toLowerCase()),
  );
}

/**
 * Parse every `<script type="application/ld+json">` block. Each block is
 * JSON.parse-d inside a try/catch (malformed blocks are skipped). Top-level
 * arrays and `@graph` arrays are flattened so we end up with a flat list of
 * candidate objects.
 */
function extractJsonLd(html: string): LdObject[] {
  const objects: LdObject[] = [];
  const blockRe =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // Tolerate malformed blocks.
    }

    // Flatten: a block may be an object, an array of objects, or an object
    // wrapping an @graph array.
    const stack: unknown[] = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === "object") {
        const obj = node as LdObject;
        objects.push(obj);
        if (Array.isArray(obj["@graph"])) {
          stack.push(...(obj["@graph"] as unknown[]));
        }
      }
    }
  }

  return objects;
}

/**
 * Merge useful fields from all listing-type JSON-LD objects, preferring the
 * first object that has each value. Returns a single merged object.
 */
function mergeListingObjects(objects: LdObject[]): LdObject {
  const merged: LdObject = {};
  const candidates = objects.filter(isListingType);

  for (const obj of candidates) {
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;
      if (merged[key] == null) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

/** Coerce a value to a finite number, or null. */
function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip the trailing " · ★4.82 · 4 bedrooms · 5 beds · 4 private baths" summary
 * Airbnb appends to og:title, leaving just the leading place name/type.
 */
function stripTitleSummary(title: string): string {
  // Cut at the first " · ★" (rating marker) or " · " followed by the capacity
  // summary. The simplest robust rule: drop everything from the first "★" on,
  // including the separator that precedes it.
  const starIdx = title.search(/\s*[·|]\s*★/);
  if (starIdx >= 0) return title.slice(0, starIdx).trim();
  return title.trim();
}

/** Extract the JSON-LD aggregateRating object, if present. */
function getAggregateRating(merged: LdObject): LdObject | null {
  const agg = merged["aggregateRating"];
  if (agg && typeof agg === "object" && !Array.isArray(agg)) {
    return agg as LdObject;
  }
  return null;
}

/**
 * Resolve an og:image / JSON-LD image into a single URL string. JSON-LD image
 * may be a string, an array (take [0]), or an object with a `.url`.
 */
function resolveImage(html: string, merged: LdObject): string | null {
  const og = extractMetaContent(html, "og:image");
  if (og) return og;

  let image = merged["image"];
  if (Array.isArray(image)) image = image[0];
  if (typeof image === "string") return clean(image);
  if (image && typeof image === "object") {
    const url = (image as LdObject)["url"];
    if (typeof url === "string") return clean(url);
  }
  return null;
}

/**
 * First capture group from a regex over `source`, parsed as a number, or null.
 */
function matchNumber(source: string, re: RegExp): number | null {
  const m = re.exec(source);
  return m?.[1] != null ? toNumber(m[1]) : null;
}

/** Pull guest capacity from JSON-LD containsPlace.occupancy.maxValue. */
function guestsFromJsonLd(merged: LdObject): number | null {
  const contains = merged["containsPlace"];
  const place = Array.isArray(contains) ? contains[0] : contains;
  if (!place || typeof place !== "object") return null;
  const occupancy = (place as LdObject)["occupancy"];
  if (!occupancy || typeof occupancy !== "object") return null;
  return toNumber((occupancy as LdObject)["maxValue"]);
}

/** Read price + currency from JSON-LD offers, if present. */
function priceFromOffers(merged: LdObject): {
  pricePerNight: number | null;
  currency: string | null;
  priceText: string | null;
} {
  let offers = merged["offers"];
  if (Array.isArray(offers)) offers = offers[0];
  if (!offers || typeof offers !== "object") {
    return { pricePerNight: null, currency: null, priceText: null };
  }
  const offer = offers as LdObject;
  const price = toNumber(offer["price"]);
  if (price == null) {
    return { pricePerNight: null, currency: null, priceText: null };
  }
  const currencyRaw = offer["priceCurrency"];
  const currency =
    typeof currencyRaw === "string" && currencyRaw.trim().length > 0
      ? currencyRaw.trim()
      : null;
  const priceText = currency ? `${currency} ${price}` : String(price);
  return { pricePerNight: price, currency, priceText };
}

/**
 * Parse raw page HTML into a ParsedListing. Always returns a complete object,
 * including a `details` object with all six keys (null when not found).
 */
export function parseListing(html: string, _url: string): ParsedListing {
  const emptyDetails: ListingDetails = {
    rating: null,
    reviews: null,
    bedrooms: null,
    beds: null,
    baths: null,
    guests: null,
  };

  if (typeof html !== "string" || html.length === 0) {
    return {
      title: null,
      imageUrl: null,
      description: null,
      priceText: null,
      pricePerNight: null,
      currency: null,
      details: { ...emptyDetails },
    };
  }

  const merged = mergeListingObjects(extractJsonLd(html));
  const aggregate = getAggregateRating(merged);

  const ogTitle = extractMetaContent(html, "og:title");
  const ogDescription = extractMetaContent(html, "og:description");

  // --- name / title --------------------------------------------------------
  // JSON-LD name || og:description (often the catchy listing name) || a cleaned
  // og:title with the trailing "★... · N bedrooms · ..." summary stripped.
  const ldName =
    typeof merged["name"] === "string" ? clean(merged["name"] as string) : null;
  const title =
    ldName ||
    ogDescription ||
    (ogTitle ? clean(stripTitleSummary(ogTitle)) : null);

  // --- description ---------------------------------------------------------
  const ldDescription =
    typeof merged["description"] === "string"
      ? clean(merged["description"] as string)
      : null;
  const description = ldDescription || ogDescription;

  // --- rating + reviews ----------------------------------------------------
  const rating =
    toNumber(aggregate?.["ratingValue"]) ??
    (ogTitle ? matchNumber(ogTitle, /★\s*([0-9.]+)/) : null);
  const reviews =
    toNumber(aggregate?.["ratingCount"]) ??
    toNumber(aggregate?.["reviewCount"]);

  // --- capacity details ----------------------------------------------------
  // Prefer the compact og:title summary; fall back to the whole HTML.
  const summarySource = ogTitle ?? "";
  const bedrooms =
    matchNumber(summarySource, /(\d+)\s+bedrooms?/i) ??
    matchNumber(html, /(\d+)\s+bedrooms?/i);
  // Note the trailing \b so "beds" never matches inside "bedrooms"
  // (e.g. "4 bedrooms · 5 beds" must yield 5, not 4).
  const beds =
    matchNumber(summarySource, /(\d+)\s+beds?\b/i) ??
    matchNumber(html, /(\d+)\s+beds?\b/i);
  const baths =
    matchNumber(summarySource, /([\d.]+)\s+(?:private\s+|shared\s+)?baths?/i) ??
    matchNumber(html, /([\d.]+)\s+(?:private\s+|shared\s+)?baths?/i);
  const guests =
    guestsFromJsonLd(merged) ??
    matchNumber(summarySource, /(\d+)\s+guests?/i) ??
    matchNumber(html, /(\d+)\s+guests?/i);

  // --- price ---------------------------------------------------------------
  const { pricePerNight, currency, priceText } = priceFromOffers(merged);

  return {
    title,
    imageUrl: resolveImage(html, merged),
    description,
    priceText,
    pricePerNight,
    currency,
    details: {
      rating,
      reviews,
      bedrooms,
      beds,
      baths,
      guests,
    },
  };
}
