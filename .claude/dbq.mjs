// Tiny local DB query helper for verification. Reads service key from .env.local.
// Usage: node .claude/dbq.mjs "<sql-ish description handled in code>"
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

export const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
);
export const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// When run directly, print a board summary.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [{ data: stays }, { data: accs }, { data: votes }, { data: members }] =
    await Promise.all([
      sb.from("stays").select("id,label").order("sort_order"),
      sb.from("accommodations").select("*").order("created_at"),
      sb.from("votes").select("*"),
      sb.from("members").select("id,name"),
    ]);
  const stayName = Object.fromEntries(stays.map((s) => [s.id, s.label]));
  const memName = Object.fromEntries(members.map((m) => [m.id, m.name]));
  console.log("MEMBERS:", members.map((m) => m.name).join(", "));
  for (const a of accs) {
    const av = votes.filter((v) => v.accommodation_id === a.id);
    console.log(
      `[${stayName[a.stay_id]}] src=${a.source} status=${a.parse_status} ` +
        `title=${JSON.stringify(a.title)} price=${JSON.stringify(a.price_text)} ` +
        `img=${a.image_url ? "yes" : "no"} notes=${JSON.stringify(a.notes)} ` +
        `votes=[${av.map((v) => memName[v.member_id] + ":" + (v.value ? "y" : "n")).join(",")}]`,
    );
  }
}
