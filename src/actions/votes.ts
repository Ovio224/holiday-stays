"use server";

/**
 * Voting Server Action.
 *
 * Each member casts a yes/no vote per accommodation. Voting is a toggle: tapping
 * the same value you already cast removes your vote (undecided), while a new or
 * opposite value upserts it. The DB enforces one vote per (accommodation,
 * member) via a unique constraint and defaults updated_at itself.
 */
import { assertGate } from "@/lib/gate/assert";
import { getServiceClient } from "@/lib/supabase/server";
import type { Vote } from "@/lib/types";

/**
 * Cast (or toggle) a member's vote on an accommodation.
 *
 *  - If an existing vote already matches the submitted value, delete it
 *    (toggle off -> back to undecided) and return null.
 *  - Otherwise upsert the vote, conflicting on (accommodation_id, member_id) so
 *    a flipped opinion overwrites the previous row in place, and return the row.
 *
 * The returned row (or null) lets the caller fold its own vote into board state
 * immediately, so the vote sticks without waiting for the realtime echo.
 */
export async function castVote(input: {
  accommodationId: string;
  memberId: string;
  value: boolean;
}): Promise<Vote | null> {
  await assertGate();

  const supabase = getServiceClient();

  // Look up any existing vote this member has on this accommodation.
  const { data: existing, error: selectError } = await supabase
    .from("votes")
    .select("id, value")
    .eq("accommodation_id", input.accommodationId)
    .eq("member_id", input.memberId)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to read vote: ${selectError.message}`);
  }

  // Tapping the same value again clears the vote (toggle off).
  if (existing && existing.value === input.value) {
    const { error: deleteError } = await supabase
      .from("votes")
      .delete()
      .eq("id", existing.id);

    if (deleteError) {
      throw new Error(`Failed to clear vote: ${deleteError.message}`);
    }
    return null;
  }

  // New vote or a changed opinion: upsert, letting the DB default updated_at.
  const { data, error: upsertError } = await supabase
    .from("votes")
    .upsert(
      {
        accommodation_id: input.accommodationId,
        member_id: input.memberId,
        value: input.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "accommodation_id,member_id" },
    )
    .select()
    .single();

  if (upsertError || !data) {
    throw new Error(`Failed to cast vote: ${upsertError?.message ?? "no data"}`);
  }

  return data as Vote;
}
