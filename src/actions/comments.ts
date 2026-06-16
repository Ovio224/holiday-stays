"use server";

/**
 * Comment Server Actions — the per-card discussion thread.
 *
 * A member can leave many comments on an accommodation (no one-per-member
 * constraint, unlike votes/prices), so the group can say WHY they're leaning
 * yes/no. Like every mutating action here each one calls assertGate() FIRST (the
 * gate cookie is the only authorization boundary) and writes through the
 * service-role client (the browser anon key is SELECT-only). Body validation is
 * delegated to the pure prepareCommentBody() helper so it's unit-testable.
 *
 * There is no per-author ownership check in the DB (this is a small, trusted,
 * shared board — parity with editing legs/accommodations). The UI only offers
 * edit/delete on your own comments; the actions trust a gated caller.
 */
import { assertGate } from "@/lib/gate/assert";
import { getServiceClient } from "@/lib/supabase/server";
import { prepareCommentBody } from "@/lib/comments";
import type { AccommodationComment } from "@/lib/types";

/** Post a new comment on an accommodation. Returns the created row. */
export async function addComment(input: {
  accommodationId: string;
  memberId: string;
  body: string;
}): Promise<AccommodationComment> {
  await assertGate();

  const body = prepareCommentBody(input.body);
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("accommodation_comments")
    .insert({
      accommodation_id: input.accommodationId,
      member_id: input.memberId,
      body,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to post comment: ${error.message}`);
  }
  return data as AccommodationComment;
}

/** Edit an existing comment's body. Returns the updated row. */
export async function updateComment(input: {
  id: string;
  body: string;
}): Promise<AccommodationComment> {
  await assertGate();

  const body = prepareCommentBody(input.body);
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("accommodation_comments")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save comment: ${error.message}`);
  }
  return data as AccommodationComment;
}

/** Delete a comment by id. */
export async function deleteComment(input: { id: string }): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("accommodation_comments")
    .delete()
    .eq("id", input.id);

  if (error) {
    throw new Error(`Failed to delete comment: ${error.message}`);
  }
}
