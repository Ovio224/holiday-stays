"use client";

// Bottom-sheet editor for a trip leg ("stay"). Mirrors submit-sheet.tsx: a
// mobile bottom-sheet that calls the createStay/updateStay/deleteStay server
// actions via useTransition, toasts on success/failure, and closes.
//
// Mode is derived from `stay`: null = create, otherwise edit. The parent passes
// a `key` that changes on every open, so this component remounts per open and
// its field state initializes cleanly — no effect-syncing, no manual reset, and
// crucially no stale values when adding several legs back-to-back.
//
// Create mode is itinerary-aware: by default a new leg "continues from" the last
// leg (start = that leg's end date) and you just pick the number of nights; the
// new leg is inserted right after whichever leg you continue from. An "exact
// dates" escape hatch falls back to the manual date pickers (also used in edit
// mode, and when there are no legs to chain from yet).

import * as React from "react";
import { toast } from "sonner";
import { CornerDownRight, Minus, Plus, Trash2Icon } from "lucide-react";

import { createStay, updateStay, deleteStay } from "@/actions/stays";
import { addNights } from "@/lib/stays";
import { formatDateRange, nights as nightsBetween } from "@/lib/format";
import type { Stay } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LegSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The leg being edited, or null to create a new one. */
  stay: Stay | null;
  /** All legs in display order — powers the create-mode "continue from" picker. */
  stays: Stay[];
  /**
   * Called with the rows returned by create/update (the saved leg, plus any legs
   * whose order shifted on insert) so the board reflects the change immediately —
   * no dependency on the realtime echo arriving.
   */
  onSaved?: (changed: Stay[]) => void;
  /** Called with the deleted leg's id so the board drops it immediately. */
  onDeleted?: (stayId: string) => void;
}

export function LegSheet({
  open,
  onOpenChange,
  stay,
  stays,
  onSaved,
  onDeleted,
}: LegSheetProps) {
  const isEdit = stay !== null;
  const [isPending, startTransition] = React.useTransition();
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // The leg a new one continues from by default: the last one in the itinerary.
  const lastLeg = stays.length > 0 ? stays[stays.length - 1] : null;

  // Field state seeds once from props. The parent remounts this component on
  // every open (via a changing `key`), so these initializers always reflect the
  // right leg and a fresh create form.
  const [label, setLabel] = React.useState(stay?.label ?? "");
  const [area, setArea] = React.useState(stay?.area ?? "");
  const [startDate, setStartDate] = React.useState(stay?.start_date ?? "");
  const [endDate, setEndDate] = React.useState(stay?.end_date ?? "");
  const [continueFromId, setContinueFromId] = React.useState(lastLeg?.id ?? "");
  const [nights, setNights] = React.useState(() => {
    // Default to the previous leg's own length, else a sensible 3.
    const n = lastLeg ? nightsBetween(lastLeg.start_date, lastLeg.end_date) : null;
    return String(n && n > 0 ? n : 3);
  });
  // When true, the user has opted into the manual date pickers for this create.
  const [manualDates, setManualDates] = React.useState(false);

  // The leg the new one continues from (create mode only).
  const predecessor =
    !isEdit && continueFromId
      ? (stays.find((s) => s.id === continueFromId) ?? null)
      : null;
  // We can chain dates only when that leg actually has an end date to start from.
  const canChain = !isEdit && predecessor?.end_date != null;
  const chaining = canChain && !manualDates;

  const nightsNum = Math.max(0, Math.floor(Number(nights)));
  const chainStart = predecessor?.end_date ?? null;
  const chainEnd =
    chaining && chainStart ? addNights(chainStart, nightsNum) : null;

  // Dates actually submitted: derived from the chain, or the manual fields.
  const effStart = chaining ? chainStart : startDate || null;
  const effEnd = chaining ? chainEnd : endDate || null;

  const continueItems = React.useMemo(
    () => stays.map((s) => ({ label: `After ${s.label}`, value: s.id })),
    [stays],
  );

  const trimmedLabel = label.trim();
  // Manual-mode date guard (chained dates are always in order by construction).
  const datesOutOfOrder =
    !chaining && Boolean(startDate) && Boolean(endDate) && endDate < startDate;
  const canSubmit =
    Boolean(trimmedLabel) &&
    !datesOutOfOrder &&
    !isPending &&
    (!chaining || nightsNum >= 1);

  // Switch from the nights chain to the manual pickers, seeding them with the
  // dates we'd have derived so nothing is lost.
  function enableManualDates() {
    if (chainStart) setStartDate(chainStart);
    if (chainEnd) setEndDate(chainEnd);
    setManualDates(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      try {
        const fields = {
          label: trimmedLabel,
          area: area.trim() || null,
          startDate: effStart,
          endDate: effEnd,
        };
        if (isEdit) {
          const saved = await updateStay({ id: stay.id, ...fields });
          onSaved?.([saved]);
        } else {
          const { created, shifted } = await createStay({
            ...fields,
            // The picked leg sets BOTH the start date and where this leg slots
            // in; empty (no legs yet) appends to the end.
            afterStayId: continueFromId || null,
          });
          onSaved?.([created, ...shifted]);
        }
        toast.success(isEdit ? "Saved" : "Added");
        onOpenChange(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save that leg.";
        toast.error(message);
      }
    });
  }

  function handleDelete() {
    if (!stay) return;
    startDeleteTransition(async () => {
      try {
        await deleteStay(stay.id);
        onDeleted?.(stay.id);
        toast.success("Leg removed");
        setConfirmOpen(false);
        onOpenChange(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not remove that leg.";
        toast.error(message);
      }
    });
  }

  // The manual start/end date pickers — used in edit mode, when creating the very
  // first leg, and as the "exact dates" escape hatch from the nights chain.
  const dateFields = (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="leg-start" className="text-sm font-medium text-foreground">
          Start date{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="leg-start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="h-12 rounded-lg px-4 text-base"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="leg-end" className="text-sm font-medium text-foreground">
          End date{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="leg-end"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="h-12 rounded-lg px-4 text-base"
        />
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl border-t border-border bg-card pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-sm"
      >
        {/* Grab handle for the bottom-sheet feel */}
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-border" />

        <SheetHeader className="px-5 pt-1 text-center sm:text-left">
          <SheetTitle className="text-xl font-semibold text-foreground sm:text-2xl">
            {isEdit ? "Edit leg" : "Add a leg"}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            {isEdit
              ? "Update the name, area, or dates for this leg."
              : stays.length > 0
                ? "Add the next stop — pick where it continues from and how many nights."
                : "Name your first stop and (optionally) set its dates."}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-4"
        >
          {/* Name — required */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="leg-label" className="text-sm font-medium text-foreground">
              Name
            </Label>
            <Input
              id="leg-label"
              autoFocus
              required
              placeholder="Ubud"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
          </div>

          {/* Area — optional */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="leg-area" className="text-sm font-medium text-foreground">
              Area{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="leg-area"
              placeholder="Jungle / rice fields"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
          </div>

          {!isEdit && stays.length > 0 ? (
            <>
              {/* Continue from — sets the start date AND the insert position. */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-foreground">
                  Continue from
                </Label>
                <Select
                  items={continueItems}
                  value={continueFromId}
                  onValueChange={(value) => setContinueFromId(value as string)}
                >
                  <SelectTrigger className="h-12 w-full rounded-lg px-4 text-base">
                    <CornerDownRight className="size-4 text-muted-foreground" />
                    <SelectValue placeholder="Pick a leg" />
                  </SelectTrigger>
                  <SelectContent>
                    {stays.map((s) => (
                      <SelectItem
                        key={s.id}
                        value={s.id}
                        className="py-2 text-base"
                      >
                        After {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The new leg slots in right after this one.
                </p>
              </div>

              {chaining ? (
                // Nights chain: start = previous end, end = start + nights.
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-foreground">
                    Nights
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setNights(String(Math.max(1, nightsNum - 1)))
                      }
                      disabled={nightsNum <= 1}
                      aria-label="Fewer nights"
                      className="flex size-12 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    >
                      <Minus className="size-4" aria-hidden />
                    </button>
                    <Input
                      aria-label="Nights"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={nights}
                      onChange={(e) => setNights(e.target.value)}
                      className="h-12 w-20 rounded-lg px-3 text-center text-base"
                    />
                    <button
                      type="button"
                      onClick={() => setNights(String(nightsNum + 1))}
                      aria-label="More nights"
                      className="flex size-12 items-center justify-center rounded-lg border border-input text-foreground transition-colors hover:bg-muted"
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                    {chainStart && chainEnd && (
                      <p className="ml-1 text-sm text-muted-foreground">
                        {formatDateRange(chainStart, chainEnd)} ·{" "}
                        {nightsNum} {nightsNum === 1 ? "night" : "nights"}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={enableManualDates}
                    className="w-fit text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Set exact dates instead
                  </button>
                </div>
              ) : (
                <>
                  {predecessor && !predecessor.end_date && (
                    <p className="text-xs text-muted-foreground">
                      “{predecessor.label}” has no end date yet — set this leg’s
                      dates below.
                    </p>
                  )}
                  {canChain && (
                    <button
                      type="button"
                      onClick={() => setManualDates(false)}
                      className="w-fit text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Use nights instead
                    </button>
                  )}
                  {dateFields}
                </>
              )}
            </>
          ) : (
            // Edit mode, or the very first leg: plain manual date pickers.
            dateFields
          )}

          {datesOutOfOrder && (
            <p className="text-xs text-destructive">
              The end date can&apos;t be before the start date.
            </p>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 h-14 w-full rounded-lg bg-primary text-base font-semibold text-white hover:bg-[#e00b41]"
          >
            {isPending
              ? isEdit
                ? "Saving…"
                : "Adding…"
              : isEdit
                ? "Save changes"
                : "Add leg"}
          </Button>

          {/* Edit mode only: destructive, confirmed delete. */}
          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              className="mb-2 h-11 w-full rounded-lg text-sm font-semibold"
            >
              <Trash2Icon className="size-4" aria-hidden />
              Delete leg
            </Button>
          )}
        </form>
      </SheetContent>

      {/* Cascading-delete confirmation. */}
      {isEdit && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this leg?</DialogTitle>
              <DialogDescription>
                This also removes every place and vote in it. This can&apos;t be
                undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" disabled={isDeleting} />}
              >
                Cancel
              </DialogClose>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Removing…" : "Delete leg"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  );
}
