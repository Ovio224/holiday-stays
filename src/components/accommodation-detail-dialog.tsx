"use client";

// AccommodationDetailDialog — expands a card into a rich detail view and an
// inline editor. The trigger is a clear "Details" button (≥44px) embedded in the
// card body. The dialog shows the cover image, a keyless Google Maps embed (built
// from the listing's address/title + the leg's area), capacity + price info,
// amenities, notes, the submitter, and a link to the original listing.
//
// "Edit" toggles a stacked form covering the user-curated fields (title, image
// URL, price/night + currency, address, amenities, notes, capacity) which saves
// via the updateAccommodation server action through useTransition + sonner, then
// exits edit mode — realtime streams the change back into the read view. Editing
// is allowed for anyone gated in (parity with legs/places); we only show a "pick
// your name" hint, mirroring the other forms.

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Bike, Expand, ExternalLink, ImageOff, MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteAccommodation, updateAccommodation } from "@/actions/accommodations";
import { CommentThread } from "@/components/comment-thread";
import {
  mapEmbedUrl,
  mapLinkUrl,
  mapQuery,
  prepareAccommodationEdit,
} from "@/lib/accommodations";
import {
  detailChips,
  formatMoney,
  formatRating,
  nightlyTotal,
  sourceLabel,
} from "@/lib/format";
import { poiDistances, type ScoreResult } from "@/lib/location-score";
import type { AccommodationWithVotes, Member, Place } from "@/lib/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AccommodationDetailDialogProps {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
  stayArea: string | null;
  stayLabel: string;
  stayNights: number | null;
  places: Place[];
  score: ScoreResult | null;
  locationScoringEnabled: boolean;
}

export function AccommodationDetailDialog({
  accommodation,
  members,
  currentMemberId,
  stayArea,
  stayLabel,
  stayNights,
  places,
  score,
  locationScoringEnabled,
}: AccommodationDetailDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [isDeleting, startDeleteTransition] = React.useTransition();

  // Reset to the read view whenever the dialog closes so a reopen starts clean.
  function handleOpenChange(next: boolean) {
    if (!next) setEditing(false);
    setOpen(next);
  }

  // Delete the whole listing (cascades to its votes, prices, and comments). On
  // success we close the dialog; the realtime `accommodations` DELETE event drops
  // the card from the board for everyone.
  function handleDelete() {
    startDeleteTransition(async () => {
      try {
        await deleteAccommodation(accommodation.id);
        toast.success("Listing deleted");
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn't delete that listing — try again",
        );
      }
    });
  }

  const title = accommodation.title?.trim() || "Untitled stay";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="min-h-10 rounded-lg px-4 text-sm font-semibold"
          />
        }
      >
        <Expand className="size-4" aria-hidden />
        Details
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] w-full max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl lg:max-w-4xl">
        {editing ? (
          <EditView
            accommodation={accommodation}
            currentMemberId={currentMemberId}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ReadView
            accommodation={accommodation}
            members={members}
            currentMemberId={currentMemberId}
            stayArea={stayArea}
            stayLabel={stayLabel}
            stayNights={stayNights}
            places={places}
            score={score}
            locationScoringEnabled={locationScoringEnabled}
            title={title}
            onEdit={() => setEditing(true)}
            onDelete={handleDelete}
            deleting={isDeleting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The full read-only detail view: header, image, map, info. */
function ReadView({
  accommodation,
  members,
  currentMemberId,
  stayArea,
  stayLabel,
  stayNights,
  places,
  score,
  locationScoringEnabled,
  title,
  onEdit,
  onDelete,
  deleting,
}: {
  accommodation: AccommodationWithVotes;
  members: Member[];
  currentMemberId: string | null;
  stayArea: string | null;
  stayLabel: string;
  stayNights: number | null;
  places: Place[];
  score: ScoreResult | null;
  locationScoringEnabled: boolean;
  title: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { details } = accommodation;
  // Two-step delete: the first click arms an inline confirmation so a destructive,
  // everyone-affecting removal is never a single mis-tap.
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const rating = formatRating(details?.rating ?? null, details?.ratingScale ?? null);
  const reviews = details?.reviews ?? null;
  const chips = detailChips(details);

  const nightly = formatMoney(accommodation.price_per_night, accommodation.currency);
  const total = formatMoney(
    nightlyTotal(accommodation.price_per_night, stayNights),
    accommodation.currency,
  );

  const submitter = accommodation.submitted_by
    ? (members.find((m) => m.id === accommodation.submitted_by) ?? null)
    : null;

  const query = mapQuery({
    title: accommodation.title,
    address: accommodation.address,
    area: stayArea,
  });
  const amenities = accommodation.amenities ?? [];

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border border-border bg-muted text-foreground"
          >
            {sourceLabel(accommodation.source)}
          </Badge>
          <span className="text-xs text-muted-foreground">{stayLabel}</span>
          {rating && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
              <Star className="size-3 fill-foreground text-foreground" aria-hidden />
              {rating}
              {reviews != null && (
                <span className="font-normal text-muted-foreground">({reviews})</span>
              )}
            </span>
          )}
        </div>
        <DialogTitle className="pr-8 text-lg leading-snug">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Full details for {title}.
        </DialogDescription>
      </DialogHeader>

      {/* Cover image + map, side by side on wider screens. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
          {accommodation.image_url ? (
            <Image
              src={accommodation.image_url}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, 28rem"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageOff className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            </div>
          )}
        </div>

        {/* Map — only when we have something searchable. */}
        {query ? (
          <div className="flex flex-col gap-2">
            <iframe
              title="Map"
              loading="lazy"
              src={mapEmbedUrl(query)}
              className="aspect-video w-full rounded-lg border border-border"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <Link
              href={mapLinkUrl(query)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm text-foreground underline-offset-2 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Open in Google Maps
            </Link>
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              Add an address to show this place on a map.
            </p>
          </div>
        )}
      </div>

      {/* Distances to this leg's places-to-visit (location scoring only). */}
      {locationScoringEnabled && places.length > 0 && (
        <DistancesSection accommodation={accommodation} places={places} score={score} />
      )}

      {/* Info */}
      <div className="flex flex-col gap-3 text-sm">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        {nightly ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-base font-semibold text-foreground">{nightly}</span>
            <span className="text-muted-foreground">/ night</span>
            {total && stayNights != null && (
              <span className="text-muted-foreground">
                · {total} for {stayNights} {stayNights === 1 ? "night" : "nights"}
              </span>
            )}
          </p>
        ) : (
          <p className="text-muted-foreground">No price yet.</p>
        )}

        {amenities.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Amenities
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {amenities.map((amenity) => (
                <li
                  key={amenity}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground"
                >
                  {amenity}
                </li>
              ))}
            </ul>
          </div>
        )}

        {accommodation.notes?.trim() && (
          <p className="leading-relaxed whitespace-pre-line text-muted-foreground">
            {accommodation.notes}
          </p>
        )}

        {accommodation.address?.trim() && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {accommodation.address}
          </p>
        )}

        {submitter && (
          <div className="flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: submitter.color }}
              aria-hidden
            />
            Added by {submitter.name}
          </div>
        )}

        <Link
          href={accommodation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-foreground underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          View original listing
        </Link>
      </div>

      <hr className="border-border" />

      {/* Full discussion thread — say why this place is a yes or no. */}
      <CommentThread
        accommodationId={accommodation.id}
        comments={accommodation.comments}
        members={members}
        votes={accommodation.votes}
        currentMemberId={currentMemberId}
        variant="dialog"
      />

      <DialogFooter className="sm:items-center sm:justify-between">
        {confirmingDelete ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm text-muted-foreground">
              Delete this listing for everyone?
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={onDelete}
                disabled={deleting}
              >
                <Trash2 className="size-4" aria-hidden />
                {deleting ? "Deleting…" : "Delete listing"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
              <Button type="button" onClick={onEdit}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Button>
            </div>
          </>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The "Distances from here" section: per-POI scooter time + distance + a sub-score
 * bar, plus the location-score summary. When the accommodation itself isn't
 * geocoded, every row would be empty, so we show a single "add an address" prompt
 * instead. (Phase 1 is scooter-only; the mode toggle arrives in Phase 2.)
 */
function DistancesSection({
  accommodation,
  places,
  score,
}: {
  accommodation: AccommodationWithVotes;
  places: Place[];
  score: ScoreResult | null;
}) {
  const origin =
    accommodation.latitude != null && accommodation.longitude != null
      ? { latitude: accommodation.latitude, longitude: accommodation.longitude }
      : null;
  const rows = poiDistances(origin, places, "scooter");

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Distances from here
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
          <Bike className="size-3.5" aria-hidden />
          Scooter
        </span>
      </div>

      {!origin ? (
        <p className="text-sm text-muted-foreground">
          Add an address to this stay to see distances. (Edit → Address, or set
          coordinates.)
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ place, minutes, km, subScore }) => (
            <li key={place.id} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 truncate font-medium text-foreground">
                {place.label}
              </span>
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                {minutes != null
                  ? `${Math.round(minutes)} min${km != null ? ` · ${km.toFixed(1)} km` : ""}`
                  : "—"}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-foreground"
                  style={{ width: `${Math.round(subScore ?? 0)}%` }}
                  aria-hidden
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {origin && score?.location != null && (
        <p className="text-sm text-muted-foreground">
          Location score:{" "}
          <span className="font-semibold text-foreground">
            {Math.round(score.location)}
          </span>
          {score.coverageCount &&
            ` · coverage ${Math.round(score.coveragePct ?? 0)}% (${score.coverageCount.within} of ${score.coverageCount.of} ≤15 min)`}
        </p>
      )}
    </section>
  );
}

/** The inline edit form. Seeds once from props (the parent remounts on reopen). */
function EditView({
  accommodation,
  currentMemberId,
  onDone,
  onCancel,
}: {
  accommodation: AccommodationWithVotes;
  currentMemberId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { details } = accommodation;
  const [isPending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState(accommodation.title ?? "");
  const [imageUrl, setImageUrl] = React.useState(accommodation.image_url ?? "");
  const [currency, setCurrency] = React.useState(accommodation.currency ?? "$");
  const [pricePerNight, setPricePerNight] = React.useState(
    accommodation.price_per_night != null ? String(accommodation.price_per_night) : "",
  );
  const [address, setAddress] = React.useState(accommodation.address ?? "");
  const [amenities, setAmenities] = React.useState(
    (accommodation.amenities ?? []).join("\n"),
  );
  const [notes, setNotes] = React.useState(accommodation.notes ?? "");
  const [guests, setGuests] = React.useState(
    details?.guests != null ? String(details.guests) : "",
  );
  const [bedrooms, setBedrooms] = React.useState(
    details?.bedrooms != null ? String(details.bedrooms) : "",
  );
  const [beds, setBeds] = React.useState(
    details?.beds != null ? String(details.beds) : "",
  );
  const [baths, setBaths] = React.useState(
    details?.baths != null ? String(details.baths) : "",
  );

  // The raw form values, gathered once so validity + dirty checks and the save
  // call all read the same shape the server action expects.
  const input = {
    id: accommodation.id,
    title,
    imageUrl,
    notes,
    address,
    amenities, // newline-separated text; the helper splits + dedupes
    pricePerNight,
    currency,
    guests,
    bedrooms,
    beds,
    baths,
  };

  // Mirror the server normalization (prepareAccommodationEdit) on the client so
  // we can disable Save for invalid input — bad price or image URL — instead of
  // only catching it via a server toast. We also gate on a dirty check so an
  // untouched form can't fire a no-op write that re-normalizes (and may null)
  // fields. Both derive purely from the current inputs, so a plain useMemo fits.
  const { valid, dirty } = React.useMemo(() => {
    let normalized;
    try {
      normalized = prepareAccommodationEdit(input);
    } catch {
      return { valid: false, dirty: true };
    }
    const initial = prepareAccommodationEdit({
      title: accommodation.title,
      imageUrl: accommodation.image_url,
      notes: accommodation.notes,
      address: accommodation.address,
      amenities: accommodation.amenities,
      pricePerNight: accommodation.price_per_night,
      currency: accommodation.currency,
      guests: details?.guests ?? null,
      bedrooms: details?.bedrooms ?? null,
      beds: details?.beds ?? null,
      baths: details?.baths ?? null,
    });
    return {
      valid: true,
      dirty: JSON.stringify(normalized) !== JSON.stringify(initial),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, imageUrl, notes, address, amenities, pricePerNight, currency, guests, bedrooms, beds, baths]);

  const canSave = !isPending && valid && dirty;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;

    startTransition(async () => {
      try {
        await updateAccommodation(input);
        toast.success("Saved");
        onDone();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save those details.";
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg">Edit details</DialogTitle>
        <DialogDescription>
          Update this place&apos;s name, price, location, amenities, and rooms.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-title">Title</Label>
        <Input
          id="detail-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Cliffside villa with a pool"
          className="h-11 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-image">Image URL</Label>
        <Input
          id="detail-image"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…"
          className="h-11 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-price">Price / night</Label>
        <div className="flex items-stretch gap-2">
          <Input
            aria-label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="$"
            className="h-11 w-16 text-center text-base"
          />
          <Input
            id="detail-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={pricePerNight}
            onChange={(e) => setPricePerNight(e.target.value)}
            placeholder="120"
            className="h-11 flex-1 text-base"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-address">Address</Label>
        <Input
          id="detail-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Jl. Raya Ubud, Bali"
          className="h-11 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-amenities">
          Amenities{" "}
          <span className="font-normal text-muted-foreground">(one per line)</span>
        </Label>
        <Textarea
          id="detail-amenities"
          value={amenities}
          onChange={(e) => setAmenities(e.target.value)}
          placeholder={"Private pool\nFast Wi-Fi\nAir conditioning"}
          className="min-h-24 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="detail-notes">Notes</Label>
        <Textarea
          id="detail-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Walking distance to the beach…"
          className="min-h-20 text-base"
        />
      </div>

      {/* Capacity — a 2×2 grid on phones, a single row on wider screens. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-guests">Guests</Label>
          <Input
            id="detail-guests"
            type="number"
            inputMode="numeric"
            min={0}
            step="1"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className="h-11 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-bedrooms">Bedrooms</Label>
          <Input
            id="detail-bedrooms"
            type="number"
            inputMode="numeric"
            min={0}
            step="1"
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            className="h-11 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-beds">Beds</Label>
          <Input
            id="detail-beds"
            type="number"
            inputMode="numeric"
            min={0}
            step="1"
            value={beds}
            onChange={(e) => setBeds(e.target.value)}
            className="h-11 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="detail-baths">Baths</Label>
          <Input
            id="detail-baths"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={baths}
            onChange={(e) => setBaths(e.target.value)}
            className="h-11 text-base"
          />
        </div>
      </div>

      {!currentMemberId && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
          Tip: pick who you are so your edits are easy to follow.
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
