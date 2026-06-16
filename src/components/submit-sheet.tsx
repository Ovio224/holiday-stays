"use client";

// Bottom-sheet form for adding a new place to a stay. Works as a mobile
// bottom-sheet and is equally at home on desktop. Calls the submitAccommodation
// server action; on success it toasts, resets, and closes.

import * as React from "react";
import { toast } from "sonner";

import { submitAccommodation } from "@/actions/accommodations";
import type { Stay } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MapPinIcon, SparklesIcon } from "lucide-react";

interface SubmitSheetProps {
  stays: Stay[];
  currentMemberId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStayId: string | null;
}

export function SubmitSheet({
  stays,
  currentMemberId,
  open,
  onOpenChange,
  defaultStayId,
}: SubmitSheetProps) {
  const [isPending, startTransition] = React.useTransition();

  // Form field state.
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [currency, setCurrency] = React.useState("$");
  const [pricePerNight, setPricePerNight] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // The selected stay is DERIVED (not synced via an effect): until the user
  // explicitly picks one, it falls back to the requested preset, then the first
  // stay. `stayOverride` is cleared when the sheet closes, so reopening for a
  // different leg naturally adopts the new preset.
  const resolvedDefaultStayId = defaultStayId ?? stays[0]?.id ?? null;
  const [stayOverride, setStayOverride] = React.useState<string | null>(null);
  const stayId = stayOverride ?? resolvedDefaultStayId;

  // Build the items map so <SelectValue> can render a stay's label by value.
  const stayItems = React.useMemo(
    () => stays.map((s) => ({ label: stayLabel(s), value: s.id })),
    [stays],
  );

  function resetForm() {
    setUrl("");
    setTitle("");
    setCurrency("$");
    setPricePerNight("");
    setNotes("");
    setStayOverride(null);
  }

  // Reset fields whenever the sheet closes so the next open starts fresh and
  // adopts its new preset stay via the derived value above.
  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  const trimmedUrl = url.trim();
  const canSubmit =
    Boolean(currentMemberId) &&
    Boolean(trimmedUrl) &&
    Boolean(stayId) &&
    !isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentMemberId || !trimmedUrl || !stayId) return;

    // Only send a numeric price when the field holds a valid finite number;
    // otherwise omit it so the server keeps its (usually parsed/null) value.
    const parsedPrice = Number(pricePerNight);
    const pricePerNightValue =
      pricePerNight.trim() && Number.isFinite(parsedPrice) ? parsedPrice : undefined;

    startTransition(async () => {
      try {
        await submitAccommodation({
          url: trimmedUrl,
          stayId,
          memberId: currentMemberId,
          title: title.trim() || undefined,
          pricePerNight: pricePerNightValue,
          currency: currency.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        toast.success("Added");
        resetForm();
        onOpenChange(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not add that place.";
        toast.error(message);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl border-t border-border bg-card pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-sm"
      >
        {/* Grab handle for the bottom-sheet feel */}
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-border" />

        <SheetHeader className="px-5 pt-1 text-center sm:text-left">
          <SheetTitle className="text-xl font-semibold text-foreground sm:text-2xl">
            Add a place
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Paste a link to add it to the board.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-4"
        >
          {/* URL — the star of the form */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-url" className="text-sm font-medium text-foreground">
              Link
            </Label>
            <Input
              id="submit-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              required
              placeholder="https://airbnb.com/rooms/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-14 rounded-lg px-4 text-base"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SparklesIcon className="size-3.5 text-muted-foreground" />
              We will auto-fill the name, rating and room details from the link.
            </p>
          </div>

          {/* Which stay this belongs to */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium text-foreground">Stay</Label>
            <Select
              items={stayItems}
              value={stayId}
              onValueChange={(value) => setStayOverride(value as string | null)}
            >
              <SelectTrigger className="h-12 w-full rounded-lg px-4 text-base">
                <MapPinIcon className="size-4 text-muted-foreground" />
                <SelectValue placeholder="Pick a stay" />
              </SelectTrigger>
              <SelectContent>
                {stays.map((stay) => (
                  <SelectItem
                    key={stay.id}
                    value={stay.id}
                    className="py-2 text-base"
                  >
                    {stayLabel(stay)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional extras */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-title" className="text-sm font-medium text-foreground">
              Title{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="submit-title"
              placeholder="Cliffside villa with a pool"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-price" className="text-sm font-medium text-foreground">
              Price / night{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <div className="flex items-stretch gap-2">
              <Input
                aria-label="Currency"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="$"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-12 w-16 rounded-lg px-3 text-center text-base"
              />
              <Input
                id="submit-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="120"
                value={pricePerNight}
                onChange={(e) => setPricePerNight(e.target.value)}
                className="h-12 flex-1 rounded-lg px-4 text-base"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Airbnb hides the price, so add it here to track budget.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-notes" className="text-sm font-medium text-foreground">
              Notes{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="submit-notes"
              placeholder="Walking distance to the beach, sleeps 6…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-20 rounded-lg px-4 py-3 text-base"
            />
          </div>

          {/* Helper when the visitor has no identity yet */}
          {!currentMemberId && (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
              Pick who you are first to start adding places.
            </p>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 mb-2 h-14 w-full rounded-lg bg-primary text-base font-semibold text-white hover:bg-[#e00b41]"
          >
            {isPending ? "Adding…" : "Add to the board"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** A friendly label for a stay in the picker: "Ubud · Aug 1 - 4". */
function stayLabel(stay: Stay): string {
  return stay.area ? `${stay.label} · ${stay.area}` : stay.label;
}
