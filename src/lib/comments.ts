// Pure, env-free validation for accommodation comments. No DB or environment
// access, so it's safe to import on server and client and is unit-testable in
// isolation (the addComment/updateComment Server Actions hit the DB).

/** The DB CHECK constraint mirror: a trimmed body must be 1..2000 chars. */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * Validate + normalize a comment body, throwing a friendly Error on bad input
 * (surfaced to the user via a toast). Trims surrounding whitespace; rejects an
 * empty body and one longer than MAX_COMMENT_LENGTH so we never attempt a write
 * the DB CHECK constraint would bounce.
 */
export function prepareCommentBody(input: string | null | undefined): string {
  const body = (input ?? "").trim();
  if (body.length === 0) {
    throw new Error("Write something first.");
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Keep it under ${MAX_COMMENT_LENGTH} characters.`);
  }
  return body;
}
