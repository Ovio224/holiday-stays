// Domain types — the single source of truth shared across the app.

export type AccommodationSource = "airbnb" | "booking" | "other";
export type ParseStatus = "pending" | "ok" | "failed" | "manual";

// Geocoding lifecycle for a coordinate-bearing row (place or accommodation):
// 'pending' = not yet geocoded (or no key configured), 'ok' = resolved,
// 'failed' = address not found, 'manual' = user-entered coordinates.
export type GeocodeStatus = "pending" | "ok" | "failed" | "manual";

// How travel time between a place and an accommodation is measured. Scooter is
// the Bali default; car is often no faster in traffic; foot anchors are tighter.
export type TravelMode = "scooter" | "foot" | "car";

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
  address: string | null; // user-entered location, for the map + display
  amenities: string[] | null; // user-entered amenity list
  notes: string | null;
  submitted_by: string | null;
  parse_status: ParseStatus;
  parsed_at: string | null;
  created_at: string;
  // Geocoded coordinates (location-aware scoring). OPTIONAL on purpose: an
  // un-migrated cloud DB returns rows WITHOUT these keys, so a non-optional type
  // would be a silent lie. The scorer treats a missing geocode_status as 'pending'.
  latitude?: number | null;
  longitude?: number | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
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

/**
 * One comment in an accommodation's discussion thread — a Notion-style note where
 * a member explains WHY they're leaning yes/no, beyond a silent vote. Unlike votes
 * and prices there's no one-per-member constraint: a thread holds many comments.
 */
export interface AccommodationComment {
  id: string;
  accommodation_id: string;
  member_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/**
 * A per-leg "place to visit" (point of interest). The group curates these on each
 * Stay; the scorer ranks that leg's accommodations by how close they sit to them.
 * `latitude`/`longitude` are null until the `address` is geocoded server-side (or
 * a manual coordinate is entered). `category` is validated app-side against the
 * canonical PLACE_CATEGORIES enum (see src/lib/places.ts). `importance` weights
 * the POI in the location score (3 = must, 2 = want, 1 = nice); `closer_is_better`
 * = false flips the curve so "being far is good" (e.g. a quiet retreat avoiding a
 * nightlife strip) — Phase 1 leaves it at the default `true`.
 */
export interface Place {
  id: string;
  stay_id: string;
  label: string;
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_status: GeocodeStatus;
  geocoded_at: string | null;
  importance: 1 | 2 | 3; // nice / want / must
  closer_is_better: boolean;
  sort_order: number;
  submitted_by: string | null;
  created_at: string;
}

/**
 * One cached routed (or haversine-estimated) leg between an accommodation and a
 * place, for one travel mode. Phase 3 read cache (`bali.distances`); Phase 1
 * computes the same shape in-memory from haversine and never persists it.
 */
export interface DistanceRecord {
  accommodation_id: string;
  place_id: string;
  mode: TravelMode;
  minutes: number | null; // one-way travel time
  distance_km: number | null;
  source: "valhalla" | "osrm" | "haversine" | "manual";
  computed_at: string;
}

/** Structured details parsed from a listing (rating + capacity). */
export interface ListingDetails {
  rating: number | null; // e.g. 4.82 (Airbnb /5) or 9.5 (Booking /10)
  ratingScale: number | null; // the rating's max, from JSON-LD bestRating (5, 10…); null = default /5
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

// View model the board renders: an accommodation with its votes, the per-member
// prices, and the discussion thread joined in. (Name kept for continuity — it now
// carries prices + comments too.)
export interface AccommodationWithVotes extends Accommodation {
  votes: Vote[];
  prices: AccommodationPrice[];
  comments: AccommodationComment[];
}
