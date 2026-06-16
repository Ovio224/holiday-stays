# Leg management (add / edit / remove / reorder) — design

**Date:** 2026-06-16
**Status:** Approved for implementation (user said "continue until finished")

## Goal

Let anyone past the gate **add, edit, remove, and reorder trip legs ("stays")** —
including their label, area, and date window — directly in the board UI, with
changes appearing live for everyone (realtime), and the trip-dates banner and
budget recomputing automatically.

Today legs exist only as seeded `bali.stays` rows; there is no in-app way to
manage them and they are treated as static for the session. This adds the
missing CRUD.

## Constraints & conventions (must follow)

- **Gate is the only authorization boundary.** Every mutating Server Action
  calls `assertGate()` first (mirror `src/actions/accommodations.ts`). `proxy.ts`
  is optimistic only.
- **Writes go through the service-role client** (`getServiceClient()`), reads via
  the same on the server. The browser anon key is SELECT-only.
- **Supabase client sets `db.schema = "bali"`**, so table names are unqualified
  in JS (`.from("stays")`), but **schema-qualified in SQL** (`bali.stays`).
- **No new RLS policies or grants needed:** service role already has full access;
  `stays_read` already allows anon SELECT (required for realtime delivery).
- **Mobile-first**, shadcn/ui primitives only (`sheet`, `dialog`, `select`,
  `input`, `label`, `textarea`, `button`). No new UI dependencies / no
  dropdown-menu (not installed).
- **Next.js 16 (this repo's variant):** consult `node_modules/next/dist/docs/` for
  Server Actions / forms if anything is uncertain, but the proven in-repo pattern
  (`"use server"` module + exported async fns, called from a client component via
  `useTransition` + `try/catch` + `sonner` toasts) is the reference.
- Follow existing code style: file-top comment explaining purpose, focused
  functions, named exports.

## Data layer

### Migration: `supabase/migrations/20260616120000_stays_realtime.sql`

Add `bali.stays` to the realtime publication so leg changes stream to the anon
client. Guard it so the migration is safe to re-run:

```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'bali' and tablename = 'stays'
  ) then
    alter publication supabase_realtime add table bali.stays;
  end if;
end $$;
```

- **Replica identity:** unchanged. Default (primary key) already carries `id` in
  DELETE payloads — enough for the client to remove a deleted leg, matching how
  `accommodations`/`votes` deletes already work.
- **Do NOT edit the existing migrations** (immutable once applied); add a new one.
- `supabase/seed.sql` is unchanged (it still seeds the initial 3 legs).

## Pure helper + validation: `src/lib/stays.ts`

A pure, env-free, server/client-safe module so the validation logic is
unit-testable (the action itself hits the DB and is integration-tested, like
`ratelimit`/`isLockedOut`).

```ts
export interface StayInput {
  label: string;
  area?: string | null;
  startDate?: string | null; // "YYYY-MM-DD" or null
  endDate?: string | null;
}
export interface NormalizedStay {
  label: string;
  area: string | null;
  start_date: string | null;
  end_date: string | null;
}
// Trims; throws Error with a friendly message on invalid input.
export function prepareStayInput(input: StayInput): NormalizedStay;
```

Rules:
- `label` trimmed; **required** — throw `"Give the leg a name."` if empty.
- `area` trimmed → `null` when empty.
- `start_date` / `end_date`: empty → `null`. If a value is present it must match
  `YYYY-MM-DD` (throw `"Enter a valid date."`).
- If **both** dates present and `end_date < start_date` (string compare is valid
  for ISO dates) → throw `"The end date can't be before the start date."`.

## Server Actions: `src/actions/stays.ts`

`"use server"`; each action calls `assertGate()` first, then uses
`getServiceClient().from("stays")`.

```ts
createStay(input: StayInput): Promise<Stay>
updateStay(input: StayInput & { id: string }): Promise<Stay>
deleteStay(id: string): Promise<void>
reorderStay(id: string, direction: "up" | "down"): Promise<void>
```

- **createStay:** `prepareStayInput`, then `sort_order = (max existing sort_order)
  + 1` (query `order(sort_order desc).limit(1)`; default 0 when empty), insert,
  return the row. New legs append to the end of the itinerary.
- **updateStay:** `prepareStayInput`, update label/area/start_date/end_date by id,
  return the row. (sort_order is managed by reorder, not edited here.)
- **deleteStay:** delete by id. DB cascade removes the leg's accommodations and
  their votes (FK `on delete cascade`). This is destructive → confirmed in UI.
- **reorderStay:** load stays ordered by `sort_order, created_at`; find the target
  and its up/down neighbor; swap their `sort_order` values (two updates). No-op if
  there is no neighbor in that direction.
- All throw `Error(...)` on failure; the client surfaces `error.message` via toast.

## Realtime: `src/hooks/use-realtime-board.ts`

- Add `initialStays: Stay[]` to the hook args; add `stays` state seeded from it.
- Add a third subscription on the same channel:
  `{ event: "*", schema: "bali", table: "stays" }` →
  - INSERT/UPDATE → upsert by id (`upsertStay`)
  - DELETE → remove by id (`removeStay`, using `payload.old.id`)
- Return `stays` alongside `accommodations` / `members`.
- Keep the existing reconcile-by-id robustness notes (events may arrive out of
  order; upsert replace-or-insert).

## UI

### `src/components/trip-board.tsx`

- Feed `initialStays` into `useRealtimeBoard`; render from **live** `stays`
  (sortedStays, byStay, budget all derive from live stays).
- **Trip-dates banner becomes live:** compute the range in the board from live
  stays instead of receiving the `tripRange` prop. Add a pure
  `tripDateRange(stays): string` helper to `src/lib/format.ts` (earliest
  start_date → latest end_date via the existing `formatDateRange`). Remove the
  `tripRange` prop and `computeTripRange` from `src/app/page.tsx` (page no longer
  needs `formatDateRange`).
- Owns leg-editor state: `legSheetOpen: boolean`, `editingStay: Stay | null`
  (`null` = create mode). Handlers: `openCreateLeg()`, `openEditLeg(stay)`,
  `moveLeg(id, dir)` (calls `reorderStay`, toasts on error).
- **Add-a-leg entry point:** a dashed "+ Add a leg" tile rendered **after** the
  last `StaySection` (styled like the existing empty-state tiles), opening the
  sheet in create mode. (The floating button stays "Add a place".)
- Render `<LegSheet open={legSheetOpen} onOpenChange={setLegSheetOpen}
  stay={editingStay} key={editingStay?.id ?? "new"} />` — the `key` remounts the
  sheet per target so its fields initialize cleanly without effect-syncing.
- Pass `onEdit`, `onMoveUp`, `onMoveDown`, `isFirst`, `isLast` to each
  `StaySection`.

### `src/components/stay-section.tsx`

- In the leg header, add a compact control cluster (small ghost icon buttons,
  ≥44px touch targets, with `aria-label`s):
  - **Edit** (pencil) → `onEdit(stay)`
  - **Move up** (chevron-up), disabled when `isFirst`
  - **Move down** (chevron-down), disabled when `isLast`
- Keep the existing "Add a place" button. Lay out so the header doesn't crowd on
  narrow phones (icons can sit on a second row / wrap).

### `src/components/leg-sheet.tsx` (NEW)

Bottom-sheet mirroring `submit-sheet.tsx`. Props:
`{ open, onOpenChange, stay: Stay | null }`.

- Title/CTA depend on mode: create → "Add a leg" / "Add leg"; edit → "Edit leg" /
  "Save changes".
- Fields: **Label** (Input, required, autoFocus), **Area** (Input, optional),
  **Start date** + **End date** (`<Input type="date">` — native mobile pickers;
  values are `YYYY-MM-DD`, matching the `date` column and `prepareStayInput`).
- Initialize fields from `stay` when editing (clean because parent passes a
  `key`). Reset handled by remount.
- Submit: `useTransition` + `try/catch`; call `createStay`/`updateStay`; on
  success `toast.success("Added"/"Saved")`, close.
- Client-side guard: disable submit when label is empty, or when both dates are
  set and end < start (show an inline hint). Server still re-validates.
- **Edit mode only:** a destructive "Delete leg" button at the bottom that opens a
  confirm `Dialog`: "Delete this leg? This also removes every place and vote in
  it." Confirm → `deleteStay(stay.id)` → `toast.success("Leg removed")` → close.

## Tests

- `src/test/stays.test.ts` (Vitest) for `prepareStayInput`:
  - trims label; throws on empty/whitespace label
  - empty area/dates → null
  - rejects malformed date and `end < start`
  - accepts a valid full input and a label-only input

## Out of scope (YAGNI)

- Drag-and-drop reordering (use up/down arrows).
- Editing `sort_order` as a number, or numeric position field.
- Per-leg attribution ("who added this leg").
- Multi-currency / timezone handling beyond what exists.

## Verification

- `nvm use 22.13.1` (default shell is Node 16) then: `npm run typecheck`,
  `npm test`, `npm run lint`, `npm run build`.
- Manual: add a leg → appears at end; edit dates → banner + nights update; reorder
  → order changes; delete → leg and its cards vanish; all of the above reflected
  live in a second browser tab.

## Risk notes

- Deleting a leg is **destructive and cascading** — confirmation dialog is
  mandatory.
- `createStay` sort_order is computed read-then-write; concurrent adds may tie on
  sort_order — harmless (ties break by `created_at`).
- Realtime DELETE relies on `payload.old.id` (PK present by default replica
  identity) — same assumption the existing handlers already make.
</content>
</invoke>
