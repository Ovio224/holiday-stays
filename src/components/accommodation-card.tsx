// AccommodationCard — a wide, two-pane "spread" for one candidate stay, built to
// be shown one-at-a-time in the leg carousel at ~80vw. On a wide card (@3xl+) the
// cover image fills the left pane while every detail lives on the right, grouped
// into four whitespace-separated zones — Identity, Money, Decision, Discussion —
// rather than a stack of <hr> rules, so the dense card reads as ONE composed
// object. On a narrow card it stacks (image on top, details below). "Details"
// opens the richer modal (map, amenities, edit).
//
// Rendered inside the client StaySection, so it composes client islands
// (PriceChart, VoteButtons, CommentThread, the detail dialog) freely. The leg's
// front-runner ("Group favorite") and unique cheapest option are computed once in
// the carousel and flagged here via isFrontRunner / isCheapestInLeg.

import Image from "next/image";
import Link from "next/link";
import { Crown, ImageOff, Star, Tag, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { AccommodationDetailDialog } from "@/components/accommodation-detail-dialog";
import { CommentThread } from "@/components/comment-thread";
import { PriceChart } from "@/components/price-chart";
import { VoteButtons } from "@/components/vote-buttons";
import { VoterChips } from "@/components/voter-chips";
import {
  detailChips,
  formatMoney,
  formatRating,
  nightlyTotal,
  sourceLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { LocationScoreChip } from "@/components/location-score";
import type { ScoreResult } from "@/lib/location-score";
import type { AccommodationWithVotes, Member, Place } from "@/lib/types";

interface AccommodationCardProps {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
  /** This leg's area + label — passed through to the detail dialog (map + header). */
  stayArea: string | null;
  stayLabel: string;
  /** Nights for this leg — used to compute the budget total. */
  stayNights: number | null;
  /** This leg's places-to-visit + this card's location score (location scoring only). */
  places: Place[];
  score: ScoreResult | null;
  locationScoringEnabled: boolean;
  /** The group's leading pick in this leg — earns the "Group favorite" ribbon. */
  isFrontRunner?: boolean;
  /** The single lowest effective nightly price in this leg — earns a price badge. */
  isCheapestInLeg?: boolean;
  /** The best-located option in this leg — earns the "Top location" badge. */
  isBestLocated?: boolean;
  /** First visible card → eager-load its cover so it can be the LCP element. */
  priority?: boolean;
}

export function AccommodationCard({
  accommodation,
  members,
  currentMemberId,
  stayArea,
  stayLabel,
  stayNights,
  places,
  score,
  locationScoringEnabled,
  isFrontRunner = false,
  isCheapestInLeg = false,
  isBestLocated = false,
  priority = false,
}: AccommodationCardProps) {
  const { votes, prices, comments, details } = accommodation;

  // Derive the live tallies + this member's current vote from the joined votes.
  let yesCount = 0;
  let noCount = 0;
  let currentValue: boolean | null = null;
  for (const vote of votes) {
    if (vote.value) yesCount += 1;
    else noCount += 1;
    if (vote.member_id === currentMemberId) currentValue = vote.value;
  }

  const submitter = accommodation.submitted_by
    ? (members.find((m) => m.id === accommodation.submitted_by) ?? null)
    : null;

  const title = accommodation.title?.trim() || "Untitled stay";
  const rating = formatRating(details?.rating ?? null, details?.ratingScale ?? null);
  const reviews = details?.reviews ?? null;
  const chips = detailChips(details);
  const memberCount = members.length;

  // A small, scarce, *computed* badge set (max 2) — factual cross-candidate signals
  // the group can filter on at a glance, never invented marketing copy.
  const computedBadges: { key: string; label: string; icon: typeof Tag }[] = [];
  if (isCheapestInLeg) {
    computedBadges.push({ key: "cheapest", label: "Best price here", icon: Tag });
  }
  if (details?.guests != null && memberCount > 0 && details.guests >= memberCount) {
    computedBadges.push({ key: "sleeps", label: "Sleeps everyone", icon: Users });
  }

  // Price: lead with the all-in leg TOTAL (the budget impact + the fair basis for
  // comparing options); demote the nightly rate to the secondary line.
  const nightly = formatMoney(accommodation.price_per_night, accommodation.currency);
  const total = formatMoney(
    nightlyTotal(accommodation.price_per_night, stayNights),
    accommodation.currency,
  );
  const hasNights = total != null && stayNights != null;

  return (
    // @container on the wrapper so the article (a DESCENDANT) can switch to the
    // two-pane grid based on the card's own width — an element can't query itself.
    <div className="@container h-full">
      <article
        className={cn(
          "group/card flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md @3xl:grid @3xl:grid-cols-[1.05fr_1fr] @3xl:items-stretch",
          // The leg's front-runner gets a warm Rausch-tinted edge so it pops out of
          // a carousel of near-identical cards — the only chrome that does.
          isFrontRunner ? "border-primary/45" : "border-border",
        )}
      >
        {/* Cover — fills the left pane on wide cards, sits on top when stacked. A
            flat black top scrim keeps the source badge + rating legible over bright
            Bali photos; source badge (left) + rating pill (right) sit above it. */}
        <div className="relative aspect-video w-full overflow-hidden bg-muted @3xl:aspect-auto @3xl:h-full @3xl:min-h-[24rem]">
          {accommodation.image_url ? (
            <Image
              src={accommodation.image_url}
              alt={title}
              fill
              priority={priority}
              sizes="(max-width: 960px) 80vw, 600px"
              className="object-cover transition-transform duration-500 ease-out group-hover/card:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover/card:scale-100"
            />
          ) : (
            <div className="flex h-full min-h-48 w-full items-center justify-center">
              <ImageOff className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            </div>
          )}

          {/* Legibility ramp — flat, low-opacity black, no blur/color. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/35 to-transparent"
            aria-hidden
          />

          <Badge className="absolute top-3 left-3 border border-border bg-white/90 text-foreground shadow-sm">
            {sourceLabel(accommodation.source)}
          </Badge>

          {rating && (
            <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full border border-border bg-white/90 px-2.5 py-1 text-sm font-semibold text-foreground shadow-sm">
              <Star className="size-3.5 fill-foreground text-foreground" aria-hidden />
              <span className="tabular-nums">{rating}</span>
              {reviews != null && (
                <span className="font-normal text-muted-foreground tabular-nums">({reviews})</span>
              )}
            </div>
          )}
        </div>

        {/* Content pane — four whitespace-grouped zones, staggered in on mount. */}
        <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          {/* ZONE 1 · Identity — favorite ribbon, title, badges, submitter + Details. */}
          <div className="animate-rise flex flex-col gap-2.5" style={{ animationDelay: "0ms" }}>
            {isFrontRunner && (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
                <Crown className="size-3.5" aria-hidden />
                Group favorite
              </span>
            )}

            <Link
              href={accommodation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-xl leading-snug font-semibold tracking-tight text-foreground transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card @3xl:text-2xl dark:focus-visible:ring-[#ff5a76]"
            >
              <span className="line-clamp-2">{title}</span>
            </Link>

            {(computedBadges.length > 0 || chips.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {computedBadges.slice(0, 2).map((badge) => (
                  <span
                    key={badge.key}
                    className="inline-flex items-center gap-1 rounded-full bg-yes/10 px-2.5 py-1 text-[11px] font-semibold text-yes"
                  >
                    <badge.icon className="size-3" aria-hidden />
                    {badge.label}
                  </span>
                ))}
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {submitter ? (
                <div className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: submitter.color }}
                    aria-hidden
                  />
                  Added by {submitter.name}
                </div>
              ) : (
                <span />
              )}

              <AccommodationDetailDialog
                accommodation={accommodation}
                members={members}
                currentMemberId={currentMemberId}
                stayArea={stayArea}
                stayLabel={stayLabel}
                stayNights={stayNights}
                places={places}
                locationScoringEnabled={locationScoringEnabled}
                isBestLocated={isBestLocated}
              />
            </div>
          </div>

          {/* ZONE 2 · Money — total-first price, location score, notes, who-pays-what. */}
          <div className="animate-rise mt-6 flex flex-col gap-3.5" style={{ animationDelay: "60ms" }}>
            {nightly ? (
              <div className="flex flex-col gap-0.5">
                {hasNights ? (
                  <>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                        {total}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        total · {stayNights} {stayNights === 1 ? "night" : "nights"}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">{nightly} / night</p>
                  </>
                ) : (
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                      {nightly}
                    </span>
                    <span className="text-sm text-muted-foreground">/ night</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Add a price to track budget</p>
            )}

            {/* Location score — how close this stay is to the leg's places-to-visit. */}
            {locationScoringEnabled && places.length > 0 && score && (
              <LocationScoreChip score={score} isBestLocated={isBestLocated} />
            )}

            {accommodation.notes?.trim() && (
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {accommodation.notes}
              </p>
            )}

            <PriceChart
              accommodationId={accommodation.id}
              members={members}
              prices={prices}
              currentMemberId={currentMemberId}
              referenceAmount={accommodation.price_per_night}
              currency={accommodation.currency}
              stayNights={stayNights}
            />
          </div>

          {/* ZONE 3 · Decision — consensus + vote + who voted. */}
          <div className="animate-rise mt-7 flex flex-col gap-3" style={{ animationDelay: "120ms" }}>
            <VoteButtons
              accommodationId={accommodation.id}
              currentMemberId={currentMemberId}
              currentValue={currentValue}
              yesCount={yesCount}
              noCount={noCount}
              memberCount={memberCount}
            />
            <VoterChips votes={votes} members={members} />
          </div>

          {/* ZONE 4 · Discussion — say WHY it's a yes or no. */}
          <div className="animate-rise mt-7" style={{ animationDelay: "180ms" }}>
            <CommentThread
              accommodationId={accommodation.id}
              comments={comments}
              members={members}
              votes={votes}
              currentMemberId={currentMemberId}
              variant="card"
            />
          </div>
        </div>
      </article>
    </div>
  );
}

