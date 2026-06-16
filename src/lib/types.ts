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
  price_text: string | null;
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

export interface ParsedListing {
  title: string | null;
  imageUrl: string | null;
  priceText: string | null;
  description: string | null;
}

// View model the board renders: an accommodation with its votes joined in.
export interface AccommodationWithVotes extends Accommodation {
  votes: Vote[];
}
