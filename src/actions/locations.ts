"use server";

/**
 * Location Server Actions — manage a leg's places-to-visit and geocode addresses
 * into coordinates for the location scorer.
 *
 * Like every mutating action in this app, each calls assertGate() FIRST (the gate
 * cookie is the only authorization boundary) and writes through the service-role
 * client (the anon key is SELECT-only). Input validation is delegated to the pure
 * preparePlaceInput / parseCoordinates helpers so it's unit-testable without a DB.
 *
 * Geocoding never blocks a write: a place/accommodation always saves, and the
 * address is resolved to coordinates best-effort. With no LOCATIONIQ_API_KEY the
 * row stays `geocode_status='pending'` and the board falls back to manual
 * coordinates + haversine — the feature is fully usable keyless, just approximate.
 */
import { assertGate } from "@/lib/gate/assert";
import { getServiceClient } from "@/lib/supabase/server";
import { geocodeToColumns, type GeocodeColumns } from "@/lib/geocode";
import { parseCoordinates, preparePlaceInput, type PlaceInput } from "@/lib/places";
import type { Accommodation, GeocodeStatus, Place } from "@/lib/types";

type Service = ReturnType<typeof getServiceClient>;

/**
 * Keep existing coordinates when a (re)geocode yields a transient/no-key 'pending'
 * result. Only a definitive 'ok' (new coords) or 'failed' (genuine miss) overwrites
 * them — so the "tap to retry" path can never wipe a row that was already located.
 */
function preserveOnPending(prev: GeocodeColumns, fresh: GeocodeColumns): GeocodeColumns {
  if (
    fresh.geocode_status === "pending" &&
    (prev.latitude != null || prev.longitude != null)
  ) {
    return prev;
  }
  return fresh;
}

/** The current geocode columns of a row (place or accommodation), defaulting a
 *  missing status to 'pending'. */
function prevGeo(row: {
  latitude?: number | null;
  longitude?: number | null;
  geocode_status?: GeocodeStatus;
  geocoded_at?: string | null;
}): GeocodeColumns {
  return {
    geocode_status: row.geocode_status ?? "pending",
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    geocoded_at: row.geocoded_at ?? null,
  };
}

/** Next sort_order for a stay's places (max + 1), so insertion order is stable. */
async function nextPlaceSortOrder(supabase: Service, stayId: string): Promise<number> {
  const { data } = await supabase
    .from("places")
    .select("sort_order")
    .eq("stay_id", stayId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sort_order ?? -1) + 1;
}

/** Create a place-to-visit on a leg, geocoding its address best-effort. */
export async function submitPlace(
  input: PlaceInput & { stayId: string; submittedBy?: string | null },
): Promise<Place> {
  await assertGate();

  const normalized = preparePlaceInput(input);
  const supabase = getServiceClient();

  // Independent IO (a DB read + a geocode fetch) — run them together, matching
  // the codebase's Promise.all convention for independent queries.
  const [sortOrder, geo] = await Promise.all([
    nextPlaceSortOrder(supabase, input.stayId),
    geocodeToColumns(normalized.address),
  ]);

  const { data, error } = await supabase
    .from("places")
    .insert({
      stay_id: input.stayId,
      label: normalized.label,
      category: normalized.category,
      address: normalized.address,
      importance: normalized.importance,
      closer_is_better: normalized.closer_is_better,
      submitted_by: input.submittedBy ?? null,
      sort_order: sortOrder,
      ...geo,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to add place: ${error?.message ?? "no data"}`);
  }
  return data as Place;
}

/**
 * Update a place. Re-geocodes only when the address actually changes (a cleared
 * address resets to 'pending' with no coords; an unchanged address keeps the
 * existing coordinates, including a manual pin).
 */
export async function updatePlace(input: PlaceInput & { id: string }): Promise<Place> {
  await assertGate();

  const normalized = preparePlaceInput(input);
  const supabase = getServiceClient();

  const { data: existing, error: readError } = await supabase
    .from("places")
    .select("*")
    .eq("id", input.id)
    .single();
  if (readError || !existing) {
    throw new Error(`Failed to save place: ${readError?.message ?? "not found"}`);
  }
  const prev = existing as Place;

  const keepPrev: GeocodeColumns = {
    geocode_status: prev.geocode_status,
    latitude: prev.latitude,
    longitude: prev.longitude,
    geocoded_at: prev.geocoded_at,
  };

  let geo: GeocodeColumns;
  if (prev.geocode_status === "manual") {
    // A manual pin is the user's authoritative correction — never wipe it on an
    // address-text edit. Changing the actual location is done via setManualLocation.
    geo = keepPrev;
  } else if (!normalized.address) {
    geo = { geocode_status: "pending", latitude: null, longitude: null, geocoded_at: null };
  } else if (normalized.address !== prev.address) {
    geo = await geocodeToColumns(normalized.address);
  } else {
    geo = keepPrev;
  }

  const { data, error } = await supabase
    .from("places")
    .update({
      label: normalized.label,
      category: normalized.category,
      address: normalized.address,
      importance: normalized.importance,
      closer_is_better: normalized.closer_is_better,
      ...geo,
    })
    .eq("id", input.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save place: ${error?.message ?? "no data"}`);
  }
  return data as Place;
}

/** Delete a place by id. */
export async function deletePlace(id: string): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();
  const { error } = await supabase.from("places").delete().eq("id", id);
  if (error) {
    throw new Error(`Failed to remove place: ${error.message}`);
  }
}

/**
 * Set a manual location from pasted coordinates or a Google Maps link (the
 * Phase-1 escape hatch when geocoding misses — true pin-drop is a later phase).
 * Marks the row `geocode_status='manual'`.
 */
export async function setManualLocation(
  kind: "place" | "accommodation",
  id: string,
  text: string,
): Promise<Place | Accommodation> {
  await assertGate();

  const coords = parseCoordinates(text);
  if (!coords) {
    throw new Error(
      "Enter coordinates like -8.5069, 115.2625 or paste a Google Maps link.",
    );
  }

  const supabase = getServiceClient();
  const table = kind === "place" ? "places" : "accommodations";
  const { data, error } = await supabase
    .from(table)
    .update({
      latitude: coords.latitude,
      longitude: coords.longitude,
      geocode_status: "manual",
      geocoded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to set location: ${error?.message ?? "no data"}`);
  }
  return data as Place | Accommodation;
}

/** (Re)geocode a place's current address — the "tap to retry" path. */
export async function geocodePlace(id: string): Promise<Place> {
  await assertGate();

  const supabase = getServiceClient();
  const { data: row, error: readError } = await supabase
    .from("places")
    .select("address, latitude, longitude, geocode_status, geocoded_at")
    .eq("id", id)
    .single();
  if (readError || !row) {
    throw new Error(`Failed to locate place: ${readError?.message ?? "not found"}`);
  }
  const prev = row as Place;

  const geo = preserveOnPending(prevGeo(prev), await geocodeToColumns(prev.address));
  const { data, error } = await supabase
    .from("places")
    .update(geo)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to locate place: ${error?.message ?? "no data"}`);
  }
  return data as Place;
}

/** (Re)geocode an accommodation's current address (used by the backfill + retry). */
export async function geocodeAccommodation(id: string): Promise<Accommodation> {
  await assertGate();

  const supabase = getServiceClient();
  const { data: row, error: readError } = await supabase
    .from("accommodations")
    .select("address, latitude, longitude, geocode_status, geocoded_at")
    .eq("id", id)
    .single();
  if (readError || !row) {
    throw new Error(`Failed to locate accommodation: ${readError?.message ?? "not found"}`);
  }
  const prev = row as Accommodation;

  const geo = preserveOnPending(prevGeo(prev), await geocodeToColumns(prev.address ?? null));
  const { data, error } = await supabase
    .from("accommodations")
    .update(geo)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to locate accommodation: ${error?.message ?? "no data"}`);
  }
  return data as Accommodation;
}

/**
 * One-off backfill: geocode existing accommodations/places that have an address
 * but no coordinates yet (geocode_status='pending'), after the cloud DB columns
 * are applied (spec §11 rollout). A no-op without LOCATIONIQ_API_KEY (rows stay
 * 'pending'); with a key it resolves up to `limit` rows per table per call.
 * Returns how many rows it actually located. Gated like every other action.
 */
export async function backfillGeocoding(
  limit = 100,
): Promise<{ accommodations: number; places: number }> {
  await assertGate();
  const supabase = getServiceClient();

  async function run(table: "accommodations" | "places"): Promise<number> {
    const { data } = await supabase
      .from(table)
      .select("id, address")
      .eq("geocode_status", "pending")
      .not("address", "is", null)
      .limit(limit);

    let located = 0;
    for (const row of (data ?? []) as { id: string; address: string | null }[]) {
      const geo = await geocodeToColumns(row.address);
      // Only write a definitive result; leave un-resolvable rows 'pending' for a retry.
      if (geo.geocode_status === "ok" || geo.geocode_status === "failed") {
        await supabase.from(table).update(geo).eq("id", row.id);
        if (geo.geocode_status === "ok") located += 1;
      }
    }
    return located;
  }

  const [accommodations, places] = await Promise.all([
    run("accommodations"),
    run("places"),
  ]);
  return { accommodations, places };
}
