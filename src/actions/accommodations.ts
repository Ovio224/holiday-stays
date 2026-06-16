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
import {
  prepareAccommodationEdit,
  type AccommodationEditInput,
} from "@/lib/accommodations";
import { detectSource } from "@/lib/parsing/source";
import { fetchAndParse } from "@/lib/parsing/fetch-listing";
import { getServiceClient } from "@/lib/supabase/server";
import type {
  Accommodation,
  ListingDetails,
  ParsedListing,
  ParseStatus,
} from "@/lib/types";

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
  notes?: string;
  pricePerNight?: number;
  currency?: string;
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
  let parsed: ParsedListing = {
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
      // User-provided fields always win over the (usually absent) parsed ones.
      title: manualTitle || parsed.title,
      image_url: parsed.imageUrl,
      details: parsed.details, // jsonb
      price_per_night: input.pricePerNight ?? parsed.pricePerNight,
      currency: input.currency?.trim() || parsed.currency || "$",
      price_text: parsed.priceText, // legacy/display fallback
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
 * Edit an existing accommodation's user-curated fields: title, image URL, price,
 * currency, address, amenities, notes, and the capacity portion of `details`.
 *
 * Validation/normalization is delegated to the pure prepareAccommodationEdit()
 * helper so it's unit-testable without a DB. The capacity edits are MERGED into
 * the row's current `details` so parsed rating/reviews are never clobbered. When
 * the user supplies a title we flip parse_status to "manual" (mirroring submit
 * semantics for a curated card). Returns the updated row.
 */
export async function updateAccommodation(
  input: { id: string } & AccommodationEditInput,
): Promise<Accommodation> {
  await assertGate();

  const { id, ...rest } = input;
  const normalized = prepareAccommodationEdit(rest);

  const supabase = getServiceClient();

  // Fetch the current details so we can overlay only the edited capacity keys,
  // leaving parsed rating/reviews (and any unedited capacity field) intact.
  const { data: existing, error: fetchError } = await supabase
    .from("accommodations")
    .select("details")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    throw new Error(
      `Failed to load accommodation: ${fetchError?.message ?? "not found"}`,
    );
  }

  const currentDetails = (existing.details ?? {}) as Partial<ListingDetails>;
  const mergedDetails = { ...currentDetails, ...normalized.details };

  const update: Record<string, unknown> = {
    title: normalized.title,
    image_url: normalized.image_url,
    notes: normalized.notes,
    address: normalized.address,
    amenities: normalized.amenities,
    price_per_night: normalized.price_per_night,
    currency: normalized.currency,
    details: mergedDetails,
  };
  // A manually supplied title means the user curated this card themselves.
  if (normalized.title) {
    update.parse_status = "manual" satisfies ParseStatus;
  }

  const { data, error } = await supabase
    .from("accommodations")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update accommodation: ${error?.message ?? "no data"}`,
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
