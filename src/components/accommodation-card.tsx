// AccommodationCard — a premium frosted-glass card for one candidate stay.
// Shows a 16:9 cover (with a tropical placeholder when imageless), a colored
// source badge, the title as an external link, an optional price pill + notes,
// the submitter chip, and finally the vote pills + voter clusters.
//
// This is a shared component: it renders fine on the server and embeds the
// VoteButtons client island for interactivity.

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Palmtree } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { VoteButtons } from "@/components/vote-buttons";
import { VoterChips } from "@/components/voter-chips";
import { sourceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AccommodationSource, AccommodationWithVotes, Member } from "@/lib/types";

interface AccommodationCardProps {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
}

/** Source badge tint — Airbnb coral/hibiscus, Booking ocean blue, else lagoon. */
function sourceBadgeClass(source: AccommodationSource): string {
  switch (source) {
    case "airbnb":
      return "bg-hibiscus/15 text-hibiscus";
    case "booking":
      return "bg-ocean/15 text-ocean";
    default:
      return "bg-lagoon/20 text-lagoon";
  }
}

export function AccommodationCard({
  accommodation,
  members,
  currentMemberId,
}: AccommodationCardProps) {
  const { votes } = accommodation;

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
    ? members.find((m) => m.id === accommodation.submitted_by) ?? null
    : null;

  const title = accommodation.title?.trim() || "Untitled stay";

  return (
    <article className="group/card glass animate-pop-in flex flex-col overflow-hidden rounded-3xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-28px_var(--ocean)]">
      {/* Cover — 16:9. Real image when we have one, otherwise a sea-gradient
          panel with a friendly palm so empty cards still feel intentional. */}
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
          <div className="bg-grad-sea flex h-full w-full items-center justify-center">
            <Palmtree
              className="size-12 text-white/80 drop-shadow"
              strokeWidth={1.75}
              aria-hidden
            />
          </div>
        )}

        {/* Source badge floats over the image for a polished overlay feel. */}
        <Badge
          className={cn(
            "absolute top-3 left-3 backdrop-blur-md shadow-sm",
            sourceBadgeClass(accommodation.source)
          )}
        >
          {sourceLabel(accommodation.source)}
        </Badge>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Title links out to the original listing in a new tab. */}
        <Link
          href={accommodation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/title flex items-start gap-1.5 font-heading text-lg leading-snug font-semibold text-foreground transition-colors hover:text-ocean"
        >
          <span className="line-clamp-2">{title}</span>
          <ExternalLink
            className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100"
            aria-hidden
          />
        </Link>

        {/* Price pill — only when we actually have a price. */}
        {accommodation.price_text && (
          <span className="w-fit rounded-full bg-sunset/15 px-3 py-1 text-sm font-semibold text-sunset">
            {accommodation.price_text}
          </span>
        )}

        {/* Optional notes from whoever added it. */}
        {accommodation.notes?.trim() && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {accommodation.notes}
          </p>
        )}

        {/* "added by" chip, tinted with the submitter's personal color. */}
        {submitter && (
          <div
            className="flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              backgroundColor: `color-mix(in oklab, ${submitter.color} 16%, transparent)`,
              color: submitter.color,
            }}
          >
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: submitter.color }}
              aria-hidden
            />
            added by {submitter.name}
          </div>
        )}

        {/* Push the voting controls to the bottom so cards align on a grid. */}
        <div className="mt-auto flex flex-col gap-3 pt-1">
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
