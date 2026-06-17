"use client";

// PlacesManager — the per-leg "Places to visit" list that lives inside a
// StaySection (where the leg's accommodations render). Add/edit forms are hosted
// in a bottom-sheet, consistent with how legs are edited (leg-sheet.tsx). It owns
// the submitPlace / updatePlace / deletePlace / setManualLocation actions and
// folds their results into live board state via onPlaceSaved / onPlaceRemoved, so
// the acting member sees the change instantly (the realtime echo is idempotent).
//
// Phase 1 exercises label + address + importance only. Geocoding is best-effort:
// with no LOCATIONIQ_API_KEY a place saves as "Needs location", and the user can
// paste coordinates / a Google Maps link to locate it (true pin-drop is a later
// phase — the keyless map iframe can't capture clicks).

import * as React from "react";
import { toast } from "sonner";
import { MapPin, MapPinOff, Pencil, Plus, RotateCw, Trash2Icon } from "lucide-react";

import {
  deletePlace,
  geocodePlace,
  setManualLocation,
  submitPlace,
  updatePlace,
} from "@/actions/locations";
import type { Place } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const IMPORTANCE_OPTIONS = [
  { value: 3, label: "Must" },
  { value: 2, label: "Want" },
  { value: 1, label: "Nice" },
] as const;

function importanceWord(n: number): string {
  return n === 3 ? "must" : n === 1 ? "nice" : "want";
}

function isLocated(place: Place): boolean {
  return place.latitude != null && place.longitude != null;
}

interface PlacesManagerProps {
  stayId: string;
  places: Place[];
  currentMemberId: string | null;
  onPlaceSaved: (place: Place) => void;
  onPlaceRemoved: (placeId: string) => void;
}

export function PlacesManager({
  stayId,
  places,
  currentMemberId,
  onPlaceSaved,
  onPlaceRemoved,
}: PlacesManagerProps) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Place | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const openAdd = React.useCallback(() => {
    setEditing(null);
    setNonce((n) => n + 1);
    setOpen(true);
  }, []);
  const openEdit = React.useCallback((place: Place) => {
    setEditing(place);
    setNonce((n) => n + 1);
    setOpen(true);
  }, []);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <MapPin className="size-4 text-muted-foreground" aria-hidden />
          Places to visit
          {places.length > 0 && (
            <span className="text-muted-foreground">({places.length})</span>
          )}
        </h3>
        <Button
          type="button"
          variant="outline"
          onClick={openAdd}
          className="h-9 rounded-lg px-3 text-sm font-semibold"
        >
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </div>

      {places.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No places yet — add the spots you want to be near (a temple, a beach, that
          warung) and we&apos;ll rank your stays by how close they are.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {places.map((place) => (
            <PlaceRow key={place.id} place={place} onEdit={() => openEdit(place)} />
          ))}
        </ul>
      )}

      <PlaceSheet
        key={`${editing?.id ?? "new"}-${nonce}`}
        open={open}
        onOpenChange={setOpen}
        stayId={stayId}
        place={editing}
        currentMemberId={currentMemberId}
        onSaved={onPlaceSaved}
        onRemoved={onPlaceRemoved}
      />
    </div>
  );
}

/** One row in the standalone places list: name, importance, located/needs-location. */
function PlaceRow({ place, onEdit }: { place: Place; onEdit: () => void }) {
  const located = isLocated(place);
  return (
    <li className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {located ? (
          <MapPin className="size-3.5 shrink-0 text-foreground" aria-hidden />
        ) : (
          <MapPinOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="truncate text-sm font-medium text-foreground">
          {place.label}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
          {importanceWord(place.importance)}
        </span>
        {!located && (
          <span className="shrink-0 text-xs font-medium text-primary">
            {place.geocode_status === "failed" ? "Couldn't find — set it" : "Set location"}
          </span>
        )}
      </button>
      <Button
        type="button"
        variant="ghost"
        onClick={onEdit}
        aria-label={`Edit ${place.label}`}
        className="size-9 rounded-lg p-0 text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/** The add/edit bottom-sheet. Seeds once from props (remounts per open via key). */
function PlaceSheet({
  open,
  onOpenChange,
  stayId,
  place,
  currentMemberId,
  onSaved,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stayId: string;
  place: Place | null;
  currentMemberId: string | null;
  onSaved: (place: Place) => void;
  onRemoved: (placeId: string) => void;
}) {
  const isEdit = place !== null;
  const [isPending, startTransition] = React.useTransition();
  const [isDeleting, startDeleteTransition] = React.useTransition();
  const [isLocating, startLocateTransition] = React.useTransition();

  const [label, setLabel] = React.useState(place?.label ?? "");
  const [address, setAddress] = React.useState(place?.address ?? "");
  const [importance, setImportance] = React.useState<number>(place?.importance ?? 2);
  const [coords, setCoords] = React.useState("");

  const trimmedLabel = label.trim();
  const canSubmit = Boolean(trimmedLabel) && !isPending;

  const currentCoords =
    place && place.latitude != null && place.longitude != null
      ? `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`
      : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      try {
        const fields = {
          label: trimmedLabel,
          address: address.trim() || null,
          importance,
        };
        const saved = isEdit
          ? await updatePlace({ id: place.id, ...fields })
          : await submitPlace({ stayId, submittedBy: currentMemberId, ...fields });

        // If the user pasted coordinates, apply them as a manual location.
        let finalPlace = saved;
        if (coords.trim()) {
          finalPlace = (await setManualLocation("place", saved.id, coords.trim())) as Place;
        }
        onSaved(finalPlace);
        toast.success(isEdit ? "Saved" : "Added");
        onOpenChange(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save that place.";
        toast.error(message);
      }
    });
  }

  function handleDelete() {
    if (!place) return;
    startDeleteTransition(async () => {
      try {
        await deletePlace(place.id);
        onRemoved(place.id);
        toast.success("Place removed");
        onOpenChange(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not remove that place.";
        toast.error(message);
      }
    });
  }

  // Retry geocoding the saved address (the "tap to retry" path for a transient miss).
  function handleRetryLocate() {
    if (!place) return;
    startLocateTransition(async () => {
      try {
        const updated = await geocodePlace(place.id);
        onSaved(updated);
        toast.success(isLocated(updated) ? "Located" : "Still couldn't find it");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not locate that place.";
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
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-border" />

        <SheetHeader className="px-5 pt-1 text-center sm:text-left">
          <SheetTitle className="text-xl font-semibold text-foreground sm:text-2xl">
            {isEdit ? "Edit place" : "Add a place"}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            A spot you want to be near on this leg — we&apos;ll rank stays by how
            close they are.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 pt-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="place-label" className="text-sm font-medium text-foreground">
              Name
            </Label>
            <Input
              id="place-label"
              autoFocus
              required
              placeholder="Monkey Forest"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="place-address" className="text-sm font-medium text-foreground">
              Address{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="place-address"
              placeholder="Jl. Monkey Forest Rd, Ubud"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium text-foreground">How important?</Label>
            <div className="grid grid-cols-3 gap-2">
              {IMPORTANCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setImportance(opt.value)}
                  aria-pressed={importance === opt.value}
                  className={cn(
                    "h-11 rounded-lg border text-sm font-semibold transition-colors",
                    importance === opt.value
                      ? "border-foreground bg-foreground text-white"
                      : "border-input text-foreground hover:bg-muted",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="place-coords" className="text-sm font-medium text-foreground">
              Set location{" "}
              <span className="font-normal text-muted-foreground">
                (optional — paste coordinates or a Google Maps link)
              </span>
            </Label>
            <Input
              id="place-coords"
              inputMode="text"
              placeholder="-8.5069, 115.2625"
              value={coords}
              onChange={(e) => setCoords(e.target.value)}
              className="h-12 rounded-lg px-4 text-base"
            />
            {currentCoords && (
              <p className="text-xs text-muted-foreground">
                Currently located at {currentCoords}. Paste new coordinates to move it.
              </p>
            )}
            {isEdit && place && !isLocated(place) && place.address && (
              <button
                type="button"
                onClick={handleRetryLocate}
                disabled={isLocating}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary disabled:opacity-50"
              >
                <RotateCw className="size-3.5" aria-hidden />
                {isLocating ? "Locating…" : "Try to locate from the address"}
              </button>
            )}
          </div>

          {!currentMemberId && (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
              Tip: pick who you are so your places are easy to follow.
            </p>
          )}

          <Button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 h-14 w-full rounded-lg bg-primary text-base font-semibold text-white hover:bg-[#e00b41]"
          >
            {isPending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add place"}
          </Button>

          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="mb-2 h-11 w-full rounded-lg text-sm font-semibold"
            >
              <Trash2Icon className="size-4" aria-hidden />
              {isDeleting ? "Removing…" : "Remove place"}
            </Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
