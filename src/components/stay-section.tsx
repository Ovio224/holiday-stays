"use client";

// StaySection — one leg of the trip. A bold heading with the date range +
// nights pill and the leg controls, then (when location scoring is on) the
// per-leg "Places to visit" manager, then a full-bleed CAROUSEL of large
// AccommodationCards. When a leg has no places yet it shows a friendly invitation
// to drop the first link.
//
// This is a client component because it surfaces the onAdd callback that the
// parent board wires up to open the add-link sheet, AND because it computes the
// (synchronous, haversine) location scores for its accommodations and owns the
// "sort by Location" control.

import * as React from "react";
import { CalendarDays, ChevronDown, ChevronUp, MapPin, Pencil, Plus } from "lucide-react";

import { AccommodationCarousel } from "@/components/accommodation-carousel";
import { PlacesManager } from "@/components/places-manager";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateRange, nights } from "@/lib/format";
import {
  compareByLocation,
  DEFAULT_WEIGHTS,
  scoreLegAccommodations,
  type ScorableAccommodation,
  type ScoreResult,
} from "@/lib/location-score";
import type { AccommodationWithVotes, Member, Place, Stay } from "@/lib/types";

type SortKey = "default" | "location";

interface StaySectionProps {
  stay: Stay;
  accommodations: AccommodationWithVotes[];
  places: Place[];
  members: Member[];
  currentMemberId: string | null;
  locationScoringEnabled: boolean;
  onAdd: (stayId: string) => void;
  onEdit: (stay: Stay) => void;
  onMoveUp: (stayId: string) => void;
  onMoveDown: (stayId: string) => void;
  onPlaceSaved: (place: Place) => void;
  onPlaceRemoved: (placeId: string) => void;
  isFirst: boolean;
  isLast: boolean;
}

/** Map the board view-model to the minimal shape the scorer needs. */
function toScorable(acc: AccommodationWithVotes): ScorableAccommodation {
  return {
    id: acc.id,
    latitude: acc.latitude ?? null,
    longitude: acc.longitude ?? null,
    price_per_night: acc.price_per_night,
    prices: acc.prices,
    rating: acc.details?.rating ?? null,
    ratingScale: acc.details?.ratingScale ?? null,
    votes: acc.votes,
  };
}

export function StaySection({
  stay,
  accommodations,
  places,
  members,
  currentMemberId,
  locationScoringEnabled,
  onAdd,
  onEdit,
  onMoveUp,
  onMoveDown,
  onPlaceSaved,
  onPlaceRemoved,
  isFirst,
  isLast,
}: StaySectionProps) {
  const range = formatDateRange(stay.start_date, stay.end_date);
  const nightCount = nights(stay.start_date, stay.end_date);
  const nightLabel =
    nightCount !== null ? `${nightCount} ${nightCount === 1 ? "night" : "nights"}` : "";
  const metaParts = [range, nightLabel].filter(Boolean);

  const [sortKey, setSortKey] = React.useState<SortKey>("default");

  // Location scores (scooter, balanced) for this leg's candidates. Synchronous +
  // neighbour-independent (absolute anchors), so there's no "scoring…" async
  // window in Phase 1 and no mid-interaction reshuffle.
  const scores = React.useMemo<Map<string, ScoreResult>>(() => {
    if (!locationScoringEnabled) return new Map();
    return scoreLegAccommodations({
      accommodations: accommodations.map(toScorable),
      places,
      mode: "scooter",
      weights: DEFAULT_WEIGHTS,
      persona: "balanced",
    });
  }, [locationScoringEnabled, accommodations, places]);

  // The display order. Default = the order received (created_at). Location =
  // scored cards by compareByLocation, with un-scorable "needs info" cards kept
  // together at the END (never interleaved as if they scored low).
  const ordered = React.useMemo(() => {
    if (!locationScoringEnabled || sortKey !== "location") return accommodations;
    const scored: { acc: AccommodationWithVotes; s: ScoreResult }[] = [];
    const rest: AccommodationWithVotes[] = [];
    for (const acc of accommodations) {
      const s = scores.get(acc.id);
      if (s && s.location != null) scored.push({ acc, s });
      else rest.push(acc);
    }
    scored.sort((a, b) =>
      compareByLocation(
        {
          location: a.s.location as number,
          worstPoi: a.s.worstPoi,
          coveragePct: a.s.coveragePct,
          created_at: a.acc.created_at,
        },
        {
          location: b.s.location as number,
          worstPoi: b.s.worstPoi,
          coveragePct: b.s.coveragePct,
          created_at: b.acc.created_at,
        },
      ),
    );
    return [...scored.map((x) => x.acc), ...rest];
  }, [locationScoringEnabled, sortKey, accommodations, scores]);

  // The sort control is only meaningful with places to measure against AND more
  // than one candidate to reorder.
  const showSort =
    locationScoringEnabled && places.length > 0 && accommodations.length > 1;

  return (
    <section className="flex flex-col gap-5">
      {/* Leg header */}
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

      {/* Per-leg places-to-visit manager (location scoring only). */}
      {locationScoringEnabled && (
        <PlacesManager
          stayId={stay.id}
          places={places}
          currentMemberId={currentMemberId}
          onPlaceSaved={onPlaceSaved}
          onPlaceRemoved={onPlaceRemoved}
        />
      )}

      {accommodations.length === 0 ? (
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
        <>
          {showSort && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">Sort by</span>
              <Select
                items={[
                  { label: "Default order", value: "default" },
                  { label: "Location", value: "location" },
                ]}
                value={sortKey}
                onValueChange={(value) => setSortKey(value as SortKey)}
              >
                <SelectTrigger className="h-9 w-40 rounded-lg px-3 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="text-sm">
                    Default order
                  </SelectItem>
                  <SelectItem value="location" className="text-sm">
                    Location
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <AccommodationCarousel
            accommodations={ordered}
            members={members}
            currentMemberId={currentMemberId}
            stayArea={stay.area}
            stayLabel={stay.label}
            stayNights={nightCount}
            places={places}
            scores={scores}
            locationScoringEnabled={locationScoringEnabled}
          />
        </>
      )}
    </section>
  );
}
