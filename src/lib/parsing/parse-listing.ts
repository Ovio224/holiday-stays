// HTML -> ParsedListing extraction. PURE function: no network, no DOM.
// Everything is regex over the raw HTML string so it runs anywhere (tests,
// edge, node) and stays deterministic.

import type { ParsedListing } from "@/lib/types";

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

/** Title falls back to the <title> element when og:title is absent. */
function extractTitle(html: string): string | null {
  const og = extractMetaContent(html, "og:title");
  if (og) return og;

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return clean(titleTag?.[1] ?? null);
}

/**
 * Best-effort price extraction. Strategy, in priority order:
 *   1. JSON-LD `"price"` / `"priceCurrency"` fields (the most reliable signal).
 *   2. A currency-like amount that sits near words such as "night" / "total".
 *   3. The first plausible currency-like amount anywhere.
 * Returns null when nothing convincing is found.
 */
function extractPrice(html: string): string | null {
  // --- 1. JSON-LD structured data -----------------------------------------
  // Look for a "price" value, optionally paired with a currency code.
  const ldPrice = /"price"\s*:\s*"?(\d[\d.,]*)"?/i.exec(html);
  if (ldPrice?.[1]) {
    const currency = /"priceCurrency"\s*:\s*"([A-Za-z]{3})"/i.exec(html);
    const amount = ldPrice[1];
    return currency?.[1]
      ? `${currency[1].toUpperCase()} ${amount}`
      : clean(amount);
  }

  // A currency token: a symbol ($ € £ ¥ ₹) or a 2-4 letter code (EUR, Rp, IDR)
  // attached to a grouped number like 1,234 / 1.234.000 / 120.
  const currencyAmount =
    "(?:[$€£¥₹]|\\b[A-Za-z]{2,4}\\b)\\s*\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,2})?";

  // --- 2. Amount near a price-ish keyword ---------------------------------
  // Search a window of text around "night" / "total" / "per night".
  const keywordWindow = new RegExp(
    `(${currencyAmount})[^<>]{0,40}?(?:per\\s+night|night|total)|(?:per\\s+night|night|total)[^<>]{0,40}?(${currencyAmount})`,
    "i",
  ).exec(stripTags(html));
  if (keywordWindow) {
    const hit = keywordWindow[1] ?? keywordWindow[2];
    if (hit) return clean(hit);
  }

  // --- 3. First plausible currency amount anywhere ------------------------
  const anyAmount = new RegExp(currencyAmount, "i").exec(stripTags(html));
  if (anyAmount?.[0]) return clean(anyAmount[0]);

  return null;
}

/**
 * Crude tag stripper used only for price proximity matching — keeps text nodes
 * and the spaces between them so "$120 / night" survives even when the markup
 * splits the amount and the word across elements.
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Parse raw page HTML into a ParsedListing. Always returns all four keys, with
 * null for any field that could not be found.
 */
export function parseListing(html: string, _url: string): ParsedListing {
  if (typeof html !== "string" || html.length === 0) {
    return { title: null, imageUrl: null, priceText: null, description: null };
  }

  return {
    title: extractTitle(html),
    imageUrl: extractMetaContent(html, "og:image"),
    priceText: extractPrice(html),
    description: extractMetaContent(html, "og:description"),
  };
}
