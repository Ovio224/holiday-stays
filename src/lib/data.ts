// Server-side read helpers. These use the service-role client (bypasses RLS) so
// they MUST only run on the server — never import this from a client component.

import { getServiceClient } from "@/lib/supabase/server";
import type {
  Stay,
  Member,
  Accommodation,
  AccommodationComment,
  AccommodationPrice,
  Vote,
  AccommodationWithVotes,
} from "@/lib/types";

/** All trip legs ("stays"), ordered by manual sort then creation time. */
export async function getStays(): Promise<Stay[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("stays")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load stays: ${error.message}`);
  }

  return (data ?? []) as Stay[];
}

/** All members of the trip group, oldest first. */
export async function getMembers(): Promise<Member[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load members: ${error.message}`);
  }

  return (data ?? []) as Member[];
}

// Shape of an accommodation row with its joined votes + per-member prices.
// `select("*, votes(*), accommodation_prices(*)")` returns every column — incl.
// `price_per_night`, `currency`, and the `details` jsonb. The embedded relations
// may come back as null/undefined from PostgREST, so we normalize them to arrays.
type AccommodationRow = Accommodation & {
  votes: Vote[] | null;
  accommodation_prices: AccommodationPrice[] | null;
};

/**
 * Everything the board needs in one shot: stays, accommodations (with their
 * votes joined in), and members. Runs the three queries concurrently.
 */
export async function getBoardData(): Promise<{
  stays: Stay[];
  accommodations: AccommodationWithVotes[];
  members: Member[];
}> {
  const supabase = getServiceClient();

  // Comments are loaded as a SEPARATE query (not a PostgREST embed) so the board
  // never hard-fails if the bali.accommodation_comments table hasn't been applied
  // to this database yet — a missing relation just degrades to an empty thread.
  // (Embeds fail the whole accommodations query; a standalone error doesn't.)
  const [staysResult, accommodationsResult, membersResult, commentsResult] =
    await Promise.all([
      supabase
        .from("stays")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("accommodations")
        .select("*, votes(*), accommodation_prices(*)")
        .order("created_at", { ascending: true }),
      supabase
        .from("members")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("accommodation_comments")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

  if (staysResult.error) {
    throw new Error(`Failed to load stays: ${staysResult.error.message}`);
  }
  if (accommodationsResult.error) {
    throw new Error(
      `Failed to load accommodations: ${accommodationsResult.error.message}`,
    );
  }
  if (membersResult.error) {
    throw new Error(`Failed to load members: ${membersResult.error.message}`);
  }

  const stays = (staysResult.data ?? []) as Stay[];
  const members = (membersResult.data ?? []) as Member[];

  // Bucket comments by accommodation. A query error (e.g. the table isn't applied
  // here yet) is non-fatal: we log once and fall back to no comments rather than
  // breaking the whole board.
  if (commentsResult.error) {
    console.warn(
      `Comments unavailable (continuing without them): ${commentsResult.error.message}`,
    );
  }
  const commentsByAccommodation = new Map<string, AccommodationComment[]>();
  for (const comment of (commentsResult.data ?? []) as AccommodationComment[]) {
    const bucket = commentsByAccommodation.get(comment.accommodation_id);
    if (bucket) bucket.push(comment);
    else commentsByAccommodation.set(comment.accommodation_id, [comment]);
  }

  // Ensure votes + prices + comments are always arrays, even if PostgREST returns null.
  const accommodations: AccommodationWithVotes[] = (
    (accommodationsResult.data ?? []) as AccommodationRow[]
  ).map(({ accommodation_prices, ...row }) => ({
    ...row,
    votes: row.votes ?? [],
    prices: accommodation_prices ?? [],
    comments: commentsByAccommodation.get(row.id) ?? [],
  }));

  return { stays, accommodations, members };
}
