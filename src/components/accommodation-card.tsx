// AccommodationCard — a clean Airbnb-style listing card for one candidate stay.
// Shows a 16:9 cover with a source badge and a rating pill, the parsed name,
// capacity details (guests / bedrooms / beds / baths), a prominent price with a
// per-leg budget total, optional notes, the submitter, then votes.
//
// Shared component: renders on the server, embeds the VoteButtons client island.

import Image from "next/image";
import Link from "next/link";
import { ImageOff, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { AccommodationDetailDialog } from "@/components/accommodation-detail-dialog";
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
  const { votes, prices, details } = accommodation;

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
  const rating = formatRating(details?.rating ?? null);
  const reviews = details?.reviews ?? null;
  const chips = detailChips(details);

  // Price + per-leg budget total.
  const nightly = formatMoney(accommodation.price_per_night, accommodation.currency);
  const total = formatMoney(
    nightlyTotal(accommodation.price_per_night, stayNights),
    accommodation.currency,
  );

  return (
    <article className="group/card flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {/* Cover — 16:9, with source badge (left) and rating pill (right). */}
      <div className="relative aspect-video w-full overflow-hidden">
        {accommodation.image_url ? (
          <Image
            src={accommodation.image_url}
            alt={title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover/card:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <ImageOff className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          </div>
        )}

        <Badge className="absolute top-3 left-3 border border-border bg-white/90 text-foreground shadow-sm">
          {sourceLabel(accommodation.source)}
        </Badge>

        {rating && (
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full border border-border bg-white/90 px-2 py-1 text-xs font-semibold text-foreground shadow-sm">
            <Star className="size-3 fill-foreground text-foreground" aria-hidden />
            {rating}
            {reviews != null && (
              <span className="font-normal text-muted-foreground">({reviews})</span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Title links out to the original listing in a new tab. */}
        <Link
          href={accommodation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base leading-snug font-semibold text-foreground transition-colors hover:underline"
        >
          <span className="line-clamp-2">{title}</span>
        </Link>

        {/* Capacity details parsed from the listing. */}
        {chips.length > 0 && (
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {chips.join(" · ")}
          </p>
        )}

        {/* Price + per-leg budget total. */}
        {nightly ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-base font-semibold text-foreground">{nightly}</span>
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
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {accommodation.notes}
          </p>
        )}

        {/* "Added by" chip, with the submitter's personal color as a dot. */}
        {submitter && (
          <div className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: submitter.color }}
              aria-hidden
            />
            Added by {submitter.name}
          </div>
        )}

        {/* Push the price comparison + voting controls to the bottom so cards
            align on a grid. */}
        <div className="mt-auto flex flex-col gap-3 pt-2">
          {/* Expand into the full detail + edit dialog (client island). */}
          <AccommodationDetailDialog
            accommodation={accommodation}
            members={members}
            currentMemberId={currentMemberId}
            stayArea={stayArea}
            stayLabel={stayLabel}
            stayNights={stayNights}
          />

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

          <VoteButtons
            accommodationId={accommodation.id}
            currentMemberId={currentMemberId}
            currentValue={currentValue}
            yesCount={yesCount}
            noCount={noCount}
          />
          <VoterChips votes={votes} members={members} />
        </div>
      </div>
    </article>
  );
}
