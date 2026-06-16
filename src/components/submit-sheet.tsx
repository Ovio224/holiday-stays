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
  const [stayId, setStayId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [priceText, setPriceText] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // The stay select's value falls back to the requested default, then the
  // first stay. Re-sync whenever the sheet opens with a new preset.
  const resolvedDefaultStayId = defaultStayId ?? stays[0]?.id ?? null;

  React.useEffect(() => {
    // Re-seed the stay selection whenever the sheet opens or the preset changes.
    if (open) {
      setStayId(resolvedDefaultStayId);
    }
  }, [open, resolvedDefaultStayId]);

  // Build the items map so <SelectValue> can render a stay's label by value.
  const stayItems = React.useMemo(
    () => stays.map((s) => ({ label: stayLabel(s), value: s.id })),
    [stays],
  );

  function resetForm() {
    setUrl("");
    setTitle("");
    setPriceText("");
    setNotes("");
    setStayId(resolvedDefaultStayId);
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

    startTransition(async () => {
      try {
        await submitAccommodation({
          url: trimmedUrl,
          stayId,
          memberId: currentMemberId,
          title: title.trim() || undefined,
          priceText: priceText.trim() || undefined,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="glass-strong max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl border-t-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        {/* Grab handle for the bottom-sheet feel */}
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-foreground/15" />

        <SheetHeader className="px-5 pt-1 text-center sm:text-left">
          <SheetTitle className="text-xl text-gradient-sea sm:text-2xl">
            Add a place
          </SheetTitle>
          <SheetDescription>
            Paste a link and we&rsquo;ll tidy it up for the crew.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-4"
        >
          {/* URL — the star of the form */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-url" className="text-foreground/80">
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
              className="h-14 rounded-2xl bg-card/70 px-4 text-base shadow-sm"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SparklesIcon className="size-3.5 text-sunset" />
              We will try to grab the photo &amp; price automatically.
            </p>
          </div>

          {/* Which stay this belongs to */}
          <div className="flex flex-col gap-2">
            <Label className="text-foreground/80">Which stay?</Label>
            <Select
              items={stayItems}
              value={stayId}
              onValueChange={(value) => setStayId(value as string | null)}
            >
              <SelectTrigger className="h-12 w-full rounded-2xl bg-card/70 px-4 text-base">
                <MapPinIcon className="size-4 text-lagoon" />
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
            <Label htmlFor="submit-title" className="text-foreground/80">
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
              className="h-12 rounded-2xl bg-card/70 px-4 text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-price" className="text-foreground/80">
              Price{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="submit-price"
              inputMode="text"
              placeholder="€120 / night"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="h-12 rounded-2xl bg-card/70 px-4 text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="submit-notes" className="text-foreground/80">
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
              className="min-h-20 rounded-2xl bg-card/70 px-4 py-3 text-base"
            />
          </div>

          {/* Helper when the visitor has no identity yet */}
          {!currentMemberId && (
            <p className="rounded-2xl bg-mango/15 px-4 py-3 text-sm text-foreground/70">
              Pick who you are first to start adding places.
            </p>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 mb-2 h-14 w-full rounded-2xl bg-grad-sea text-base font-semibold text-white shadow-lg shadow-ocean/25 hover:opacity-95"
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
