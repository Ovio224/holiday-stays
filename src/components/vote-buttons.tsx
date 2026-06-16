"use client";

// VoteButtons — the two big, thumb-friendly pills at the heart of the board.
// YES (thumbs up, palm green when active) and NO (thumbs down, coral when
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
        <ThumbsUp className="size-5" strokeWidth={2.5} aria-hidden />
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
        <ThumbsDown className="size-5" strokeWidth={2.5} aria-hidden />
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
 * A single large vote pill (>= 48px tall → comfortably above the 44px touch
 * target floor). Inactive pills are soft tinted glass; the active pill flips to
 * a solid yes/no fill and pops in.
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
    tone === "yes"
      ? "bg-yes text-white shadow-[0_8px_20px_-8px] shadow-yes/70"
      : "bg-no text-white shadow-[0_8px_20px_-8px] shadow-no/70";
  const idleFill =
    tone === "yes"
      ? "bg-yes/10 text-yes hover:bg-yes/20"
      : "bg-no/10 text-no hover:bg-no/20";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3",
        "text-base font-bold transition-all duration-200 outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
        tone === "yes" ? "focus-visible:ring-yes/60" : "focus-visible:ring-no/60",
        active ? activeFill : idleFill,
        popped && "animate-pop-in"
      )}
    >
      {children}
      <span className="tabular-nums">{count}</span>
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
