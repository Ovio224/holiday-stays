import { describe, it, expect } from "vitest";
import {
  userAgentsFor,
  looksLikeRealPage,
  exceedsSizeLimit,
} from "@/lib/parsing/fetch-listing";

// Booking.com answers ordinary browser/bot User-Agents with a JavaScript
// anti-bot challenge (HTTP 202) that a plain server-side fetch can never solve.
// It DOES whitelist social link-preview crawlers and serve them the full static
// page. Empirically (this session) facebookexternalhit, Slackbot AND WhatsApp
// all bypass; Discord/Telegram/LinkedIn/reddit/Embedly/Googlebot/Twitterbot are
// all challenged. So Booking gets an ordered chain of proven-good crawler UAs
// (primary + an independent fallback); every other source keeps the desktop
// browser UA (Airbnb 403s the social crawler).
describe("userAgentsFor", () => {
  it("returns an ordered chain of social-crawler UAs for Booking (primary + fallback)", () => {
    const uas = userAgentsFor("booking");
    expect(uas.length).toBeGreaterThanOrEqual(2);
    expect(uas[0]).toMatch(/facebookexternalhit/i);
    // The fallback should be an independent vendor (Slack, not another Meta bot).
    expect(uas.some((u) => /slack/i.test(u))).toBe(true);
  });

  it("returns a single desktop-browser UA for Airbnb (which blocks the social crawler)", () => {
    const uas = userAgentsFor("airbnb");
    expect(uas).toHaveLength(1);
    expect(uas[0]).toMatch(/Chrome/);
    expect(uas[0]).not.toMatch(/facebookexternalhit/i);
  });

  it("returns a single desktop-browser UA for other/unknown sources", () => {
    const uas = userAgentsFor("other");
    expect(uas).toHaveLength(1);
    expect(uas[0]).toMatch(/Chrome/);
  });
});

// looksLikeRealPage is the defensive guard that rejects anti-bot/empty shells
// when the HTTP status didn't already (e.g. a 200 that's actually a challenge).
describe("looksLikeRealPage", () => {
  it("accepts a page carrying og:title", () => {
    expect(looksLikeRealPage('<meta property="og:title" content="X" />')).toBe(true);
  });

  it("accepts a page carrying JSON-LD", () => {
    expect(
      looksLikeRealPage('<script type="application/ld+json">{}</script>'),
    ).toBe(true);
  });

  it("accepts a page with a non-empty <title>", () => {
    expect(looksLikeRealPage("<title>Real Hotel</title>")).toBe(true);
  });

  it("rejects an EMPTY <title></title> shell with no other signals", () => {
    // Regression: the old /<title[^>]*>\s*\S/i matched here because \S matched
    // the "<" of the closing tag.
    expect(
      looksLikeRealPage("<html><head><title></title></head><body></body></html>"),
    ).toBe(false);
  });

  it("rejects a whitespace-only <title>", () => {
    expect(looksLikeRealPage("<title>   </title>")).toBe(false);
  });

  it("rejects an empty shell", () => {
    expect(looksLikeRealPage("<html><body></body></html>")).toBe(false);
  });
});

// A guard against buffering a huge (possibly malicious) response into memory.
// Real Booking/Airbnb pages are ~350KB-1.4MB; anything multi-MB is suspect.
describe("exceedsSizeLimit", () => {
  it("allows a normal page size", () => {
    expect(exceedsSizeLimit(String(1_400_000))).toBe(false);
  });

  it("rejects a multi-megabyte content-length", () => {
    expect(exceedsSizeLimit(String(50 * 1024 * 1024))).toBe(true);
  });

  it("allows when content-length is missing or unparseable (unknown)", () => {
    expect(exceedsSizeLimit(null)).toBe(false);
    expect(exceedsSizeLimit("not-a-number")).toBe(false);
  });
});
