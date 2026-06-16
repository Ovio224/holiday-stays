// AccommodationCard — a clean Airbnb-style listing card for one candidate stay.
// Shows a 16:9 cover (with a neutral placeholder when imageless), a subtle
// source badge, the title as an external link, an optional inline price + notes,
// the submitter chip, and finally the vote pills + voter clusters.
//
// This is a shared component: it renders fine on the server and embeds the
// VoteButtons client island for interactivity.

import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { VoteButtons } from "@/components/vote-buttons";
import { VoterChips } from "@/components/voter-chips";
import { sourceLabel } from "@/lib/format";
import type { AccommodationWithVotes, Member } from "@/lib/types";

interface AccommodationCardProps {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
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
    <article className="group/card flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {/* Cover — 16:9. Real image when we have one, otherwise a neutral
          placeholder so empty cards still read as intentional. */}
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
            <ImageOff
              className="size-10 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
          </div>
        )}

        {/* Source badge floats over the image as a subtle white pill. */}
        <Badge className="absolute top-3 left-3 border border-border bg-white/90 text-foreground shadow-sm">
          {sourceLabel(accommodation.source)}
        </Badge>
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

        {/* Price — shown inline in bold ink, Airbnb-style. */}
        {accommodation.price_text && (
          <p className="text-sm font-semibold text-foreground">
            {accommodation.price_text}
          </p>
        )}

        {/* Optional notes from whoever added it. */}
        {accommodation.notes?.trim() && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {accommodation.notes}
          </p>
        )}

        {/* "added by" chip, with the submitter's personal color as a dot. */}
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

        {/* Push the voting controls to the bottom so cards align on a grid. */}
        <div className="mt-auto flex flex-col gap-3 pt-2">
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
