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
