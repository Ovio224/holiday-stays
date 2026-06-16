"use server";

/**
 * Identity Server Actions.
 *
 * There is no Supabase Auth — a "member" is just a row in the members table,
 * and the current member is remembered via the MEMBER_COOKIE. Both actions are
 * gated: you must have passed the shared code before you can create or pick a
 * member.
 */
import { cookies } from "next/headers";
import { assertGate } from "@/lib/gate/assert";
import { MEMBER_COOKIE } from "@/lib/identity";
import { pickColor } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/server";
import type { Member } from "@/lib/types";

// Cookie options shared by both actions — httpOnly so client JS can't read it,
// secure + lax to behave well in a normal navigation flow. Members are sticky
// for a year.
const MEMBER_COOKIE_OPTS = {
  httpOnly: true,
  // secure only in production — see gate.ts: a secure cookie over http://localhost
  // is dropped by the browser and breaks the local dev flow.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1 year
} as const;

/**
 * Create a new member and adopt that identity.
 *
 * Validates the name (trimmed, 1-40 chars), assigns a deterministic tropical
 * color from the name, inserts the row, then stores the new id in the member
 * cookie. Returns the freshly created Member.
 */
export async function createMember(name: string): Promise<Member> {
  await assertGate();

  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error("Name must be between 1 and 40 characters.");
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("members")
    .insert({ name: trimmed, color: pickColor(trimmed) })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create member: ${error?.message ?? "no data"}`);
  }

  const member = data as Member;

  const cookieStore = await cookies();
  cookieStore.set(MEMBER_COOKIE, member.id, MEMBER_COOKIE_OPTS);

  return member;
}

/**
 * Adopt an existing member identity by id. Used when someone returns and picks
 * their name from the list rather than creating a new one.
 */
export async function selectMember(memberId: string): Promise<void> {
  await assertGate();

  const cookieStore = await cookies();
  cookieStore.set(MEMBER_COOKIE, memberId, MEMBER_COOKIE_OPTS);
}
