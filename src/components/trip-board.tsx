"use client";

// The live board. Seeds from server-rendered data, then stays realtime via
// useRealtimeBoard. Groups accommodations under their stay, renders each stay
// as a StaySection, and owns the "add a place" bottom-sheet.

import * as React from "react";
import { PlusIcon } from "lucide-react";

import type { Stay, AccommodationWithVotes, Member } from "@/lib/types";
import { useRealtimeBoard } from "@/hooks/use-realtime-board";
import { StaySection } from "@/components/stay-section";
import { SubmitSheet } from "@/components/submit-sheet";

interface TripBoardProps {
  initialStays: Stay[];
  initialAccommodations: AccommodationWithVotes[];
  members: Member[];
  currentMemberId: string | null;
  tripRange: string;
}

export function TripBoard({
  initialStays,
  initialAccommodations,
  members,
  currentMemberId,
  tripRange,
}: TripBoardProps) {
  // Live accommodations + members; stays are static for the session.
  const { accommodations, members: liveMembers } = useRealtimeBoard({
    initialAccommodations,
    initialMembers: members,
  });

  // Live counts for the header so they update with realtime additions.
  const friendCount = liveMembers.length;
  const placeCount = accommodations.length;

  // Submit-sheet state. submitStayId pre-selects a stay when the user taps a
  // section's "+"; the floating button opens it with no preset.
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [submitStayId, setSubmitStayId] = React.useState<string | null>(null);

  // Open the sheet pre-targeting a specific stay (from a StaySection).
  const openSubmitFor = React.useCallback((stayId: string) => {
    setSubmitStayId(stayId);
    setSubmitOpen(true);
  }, []);

  // Open the sheet with no preset (from the floating button).
  const openSubmitBlank = React.useCallback(() => {
    setSubmitStayId(null);
    setSubmitOpen(true);
  }, []);

  // Stays in display order.
  const sortedStays = React.useMemo(
    () => [...initialStays].sort((a, b) => a.sort_order - b.sort_order),
    [initialStays],
  );

  // Bucket accommodations by stay_id once per change.
  const byStay = React.useMemo(() => {
    const map = new Map<string, AccommodationWithVotes[]>();
    for (const acc of accommodations) {
      const bucket = map.get(acc.stay_id);
      if (bucket) {
        bucket.push(acc);
      } else {
        map.set(acc.stay_id, [acc]);
      }
    }
    return map;
  }, [accommodations]);

  return (
    <div className="relative">
      <header className="mx-auto mb-8 w-full max-w-2xl px-4 text-center sm:px-6">
        <p className="mb-2 text-sm font-medium tracking-wide text-foreground/60 uppercase">
          {friendCount === 1
            ? "Just you, for now"
            : `${friendCount} friends · ${placeCount} ${placeCount === 1 ? "place" : "places"}`}
        </p>
        <h1 className="font-heading text-5xl font-extrabold text-gradient-sunset sm:text-6xl">
          Bali Stays
        </h1>
        <p className="mt-3 text-base text-foreground/70 sm:text-lg">
          Drop the places you love, vote yes or no, and let&rsquo;s find our
          home base together. 🌴
        </p>
        {tripRange && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-card/60 px-4 py-1.5 text-sm font-medium text-foreground/80 ring-1 ring-foreground/10 backdrop-blur">
            🗓️ {tripRange}
          </p>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-32 sm:px-6">
        {sortedStays.map((stay) => (
          <StaySection
            key={stay.id}
            stay={stay}
            accommodations={byStay.get(stay.id) ?? []}
            members={liveMembers}
            currentMemberId={currentMemberId}
            onAdd={openSubmitFor}
          />
        ))}
      </div>

      {/* Floating "add a place" action — bottom-right, thumb-friendly. */}
      <button
        type="button"
        onClick={openSubmitBlank}
        aria-label="Add a place"
        className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-14 items-center gap-2 rounded-full bg-grad-sunset pr-5 pl-4 text-base font-semibold text-white shadow-xl shadow-sunset/30 transition-transform active:translate-y-px sm:right-8 sm:bottom-8"
      >
        <PlusIcon className="size-6" />
        <span className="pr-0.5">Add a place</span>
      </button>

      <SubmitSheet
        stays={initialStays}
        currentMemberId={currentMemberId}
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        defaultStayId={submitStayId}
      />
    </div>
  );
}
