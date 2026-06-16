"use client";

// VoteButtons — the two thumb-friendly pills at the heart of the board.
// YES (thumbs up, green when active) and NO (thumbs down, ink when
// active). Each shows its live count. Tapping casts a vote optimistically:
// we flip the local UI immediately inside a transition, then reconcile with
// the server. If no member is selected yet we disable and nudge the user to
// pick a name first.

import { useOptimistic, useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { castVote } from "@/actions/votes";
import { cn } from "@/lib/utils";

interface VoteButtonsProps {
  accommodationId: string;
  currentMemberId: string | null;
  /** This member's current vote: true = yes, false = no, null = no vote yet. */
  currentValue: boolean | null;
  yesCount: number;
  noCount: number;
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
        await castVote({
          accommodationId,
          memberId: currentMemberId,
          value: next,
        });
      } catch {
        toast.error("Couldn't save your vote — try again");
      }
    });
  }

  const disabled = !currentMemberId;
  const yesActive = optimistic.value === true;
  const noActive = optimistic.value === false;

  return (
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
