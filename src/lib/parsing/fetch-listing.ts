// Server-side fetch + parse. This is the only impure piece of the parsing
// stack — it performs the network request, then hands the HTML to the pure
// parseListing(). It NEVER throws.
//
// Some sites (notably Booking.com) answer automated requests with an anti-bot
// challenge: a tiny HTTP 202 page with no real content. We mark those "failed"
// (truthful), but still keep a URL-derived title (e.g. Booking's hotel slug) so
// the card is usable and the user only needs to add a price by hand.

import type { ParsedListing } from "@/lib/types";
import { parseListing } from "@/lib/parsing/parse-listing";

// A realistic desktop browser UA — many listing sites short-circuit or block
// obvious bot agents, so we present as Chrome on macOS.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Hard cap on how long we'll wait for the remote page.
const TIMEOUT_MS = 8000;

/**
 * True when the HTML looks like a real listing page (carries OpenGraph tags,
 * JSON-LD, or a non-empty <title>) rather than a bot-challenge or empty shell.
 */
function looksLikeRealPage(html: string): boolean {
  return (
    /["']og:title["']/i.test(html) ||
    /application\/ld\+json/i.test(html) ||
    /<title[^>]*>\s*\S/i.test(html)
  );
}

/**
 * Fetch a listing URL server-side and parse it into a ParsedListing.
 *
 * @returns `{ parsed, status }`. status is "ok" only when a real page was read
 *          and parsed; it is "failed" on any non-ok/202 response, timeout,
 *          network error, empty body, or anti-bot challenge. Even on "failed",
 *          `parsed.title` may be derived from the URL. Always resolves.
 */
export async function fetchAndParse(
  url: string,
): Promise<{ parsed: ParsedListing; status: "ok" | "failed" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // A failed fetch still yields whatever the URL itself can tell us (title).
  const failed = () =>
    ({ parsed: parseListing("", url), status: "failed" as const });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Non-2xx, or the 202 anti-bot challenge Booking serves to non-browsers.
    if (!response.ok || response.status === 202) {
      return failed();
    }

    const html = await response.text();
    if (!html || !looksLikeRealPage(html)) {
      return failed();
    }

    return { parsed: parseListing(html, url), status: "ok" };
  } catch {
    // AbortError (timeout), DNS/connection errors, etc. all land here.
    return failed();
  } finally {
    clearTimeout(timeout);
  }
}
