"use server";

/**
 * Per-member price Server Action.
 *
 * Each member records the real price THEY see for an accommodation. Like every
 * mutating action here it calls assertGate() FIRST (the gate cookie is the only
 * authorization boundary) and writes through the service-role client (the browser
 * anon key is SELECT-only). Input validation is delegated to the pure
 * preparePriceInput() helper so it's unit-testable without a DB.
 *
 * The DB enforces one price per (accommodation, member) via a unique constraint
 * and defaults updated_at itself. Amounts are per night.
 */
import { assertGate } from "@/lib/gate/assert";
import { getServiceClient } from "@/lib/supabase/server";
import { preparePriceInput } from "@/lib/prices";

/**
 * Set (or clear) a member's personal price for an accommodation.
 *
 *  - amount == null → delete this member's price row (back to "no price yet"),
 *    mirroring how castVote toggles a vote off.
 *  - otherwise → upsert, conflicting on (accommodation_id, member_id) so an
 *    updated price overwrites the previous row in place.
 */
export async function setPrice(input: {
  accommodationId: string;
  memberId: string;
  amount: number | null;
  note?: string | null;
  currency?: string | null;
}): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();

  // Clearing the price: remove this member's row (no-op if none exists).
  if (input.amount == null) {
    const { error } = await supabase
      .from("accommodation_prices")
      .delete()
      .eq("accommodation_id", input.accommodationId)
      .eq("member_id", input.memberId);

    if (error) {
      throw new Error(`Failed to clear price: ${error.message}`);
    }
    return;
  }

  // Validate + normalize before writing (throws a friendly Error on bad input).
  const normalized = preparePriceInput({
    amount: input.amount,
    note: input.note,
    currency: input.currency,
  });

  const { error } = await supabase.from("accommodation_prices").upsert(
    {
      accommodation_id: input.accommodationId,
      member_id: input.memberId,
      amount: normalized.amount,
      note: normalized.note,
      currency: normalized.currency,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "accommodation_id,member_id" },
  );

  if (error) {
    throw new Error(`Failed to save price: ${error.message}`);
  }
}
