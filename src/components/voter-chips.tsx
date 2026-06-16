// VoterChips — a compact readout of who voted which way.
// Two overlapping mini-avatar clusters: yes-voters get a green ring,
// no-voters an ink ring. Each circle shows a member's initials over
// their personal color. Empty clusters are hidden. This is a pure shared
// component (no hooks, no client state) — safe to render on the server.

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Member, Vote } from "@/lib/types";

interface VoterChipsProps {
  votes: Vote[];
  members: Member[];
}

interface ClusterProps {
  /** Members who voted this way, already resolved + ordered. */
  voters: Member[];
  /** Tone of the surrounding ring — yes = green, no = ink. */
  tone: "yes" | "no";
}

/**
 * A single overlapping avatar cluster with a count. Renders nothing when there
 * are no voters so the parent can lay out only the clusters that matter.
 */
function Cluster({ voters, tone }: ClusterProps) {
  if (voters.length === 0) return null;

  const ringClass = tone === "yes" ? "ring-yes" : "ring-no";

  return (
    <div className="flex items-center gap-1.5">
      {/* Overlapping initials — a thin colored ring marks the cluster's tone
          while keeping each member's personal color. */}
      <div className="flex -space-x-2">
        {voters.map((member) => (
          <span
            key={member.id}
            title={member.name}
            style={{ backgroundColor: member.color }}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full text-[0.65rem] font-semibold text-white",
              "ring-2 ring-offset-1 ring-offset-card",
              ringClass
            )}
          >
            {initials(member.name)}
          </span>
        ))}
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">
        {voters.length}
      </span>
    </div>
  );
}

/**
 * Render the yes / no voter clusters for an accommodation. Votes are matched to
 * members by id; unknown members (e.g. a deleted person) are skipped gracefully.
 */
export function VoterChips({ votes, members }: VoterChipsProps) {
  // Index members by id once so each lookup is O(1).
  const byId = new Map(members.map((m) => [m.id, m] as const));

  const yesVoters: Member[] = [];
  const noVoters: Member[] = [];
  for (const vote of votes) {
    const member = byId.get(vote.member_id);
    if (!member) continue;
    (vote.value ? yesVoters : noVoters).push(member);
  }

  // Nothing voted yet — render nothing rather than an empty row.
  if (yesVoters.length === 0 && noVoters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Cluster voters={yesVoters} tone="yes" />
      <Cluster voters={noVoters} tone="no" />
    </div>
  );
}
