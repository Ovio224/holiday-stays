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

import { useCallback, useEffect, useState } from "react";

import { getBrowserClient } from "@/lib/supabase/browser";
import type {
  Accommodation,
  AccommodationComment,
  AccommodationPrice,
  AccommodationWithVotes,
  Member,
  Place,
  Stay,
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
  initialStays: Stay[];
  initialAccommodations: AccommodationWithVotes[];
  initialMembers: Member[];
  initialPlaces: Place[];
}

interface UseRealtimeBoardResult {
  stays: Stay[];
  accommodations: AccommodationWithVotes[];
  members: Member[];
  places: Place[];
  /**
   * Imperatively merge a stay the caller just wrote (the return value of a
   * create/update server action) into local state, without waiting for the
   * realtime round-trip. Keyed by id, so the realtime echo that follows is an
   * idempotent no-op. This is what lets the acting user see their own edit
   * instantly — even if the stays table isn't in the realtime publication.
   */
  applyStayUpsert: (stay: Stay) => void;
  /** Imperatively drop a stay the caller just deleted (same rationale). */
  applyStayRemoval: (stayId: string) => void;
  /** Imperatively merge a place the caller just wrote (same rationale as stays). */
  applyPlaceUpsert: (place: Place) => void;
  /** Imperatively drop a place the caller just deleted. */
  applyPlaceRemoval: (placeId: string) => void;
}

/** Upsert a stay row by id (replace-or-insert), tolerant of out-of-order events. */
function upsertStay(list: Stay[], row: Stay): Stay[] {
  const existing = list.some((s) => s.id === row.id);
  return existing
    ? list.map((s) => (s.id === row.id ? row : s))
    : [...list, row];
}

/** Remove a stay (by id). */
function removeStay(list: Stay[], stayId: string): Stay[] {
  return list.filter((s) => s.id !== stayId);
}

/** Upsert a place row by id (replace-or-insert), tolerant of out-of-order events. */
function upsertPlace(list: Place[], row: Place): Place[] {
  const existing = list.some((p) => p.id === row.id);
  return existing ? list.map((p) => (p.id === row.id ? row : p)) : [...list, row];
}

/** Remove a place (by id). */
function removePlace(list: Place[], placeId: string): Place[] {
  return list.filter((p) => p.id !== placeId);
}

/**
 * Upsert an accommodation row while preserving its existing votes + prices +
 * comments. The realtime payload for `accommodations` carries none of those nested
 * columns, so an INSERT/UPDATE must never clobber the relations we already hold.
 */
function upsertAccommodation(
  list: AccommodationWithVotes[],
  row: Accommodation,
): AccommodationWithVotes[] {
  const existing = list.find((a) => a.id === row.id);
  if (existing) {
    // Merge new columns over the old, but keep the nested relations we already have.
    return list.map((a) =>
      a.id === row.id
        ? { ...a, ...row, votes: a.votes, prices: a.prices, comments: a.comments }
        : a,
    );
  }
  // Brand-new accommodation: no votes, prices, or comments yet.
  return [...list, { ...row, votes: [], prices: [], comments: [] }];
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

/** Apply a price insert/update to the matching accommodation's prices array. */
function upsertPrice(
  list: AccommodationWithVotes[],
  price: AccommodationPrice,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (a.id !== price.accommodation_id) return a;
    const hasPrice = a.prices.some((p) => p.id === price.id);
    const prices = hasPrice
      ? a.prices.map((p) => (p.id === price.id ? price : p))
      : [...a.prices, price];
    return { ...a, prices };
  });
}

/** Remove a price (by id) from whichever accommodation holds it. */
function removePrice(
  list: AccommodationWithVotes[],
  priceId: string,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (!a.prices.some((p) => p.id === priceId)) return a;
    return { ...a, prices: a.prices.filter((p) => p.id !== priceId) };
  });
}

/** Apply a comment insert/update to the matching accommodation's thread. */
function upsertComment(
  list: AccommodationWithVotes[],
  comment: AccommodationComment,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (a.id !== comment.accommodation_id) return a;
    const hasComment = a.comments.some((c) => c.id === comment.id);
    const comments = hasComment
      ? a.comments.map((c) => (c.id === comment.id ? comment : c))
      : [...a.comments, comment];
    return { ...a, comments };
  });
}

/** Remove a comment (by id) from whichever accommodation holds it. */
function removeComment(
  list: AccommodationWithVotes[],
  commentId: string,
): AccommodationWithVotes[] {
  return list.map((a) => {
    if (!a.comments.some((c) => c.id === commentId)) return a;
    return { ...a, comments: a.comments.filter((c) => c.id !== commentId) };
  });
}

export function useRealtimeBoard({
  initialStays,
  initialAccommodations,
  initialMembers,
  initialPlaces,
}: UseRealtimeBoardArgs): UseRealtimeBoardResult {
  const [stays, setStays] = useState<Stay[]>(initialStays);
  const [accommodations, setAccommodations] =
    useState<AccommodationWithVotes[]>(initialAccommodations);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [places, setPlaces] = useState<Place[]>(initialPlaces);

  // Imperative, locally-applied mutations for the acting user. They run through
  // the very same reducers the realtime handlers use, so applying a freshly
  // written row here and later receiving its realtime echo converge to the same
  // state (replace-or-insert / remove are both idempotent by id).
  const applyStayUpsert = useCallback(
    (stay: Stay) => setStays((prev) => upsertStay(prev, stay)),
    [],
  );
  const applyStayRemoval = useCallback(
    (stayId: string) => setStays((prev) => removeStay(prev, stayId)),
    [],
  );
  const applyPlaceUpsert = useCallback(
    (place: Place) => setPlaces((prev) => upsertPlace(prev, place)),
    [],
  );
  const applyPlaceRemoval = useCallback(
    (placeId: string) => setPlaces((prev) => removePlace(prev, placeId)),
    [],
  );

  // State seeds once from the server snapshot (the useState initializers above);
  // after mount the realtime subscription below is the source of truth. Landing
  // on the board is always a fresh navigation that remounts this hook, so a new
  // server snapshot is picked up naturally — no re-seeding effect needed (and
  // re-seeding would risk clobbering a freshly-applied realtime change).

  useEffect(() => {
    const supabase = getBrowserClient();

    const channel = supabase
      .channel("trip-board")
      // --- stays ----------------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "stays" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<Stay>).id;
            if (!oldId) return;
            setStays((prev) => removeStay(prev, oldId));
            return;
          }
          // INSERT or UPDATE → upsert by id (replace-or-insert).
          const row = payload.new as unknown as Stay;
          if (!row?.id) return;
          setStays((prev) => upsertStay(prev, row));
        },
      )
      // --- accommodations -------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "accommodations" },
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
        { event: "*", schema: "bali", table: "votes" },
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
      // --- accommodation_prices (per-member prices) -----------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "accommodation_prices" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<AccommodationPrice>).id;
            if (!oldId) return;
            setAccommodations((prev) => removePrice(prev, oldId));
            return;
          }
          const price = payload.new as unknown as AccommodationPrice;
          if (!price?.id) return;
          setAccommodations((prev) => upsertPrice(prev, price));
        },
      )
      // --- accommodation_comments (per-card discussion) -------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "accommodation_comments" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<AccommodationComment>).id;
            if (!oldId) return;
            setAccommodations((prev) => removeComment(prev, oldId));
            return;
          }
          const comment = payload.new as unknown as AccommodationComment;
          if (!comment?.id) return;
          setAccommodations((prev) => upsertComment(prev, comment));
        },
      )
      // --- places (per-leg points of interest) ----------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "places" },
        (payload: ChangePayload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as Partial<Place>).id;
            if (!oldId) return;
            setPlaces((prev) => removePlace(prev, oldId));
            return;
          }
          const row = payload.new as unknown as Place;
          if (!row?.id) return;
          setPlaces((prev) => upsertPlace(prev, row));
        },
      )
      // --- members --------------------------------------------------------
      .on(
        "postgres_changes",
        { event: "*", schema: "bali", table: "members" },
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

  return {
    stays,
    accommodations,
    members,
    places,
    applyStayUpsert,
    applyStayRemoval,
    applyPlaceUpsert,
    applyPlaceRemoval,
  };
}
