// Server-side fetch + parse. This is the only impure piece of the parsing
// stack — it performs the network request, then hands the HTML to the pure
// parseListing(). It NEVER throws.
//
// Booking.com answers ordinary browser/bot requests with a JavaScript anti-bot
// challenge (a tiny HTTP 202 page) that a plain fetch can't solve. But it
// whitelists social link-preview crawlers (facebookexternalhit, Slackbot,
// WhatsApp) — so that pasting a link into Facebook/WhatsApp/Slack yields a
// rich preview — and serves THEM the full static page: og: tags + JSON-LD.
// We exploit that: for Booking we present as such a crawler and get the real
// page our parser already reads. Every other source keeps a desktop-browser UA
// (Airbnb, notably, 403s the social crawler). The 202 / empty-page guards below
// remain as a defensive fallback if a challenge ever slips through.

import type { AccommodationSource, ParsedListing } from "@/lib/types";
import { detectSource } from "@/lib/parsing/source";
import { parseListing } from "@/lib/parsing/parse-listing";
import { assertFetchableUrl } from "@/lib/parsing/net-guard";

// A realistic desktop browser UA — the default for most sites; many (Airbnb
// included) short-circuit or block obvious bot agents, so we present as Chrome.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Social link-preview crawler UAs that Booking.com whitelists (verified this
// session: it serves them the full static page — og: + JSON-LD — bypassing its
// JS anti-bot challenge). Ordered as a fallback chain across INDEPENDENT vendors
// (Meta, then Slack) so one being de-whitelisted doesn't take the feature down.
// Empirically facebookexternalhit, Slackbot and WhatsApp all pass; Discord,
// Telegram, LinkedIn, reddit, Embedly, Googlebot and Twitterbot are challenged.
const SOCIAL_CRAWLER_USER_AGENTS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
];

/**
 * The ordered User-Agent(s) to try for a source. Booking.com needs a social
 * link-preview crawler UA to get past its JavaScript challenge (we try a couple
 * of independent ones in turn); everything else uses a single desktop-browser
 * UA (Airbnb blocks the social crawler with a 403).
 */
export function userAgentsFor(source: AccommodationSource): string[] {
  return source === "booking"
    ? [...SOCIAL_CRAWLER_USER_AGENTS]
    : [BROWSER_USER_AGENT];
}

// Hard cap on how long we'll wait for the remote page (per attempt, all hops).
const TIMEOUT_MS = 8000;

// Cap on redirect hops we'll follow (manually, so each is SSRF-validated).
// Booking share links chain a few; 8 is comfortably above any real listing.
const MAX_REDIRECTS = 8;

// Hard cap on advertised response size. Real listing pages are ~350KB-1.4MB;
// a multi-MB body is almost certainly hostile or misconfigured, so we refuse to
// buffer it into memory. (This trusts Content-Length, which Booking/Airbnb both
// send; a chunked response with no length still gets read — acceptable for this
// gated, internal app.)
const MAX_BYTES = 5 * 1024 * 1024;

/** True when a Content-Length header advertises a body larger than MAX_BYTES. */
export function exceedsSizeLimit(contentLength: string | null): boolean {
  if (!contentLength) return false; // unknown length — let it through
  const n = Number(contentLength);
  return Number.isFinite(n) && n > MAX_BYTES;
}

/**
 * True when the HTML looks like a real listing page (carries OpenGraph tags,
 * JSON-LD, or a non-empty <title>) rather than a bot-challenge or empty shell.
 */
export function looksLikeRealPage(html: string): boolean {
  return (
    /["']og:title["']/i.test(html) ||
    /application\/ld\+json/i.test(html) ||
    // A <title> whose first content char is neither whitespace nor "<". The
    // "[^\s<]" is load-bearing: a plain "\S" would match the "<" of an empty
    // "<title></title>" closing tag and wrongly accept a blank-title shell.
    /<title[^>]*>\s*[^\s<]/i.test(html)
  );
}

/**
 * One fetch attempt with a single User-Agent. Returns the parsed page on
 * success, or null when this attempt was blocked / empty / over-sized / errored
 * (so the caller can try the next UA in the chain). Never throws.
 */
async function attempt(
  url: string,
  userAgent: string,
): Promise<ParsedListing | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    let current = url;
    // Follow redirects MANUALLY so every hop — the original URL and each target
    // — is SSRF-validated before we connect (a public URL can redirect inward).
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertFetchableUrl(current); // throws on private/non-http -> caught -> null

      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }

      // Final response. Non-2xx, the 202 anti-bot challenge, or a suspiciously
      // large body — treat all as "blocked".
      if (!response.ok || response.status === 202) return null;
      if (exceedsSizeLimit(response.headers.get("content-length"))) return null;

      const html = await response.text();
      if (!html || !looksLikeRealPage(html)) return null;

      return parseListing(html, url);
    }

    return null; // too many redirects
  } catch {
    // AbortError (timeout), DNS/connection errors, SSRF rejections, etc.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch a listing URL server-side and parse it into a ParsedListing.
 *
 * Tries each User-Agent for the URL's source in turn (Booking gets a chain of
 * independent social-crawler UAs; other sources get one browser UA), returning
 * the first that yields a real page.
 *
 * @returns `{ parsed, status }`. status is "ok" only when a real page was read
 *          and parsed; it is "failed" when every attempt was a non-ok/202
 *          response, timeout, network error, empty body, over-sized body, or
 *          anti-bot challenge. Even on "failed", `parsed.title` may be derived
 *          from the URL. Always resolves.
 */
export async function fetchAndParse(
  url: string,
): Promise<{ parsed: ParsedListing; status: "ok" | "failed" }> {
  const source = detectSource(url);

  for (const userAgent of userAgentsFor(source)) {
    const parsed = await attempt(url, userAgent);
    if (parsed) return { parsed, status: "ok" };
  }

  // Every attempt was blocked. For Booking that means the social-crawler
  // whitelist this fix relies on may have changed — surface it in logs so the
  // breakage is visible instead of silently degrading to slug-only titles.
  if (source === "booking") {
    console.warn(
      `[fetch-listing] Booking returned no parseable page for ${url} — ` +
        `the social-crawler whitelist may have changed.`,
    );
  }

  // A failed fetch still yields whatever the URL itself can tell us (title).
  return { parsed: parseListing("", url), status: "failed" };
}
