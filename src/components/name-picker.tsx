"use client";

// "Who are you?" screen. The visitor has passed the gate but has no identity
// cookie yet. They either tap an existing member chip or join as a new name.
// Both paths set the member cookie via a server action, then route to the board.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { selectMember, createMember } from "@/actions/identity";
import type { Member } from "@/lib/types";
import { initials } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface NamePickerProps {
  members: Member[];
}

export function NamePicker({ members }: NamePickerProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  // Which existing chip is mid-flight (so we can show a subtle busy state).
  const [pendingMemberId, setPendingMemberId] = React.useState<string | null>(
    null,
  );
  const [name, setName] = React.useState("");

  const trimmedName = name.trim();
  const canJoin = Boolean(trimmedName) && !isPending;

  function handleSelect(member: Member) {
    if (isPending) return;
    setPendingMemberId(member.id);
    startTransition(async () => {
      try {
        await selectMember(member.id);
        router.push("/");
        router.refresh();
      } catch (error) {
        setPendingMemberId(null);
        const message =
          error instanceof Error ? error.message : "Could not pick that name.";
        toast.error(message);
      }
    });
  }

  function handleJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || isPending) return;
    startTransition(async () => {
      try {
        await createMember(trimmedName);
        router.push("/");
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not join, try again.";
        toast.error(message);
      }
    });
  }

  return (
    <Card className="glass w-full max-w-md rounded-3xl border-0 bg-card/60 p-2 ring-0 shadow-[0_30px_70px_-40px_var(--ocean)] animate-pop-in">
      <CardHeader className="items-center gap-1 px-6 pt-6 text-center">
        <div className="mb-1 text-4xl" aria-hidden>
          🌺
        </div>
        <CardTitle className="text-2xl text-gradient-sea">
          Who are you?
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tap your name so the crew knows whose votes are whose.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-6 pb-6">
        {/* Existing members as big tappable chips */}
        {members.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3">
            {members.map((member) => {
              const busy = pendingMemberId === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handleSelect(member)}
                  disabled={isPending}
                  className="flex min-h-12 items-center gap-2.5 rounded-full bg-card/80 py-2 pr-4 pl-2 text-base font-medium shadow-sm ring-1 ring-foreground/10 transition-all hover:bg-card hover:shadow-md active:translate-y-px disabled:opacity-60 data-[busy=true]:opacity-70"
                  data-busy={busy}
                  aria-label={`Continue as ${member.name}`}
                >
                  <span
                    className="flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: member.color }}
                    aria-hidden
                  >
                    {initials(member.name)}
                  </span>
                  <span className="pr-1">{member.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {members.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            new here?
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        {/* Join as a brand-new member */}
        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <Label htmlFor="join-name" className="text-foreground/80">
            Your name
          </Label>
          <Input
            id="join-name"
            placeholder="e.g. Maya"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={40}
            className="h-14 rounded-2xl bg-card/70 px-4 text-base shadow-sm"
          />
          <Button
            type="submit"
            disabled={!canJoin}
            className="h-14 w-full rounded-2xl bg-grad-sunset text-base font-semibold text-white shadow-lg shadow-sunset/25 hover:opacity-95"
          >
            {trimmedName ? `Join as ${trimmedName}` : "Join the trip"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
