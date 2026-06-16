// AccommodationCard — a wide, two-pane "spread" for one candidate stay, built to
// be shown one-at-a-time in the leg carousel at ~80vw. On a wide card (@3xl+) the
// cover image fills the left pane while every detail lives on the right: title,
// capacity, price + per-leg budget, the per-member "who pays what" comparison,
// the yes/no vote, who voted, and the Notion-style discussion thread. On a narrow
// card it stacks (image on top, details below). "Details" opens the richer modal
// (map, amenities, edit).
//
// Rendered inside the client StaySection, so it composes client islands
// (PriceChart, VoteButtons, CommentThread, the detail dialog) freely.

import Image from "next/image";
import Link from "next/link";
import { ImageOff, Star } from "lucide-react";

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
import type { AccommodationWithVotes, Member } from "@/lib/types";

interface AccommodationCardProps {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
  /** This leg's area + label — passed through to the detail dialog (map + header). */
  stayArea: string | null;
  stayLabel: string;
  /** Nights for this leg — used to compute the budget total. */
  stayNights: number | null;
}

export function AccommodationCard({
  accommodation,
  members,
  currentMemberId,
  stayArea,
  stayLabel,
  stayNights,
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

  // Price + per-leg budget total.
  const nightly = formatMoney(accommodation.price_per_night, accommodation.currency);
  const total = formatMoney(
    nightlyTotal(accommodation.price_per_night, stayNights),
    accommodation.currency,
  );

  return (
    // @container on the wrapper so the article (a DESCENDANT) can switch to the
    // two-pane grid based on the card's own width — an element can't query itself.
    <div className="@container h-full">
    <article className="group/card flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md @3xl:grid @3xl:grid-cols-[1.05fr_1fr] @3xl:items-stretch">
      {/* Cover — fills the left pane on wide cards, sits on top when stacked.
          Source badge (left) + rating pill (right) overlaid. */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted @3xl:aspect-auto @3xl:h-full @3xl:min-h-[24rem]">
        {accommodation.image_url ? (
          <Image
            src={accommodation.image_url}
            alt={title}
            fill
            sizes="(max-width: 960px) 80vw, 600px"
            className="object-cover transition-transform duration-500 group-hover/card:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full min-h-48 w-full items-center justify-center">
            <ImageOff className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          </div>
        )}

        <Badge className="absolute top-3 left-3 border border-border bg-white/90 text-foreground shadow-sm">
          {sourceLabel(accommodation.source)}
        </Badge>

        {rating && (
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full border border-border bg-white/90 px-2.5 py-1 text-sm font-semibold text-foreground shadow-sm">
            <Star className="size-3.5 fill-foreground text-foreground" aria-hidden />
            {rating}
            {reviews != null && (
              <span className="font-normal text-muted-foreground">({reviews})</span>
            )}
          </div>
        )}
      </div>

      {/* Content pane */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:p-6">
        {/* Title links out to the original listing in a new tab. */}
        <div className="flex flex-col gap-2">
          <Link
            href={accommodation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl leading-snug font-semibold tracking-tight text-foreground transition-colors hover:text-primary @3xl:text-2xl"
          >
            <span className="line-clamp-2">{title}</span>
          </Link>

          {/* Capacity details parsed from the listing. */}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
        </div>

        {/* Price + per-leg budget total. */}
        {nightly ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">{nightly}</span>
            <span className="text-sm text-muted-foreground">/ night</span>
            {total && stayNights != null && (
              <span className="text-sm text-muted-foreground">
                · {total} for {stayNights} {stayNights === 1 ? "night" : "nights"}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Add a price to track budget</p>
        )}

        {/* Optional notes from whoever added it. */}
        {accommodation.notes?.trim() && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {accommodation.notes}
          </p>
        )}

        {/* Submitter + the Details / listing actions. */}
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
          />
        </div>

        <hr className="border-border" />

        {/* Per-member price comparison — who has the best deal & books. */}
        <PriceChart
          accommodationId={accommodation.id}
          members={members}
          prices={prices}
          currentMemberId={currentMemberId}
          referenceAmount={accommodation.price_per_night}
          currency={accommodation.currency}
          stayNights={stayNights}
        />

        {/* Vote + who voted. */}
        <div className="flex flex-col gap-3">
          <VoteButtons
            accommodationId={accommodation.id}
            currentMemberId={currentMemberId}
            currentValue={currentValue}
            yesCount={yesCount}
            noCount={noCount}
          />
          <VoterChips votes={votes} members={members} />
        </div>

        <hr className="border-border" />

        {/* Notion-style discussion — say WHY it's a yes or no. */}
        <CommentThread
          accommodationId={accommodation.id}
          comments={comments}
          members={members}
          votes={votes}
          currentMemberId={currentMemberId}
          variant="card"
        />
      </div>
    </article>
    </div>
  );
}
