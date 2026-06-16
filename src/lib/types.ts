// Domain types — the single source of truth shared across the app.

export type AccommodationSource = "airbnb" | "booking" | "other";
export type ParseStatus = "pending" | "ok" | "failed" | "manual";

export interface Member {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Stay {
  id: string;
  label: string;
  area: string | null;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  created_at: string;
}

export interface Accommodation {
  id: string;
  stay_id: string;
  url: string;
  source: AccommodationSource;
  title: string | null;
  image_url: string | null;
  price_text: string | null; // legacy / free-form
  price_per_night: number | null; // numeric nightly price (for budgeting)
  currency: string | null; // currency symbol/code for price_per_night
  details: ListingDetails | null; // parsed structured details (jsonb column)
  notes: string | null;
  submitted_by: string | null;
  parse_status: ParseStatus;
  parsed_at: string | null;
  created_at: string;
}

export interface Vote {
  id: string;
  accommodation_id: string;
  member_id: string;
  value: boolean; // true = yes, false = no
  updated_at: string;
}

/**
 * One member's real, personal price for an accommodation — the price they see
 * when logged into their own account (Genius level, loyalty, regional pricing,
 * coupons…), layered on top of the parsed "standard" price_per_night. Stored per
 * night, so it compares apples-to-apples with the reference price. One row per
 * (accommodation, member), upserted exactly like a Vote.
 */
export interface AccommodationPrice {
  id: string;
  accommodation_id: string;
  member_id: string;
  amount: number; // per night, in `currency`
  currency: string | null;
  note: string | null;
  updated_at: string;
}

/** Structured details parsed from a listing (rating + capacity). */
export interface ListingDetails {
  rating: number | null; // e.g. 4.82
  reviews: number | null; // review count
  bedrooms: number | null;
  beds: number | null;
  baths: number | null; // may be fractional (1.5)
  guests: number | null; // max guests
}

export interface ParsedListing {
  title: string | null;
  imageUrl: string | null;
  description: string | null;
  priceText: string | null; // raw price string, best-effort
  pricePerNight: number | null; // numeric nightly price, best-effort (often null)
  currency: string | null; // e.g. "$", "USD", "€"
  details: ListingDetails;
}

// View model the board renders: an accommodation with its votes and the per-member
// prices joined in. (Name kept for continuity — it now carries prices too.)
export interface AccommodationWithVotes extends Accommodation {
  votes: Vote[];
  prices: AccommodationPrice[];
}
