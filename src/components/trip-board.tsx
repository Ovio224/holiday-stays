"use client";

// The live board. Seeds from server-rendered data, then stays realtime via
// useRealtimeBoard. Groups accommodations under their stay, renders each stay
// as a StaySection, and owns the "add a place" bottom-sheet.

import * as React from "react";
import { CalendarDays, Plus, PlusIcon, Wallet } from "lucide-react";
import { toast } from "sonner";

import type { Stay, AccommodationWithVotes, Member } from "@/lib/types";
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
  currentMemberId: string | null;
}

export function TripBoard({
  initialStays,
  initialAccommodations,
  members,
  currentMemberId,
}: TripBoardProps) {
  // Everything live: stays, accommodations, and members all stream in via the
  // realtime subscription, so the board, banner, and budget recompute together.
  const {
    stays,
    accommodations,
    members: liveMembers,
  } = useRealtimeBoard({
    initialStays,
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

  // Leg-editor state. editingStay null = create mode; a stay = edit mode. The
  // LegSheet is keyed on the target so it remounts (and re-seeds fields) cleanly.
  const [legSheetOpen, setLegSheetOpen] = React.useState(false);
  const [editingStay, setEditingStay] = React.useState<Stay | null>(null);

  const openCreateLeg = React.useCallback(() => {
    setEditingStay(null);
    setLegSheetOpen(true);
  }, []);

  const openEditLeg = React.useCallback((stay: Stay) => {
    setEditingStay(stay);
    setLegSheetOpen(true);
  }, []);

  // Reorder a leg one step; the realtime stays subscription reflects the swap.
  const moveLeg = React.useCallback(
    (id: string, direction: "up" | "down") => {
      void (async () => {
        try {
          await reorderStay(id, direction);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not reorder that leg.";
          toast.error(message);
        }
      })();
    },
    [],
  );

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
    <div className="relative">
      <header className="mx-auto mb-8 w-full max-w-2xl px-4 sm:px-6">
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
        {tripRange && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-sm font-medium text-foreground">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            {tripRange}
          </p>
        )}

        {budget.leadingTotal != null && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted-foreground">Estimated trip total</span>
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
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-32 sm:px-6">
        {sortedStays.map((stay, index) => (
          <StaySection
            key={stay.id}
            stay={stay}
            accommodations={byStay.get(stay.id) ?? []}
            members={liveMembers}
            currentMemberId={currentMemberId}
            onAdd={openSubmitFor}
            onEdit={openEditLeg}
            onMoveUp={(id) => moveLeg(id, "up")}
            onMoveDown={(id) => moveLeg(id, "down")}
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
      />

      {/* Leg editor — keyed on the target so fields re-seed on each open. */}
      <LegSheet
        open={legSheetOpen}
        onOpenChange={setLegSheetOpen}
        stay={editingStay}
        key={editingStay?.id ?? "new"}
      />
    </div>
  );
}
