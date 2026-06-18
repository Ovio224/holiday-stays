"use client";

// VoteButtons — the two thumb-friendly pills at the heart of the board.
// YES (thumbs up, green when active) and NO (thumbs down, ink when
// active). Each shows its live count. Tapping casts a vote optimistically:
// we flip the local UI immediately inside a transition, then reconcile with
// the server. If no member is selected yet we disable and nudge the user to
// pick a name first.

import { useOptimistic, useState, useTransition } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { castVote } from "@/actions/votes";
import { cn } from "@/lib/utils";
import type { Vote } from "@/lib/types";

interface VoteButtonsProps {
  accommodationId: string;
  currentMemberId: string | null;
  /** This member's current vote: true = yes, false = no, null = no vote yet. */
  currentValue: boolean | null;
  yesCount: number;
  noCount: number;
  /** Group size — the denominator for the quorum line + participation bar. */
  memberCount: number;
  /**
   * Fold the cast vote into board state once the server confirms it (the row on
   * a cast/flip, null on a toggle-off), so it sticks without the realtime echo.
   */
  onVoted: (vote: Vote | null) => void;
}

/** Local snapshot of what the buttons should show, kept optimistic. */
interface VoteState {
  value: boolean | null;
  yes: number;
  no: number;
}

export function VoteButtons({
  accommodationId,
  currentMemberId,
  currentValue,
  yesCount,
  noCount,
  memberCount,
  onVoted,
}: VoteButtonsProps) {
  const [isPending, startTransition] = useTransition();

  // Base truth from props; useOptimistic layers the in-flight guess on top so
  // realtime/server updates flowing through props still win once settled.
  const base: VoteState = { value: currentValue, yes: yesCount, no: noCount };
  const [optimistic, applyOptimistic] = useOptimistic(
    base,
    (state, next: boolean) => projectVote(state, next)
  );

  // Track which button most recently became active so we can pop just that one.
  const [popped, setPopped] = useState<boolean | null>(null);

  function handleVote(next: boolean) {
    if (!currentMemberId) {
      toast.error("Pick your name first");
      return;
    }
    // Tapping the side you already chose is a deliberate toggle-OFF: castVote
    // deletes the existing vote, so we must still fire (and project) it.
    setPopped(next);
    startTransition(async () => {
      applyOptimistic(next);
      try {
        // Fold the confirmed vote into board state so it survives the optimistic
        // reset (useOptimistic snaps back to props once the transition settles).
        const saved = await castVote({
          accommodationId,
          memberId: currentMemberId,
          value: next,
        });
        onVoted(saved);
      } catch {
        toast.error("Couldn't save your vote — try again");
      }
    });
  }

  const disabled = !currentMemberId;
  const yesActive = optimistic.value === true;
  const noActive = optimistic.value === false;

  return (
    <div className="flex flex-col gap-2.5">
      <ConsensusStrip
        yes={optimistic.yes}
        no={optimistic.no}
        memberCount={memberCount}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <VotePill
          tone="yes"
          active={yesActive}
          popped={popped === true && yesActive}
          count={optimistic.yes}
          disabled={disabled || isPending}
          onClick={() => handleVote(true)}
          label="Vote yes"
        >
          <ThumbsUp className="size-4" strokeWidth={2} aria-hidden />
        </VotePill>

        <VotePill
          tone="no"
          active={noActive}
          popped={popped === false && noActive}
          count={optimistic.no}
          disabled={disabled || isPending}
          onClick={() => handleVote(false)}
          label="Vote no"
        >
          <ThumbsDown className="size-4" strokeWidth={2} aria-hidden />
        </VotePill>
      </div>
    </div>
  );
}

/**
 * The glanceable group verdict that sits above the pills: a net-score pill, a
 * participation/split bar, and a quorum line. It reads from the SAME optimistic
 * tallies as the pills, so it shifts the instant you vote — before the server
 * round-trip. Wrapped in an aria-live region so screen-reader users hear the
 * running tally as realtime votes stream in (polite, never interrupting).
 */
function ConsensusStrip({
  yes,
  no,
  memberCount,
}: {
  yes: number;
  no: number;
  memberCount: number;
}) {
  const voted = yes + no;
  const net = yes - no;
  // Denominator for the bar: the group size, but never less than the votes cast
  // (a removed member's stale vote shouldn't overflow the bar past 100%).
  const denom = Math.max(memberCount, voted, 1);
  const yesPct = (yes / denom) * 100;
  const noPct = (no / denom) * 100;
  const everyone = voted > 0 && memberCount > 0 && voted >= memberCount;

  const quorum =
    voted === 0
      ? "No votes yet"
      : everyone
        ? "Everyone voted"
        : `${voted} of ${memberCount} voted`;

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-1.5">
      {/* One clean sentence for assistive tech; the visual chips below are hidden
          from the a11y tree so the tally isn't announced twice. */}
      <span className="sr-only">
        {yes} yes, {no} no. {quorum}.
      </span>

      <div aria-hidden className="flex items-center justify-between gap-2">
        {voted === 0 ? (
          <span className="text-xs font-medium text-muted-foreground">Cast the first vote</span>
        ) : net === 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
            Tied {yes}–{no}
          </span>
        ) : (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              net > 0 ? "bg-yes/12 text-yes" : "bg-foreground/10 text-foreground",
            )}
          >
            {net > 0 ? `+${net}` : `−${Math.abs(net)}`} {net > 0 ? "leaning yes" : "leaning no"}
          </span>
        )}

        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
          {everyone && <Check className="size-3.5 text-yes" aria-hidden />}
          {quorum}
        </span>
      </div>

      {/* Participation bar: green YES + ink NO segments over a hairline track, so
          "few voted" reads as a mostly-empty bar and "split" reads as two colors. */}
      <div
        aria-hidden
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <span
          className="h-full bg-yes transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${yesPct}%` }}
        />
        <span
          className="h-full bg-no transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${noPct}%` }}
        />
      </div>
    </div>
  );
}

interface VotePillProps {
  tone: "yes" | "no";
  active: boolean;
  popped: boolean;
  count: number;
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

/**
 * A single vote pill (>= 48px tall → comfortably above the 44px touch target
 * floor). Inactive pills are clean white with a hairline border; the active
 * pill flips to a solid yes/no fill and pops in subtly.
 */
function VotePill({
  tone,
  active,
  popped,
  count,
  disabled,
  onClick,
  label,
  children,
}: VotePillProps) {
  const activeFill =
    tone === "yes" ? "bg-yes text-white" : "bg-no text-white";
  const idleFill =
    "border border-border bg-white text-foreground hover:bg-muted";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex min-h-12 items-center justify-center gap-2 rounded-full px-4 py-3",
        "text-base font-semibold transition-all duration-200 outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:ring-ring/50",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
        active ? activeFill : idleFill,
        popped && "animate-pop-in"
      )}
    >
      {children}
      <span
        className={cn(
          "tabular-nums",
          !active && "text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Pure transition: given the prior vote state and the tapped value, return the
 * projected counts + value. Tapping the side you already chose toggles your vote
 * OFF (back to undecided); switching sides moves a tally; voting fresh adds one.
 * This mirrors castVote on the server (same value → delete, else upsert).
 */
function projectVote(state: VoteState, next: boolean): VoteState {
  let { yes, no } = state;

  // Toggle off: tapping your current side removes the vote.
  if (state.value === next) {
    if (next) yes = Math.max(0, yes - 1);
    else no = Math.max(0, no - 1);
    return { value: null, yes, no };
  }

  // Otherwise remove the previous vote (if any) and add the new one.
  if (state.value === true) yes = Math.max(0, yes - 1);
  if (state.value === false) no = Math.max(0, no - 1);
  if (next) yes += 1;
  else no += 1;

  return { value: next, yes, no };
}
