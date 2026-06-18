"use client";

// The live board. Seeds from server-rendered data, then stays realtime via
// useRealtimeBoard. Groups accommodations under their stay, renders each stay
// as a StaySection, and owns the "add a place" bottom-sheet.

import * as React from "react";
import { CalendarDays, Plus, PlusIcon, Wallet } from "lucide-react";
import { toast } from "sonner";

import type { Stay, AccommodationWithVotes, Member, Place } from "@/lib/types";
import { formatMoney, nights, tripBudget, tripDateRange } from "@/lib/format";
import { reorderStay } from "@/actions/stays";
import { useRealtimeBoard } from "@/hooks/use-realtime-board";
import { StaySection } from "@/components/stay-section";
import { SubmitSheet } from "@/components/submit-sheet";
import { LegSheet } from "@/components/leg-sheet";

interface TripBoardProps {
  initialStays: Stay[];
  initialAccommodations: AccommodationWithVotes[];
  members: Member[];
  initialPlaces: Place[];
  /** Master flag — when off the board renders exactly as before (no places UI). */
  locationScoringEnabled: boolean;
  currentMemberId: string | null;
}

export function TripBoard({
  initialStays,
  initialAccommodations,
  members,
  initialPlaces,
  locationScoringEnabled,
  currentMemberId,
}: TripBoardProps) {
  // Everything live: stays, accommodations, members, and places all stream in via
  // the realtime subscription, so the board, banner, budget, and location scores
  // recompute together.
  const {
    stays,
    accommodations,
    members: liveMembers,
    places,
    applyStayUpsert,
    applyStayRemoval,
    applyPlaceUpsert,
    applyPlaceRemoval,
    applyAccommodationUpsert,
    applyAccommodationRemoval,
    applyVote,
  } = useRealtimeBoard({
    initialStays,
    initialAccommodations,
    initialMembers: members,
    initialPlaces,
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

  // Leg-editor state. editingStay null = create mode; a stay = edit mode. The
  // LegSheet is keyed on the target AND a per-open nonce, so it remounts (and
  // re-seeds its fields) on every open — including consecutive creates, which
  // would otherwise reuse the same "new" instance and keep the last values.
  const [legSheetOpen, setLegSheetOpen] = React.useState(false);
  const [editingStay, setEditingStay] = React.useState<Stay | null>(null);
  const [legSheetNonce, setLegSheetNonce] = React.useState(0);

  const openCreateLeg = React.useCallback(() => {
    setEditingStay(null);
    setLegSheetNonce((n) => n + 1);
    setLegSheetOpen(true);
  }, []);

  const openEditLeg = React.useCallback((stay: Stay) => {
    setEditingStay(stay);
    setLegSheetNonce((n) => n + 1);
    setLegSheetOpen(true);
  }, []);

  // Stays in display order, derived from live state (sort_order, then stable by
  // created_at to break ties from concurrent appends).
  const sortedStays = React.useMemo(
    () =>
      [...stays].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      ),
    [stays],
  );

  // Reorder a leg one step. Swap the two neighbours' sort_order in local state
  // immediately (optimistic) so the move is instant, then persist; the realtime
  // echo replays the same swap (idempotent by id). On failure, put the original
  // rows back so the UI never lies about what's saved.
  const moveLeg = React.useCallback(
    (id: string, direction: "up" | "down") => {
      const index = sortedStays.findIndex((s) => s.id === id);
      if (index === -1) return;
      const neighborIndex = direction === "up" ? index - 1 : index + 1;
      if (neighborIndex < 0 || neighborIndex >= sortedStays.length) return;

      const current = sortedStays[index];
      const neighbor = sortedStays[neighborIndex];

      // Optimistic swap of their sort_order values.
      applyStayUpsert({ ...current, sort_order: neighbor.sort_order });
      applyStayUpsert({ ...neighbor, sort_order: current.sort_order });

      void (async () => {
        try {
          await reorderStay(id, direction);
        } catch (error) {
          // Roll back to the pre-swap ordering.
          applyStayUpsert(current);
          applyStayUpsert(neighbor);
          const message =
            error instanceof Error ? error.message : "Could not reorder that leg.";
          toast.error(message);
        }
      })();
    },
    [sortedStays, applyStayUpsert],
  );

  // Live trip-dates banner: earliest start → latest end across live stays.
  const tripRange = React.useMemo(() => tripDateRange(stays), [stays]);

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

  // Bucket places by stay_id, sorted for display (sort_order, then created_at).
  const placesByStay = React.useMemo(() => {
    const map = new Map<string, Place[]>();
    for (const p of places) {
      const bucket = map.get(p.stay_id);
      if (bucket) bucket.push(p);
      else map.set(p.stay_id, [p]);
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
      );
    }
    return map;
  }, [places]);

  // Whole-trip budget estimate from the priced candidates in each leg.
  const budget = React.useMemo(
    () =>
      tripBudget(
        sortedStays.map((stay) => ({
          nights: nights(stay.start_date, stay.end_date),
          accommodations: byStay.get(stay.id) ?? [],
        })),
      ),
    [sortedStays, byStay],
  );

  return (
    <div className="relative overflow-x-clip">
      <header className="mx-auto mb-10 w-full max-w-2xl px-4 sm:px-6 lg:mb-16 lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          {/* Title + intro — capped to a comfortable reading measure. */}
          <div className="max-w-xl">
            <p className="mb-2 text-sm text-muted-foreground">
              {friendCount === 1
                ? "Just you, for now"
                : `${friendCount} friends · ${placeCount} ${placeCount === 1 ? "place" : "places"}`}
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-primary sm:text-5xl">
              Bali Stays
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              Add the places you love, vote yes or no, and find your home base
              together.
            </p>
          </div>

          {/* Trip meta — date range + live budget. Sits beside the title on
              desktop, stacks beneath it on mobile. */}
          {(tripRange || budget.leadingTotal != null) && (
            <div className="flex flex-col gap-3 lg:items-end">
              {tripRange && (
                <p className="inline-flex w-fit items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-sm font-medium text-foreground">
                  <CalendarDays
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {tripRange}
                </p>
              )}

              {budget.leadingTotal != null && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm lg:justify-end">
                  <span className="text-muted-foreground">
                    Estimated trip total
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 font-semibold text-white">
                    <Wallet className="size-3.5" aria-hidden />
                    {formatMoney(budget.leadingTotal, budget.currency)}
                  </span>
                  {budget.cheapestTotal != null &&
                    budget.cheapestTotal < budget.leadingTotal && (
                      <span className="text-muted-foreground">
                        · from {formatMoney(budget.cheapestTotal, budget.currency)}
                      </span>
                    )}
                  {budget.pricedLegs < budget.totalLegs && (
                    <span className="text-muted-foreground">
                      · {budget.pricedLegs}/{budget.totalLegs} legs priced
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-32 sm:px-6 lg:max-w-5xl lg:gap-16 xl:max-w-6xl 2xl:max-w-7xl">
        {sortedStays.map((stay, index) => (
          <StaySection
            key={stay.id}
            stay={stay}
            accommodations={byStay.get(stay.id) ?? []}
            places={placesByStay.get(stay.id) ?? []}
            members={liveMembers}
            currentMemberId={currentMemberId}
            locationScoringEnabled={locationScoringEnabled}
            onAdd={openSubmitFor}
            onEdit={openEditLeg}
            onMoveUp={(id) => moveLeg(id, "up")}
            onMoveDown={(id) => moveLeg(id, "down")}
            onPlaceSaved={applyPlaceUpsert}
            onPlaceRemoved={applyPlaceRemoval}
            onVote={applyVote}
            onAccommodationSaved={applyAccommodationUpsert}
            onAccommodationRemoved={applyAccommodationRemoval}
            isFirst={index === 0}
            isLast={index === sortedStays.length - 1}
          />
        ))}

        {/* Add-a-leg entry point — a dashed tile after the last section,
            styled like the empty-state tiles. Opens the sheet in create mode. */}
        <button
          type="button"
          onClick={openCreateLeg}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Add a leg
        </button>
      </div>

      {/* Floating "add a place" action — bottom-right, thumb-friendly. */}
      <button
        type="button"
        onClick={openSubmitBlank}
        aria-label="Add a place"
        className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 flex h-12 items-center gap-2 rounded-full bg-primary pr-5 pl-4 text-base font-semibold text-white shadow-md transition-colors hover:bg-[#e00b41] active:translate-y-px sm:right-8 sm:bottom-8"
      >
        <PlusIcon className="size-6" />
        <span className="pr-0.5">Add a place</span>
      </button>

      <SubmitSheet
        stays={sortedStays}
        currentMemberId={currentMemberId}
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        defaultStayId={submitStayId}
        onSubmitted={applyAccommodationUpsert}
      />

      {/* Leg editor — keyed on the target so fields re-seed on each open. The
          onSaved/onDeleted callbacks fold the server-action result straight into
          live state, so the acting user sees the change without a refresh. */}
      <LegSheet
        open={legSheetOpen}
        onOpenChange={setLegSheetOpen}
        stay={editingStay}
        stays={sortedStays}
        onSaved={(changed) => changed.forEach(applyStayUpsert)}
        onDeleted={applyStayRemoval}
        key={`${editingStay?.id ?? "new"}-${legSheetNonce}`}
      />
    </div>
  );
}
