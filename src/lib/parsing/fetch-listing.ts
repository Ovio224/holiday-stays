// Server-side fetch + parse. This is the only impure piece of the parsing
// stack — it performs the network request, then hands the HTML to the pure
// parseListing(). It NEVER throws: every failure path resolves to a "failed"
// result with an all-null ParsedListing.

import type { ParsedListing } from "@/lib/types";
import { parseListing } from "@/lib/parsing/parse-listing";

// A realistic desktop browser UA — many listing sites short-circuit or block
// obvious bot agents, so we present as Chrome on macOS.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Hard cap on how long we'll wait for the remote page.
const TIMEOUT_MS = 8000;

const EMPTY: ParsedListing = {
  title: null,
  imageUrl: null,
  description: null,
  priceText: null,
  pricePerNight: null,
  currency: null,
  details: {
    rating: null,
    reviews: null,
    bedrooms: null,
    beds: null,
    baths: null,
    guests: null,
  },
};

/**
 * Fetch a listing URL server-side and parse it into a ParsedListing.
 *
 * @returns `{ parsed, status }` where status is "ok" when the page was fetched
 *          and parsed, or "failed" on any non-ok response, timeout, network
 *          error, or empty body. Always resolves — never rejects.
 */
export async function fetchAndParse(
  url: string,
): Promise<{ parsed: ParsedListing; status: "ok" | "failed" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        // Ask for HTML and a couple of common locales to look like a browser.
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return { parsed: { ...EMPTY }, status: "failed" };
    }

    const html = await response.text();
    if (!html || html.trim().length === 0) {
      return { parsed: { ...EMPTY }, status: "failed" };
    }

    return { parsed: parseListing(html, url), status: "ok" };
  } catch {
    // AbortError (timeout), DNS/connection errors, etc. all land here.
    return { parsed: { ...EMPTY }, status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
}
