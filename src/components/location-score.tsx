"use client";

// Location Score — the production-grade UI for "how well-placed is this stay for
// the spots we want to visit". Models the patterns leading products converge on
// (Walk Score / Booking / ImmoScout24, see the deep-research notes): a 0–100 score
// shown as a radial gauge with a NAMED TIER + plain-language descriptor (never a
// bare number, never colour alone), a categorised "what's nearby" breakdown with
// per-POI distance + time, a real Walk / Scooter / Car travel-mode selector, and
// honest trust signals (a straight-line-estimate label, the input count, and a
// "Top location" badge for the best-placed option in the leg).
//
// Two surfaces share the system:
//  - <LocationScoreChip>  — compact, on each accommodation card.
//  - <LocationScorePanel> — the full report in the detail dialog, with the live
//    mode toggle (haversine recomputes all three modes for free, no routing key).

import * as React from "react";
import {
  Bike,
  Car,
  Coffee,
  Footprints,
  Landmark,
  MapPin,
  MapPinOff,
  Music,
  ShoppingBasket,
  Sparkles,
  Trees,
  Utensils,
  Waves,
  Wine,
} from "lucide-react";

import {
  formatDistanceKm,
  formatMinutes,
  locationScoreForMode,
  scoreTier,
  type LatLng,
  type PoiDistance,
  type ScoreResult,
  type TierColor,
} from "@/lib/location-score";
import type { AccommodationWithVotes, Place, TravelMode } from "@/lib/types";
import { cn } from "@/lib/utils";

// Theme-robust class sets per tier colour (work in light + dark).
const TIER_CLASSES: Record<
  TierColor,
  { text: string; softBg: string; border: string; track: string; arc: string; bar: string }
> = {
  emerald: {
    text: "text-emerald-700 dark:text-emerald-300",
    softBg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
    track: "stroke-emerald-500/15",
    arc: "stroke-emerald-500",
    bar: "bg-emerald-500",
  },
  green: {
    text: "text-green-700 dark:text-green-300",
    softBg: "bg-green-500/10",
    border: "border-green-500/25",
    track: "stroke-green-500/15",
    arc: "stroke-green-500",
    bar: "bg-green-500",
  },
  amber: {
    text: "text-amber-700 dark:text-amber-300",
    softBg: "bg-amber-500/10",
    border: "border-amber-500/30",
    track: "stroke-amber-500/15",
    arc: "stroke-amber-500",
    bar: "bg-amber-500",
  },
  orange: {
    text: "text-orange-700 dark:text-orange-300",
    softBg: "bg-orange-500/10",
    border: "border-orange-500/30",
    track: "stroke-orange-500/15",
    arc: "stroke-orange-500",
    bar: "bg-orange-500",
  },
  rose: {
    text: "text-rose-700 dark:text-rose-300",
    softBg: "bg-rose-500/10",
    border: "border-rose-500/25",
    track: "stroke-rose-500/15",
    arc: "stroke-rose-500",
    bar: "bg-rose-500",
  },
};

/** Category → icon, as a switch returning static JSX (so each icon is a stable
 *  component reference, not one selected into a variable during render). */
function PoiIcon({ category, className }: { category: string | null; className?: string }) {
  switch (category) {
    case "beach":
    case "surf":
      return <Waves className={className} aria-hidden />;
    case "restaurant":
      return <Utensils className={className} aria-hidden />;
    case "cafe":
      return <Coffee className={className} aria-hidden />;
    case "market":
      return <ShoppingBasket className={className} aria-hidden />;
    case "bar":
      return <Wine className={className} aria-hidden />;
    case "club":
      return <Music className={className} aria-hidden />;
    case "nature":
      return <Trees className={className} aria-hidden />;
    case "temple":
      return <Landmark className={className} aria-hidden />;
    default:
      return <MapPin className={className} aria-hidden />;
  }
}

const MODES: { key: TravelMode; label: string; Icon: typeof MapPin }[] = [
  { key: "foot", label: "Walk", Icon: Footprints },
  { key: "scooter", label: "Scooter", Icon: Bike },
  { key: "car", label: "Car", Icon: Car },
];

function originOf(acc: {
  latitude?: number | null;
  longitude?: number | null;
}): LatLng | null {
  return acc.latitude != null && acc.longitude != null
    ? { latitude: acc.latitude, longitude: acc.longitude }
    : null;
}

// ── Radial gauge ─────────────────────────────────────────────────────────────

function ScoreGauge({
  score,
  color,
  size = 72,
  strokeWidth = 8,
}: {
  score: number;
  color: TierColor;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(100, Math.max(0, score)) / 100;
  const cls = TIER_CLASSES[color];
  const center = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cls.track}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={cn(cls.arc, "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none")}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn("font-bold tabular-nums tracking-tight text-foreground", size >= 80 ? "text-2xl" : size >= 56 ? "text-lg" : "text-sm")}
        >
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

// ── Travel-mode selector ─────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
}: {
  mode: TravelMode;
  onChange: (mode: TravelMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Travel mode"
      className="inline-flex rounded-full border border-border bg-muted/50 p-0.5"
    >
      {MODES.map(({ key, label, Icon }) => {
        const active = key === mode;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── "Top location" badge + needs-location states ─────────────────────────────

function TopLocationBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[0.7rem] font-semibold text-white">
      <Sparkles className="size-3" aria-hidden />
      Top location
    </span>
  );
}

function NeedsLocation({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
      <MapPinOff className="size-4 shrink-0" aria-hidden />
      {message}
    </div>
  );
}

// ── Compact chip (accommodation card) ────────────────────────────────────────

export function LocationScoreChip({
  score,
  isBestLocated = false,
}: {
  score: ScoreResult;
  isBestLocated?: boolean;
}) {
  if (score.status === "needs-address") {
    return <NeedsLocation message="Add a location to rank this stay by distance" />;
  }
  if (score.location == null) return null;

  const tier = scoreTier(score.location);
  const cls = TIER_CLASSES[tier.color];
  const coverage = score.coverageCount;

  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-2.5", cls.softBg, cls.border)}>
      <ScoreGauge score={score.location} color={tier.color} size={48} strokeWidth={5} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm font-semibold", cls.text)}>{tier.label}</span>
          {isBestLocated && <TopLocationBadge />}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {coverage
            ? `${coverage.within} of ${coverage.of} spots within a 15-min ride`
            : tier.descriptor}
        </p>
      </div>
    </div>
  );
}

// ── Per-POI row ──────────────────────────────────────────────────────────────

function PoiRow({ row }: { row: PoiDistance }) {
  const time = formatMinutes(row.minutes);
  const distance = formatDistanceKm(row.km);
  const reachable = row.minutes != null && row.subScore != null;
  const barTier = reachable ? scoreTier(row.subScore as number) : null;

  return (
    <li className="flex items-center gap-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <PoiIcon category={row.place.category} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{row.place.label}</p>
        {reachable ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {time}
            {distance ? ` · ${distance}` : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Not located yet</p>
        )}
      </div>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
        {barTier && (
          <span
            className={cn("block h-full rounded-full transition-[width] duration-500", TIER_CLASSES[barTier.color].bar)}
            style={{ width: `${Math.round(row.subScore as number)}%` }}
          />
        )}
      </span>
    </li>
  );
}

// ── Full report panel (detail dialog) ────────────────────────────────────────

export function LocationScorePanel({
  accommodation,
  places,
  isBestLocated = false,
}: {
  accommodation: AccommodationWithVotes;
  places: Place[];
  isBestLocated?: boolean;
}) {
  const origin = originOf(accommodation);
  const [mode, setMode] = React.useState<TravelMode>("scooter");

  const result = React.useMemo(
    () => locationScoreForMode({ origin, places, mode }),
    [origin, places, mode],
  );

  const tier = result.location != null ? scoreTier(result.location) : null;

  // Nearest-first; un-located POIs sink to the bottom.
  const rows = React.useMemo(
    () =>
      [...result.poi].sort((a, b) => {
        if (a.minutes == null) return b.minutes == null ? 0 : 1;
        if (b.minutes == null) return -1;
        return a.minutes - b.minutes;
      }),
    [result.poi],
  );

  const placeCount = places.length;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Location score</h3>
        <ModeSelector mode={mode} onChange={setMode} />
      </header>

      {origin == null ? (
        <NeedsLocation message="Add an address to this stay (or paste coordinates) to see how close it is to your spots." />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <ScoreGauge score={result.location ?? 0} color={tier?.color ?? "rose"} size={84} strokeWidth={9} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("text-lg leading-tight font-semibold", tier ? TIER_CLASSES[tier.color].text : "text-foreground")}>
                  {tier?.label ?? "Not enough info"}
                </p>
                {isBestLocated && <TopLocationBadge />}
              </div>
              <p className="text-sm text-muted-foreground">
                {tier?.descriptor ?? "Add some places to visit to score this stay."}
              </p>
              {result.coverageCount && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Straight-line estimate · {result.coverageCount.within} of{" "}
                  {result.coverageCount.of} within reach · {placeCount}{" "}
                  {placeCount === 1 ? "place" : "places"} you added
                </p>
              )}
            </div>
          </div>

          {placeCount > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                What&apos;s nearby
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((row) => (
                  <PoiRow key={row.place.id} row={row} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
