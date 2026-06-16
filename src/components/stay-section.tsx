"use client";

// StaySection — one leg of the trip. A bold heading with the date range +
// nights pill and an "Add a place" action, then a responsive grid of
// AccommodationCards. When a leg has no places yet it shows a friendly glass
// invitation to drop the first link.
//
// This is a client component because it surfaces the onAdd callback that the
// parent board wires up to open the add-link sheet.

import { CalendarDays, ChevronDown, ChevronUp, MapPin, Pencil, Plus } from "lucide-react";

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
  onEdit: (stay: Stay) => void;
  onMoveUp: (stayId: string) => void;
  onMoveDown: (stayId: string) => void;
  isFirst: boolean;
  isLast: boolean;
}

export function StaySection({
  stay,
  accommodations,
  members,
  currentMemberId,
  onAdd,
  onEdit,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
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
          <h2 className="text-xl font-semibold leading-tight text-foreground">
            {stay.label}
          </h2>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {stay.area && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {stay.area}
              </span>
            )}
            {metaParts.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground">
                <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />
                {metaParts.join(" · ")}
              </span>
            )}
          </div>
        </div>

        {/* Control cluster — wraps to its own row on narrow phones so the
            header never crowds. Icon buttons keep ≥44px touch targets. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onEdit(stay)}
            aria-label={`Edit ${stay.label}`}
            className="size-11 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMoveUp(stay.id)}
            disabled={isFirst}
            aria-label={`Move ${stay.label} up`}
            className="size-11 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronUp className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMoveDown(stay.id)}
            disabled={isLast}
            aria-label={`Move ${stay.label} down`}
            className="size-11 rounded-lg p-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-4" aria-hidden />
          </Button>
          <Button
            onClick={() => onAdd(stay.id)}
            className="min-h-11 rounded-lg border border-foreground/30 bg-white px-4 text-sm font-semibold text-foreground shadow-none hover:bg-muted"
          >
            <Plus className="size-4" aria-hidden />
            Add a place
          </Button>
        </div>
      </header>

      {accommodations.length === 0 ? (
        // Empty state — a clean bordered tile rather than a dead gap.
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
          <MapPin className="size-6 text-muted-foreground" aria-hidden />
          <p className="max-w-xs text-sm text-muted-foreground">
            No places yet — paste the first Airbnb or Booking link.
          </p>
          <Button
            onClick={() => onAdd(stay.id)}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-[#e00b41]"
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
              stayNights={nightCount}
            />
          ))}
        </div>
      )}
    </section>
  );
}
