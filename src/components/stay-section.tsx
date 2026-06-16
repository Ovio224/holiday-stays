"use client";

// StaySection — one leg of the trip. A bold heading with the date range +
// nights pill and an "Add a place" action, then a responsive grid of
// AccommodationCards. When a leg has no places yet it shows a friendly glass
// invitation to drop the first link.
//
// This is a client component because it surfaces the onAdd callback that the
// parent board wires up to open the add-link sheet.

import { MapPin, Plus } from "lucide-react";

import { AccommodationCard } from "@/components/accommodation-card";
import { Button } from "@/components/ui/button";
import { formatDateRange, nights } from "@/lib/format";
import type { AccommodationWithVotes, Member, Stay } from "@/lib/types";

interface StaySectionProps {
  stay: Stay;
  accommodations: AccommodationWithVotes[];
  members: Member[];
  currentMemberId: string | null;
  onAdd: (stayId: string) => void;
}

export function StaySection({
  stay,
  accommodations,
  members,
  currentMemberId,
  onAdd,
}: StaySectionProps) {
  const range = formatDateRange(stay.start_date, stay.end_date);
  const nightCount = nights(stay.start_date, stay.end_date);
  // Compose the pill text from whatever date info we actually have.
  const nightLabel =
    nightCount !== null ? `${nightCount} ${nightCount === 1 ? "night" : "nights"}` : "";
  const metaParts = [range, nightLabel].filter(Boolean);

  return (
    <section className="flex flex-col gap-4">
      {/* Leg header — label + date/nights meta on the left, add on the right. */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-2xl font-bold leading-tight text-foreground">
            {stay.label}
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {stay.area && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden />
                {stay.area}
              </span>
            )}
            {metaParts.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-grad-sunset px-3 py-1 text-xs font-semibold text-white shadow-sm">
                {metaParts.join(" · ")}
              </span>
            )}
          </div>
        </div>

        <Button
          onClick={() => onAdd(stay.id)}
          className="min-h-11 rounded-2xl bg-grad-sea px-4 text-sm font-semibold text-white shadow-md transition-transform hover:-translate-y-0.5 hover:bg-grad-sea"
        >
          <Plus className="size-4" aria-hidden />
          Add a place
        </Button>
      </header>

      {accommodations.length === 0 ? (
        // Empty state — an inviting frosted tile rather than a dead gap.
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-10 text-center">
          <span className="text-4xl" aria-hidden>
            🏝️
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">
            No places yet — drop the first Airbnb or Booking link for this leg.
          </p>
          <Button
            onClick={() => onAdd(stay.id)}
            className="min-h-11 rounded-2xl bg-grad-sea px-4 text-sm font-semibold text-white shadow-md hover:bg-grad-sea"
          >
            <Plus className="size-4" aria-hidden />
            Add the first place
          </Button>
        </div>
      ) : (
        // Responsive card grid: 1 col on phones, 2 on small, 3 on large.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accommodations.map((accommodation) => (
            <AccommodationCard
              key={accommodation.id}
              accommodation={accommodation}
              members={members}
              currentMemberId={currentMemberId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
