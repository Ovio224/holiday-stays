# Accommodation detail + edit dialog — design

**Date:** 2026-06-16
**Status:** Approved for implementation (user: "fully autonomous, don't stop until finished").

## Context & decision

The user wants to **click/expand an accommodation card into a dialog** showing richer
info (map, amenities, details), let people **enter more info**, and **edit the price
and all of an accommodation's fields**.

"each stay" here means each **accommodation** (candidate listing) — the clues
(parsed info, map, amenities, price) all describe `bali.accommodations`, not legs.

A **per-member price-comparison feature** was being built concurrently in the same
tree (new `bali.accommodation_prices` table, `src/lib/prices.ts`, `src/actions/prices.ts`,
`src/components/price-chart.tsx`, plus edits to `data.ts`, `use-realtime-board.ts`,
`accommodation-card.tsx`, `types.ts`, `docs/deploy/bali-cloud-setup.sql`). Per the
user's choice ("incorporate it all now"), this feature is built **on top of** that
work and the final commit includes both. The price feature is functionally complete
and typechecks; the only gap we close is its missing unit test.

## Constraints & conventions (unchanged from the leg feature)

- Gate is the only auth boundary: every mutating Server Action calls `assertGate()`
  first, then writes via `getServiceClient()`. Anon key is SELECT-only.
- Supabase client sets `db.schema = "bali"` → JS uses `.from("accommodations")`;
  raw SQL uses `bali.accommodations`.
- Mobile-first; only the shadcn primitives already in `src/components/ui`
  (`dialog`, `sheet`, `input`, `label`, `textarea`, `button`, `badge`, …). No new deps.
- Modified Next.js 16: prefer proven in-repo patterns (`"use server"` actions called
  from client islands via `useTransition` + `try/catch` + `sonner`); consult
  `node_modules/next/dist/docs/` only if an API is uncertain.
- Match existing file-top comments, naming, and visual style.

## Data layer

### Migration: `supabase/migrations/20260616140000_accommodation_details.sql`

Add two nullable columns to `bali.accommodations` (idempotent):

```sql
alter table bali.accommodations add column if not exists address   text;
alter table bali.accommodations add column if not exists amenities text[];
```

- No new RLS/grants: table-level `grant select … to anon` and `grant all … to
  service_role` (init.sql) already cover future columns. `accommodations` is already
  in the realtime publication, so edits to these columns stream live with no hook
  change. No replica-identity change.
- Do **not** edit existing migrations. Sorts after the `…130000_accommodation_prices`
  migration, so order is clean on `db:reset` and cloud apply.
- Also append the two `add column if not exists` lines to
  `docs/deploy/bali-cloud-setup.sql` (the one-shot deploy script) to keep it complete.

### Types: `src/lib/types.ts`

Add to `Accommodation`:
```ts
address: string | null;     // user-entered location, for the map + display
amenities: string[] | null; // user-entered amenity list
```
(`AccommodationWithVotes` already carries `votes` + `prices`.)

## Pure helpers + validation: `src/lib/accommodations.ts` (new)

Env-free, server/client-safe, unit-testable.

```ts
export interface AccommodationEditInput {
  title?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  address?: string | null;
  amenities?: string[] | string | null; // array or newline/comma text from the form
  pricePerNight?: number | string | null;
  currency?: string | null;
  guests?: number | string | null;
  bedrooms?: number | string | null;
  beds?: number | string | null;
  baths?: number | string | null; // may be fractional
}
export interface NormalizedAccommodationEdit {
  title: string | null;
  image_url: string | null;
  notes: string | null;
  address: string | null;
  amenities: string[] | null;       // null when empty
  price_per_night: number | null;
  currency: string | null;
  details: Partial<ListingDetails>;  // only capacity keys we let users edit
}
export function prepareAccommodationEdit(input: AccommodationEditInput): NormalizedAccommodationEdit;

// Map helpers
export function mapQuery(opts: { title: string | null; address: string | null; area: string | null }): string | null;
export function mapEmbedUrl(query: string): string;  // https://www.google.com/maps?q=<enc>&output=embed
export function mapLinkUrl(query: string): string;    // https://www.google.com/maps/search/?api=1&query=<enc>
```

Rules:
- All text fields trimmed → `null` when empty.
- `imageUrl`: if present, must be http(s) (reuse the same check style as
  `submitAccommodation`); else throw `"Enter a valid image link."`.
- `amenities`: accept an array OR a string (split on newlines/commas); trim each, drop
  empties, dedupe (case-insensitive, keep first), preserve order; `[]` → `null`.
- `pricePerNight`: empty/null → `null`; otherwise must parse to a finite number `>= 0`
  (throw `"Enter a valid price."`), rounded to cents.
- capacity (`guests/bedrooms/beds/baths`): empty/null → omitted; otherwise finite
  `>= 0` (`baths` may be fractional, others rounded to integers); invalid → throw.
- `mapQuery`: join the first of `address` else `title` with `area` (", " separated);
  return `null` if nothing usable.

## Server Action: extend `src/actions/accommodations.ts`

Add (keep `submitAccommodation`/`deleteAccommodation` as-is):

```ts
export async function updateAccommodation(
  input: { id: string } & AccommodationEditInput,
): Promise<Accommodation>
```

- `assertGate()` first.
- `prepareAccommodationEdit(input)` → normalized fields.
- Merge `details`: fetch the row's current `details`, overlay the edited capacity keys
  (leaving parsed `rating`/`reviews` untouched), write the merged object back.
- Update `title, image_url, notes, address, amenities, price_per_night, currency,
  details` by `id`; if the user typed a title, also flip `parse_status` to `"manual"`
  (mirrors submit semantics for curated cards). Return the updated row.
- Throw `Error(...)` on failure (client toasts `error.message`).

## UI

### `src/components/accommodation-detail-dialog.tsx` (new, client island)

A shadcn `Dialog` that shows the full listing and an inline edit mode.

Props: `{ accommodation: AccommodationWithVotes; members: Member[]; currentMemberId: string | null; stayArea: string | null; stayLabel: string; stayNights: number | null }`.

- **Trigger:** renders a clear, accessible "Details" button (ghost/outline, ≥44px) —
  this is what the card embeds. (Image-as-trigger is optional/nice-to-have; the button
  is the must-have.)
- **DialogContent** (scrollable: `max-h-[90dvh] overflow-y-auto`, mobile-friendly width):
  - Header: title, source badge, rating/reviews if present.
  - Cover image (`next/image`) when `image_url`.
  - **Map:** when `mapQuery(...)` is non-null, a lazy `<iframe loading="lazy">` using
    `mapEmbedUrl(query)` (rounded, ~16:9, `title="Map"`), plus an "Open in Google Maps"
    external link via `mapLinkUrl(query)`. If no query, show nothing (or a hint to add
    an address).
  - **Info:** capacity chips (`detailChips`), price (reference `price_per_night` +
    per-leg total via `nightlyTotal`), amenities as a chip/bullet list, notes,
    address, submitter, and an external "View original listing" link.
  - **Edit mode:** an "Edit" button toggles a form (stacked fields) covering title,
    image URL, price/night + currency, address, amenities (textarea, one per line),
    notes, and capacity (guests/bedrooms/beds/baths). Save → `useTransition` +
    `updateAccommodation` → `toast.success("Saved")` → exit edit mode (realtime updates
    the view); Cancel → revert. Disable save while pending or when nothing valid.
    Guard `currentMemberId` only for UX parity — editing is allowed for anyone gated in
    (consistent with legs/places), but show the "pick your name" hint like other forms.
- Reuse `src/components/ui/dialog.tsx` patterns (incl. `DialogClose render={<Button/>}`).

### `src/components/accommodation-card.tsx` (edit)

- Embed `<AccommodationDetailDialog … />` as a client island (the card stays a server
  component). Place the "Details" trigger button in the body — e.g. a subtle full-width
  button just above the `PriceChart`/vote block, or beside the title — without crowding.
- Pass through the new `stayArea` / `stayLabel` props (added below).
- Surface `address`/`amenities` minimally on the collapsed card only if it doesn't add
  clutter (optional); the dialog is the home for full detail.

### `src/components/stay-section.tsx` (edit)

- Pass `stayArea={stay.area}` and `stayLabel={stay.label}` to each `AccommodationCard`
  (it already passes `stayNights`). No other changes.

## Realtime

No hook changes. Accommodation edits (incl. new `address`/`amenities` columns) flow
through the existing `accommodations` UPDATE subscription, which already merges all
columns while preserving `votes`/`prices`.

## Tests (Vitest)

- `src/test/accommodations.test.ts` (new): `prepareAccommodationEdit` (trim→null,
  amenities array+string parsing/dedupe, price validation, bad image URL, capacity
  validation, fractional baths) and `mapQuery`/`mapEmbedUrl`/`mapLinkUrl`
  (encoding, address-vs-title preference, null when empty).
- `src/test/prices.test.ts` (new — completes the incorporated price feature):
  `preparePriceInput` (negative/NaN/normalize), `priceComparison` (sort, cheapest set,
  ties, unknown members dropped), `effectiveNightly` (member-cheapest else reference).

## Out of scope (YAGNI)

- Geocoding / storing coordinates (map is a keyless search embed).
- Image upload (only the image URL is editable).
- Rewiring the trip budget to use member prices / `effectiveNightly` (leave the
  concurrent author's budget semantics — parsed reference price — unchanged).
- Editing parsed `rating`/`reviews`, `source`, or `url`.

## Verification

- Node 22.13.1 → `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- Manual: open a card's Details dialog → see info + map; edit price/amenities/address/
  capacity → Save → card + dialog reflect it, and a second browser tab updates live.

## Risk notes

- **Concurrency:** the price feature may still be edited in parallel. Final verification
  re-checks `git status` + a green typecheck/build; reconcile any drift before commit.
- The map embed is best-effort; an opaque title (e.g. Airbnb numeric room) with no
  address yields a vague map — acceptable, improves once an address is entered.
- `updateAccommodation` merges `details`; it must not clobber parsed `rating`/`reviews`.
</content>
