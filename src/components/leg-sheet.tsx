"use client";

// Bottom-sheet editor for a trip leg ("stay"). Mirrors submit-sheet.tsx: a
// mobile bottom-sheet that calls the createStay/updateStay/deleteStay server
// actions via useTransition, toasts on success/failure, and closes.
//
// Mode is derived from `stay`: null = create, otherwise edit. The parent passes
// a `key` keyed on the target leg, so this component remounts per target and its
// field state initializes cleanly from props — no effect-syncing, no manual
// reset. Edit mode additionally offers a destructive, confirmed delete.

import * as React from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";

import { createStay, updateStay, deleteStay } from "@/actions/stays";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LegSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stay: Stay | null;
  /**
   * Called with the row returned by createStay/updateStay so the board reflects
   * the change immediately — no dependency on the realtime echo arriving.
   */
  onSaved?: (stay: Stay) => void;
  /** Called with the deleted leg's id so the board drops it immediately. */
  onDeleted?: (stayId: string) => void;
}

export function LegSheet({
  open,
  onOpenChange,
  stay,
  onSaved,
  onDeleted,
}: LegSheetProps) {
  const isEdit = stay !== null;
  const [isPending, startTransition] = React.useTransition();
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Field state seeds once from props. The parent remounts this component per
  // target (via `key`), so these initializers always reflect the right leg.
  const [label, setLabel] = React.useState(stay?.label ?? "");
  const [area, setArea] = React.useState(stay?.area ?? "");
  const [startDate, setStartDate] = React.useState(stay?.start_date ?? "");
  const [endDate, setEndDate] = React.useState(stay?.end_date ?? "");

  const trimmedLabel = label.trim();
  // Mirror the server's date guard so we can disable submit + hint inline.
  const datesOutOfOrder =
    Boolean(startDate) && Boolean(endDate) && endDate < startDate;
  const canSubmit = Boolean(trimmedLabel) && !datesOutOfOrder && !isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      try {
        const fields = {
          label: trimmedLabel,
          area: area.trim() || null,
          startDate: startDate || null,
          endDate: endDate || null,
        };
        const saved = isEdit
          ? await updateStay({ id: stay.id, ...fields })
          : await createStay(fields);
        onSaved?.(saved);
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
              : "Name a new stop on the itinerary and (optionally) its dates."}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-4"
        >
          {/* Label — required */}
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

          {/* Dates — native pickers; values are YYYY-MM-DD */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label
                htmlFor="leg-start"
                className="text-sm font-medium text-foreground"
              >
                Start date{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
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
              <Label
                htmlFor="leg-end"
                className="text-sm font-medium text-foreground"
              >
                End date{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
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
