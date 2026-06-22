// Pure, env-free validation + normalization for trip legs ("stays"). Kept free
// of any DB or environment access so it is safe to import on both the server and
// the client, and so the validation logic is unit-testable in isolation (the
// Server Actions themselves hit the DB and are integration-tested instead).

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

// Strict ISO calendar-date shape, matching the Postgres `date` column and the
// values produced by <Input type="date">.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a raw leg form input into the shape the DB expects, throwing a
 * friendly Error on invalid input (surfaced to the user via a toast).
 *
 * - `label` is trimmed and required.
 * - `area` is trimmed; empty becomes null.
 * - `start_date` / `end_date` are trimmed; empty becomes null. A present value
 *   must match YYYY-MM-DD.
 * - When both dates are present, end must not be before start (string compare is
 *   valid for ISO dates).
 */
export function prepareStayInput(input: StayInput): NormalizedStay {
  const label = input.label.trim();
  if (!label) {
    throw new Error("Give the leg a name.");
  }

  const area = input.area?.trim() || null;
  const start_date = normalizeDate(input.startDate);
  const end_date = normalizeDate(input.endDate);

  if (start_date && end_date && end_date < start_date) {
    throw new Error("The end date can't be before the start date.");
  }

  return { label, area, start_date, end_date };
}

/** Trim a date input → null when empty, or validate it as YYYY-MM-DD. */
function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!ISO_DATE.test(trimmed)) {
    throw new Error("Enter a valid date.");
  }
  return trimmed;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Add `nights` whole days to an ISO date, returning a new "YYYY-MM-DD". Used to
 * chain a new leg's end date off the previous leg's end (start = prev end, so
 * end = start + nights). Computed in UTC to stay stable across server/client
 * timezones — the same reason format.ts formats dates in UTC. Returns null when
 * the input date is malformed or `nights` isn't a finite, non-negative integer,
 * so callers can fall back to manual date entry.
 */
export function addNights(dateISO: string, nights: number): string | null {
  if (!ISO_DATE.test(dateISO)) return null;
  if (!Number.isFinite(nights) || nights < 0 || !Number.isInteger(nights)) {
    return null;
  }

  const [year, month, day] = dateISO.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day);
  const result = new Date(start + nights * MS_PER_DAY);

  const yyyy = result.getUTCFullYear();
  const mm = String(result.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(result.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** A leg's id paired with a new sort_order to write. */
export interface SortShift {
  id: string;
  sort_order: number;
}

export interface ConsecutiveInsertPlan {
  /** sort_order the new leg should take (right after the anchor). */
  newSortOrder: number;
  /** Existing legs that must be renumbered to stay after the new one. */
  shifts: SortShift[];
}

/**
 * Plan where a new leg inserted *consecutively after* `afterStayId` should sit,
 * and how the legs that currently follow it must be renumbered to stay strictly
 * after the new one.
 *
 * `ordered` must already be in display order (sort_order, then created_at). The
 * new leg takes the anchor's sort_order + 1; every leg after the anchor is
 * renumbered to a clean increasing run above that, preserving relative order —
 * robust to gaps or duplicate sort_order values. Only legs whose value actually
 * changes are returned, so appending after the last leg yields no shifts at all.
 */
export function planConsecutiveInsert(
  ordered: { id: string; sort_order: number }[],
  afterStayId: string,
): ConsecutiveInsertPlan {
  const anchorIndex = ordered.findIndex((s) => s.id === afterStayId);
  if (anchorIndex === -1) {
    throw new Error("Could not find the leg to add after.");
  }

  const newSortOrder = ordered[anchorIndex].sort_order + 1;
  const shifts: SortShift[] = [];
  ordered.slice(anchorIndex + 1).forEach((stay, i) => {
    const next = newSortOrder + 1 + i;
    if (stay.sort_order !== next) shifts.push({ id: stay.id, sort_order: next });
  });

  return { newSortOrder, shifts };
}

/** What a leg holds — used to spell out the blast radius of deleting it. */
export interface LegContentsSummary {
  listings: number;
  votes: number;
  comments: number;
}

/**
 * Count what a delete would take down with the leg: the number of listings in it,
 * plus the votes and comments cascaded across those listings (the DB deletes them
 * via `on delete cascade`). Structurally typed — it only reads `.votes`/`.comments`
 * lengths — so it stays a pure, render-free helper the confirm dialog can trust.
 */
export function legContentsSummary(
  accommodations: ReadonlyArray<{
    votes: readonly unknown[];
    comments: readonly unknown[];
  }>,
): LegContentsSummary {
  return {
    listings: accommodations.length,
    votes: accommodations.reduce((sum, a) => sum + a.votes.length, 0),
    comments: accommodations.reduce((sum, a) => sum + a.comments.length, 0),
  };
}

/**
 * Whether a typed confirmation value matches the leg's name closely enough to arm
 * a destructive delete — trimmed and case-insensitive, so "  uluwatu " clears the
 * gate for "Uluwatu". An empty/whitespace-only label never matches (defensive: we
 * must never auto-arm the button when there's effectively nothing to type).
 */
export function confirmMatches(input: string, label: string): boolean {
  const target = label.trim().toLowerCase();
  if (!target) return false;
  return input.trim().toLowerCase() === target;
}
