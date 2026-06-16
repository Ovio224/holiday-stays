"use server";

/**
 * Accommodation Server Actions — submit and delete listings.
 *
 * Submitting kicks off a best-effort server-side parse of the link (title,
 * image, price) so cards look rich without manual data entry. Parsing must
 * never block or break submission, so any failure degrades gracefully to a
 * "failed" status with empty metadata. Both actions are gated.
 */
import { assertGate } from "@/lib/gate/assert";
import { detectSource } from "@/lib/parsing/source";
import { fetchAndParse } from "@/lib/parsing/fetch-listing";
import { getServiceClient } from "@/lib/supabase/server";
import type { Accommodation, ParseStatus } from "@/lib/types";

/**
 * Submit a new accommodation link into a stay.
 *
 * Validates the URL is http(s), detects its source, then attempts to parse the
 * page. User-provided fields always win over parsed ones. When the user types a
 * title manually, we mark parse_status "manual" to signal the card was curated
 * rather than auto-scraped.
 */
export async function submitAccommodation(input: {
  url: string;
  stayId: string;
  memberId: string;
  title?: string;
  priceText?: string;
  notes?: string;
}): Promise<Accommodation> {
  await assertGate();

  const url = input.url.trim();
  // Only accept real web links — anything else (javascript:, mailto:, garbage)
  // is rejected before we ever try to fetch it.
  let isHttp = false;
  try {
    const protocol = new URL(url).protocol;
    isHttp = protocol === "http:" || protocol === "https:";
  } catch {
    isHttp = false;
  }
  if (!isHttp) {
    throw new Error("Please provide a valid http(s) link.");
  }

  const source = detectSource(url);

  // Best-effort parse. fetchAndParse never throws, but we still guard the call
  // so a totally unexpected failure can't block a submission.
  let parsed = { title: null, imageUrl: null, priceText: null, description: null } as {
    title: string | null;
    imageUrl: string | null;
    priceText: string | null;
    description: string | null;
  };
  let status: "ok" | "failed" = "failed";
  try {
    const result = await fetchAndParse(url);
    parsed = result.parsed;
    status = result.status;
  } catch {
    // Leave the safe defaults in place.
  }

  const manualTitle = input.title?.trim();
  // A manually supplied title means the user curated this card themselves.
  const parseStatus: ParseStatus = manualTitle ? "manual" : status;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("accommodations")
    .insert({
      stay_id: input.stayId,
      url,
      source,
      title: manualTitle || parsed.title,
      image_url: parsed.imageUrl,
      price_text: input.priceText?.trim() || parsed.priceText,
      notes: input.notes?.trim() || null,
      submitted_by: input.memberId,
      parse_status: parseStatus,
      parsed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to submit accommodation: ${error?.message ?? "no data"}`,
    );
  }

  return data as Accommodation;
}

/**
 * Delete an accommodation (and, via DB cascade, its votes) by id.
 */
export async function deleteAccommodation(id: string): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();
  const { error } = await supabase.from("accommodations").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete accommodation: ${error.message}`);
  }
}
