// Server-side read helpers. These use the service-role client (bypasses RLS) so
// they MUST only run on the server — never import this from a client component.

import { getServiceClient } from "@/lib/supabase/server";
import type {
  Stay,
  Member,
  Accommodation,
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

// Shape of an accommodation row with its joined votes. `select("*, votes(*)")`
// returns every column — including the new `price_per_night`, `currency`, and
// the `details` jsonb (decoded to a ListingDetails object or null via the
// Accommodation type). The votes relation may come back as null/undefined from
// PostgREST, so we normalize it to an array below.
type AccommodationRow = Accommodation & { votes: Vote[] | null };

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

  const [staysResult, accommodationsResult, membersResult] = await Promise.all([
    supabase
      .from("stays")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("accommodations")
      .select("*, votes(*)")
      .order("created_at", { ascending: true }),
    supabase
      .from("members")
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

  // Ensure votes is always an array, even if PostgREST returns null.
  const accommodations: AccommodationWithVotes[] = (
    (accommodationsResult.data ?? []) as AccommodationRow[]
  ).map((row) => ({
    ...row,
    votes: row.votes ?? [],
  }));

  return { stays, accommodations, members };
}
