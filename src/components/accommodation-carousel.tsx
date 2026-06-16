"use client";

// AccommodationCarousel — a full-bleed, horizontal scroll-snap filmstrip of the
// candidate cards for one leg. Each card is min(80vw, 1200px) wide and snaps to
// the viewport centre with a peek of its neighbours, so you see ONE big card at a
// time with all its detail (image, price, who-pays-what, votes, discussion) and
// swipe/scroll between them. Below the strip: prev/next buttons, clickable dots,
// and a "n / total" counter. Driven by native scroll (so touch swipe + trackpad
// work for free); the controls just call scrollTo on the track.
//
// It breaks out of the centred board column to span the whole viewport (the
// board's outer wrapper sets overflow-x-clip so this never causes a page scroll).

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AccommodationCard } from "@/components/accommodation-card";
import { cn } from "@/lib/utils";
import { legDecisionSignals } from "@/lib/prices";
import type { ScoreResult } from "@/lib/location-score";
import type { AccommodationWithVotes, Member, Place } from "@/lib/types";

interface AccommodationCarouselProps {
  accommodations: AccommodationWithVotes[];
  members: Member[];
  currentMemberId: string | null;
  stayArea: string | null;
  stayLabel: string;
  stayNights: number | null;
  /** This leg's places-to-visit + per-card location scores (location scoring only). */
  places: Place[];
  scores: Map<string, ScoreResult>;
  locationScoringEnabled: boolean;
}

/** The card width, shared by the cards and the centring padding. */
const CARD_WIDTH = "min(80vw, 1200px)";

export function AccommodationCarousel({
  accommodations,
  members,
  currentMemberId,
  stayArea,
  stayLabel,
  stayNights,
  places,
  scores,
  locationScoringEnabled,
}: AccommodationCarouselProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const count = accommodations.length;

  // Leg-wide verdicts painted onto exactly the right card: the "Group favorite"
  // front-runner and the unique cheapest option. Recomputed live as votes/prices
  // stream in (the parent re-renders the carousel with fresh accommodations).
  const { frontRunnerId, cheapestId } = React.useMemo(
    () => legDecisionSignals(accommodations),
    [accommodations],
  );

  const [active, setActive] = React.useState(0);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(count <= 1);

  // Honour reduced-motion for programmatic scrolls (native swipe is unaffected).
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Recompute the active card + end flags from the live scroll position.
  const sync = React.useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const items = Array.from(track.querySelectorAll<HTMLElement>("[data-card]"));
    if (items.length === 0) return;

    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    items.forEach((el, i) => {
      const elCenter = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(elCenter - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });

    setActive(best);
    setAtStart(track.scrollLeft <= 4);
    setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  }, []);

  // Keep flags fresh on mount, when the card count changes, and on resize.
  React.useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync, count]);

  const scrollToIndex = React.useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const items = track.querySelectorAll<HTMLElement>("[data-card]");
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      const el = items[clamped];
      if (!el) return;
      const left = el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2;
      track.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
    },
    [reduceMotion],
  );

  const showControls = count > 1;

  return (
    <div className="relative left-1/2 w-screen -translate-x-1/2">
      <div
        ref={trackRef}
        onScroll={sync}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${stayLabel} — ${count} ${count === 1 ? "place" : "places"}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            scrollToIndex(active + 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            scrollToIndex(active - 1);
          }
        }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pt-1 pb-2 outline-none [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden"
        style={{
          paddingInline: `max(1rem, calc((100vw - ${CARD_WIDTH}) / 2))`,
          scrollPaddingInline: `max(1rem, calc((100vw - ${CARD_WIDTH}) / 2))`,
        }}
      >
        {accommodations.map((accommodation, i) => (
          <div
            key={accommodation.id}
            data-card
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            className="w-(--card-w) shrink-0 snap-center"
            style={{ "--card-w": CARD_WIDTH } as React.CSSProperties}
          >
            <AccommodationCard
              accommodation={accommodation}
              members={members}
              currentMemberId={currentMemberId}
              stayArea={stayArea}
              stayLabel={stayLabel}
              stayNights={stayNights}
              places={places}
              score={scores.get(accommodation.id) ?? null}
              locationScoringEnabled={locationScoringEnabled}
              isFrontRunner={accommodation.id === frontRunnerId}
              isCheapestInLeg={accommodation.id === cheapestId}
              priority={i === 0}
            />
          </div>
        ))}
      </div>

      {showControls && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <CarouselButton
            label="Previous place"
            disabled={atStart}
            onClick={() => scrollToIndex(active - 1)}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </CarouselButton>

          <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose a place">
            {accommodations.map((accommodation, i) => (
              <button
                key={accommodation.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Go to place ${i + 1}`}
                onClick={() => scrollToIndex(i)}
                className={cn(
                  "h-2 rounded-full transition-all duration-200",
                  i === active
                    ? "w-6 bg-foreground"
                    : "w-2 bg-border hover:bg-muted-foreground",
                )}
              />
            ))}
          </div>

          <CarouselButton
            label="Next place"
            disabled={atEnd}
            onClick={() => scrollToIndex(active + 1)}
          >
            <ChevronRight className="size-5" aria-hidden />
          </CarouselButton>

          <span className="ml-1 text-sm font-medium tabular-nums text-muted-foreground">
            {active + 1} / {count}
          </span>
        </div>
      )}
    </div>
  );
}

function CarouselButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-all duration-200 hover:bg-muted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-card"
    >
      {children}
    </button>
  );
}
