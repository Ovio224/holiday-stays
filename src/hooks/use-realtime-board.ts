"use client";

// Realtime board state. Seeds from server-rendered data, then keeps the
// accommodations + members live by subscribing to Postgres changes via the
// Supabase anon (browser) client. Votes are nested inside their accommodation,
// so vote events are routed to the right accommodation by accommodation_id.
//
// Robustness notes:
// - Events can arrive out of order. We always reconcile by id (replace-or-insert)
//   rather than assuming an INSERT precedes its UPDATEs.
// - An accommodation INSERT/UPDATE must never clobber the votes we already hold,
//   because the realtime payload for `accommodations` has no votes column.

import { useEffect, useState } from "react";

import { getBrowserClient } from "@/lib/supabase/browser";
import type {
  Accommodation,
  AccommodationWithVotes,
  Member,
  Vote,
} from "@/lib/types";

// Minimal, locally-controlled shape of a postgres_changes payload. We avoid
// supabase-js's generic RealtimePostgresChangesPayload<T> because its
// `T extends { [key: string]: any }` constraint isn't satisfiable by plain
// interfaces (they have no implicit index signature), and referencing our
// interfaces in the callback's param position would force that broken
// inference. Instead the callbacks accept this index-signature shape (a clean
// structural supertype of supabase's payload) and we cast `new`/`old` to the
// concrete domain type inside each handler.
type ChangePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: { [key: string]: unknown };
  old: { [key: string]: unknown };
};

interface UseRealtimeBoardArgs {
  initialAccommodations: AccommodationWithVotes[];
  initialMembers: Member[];
}

interface UseRealtimeBoardResult {
  accommodations: AccommodationWithVotes[];
  members: Member[];
}

/** Upsert an accommodation row while preserving its existing votes array. */
function upsertAccommodation(
  list: AccommodationWithVotes[],
  row: Accommodation,
): AccommodationWithVotes[] {
  const existing = list.find((a) => a.id === row.id);
  if (existing) {
    // Merge new columns over the old, but keep the votes we already have.
    return list.map((a) =>
      a.id === row.id ? { ...a, ...row, votes: a.votes } : a,
    );
  }
  // Brand-new accommodation: no votes yet.
  return [...list, { ...row, votes: [] }];
}

/** Apply a vote insert/update to the matching accommodation's votes array. */
function upsertVote(
  list: AccommodationWithVotes[],
  vote: Vote,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (a.id !== vote.accommodation_id) return a;
    const hasVote = a.votes.some((v) => v.id === vote.id);
    const votes = hasVote
      ? a.votes.map((v) => (v.id === vote.id ? vote : v))
      : [...a.votes, vote];
    return { ...a, votes };
  });
}

/** Remove a vote (by id) from whichever accommodation holds it. */
function removeVote(
  list: AccommodationWithVotes[],
  voteId: string,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (!a.votes.some((v) => v.id === voteId)) return a;
    return { ...a, votes: a.votes.filter((v) => v.id !== voteId) };
  });
}

export function useRealtimeBoard({
  initialAccommodations,
  initialMembers,
}: UseRealtimeBoardArgs): UseRealtimeBoardResult {
  const [accommodations, setAccommodations] =
    useState<AccommodationWithVotes[]>(initialAccommodations);
  const [members, setMembers] = useState<Member[]>(initialMembers);

  // Re-seed if the server hands us a fresh snapshot (e.g. after navigation).
  useEffect(() => {
    setAccommodations(initialAccommodations);
  }, [initialAccommodations]);
  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  useEffect(() => {
    const supabase = getBrowserClient();

    const channel = supabase
      .channel("trip-board")
      // --- accommodations -------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accommodations" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<Accommodation>).id;
            if (!oldId) return;
            setAccommodations((prev) => prev.filter((a) => a.id !== oldId));
            return;
          }
          // INSERT or UPDATE → upsert by id, preserving votes.
          const row = payload.new as unknown as Accommodation;
          if (!row?.id) return;
          setAccommodations((prev) => upsertAccommodation(prev, row));
        },
      )
      // --- votes ----------------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<Vote>).id;
            if (!oldId) return;
            setAccommodations((prev) => removeVote(prev, oldId));
            return;
          }
          const vote = payload.new as unknown as Vote;
          if (!vote?.id) return;
          setAccommodations((prev) => upsertVote(prev, vote));
        },
      )
      // --- members --------------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members" },
        (payload: ChangePayload) => {
          if (payload.eventType === "INSERT") {
            const member = payload.new as unknown as Member;
            if (!member?.id) return;
            setMembers((prev) =>
              prev.some((m) => m.id === member.id) ? prev : [...prev, member],
            );
          }
        },
      )
      .subscribe();

    return () => {
      // Tear down the websocket subscription on unmount.
      supabase.removeChannel(channel);
    };
  }, []);

  return { accommodations, members };
}
