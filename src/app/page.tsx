// The board — home of the app. Server component: loads the current member and
// the full board snapshot, gates on identity, then hands everything to the live
// <TripBoard />. Always dynamic so each visitor sees fresh, per-request data.

import { redirect } from "next/navigation";

import { getCurrentMemberId } from "@/lib/identity";
import { getBoardData } from "@/lib/data";
import { formatDateRange } from "@/lib/format";
import { TripBoard } from "@/components/trip-board";

// Per-request data (cookies + live board) — never statically cached.
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const memberId = await getCurrentMemberId();
  const { stays, accommodations, members } = await getBoardData();

  // No identity (or a stale cookie pointing at a deleted member) → choose a name.
  if (!memberId || !members.some((m) => m.id === memberId)) {
    redirect("/name");
  }

  // A friendly trip-dates summary spanning the first → last stay, when known.
  const tripRange = computeTripRange(stays);

  return (
    <main className="flex min-h-dvh flex-col pt-12 pb-6 sm:pt-16">
      {/* The header (with its live friends/places counts) lives inside TripBoard
          so the counts track realtime additions, not just the initial render. */}
      <TripBoard
        initialStays={stays}
        initialAccommodations={accommodations}
        members={members}
        currentMemberId={memberId}
        tripRange={tripRange}
      />
    </main>
  );
}

/**
 * Build a single date range covering the whole trip: earliest start_date to
 * latest end_date across all stays. Returns "" when no dated stays exist.
 */
function computeTripRange(
  stays: { start_date: string | null; end_date: string | null }[],
): string {
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const stay of stays) {
    if (stay.start_date && (!earliest || stay.start_date < earliest)) {
      earliest = stay.start_date;
    }
    if (stay.end_date && (!latest || stay.end_date > latest)) {
      latest = stay.end_date;
    }
  }

  return formatDateRange(earliest, latest);
}
