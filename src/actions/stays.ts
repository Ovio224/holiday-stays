"use server";

/**
 * Stay (trip leg) Server Actions — create, update, delete, and reorder legs.
 *
 * Like every mutating action in this app, each one calls assertGate() FIRST
 * (the gate cookie is the only authorization boundary) and writes through the
 * service-role client (the browser anon key is SELECT-only). Validation of the
 * user input is delegated to the pure prepareStayInput() helper so it can be
 * unit-tested without a DB.
 */
import { assertGate } from "@/lib/gate/assert";
import { getServiceClient } from "@/lib/supabase/server";
import { prepareStayInput, type StayInput } from "@/lib/stays";
import type { Stay } from "@/lib/types";

/**
 * Create a new leg. New legs append to the end of the itinerary: sort_order is
 * (max existing sort_order) + 1, defaulting to 0 when there are no legs yet.
 */
export async function createStay(input: StayInput): Promise<Stay> {
  await assertGate();

  const normalized = prepareStayInput(input);
  const supabase = getServiceClient();

  // Find the current highest sort_order so the new leg lands at the end.
  const { data: last, error: maxError } = await supabase
    .from("stays")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    throw new Error(`Failed to add leg: ${maxError.message}`);
  }

  const sortOrder = (last?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("stays")
    .insert({
      label: normalized.label,
      area: normalized.area,
      start_date: normalized.start_date,
      end_date: normalized.end_date,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to add leg: ${error?.message ?? "no data"}`);
  }

  return data as Stay;
}

/**
 * Update a leg's label/area/dates by id. sort_order is owned by reorderStay and
 * is intentionally not touched here.
 */
export async function updateStay(input: StayInput & { id: string }): Promise<Stay> {
  await assertGate();

  const normalized = prepareStayInput(input);
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("stays")
    .update({
      label: normalized.label,
      area: normalized.area,
      start_date: normalized.start_date,
      end_date: normalized.end_date,
    })
    .eq("id", input.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save leg: ${error?.message ?? "no data"}`);
  }

  return data as Stay;
}

/**
 * Delete a leg by id. The DB cascade (FK on delete cascade) removes the leg's
 * accommodations and their votes — destructive, so the UI confirms first.
 */
export async function deleteStay(id: string): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();
  const { error } = await supabase.from("stays").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to remove leg: ${error.message}`);
  }
}

/**
 * Move a leg up or down one position by swapping sort_order with its neighbor in
 * that direction. Legs are ordered by (sort_order, created_at) to match how the
 * board renders them; a no-op when there is no neighbor that way.
 */
export async function reorderStay(
  id: string,
  direction: "up" | "down",
): Promise<void> {
  await assertGate();

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("stays")
    .select("id, sort_order, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to reorder leg: ${error.message}`);
  }

  const stays = (data ?? []) as Pick<Stay, "id" | "sort_order" | "created_at">[];
  const index = stays.findIndex((s) => s.id === id);
  if (index === -1) {
    throw new Error("Failed to reorder leg: leg not found.");
  }

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  // No neighbor in that direction → nothing to do (e.g. already first/last).
  if (neighborIndex < 0 || neighborIndex >= stays.length) {
    return;
  }

  const current = stays[index];
  const neighbor = stays[neighborIndex];

  // Swap their sort_order values with two updates.
  const [first, second] = await Promise.all([
    supabase
      .from("stays")
      .update({ sort_order: neighbor.sort_order })
      .eq("id", current.id),
    supabase
      .from("stays")
      .update({ sort_order: current.sort_order })
      .eq("id", neighbor.id),
  ]);

  if (first.error || second.error) {
    throw new Error(
      `Failed to reorder leg: ${(first.error ?? second.error)?.message}`,
    );
  }
}
