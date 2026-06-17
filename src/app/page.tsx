// The board — home of the app. Server component: loads the current member and
// the full board snapshot, gates on identity, then hands everything to the live
// <TripBoard />. Always dynamic so each visitor sees fresh, per-request data.

import { redirect } from "next/navigation";

import { getCurrentMemberId } from "@/lib/identity";
import { getBoardData } from "@/lib/data";
import { env } from "@/lib/env";
import { TripBoard } from "@/components/trip-board";

// Per-request data (cookies + live board) — never statically cached.
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const memberId = await getCurrentMemberId();
  const { stays, accommodations, members, places } = await getBoardData();

  // No identity (or a stale cookie pointing at a deleted member) → choose a name.
  if (!memberId || !members.some((m) => m.id === memberId)) {
    redirect("/name");
  }

  return (
    <main className="flex min-h-dvh flex-col pt-12 pb-6 sm:pt-16">
      {/* The header (with its live friends/places counts) lives inside TripBoard
          so the counts — and the trip-dates banner — track realtime changes,
          not just the initial render. */}
      <TripBoard
        initialStays={stays}
        initialAccommodations={accommodations}
        members={members}
        initialPlaces={places}
        locationScoringEnabled={env.locationScoringEnabled()}
        currentMemberId={memberId}
      />
    </main>
  );
}
