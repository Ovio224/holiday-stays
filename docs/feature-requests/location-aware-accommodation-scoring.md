# Location-Aware Accommodation Scoring — "Best Stay Near Your Spots"

## TL;DR

Today the board lets a group collect candidate accommodations per trip leg and compare them on **price**, **votes**, and **ratings** — but location is a dead-simple keyless Google Maps embed built from a free-form `address` string, with **no coordinates, no geocoding, and no distance math anywhere in the app**. This feature adds a per-leg **"Places to visit"** list (POIs with importance weights), geocodes both POIs and accommodation addresses, computes **per-mode travel times** (scooter / foot / car) from each accommodation to each POI, and folds those into a single explainable **0–100 location score** that feeds a configurable **"best for X"** composite. The board can then auto-rank a leg's accommodations by how well-placed they are, switchable by travel mode and persona.

The hard part is **data acquisition** (geocoding + routing — brand-new external infrastructure); the scoring math is a cheap, pure, unit-testable `src/lib/location-score.ts` that ships behind a null-tolerant interface so it works (showing "Needs address") before geocoding lands. **The primary ask is "pick our spots → sort accommodations by distance."** Phase 1 ships exactly that thin loop; personas, multi-mode toggles, reorder, and cached routing are explicitly deferred.

---

## 1. Problem & motivation

The current Bali trip workflow on this board is: members paste accommodation listings under a leg (`Stay`), each person records the **real price** they'd pay, everyone **votes** yes/no, and discussion happens in **comment threads**. The detail dialog shows a map — but that map is purely cosmetic: `src/lib/accommodations.ts` builds a search string from `address || title` joined with the leg's `area` and drops it into a keyless Google embed (`mapQuery()` → `mapEmbedUrl()`). **There are no coordinates in the schema, no geocoding, no distance calculation, and no API key in the entire app.** So the single biggest real-world question a group asks — *"if I stay here, how far is everything I actually want to do?"* — is answered today by eyeballing a map, one listing at a time.

The original ask (translated from Romanian):

> "We set up the plan of what we want to visit [points of interest], and it automatically pulls the accommodations at each destination and sorts them by distance. And it computes a score for which is the best for X. **Bonus: by car, by foot, by scooter.**"

Decomposed against the current domain model:

1. **"set up the plan of what we want to visit"** → a new **per-leg list of POIs** (places-to-visit) attached to a `Stay`, with a notion of how much the group cares about each.
2. **"automatically pulls the accommodations at each destination"** → accommodations are *already* attached per-leg (`accommodations.stay_id → stays.id`). We don't need to "pull" them — they're submitted by members. The real meaning is: **automatically associate each leg's existing candidate accommodations with that leg's POIs** and rank them.
3. **"sorts them by distance"** → distance/time from each accommodation to the leg's POIs → a sortable location score. **This is the primary ask.**
4. **"score for which is the best for X"** → a configurable composite blending **location** with the existing pillars (**price**, **rating**, **votes**), where **X** is a persona / weighting preset. **This is the secondary ask — it is deferred past the MVP.**
5. **"by car, by foot, by scooter"** → travel-mode-aware times. **Scooter is the dominant Bali mode**, and in Bali a car is frequently *no faster* than a scooter due to congestion and parking — so scooter is the default, not an afterthought. **This is the explicit "bonus" — also post-MVP.**

This is the natural next pillar for a board that already scores accommodations on price/votes/rating: it makes the comparison reflect the thing groups argue about most.

---

## 2. User stories

- **As a group member**, I want to add the places we plan to visit on a leg (e.g. *Sacred Monkey Forest*, *Tegallalang Rice Terraces*, a favourite warung), so the board knows what "well-located" means **for this specific trip**, not in the abstract.
- **As a group member**, I want to mark each place as **must-be-near / want / nice-to-have**, so a villa next to the one thing we all care about ranks above one that's merely central to stuff we don't.
- **As a group member**, I want each leg's accommodations to **re-rank by how close they are** to our places, so I can sort the board by location instead of guessing from a map.
- **As a group member**, I want a **location score badge** on each accommodation card, with a one-line "why" (e.g. *"4 of 5 spots within 15 min by scooter"*), so the number is trustworthy and explainable.
- **As a group member**, I want to **switch travel mode** (scooter / foot / car) and watch the ranking change, because "10 min walk to the beach" and "10 min scooter to the beach" are completely different selling points. *(Phase 2.)*
- **As a group member**, I want to pick a **persona** ("Foodie", "Beach lover", "Nightlife", "Quiet/remote", "Group consensus") or open **manual sliders**, so "best for **X**" means *our* X — and so a quiet-retreat group can score *being far from nightlife* as a good thing. *(Phase 3.)*
- **As a group member who hasn't entered an address yet**, I want my listing to show a clear **"Needs address"** chip and sit in a separate "needs info" group — **not** get a fake low score and not silently vanish — so I know what to fix instead of being penalised.
- **As a group member on my phone**, I want all of this to work in a thumb-friendly, mobile-first layout, because trip planning happens on phones.

---

## 3. Scope

### In scope
- A `bali.places` table: per-`Stay` POIs, geocoded (`lat`/`lng`), with an **importance weight**, optional **category**, and a **closer-is-better** flag. (Reorder/category/closer-is-better are Phase 2/3 columns — see §8.)
- New `latitude` / `longitude` + geocode-status metadata columns on `bali.accommodations`.
- An optional `bali.distances` cache keyed by `(accommodation_id, place_id, mode)` storing time + distance. **(Phase 3, server-compute cache — not a realtime entity; see §8 and de-scope note in §3 Out of scope.)**
- A geocoding integration (address string → lat/lng) and a routing integration (per-mode time/distance), run **server-side only** (never expose keys), with a **keyless haversine fallback**.
- A pure, unit-tested scoring module `src/lib/location-score.ts` producing per-mode location scores and a "best for X" composite, with persona presets and manual weights.
- UI: a **"Places to visit"** manager in `stay-section.tsx` (where the leg's accommodations actually render), with add/edit forms hosted in a `leg-sheet.tsx`-style sheet; a **sort control + score badge** on cards (`stay-section.tsx` / `accommodation-carousel.tsx`); **per-POI distances + mode toggle** in the accommodation detail dialog; and a **persona/weight picker**.
- Realtime propagation of POI changes via the existing `use-realtime-board.ts` pattern, including the full **seed chain** (see §5.6).
- Migrations following the repo's actual versioned-migration style, **mirrored** into `docs/deploy/bali-cloud-setup.sql` in *that* file's idempotent idiom (see §5).

### Out of scope
- Auto-discovering POIs (e.g. "show me all temples near Ubud") — POIs are **curated by the group**, like accommodations are.
- Real Supabase Auth / per-user accounts — gate-based auth (`assertGate()`) is unchanged.
- Turn-by-turn navigation, live traffic, or booking integration.
- Multi-leg / cross-trip optimization ("which order to visit legs").
- Replacing the existing keyless map embed — it **stays** as the visual; geocoding augments it, it doesn't remove it.
- **Interactive pin-drop on the map.** The current map is a keyless read-only iframe that cannot capture clicks; true pin-drop needs a real interactive map widget (a new dependency). Manual-location correction in Phase 1 is a **coordinate field / "paste a Google Maps link or coords" input**, not a draggable pin.
- **"POI far from leg-area" centroid warning** (open decision #8). It requires geocoding the leg's `area` string — a **fourth geocoding target that does not exist today** (`stays` have no lat/lng). De-scoped to a far-future item; noted here so nobody assumes stays are geocoded.
- **"Best by scooter vs foot" side-by-side comparison** — gold-plating; deferred indefinitely.
- **Realtime streaming of cached distances.** `bali.distances` is a server-compute read cache joined in-memory; streaming cached distances to other members is marginal value for a handful of users. No `.on()` subscription unless a concrete need appears.

### Non-goals
- Pixel-perfect geocoding for ambiguous free-form addresses. We **assist** (show the resolved point, let users correct it), we do not guarantee correctness.
- A native "scooter" profile from a mainstream API — we use a provider that actually has one (Valhalla), or fall back to a documented approximation (see §6).
- Storing or scoring anything that requires more than the group's free-tier API headroom (see §10).

---

## 4. Proposed UX (mobile-first)

### 4.1 "Places to visit" manager (in `stay-section.tsx`)

The per-leg accommodation list is rendered by `StaySection` (via `AccommodationCarousel`), **not** by `LegSheet` (which is a single-leg create/edit bottom-sheet editor). The inline "Places to visit" list, the sort control, and the per-card score badges therefore live in **`stay-section.tsx`**. Add/edit POI **forms** are hosted in a bottom-sheet consistent with how legs are edited (the `leg-sheet.tsx` sheet pattern), but the inline list itself is in `StaySection`.

```
┌──────────────────────────────────────────┐
│  Ubud · 4 nights · Jun 16–20             │  ← StaySection header
│  ───────────────────────────────────────  │
│  📍 Places to visit (4)        [+ Add]    │
│   ⠿ Monkey Forest      [must ▾]  6 min 🛵 │
│   ⠿ Rice Terraces      [want ▾] 18 min 🛵 │
│   ⠿ Warung Biah Biah   [nice ▾]  4 min 🛵 │
│   ⠿ Campuhan Ridge     [want ▾] 11 min 🛵 │
│   ───────────────────────────────────────  │
│  🏠 Accommodations (3)   sort:[Location▾] │  ← AccommodationCarousel
│   ... cards below ...                      │
└──────────────────────────────────────────┘
```

- **Add a place**: a small form — `label` (required), `category` (optional select bound to the **canonical enum**, see §5.1/§7.3), an **address/search box**, and an importance toggle (**must / want / nice** = weight 3 / 2 / 1). On save, the action geocodes the address; the row shows a resolved pin and a tiny "edit location" affordance (coordinate field) if the group wants to nudge it.
- **Per-place travel time** (`6 min 🛵`) is shown relative to the *currently focused* accommodation when one is open, or hidden in the standalone list. The 🛵/🚶/🚗 glyph reflects the active mode. *(Mode toggle is Phase 2; Phase 1 is scooter-only.)*
- **Reorder** (`⠿` drag handle) sets `sort_order`, reusing the leg reorder pattern. *(Phase 2 — not in the MVP.)*
- **Empty state**: *"No places yet. Add the spots you want to be near — temples, beaches, that warung — and we'll rank your stays by how close they are."* with a single `[+ Add a place]` CTA.
- **Geocoding-pending state**: a place row shows a subtle spinner + *"Locating…"* until the action returns.
- **Geocode failure** — distinguish two cases (see §9):
  - *Transient* (rate-limit / 5xx): *"Couldn't reach the locator — tap to retry."* (`geocode_status` stays `pending`; retry re-runs the same geocode.)
  - *Not found* (genuine miss): *"Couldn't find this — set the location."* (`geocode_status='failed'`; opens the coordinate field.)

### 4.2 Sort control + score badge on cards (`stay-section.tsx` / `accommodation-carousel.tsx`)

The leg's accommodation list gets a **sort dropdown**. **Phase 1 ships only `Location` (plus the existing default order).** `Price · Rating · Votes · Best for X` are added in later phases. Each card gains a **score badge**:

```
┌────────────── Villa Ubud Green ─────────────┐
│ [img]   $52/night · ★4.7 · 👍4 👎1          │
│                                              │
│   📍 86  ·  4/5 spots within 15 min 🛵       │   ← location score + coverage
│   🏆 Best for Foodie: 85                     │   ← composite (Phase 3, only if a persona is active)
└──────────────────────────────────────────────┘
```

- **Location badge** = the 0–100 location sub-score + a plain-language coverage line ("4/5 spots within 15 min").
- **Composite badge** appears only when a persona/weights are active (Phase 3), labelled with the persona name.
- **Missing-address card**: instead of a score, a `Needs address` chip and *"Add a location to rank by distance."* These cards sort into a **separate "Needs info" group at the bottom**, never interleaved as if they scored low.
- **Loading / first-score state**: while a leg's scores are computing, badges show a **"Scoring…"** state. **Un-scored cards stay in their current sort position and do NOT jump to the "needs info" group transiently** — they remain where they are and animate **once** when a score lands, to avoid mid-interaction reshuffles on a live board. The rest of the card (price/votes/rating) is fully interactive — scoring never blocks the board.

### 4.3 Detail dialog — per-POI distances + mode toggle

The existing accommodation detail dialog (keyless map + amenities + full edit) gains a **"Distances"** section:

```
  Distances from here          [🛵 Scooter ▾]   ← mode toggle (Phase 2): Scooter / Foot / Car
  ────────────────────────────────────────────
  Monkey Forest      6 min · 2.1 km   ████████░  ← per-POI bar (sub-score)
  Rice Terraces     18 min · 6.4 km   █████░░░░
  Warung Biah Biah   4 min · 1.2 km   █████████
  Campuhan Ridge    11 min · 3.8 km   ███████░░
  ────────────────────────────────────────────
  Location score: 81 · coverage 75% (3 of 4 ≤15m)
  [ map embed stays exactly as today ]
```

- The **mode toggle** (🛵/🚶/🚗) re-fetches/recomputes times for the same POIs; the bars and the location score update in place. Scooter is the default. *(Phase 2; Phase 1 is scooter-only with no toggle.)*
- Each POI row shows time + distance + a small bar = that POI's 0–100 sub-score.
- **Accommodation-has-no-coordinates state**: if the *origin* accommodation lacks lat/lng (even when the POIs are geocoded), every row would be null — so instead show *"Add an address to this stay to see distances."* (not a list of empty rows).
- The **keyless Google Maps embed stays unchanged** beneath it.

### 4.4 Persona / weight picker (Phase 3)

A compact control. **On mobile, render it as a bottom-sheet** (consistent with `leg-sheet.tsx`), not a cramped popover; on desktop it can be a popover from the sort dropdown or a "Best for…" chip in the leg header.

```
  Best for…   ( Foodie ) ( Beach ) ( Nightlife ) ( Quiet ) ( Consensus )  [ Custom ⚙ ]

  Custom ⚙  →  Location  ▓▓▓▓▓▓░░  Price  ▓▓▓░░░░░
              Rating    ▓▓▓▓░░░░  Votes  ▓▓░░░░░░
              Mode: ( 🛵 Scooter ) 🚶 🚗
```

- Selecting a persona sets **both** the pillar weights **and** the per-POI category multipliers in one tap (see §7.3). **Personas never mutate stored data** (`closer_is_better`, `importance`) — they apply multipliers and curve-inversion **only at scoring time** as a pure transform of `(place, persona) → effective weight`.
- **Persona vs. mode precedence**: a persona **may suggest** a default mode (e.g. Nightlife → scooter), but the **mode toggle always wins** and is independent view-state. Switching mode manually after picking a persona keeps the persona's pillar/category weights and only swaps the anchor set + speed. Document this precedence in the picker.
- **Custom** exposes four pillar sliders + a mode selector. The selection is a **client-side view state** (no DB write needed for MVP); optionally persisted per-member later.

---

## 5. Data model changes

All tables live in the `bali` schema. **Match the file you are editing:**

- **Versioned migration files** (`supabase/migrations/*.sql`) use the repo's actual plain style — **bare** `create table bali.X` and **bare** `create policy "..."` (they are NOT idempotent and are not meant to be re-run). The one guarded construct that genuinely belongs even here is the realtime-publication add (publication membership errors on a re-add and on tables that don't exist).
- **`docs/deploy/bali-cloud-setup.sql`** is the hand-maintained, re-runnable file a fresh cloud DB is built from. Mirror every change here using **that file's** idempotent idiom: `create table if not exists`, `add column if not exists`, and the `do $$ … pg_policies … create policy` guard block. **Do not** use `drop policy if exists` — that idiom appears nowhere in the repo.

Tables also need **explicit grants** (the init migration's blanket `grant all on all tables` only covered tables that existed then), **explicit realtime-publication membership** (each table is added by its own statement — e.g. `stays` needed a dedicated `20260616120000_stays_realtime.sql`; nothing is auto-published), and **RLS** (anon `SELECT` only; writes go through service-role actions).

> **Cloud-apply gotcha (from project memory):** migrations are **not** auto-applied to the cloud DB. New tables/columns must be applied (Supabase SQL editor) **before** shipping code that reads them. And critically — `getBoardData()` runs `select *, votes(*), accommodation_prices(*)` as a single PostgREST query; **a PostgREST embed onto a missing relation fails the *entire* accommodations query and breaks the whole board.** That is exactly why `accommodation_comments` is loaded as a **separate query** with a graceful `console.warn` fallback (see `src/lib/data.ts` lines 66–119). **POIs and distances MUST follow the same resilient-read pattern — separate queries, never new embeds on `accommodations`.**

### 5.1 New table: `bali.places` (per-leg POIs)

Versioned migration (`supabase/migrations/20260617090000_places.sql`) — repo plain style:

```sql
set search_path = bali, public;

create table bali.places (
  id           uuid primary key default gen_random_uuid(),
  stay_id      uuid not null references bali.stays(id) on delete cascade,
  label        text not null,
  category     text,                         -- canonical enum, app-validated (see §7.3)
  address      text,                         -- free-form, what the user typed (mirrors accommodations.address)
  latitude     double precision,             -- nullable until geocoded
  longitude    double precision,             -- nullable until geocoded
  geocode_status text not null default 'pending'
                 check (geocode_status in ('pending','ok','failed','manual')),
  geocoded_at  timestamptz,
  importance   smallint not null default 2   -- 3=must, 2=want, 1=nice
                 check (importance between 1 and 3),
  closer_is_better boolean not null default true,  -- false → "being far is good" (Quiet persona / nightlife POIs)
  sort_order   integer not null default 0,
  submitted_by uuid references bali.members(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index places_stay_id_idx on bali.places(stay_id);

-- Grants: the init blanket grant predates this table, so grant explicitly.
grant select on bali.places to anon, authenticated;
grant all    on bali.places to service_role;

-- RLS: anon/authenticated read-only; all writes go through service-role actions.
alter table bali.places enable row level security;
create policy "places_select" on bali.places for select to anon, authenticated using (true);

-- Realtime publication (guarded — membership errors on re-add / missing table).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'bali' and tablename = 'places'
  ) then
    alter publication supabase_realtime add table bali.places;
  end if;
end $$;
```

> **`category` enum / column-trim note (Phase boundaries):** `category`, `closer_is_better`, and `sort_order` are present in the schema from the start for forward-compat, but the **Phase-1 UI only exercises `label` + `address` + `importance`**. The `category` select, `closer_is_better` semantics, and reorder UI arrive in Phase 2/3 (see §8). The canonical category enum is locked in §7.3 and enforced in `preparePlaceInput` (mirroring the `source` enum pattern on accommodations).

**Cloud mirror** (`docs/deploy/bali-cloud-setup.sql`) — idempotent idiom: `create table if not exists bali.places (...)`, `grant ...`, and the policy wrapped in a guard:

```sql
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='bali' and tablename='places' and policyname='places_select') then
    create policy "places_select" on bali.places for select to anon, authenticated using (true);
  end if;
end $$;
-- plus the same do-block pg_publication_tables guard for realtime.
```

### 5.2 New columns on `bali.accommodations`

```sql
-- same migration or 20260617090500_accommodation_coords.sql (versioned: bare style)
alter table bali.accommodations add column if not exists latitude       double precision;
alter table bali.accommodations add column if not exists longitude      double precision;
alter table bali.accommodations add column if not exists geocode_status text
  not null default 'pending' check (geocode_status in ('pending','ok','failed','manual'));
alter table bali.accommodations add column if not exists geocoded_at    timestamptz;
```

(`add column if not exists` is safe and matches the existing accommodations-column additions in the repo; mirror identically into the cloud doc.) These are **nullable** (null until geocoded). `accommodations` is already in the realtime publication, so coordinate updates stream for free — and they ride on the **existing `accommodations` embed**, which is safe because we're adding *columns*, not a new *relation*.

> **Column type — `double precision` chosen deliberately.** Every existing numeric column in the schema (`price_per_night`, `accommodation_prices.amount`) is `numeric`, which this project's PostgREST/Supabase client returns as a JSON **number** (the TS type for `price_per_night` is `number | null` and works). We use `double precision` for lat/lng/minutes/distance because they are floating-point measurements, not currency, and `double precision` serializes as a JSON number too. **Action item before locking the TS types:** confirm against the live project that a `double precision` column round-trips as a JS `number` (not a string) — if the project's PostgREST config stringifies it, fall back to `numeric` to keep `number | null` honest. Do not lock the TS type to `number` until this is verified.

### 5.3 Optional cache table: `bali.distances` (Phase 3)

Keyed by `(accommodation_id, place_id, mode)`, storing the routed time + distance so we don't re-hit the routing API on every render. **This is a server-compute read cache, joined in-memory — NOT a realtime entity** (no `.on()` subscription; see §3 Out of scope).

```sql
-- supabase/migrations/20260618090000_distances.sql (versioned: bare style)
create table bali.distances (
  accommodation_id uuid not null references bali.accommodations(id) on delete cascade,
  place_id         uuid not null references bali.places(id)         on delete cascade,
  mode             text not null check (mode in ('scooter','foot','car')),
  minutes          double precision,        -- one-way travel time
  distance_km      double precision,
  source           text not null default 'haversine'
                   check (source in ('valhalla','osrm','haversine','manual')),
  computed_at      timestamptz not null default now(),
  primary key (accommodation_id, place_id, mode)
);

create index distances_place_idx on bali.distances(place_id);

grant select on bali.distances to anon, authenticated;
grant all    on bali.distances to service_role;
alter table bali.distances enable row level security;
create policy "distances_select" on bali.distances for select to anon, authenticated using (true);
```

> Because `bali.distances` is **not** streamed via realtime, it does **not** need to be added to the `supabase_realtime` publication. (The earlier draft's comment to "add it with the same guarded do-block" is intentionally dropped — if a future need to stream distances appears, add the guarded publication `do`-block then, and write it out in full rather than leaving it in a comment.)

`on delete cascade` from both `accommodations` and `places` means a deleted listing or POI auto-purges its cached distances. `computed_at` supports staleness checks; we additionally invalidate by **deleting affected rows** when a **coordinate** changes (see §6.4).

### 5.4 Resilient read in `getBoardData()` (`src/lib/data.ts`)

Today `getBoardData()` returns **`{ stays, accommodations, members }`** and **folds comments INTO each accommodation** (`accommodation.comments`) — comments are *not* a top-level key. **`places` and `distances` are a genuinely different, NEW shape: top-level parallel collections, not nested onto accommodations.** Add **two more separate queries** (not embeds), mirroring the comments fallback so a cloud DB missing `places`/`distances` degrades to "no places / haversine-only" instead of breaking the board:

```ts
const [staysResult, accommodationsResult, membersResult, commentsResult,
       placesResult, distancesResult] = await Promise.all([
  /* …existing four… */
  supabase.from("places").select("*").order("sort_order", { ascending: true }),
  supabase.from("distances").select("*"),   // Phase 3 only; harmless if table absent
]);

if (placesResult.error) {
  console.warn(`Places unavailable (continuing without them): ${placesResult.error.message}`);
}
if (distancesResult.error) {
  console.warn(`Distance cache unavailable (will compute on demand): ${distancesResult.error.message}`);
}
// places: top-level array (NOT bucketed onto accommodations — they are per-stay, joined in the UI selector by stay_id).
// distances: top-level array, joined in-memory by (accommodation_id, place_id, mode).
```

`getBoardData()` now returns **`{ stays, accommodations, members, places, distances }`** — `places` and `distances` are **new top-level keys** and the return type must be updated. **No new embed is added to the accommodations `select`.**

> **Flag-gating the extra queries (rollout safety, see §11):** when `LOCATION_SCORING_ENABLED` is off, **skip** the `places`/`distances` queries entirely and return them as empty arrays, and have the scorer/UI read no new columns. This guarantees an un-migrated cloud DB is provably untouched with the flag off (acceptance criterion in §13).

### 5.5 Type model (`src/lib/types.ts`)

```ts
export type GeocodeStatus = "pending" | "ok" | "failed" | "manual";
export type TravelMode = "scooter" | "foot" | "car";

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
  importance: 1 | 2 | 3;          // nice / want / must
  closer_is_better: boolean;
  sort_order: number;
  submitted_by: string | null;
  created_at: string;
}

// Extend Accommodation. NOTE: new columns are typed OPTIONAL until the migration is
// guaranteed applied to the cloud DB — select('*') on an un-migrated DB returns rows
// WITHOUT these keys, and a non-optional type would be a silent lie. The scorer treats
// a missing/undefined geocode_status as 'pending'.
export interface Accommodation {
  /* …existing… */
  latitude?: number | null;
  longitude?: number | null;
  geocode_status?: GeocodeStatus;   // missing → treat as 'pending'
  geocoded_at?: string | null;
}

export interface DistanceRecord {
  accommodation_id: string;
  place_id: string;
  mode: TravelMode;
  minutes: number | null;
  distance_km: number | null;
  source: "valhalla" | "osrm" | "haversine" | "manual";
  computed_at: string;
}
```

The board view-model `AccommodationWithVotes` is **not** extended with embedded scores — scores are **computed in-memory** from `(accommodation, places, distances, weights, mode)` in the UI/selector layer, so a missing table can never break the fetch.

### 5.6 Realtime seed chain (the full wiring — do not half-wire)

`places` is a **top-level array**, so it must be seeded exactly like `stays`, end to end. `members` is passed to `TripBoard` as a flat prop separate from the hook args, so **follow the `stays` path, not the `members` path**:

1. **`getBoardData()`** returns `places` (and `distances`) as top-level keys (§5.4), and its return type is updated.
2. **`src/app/page.tsx`** currently destructures `{ stays, accommodations, members }` and passes `initialStays` / `initialAccommodations`. Extend it to destructure `places` and pass `initialPlaces={places}` (and `initialDistances` if/when used) into `TripBoard`.
3. **`src/components/trip-board.tsx`** threads `initialPlaces` into its `useRealtimeBoard({ … })` call.
4. **`src/hooks/use-realtime-board.ts`**:
   - add `initialPlaces: Place[]` to `UseRealtimeBoardArgs`;
   - add `const [places, setPlaces] = useState(initialPlaces)`;
   - add `upsertPlace` / `removePlace` reducers and a `.on()` handler scoped `{ schema: 'bali', table: 'places' }` (INSERT/UPDATE → upsert-by-id, DELETE → remove-by-id) — matching the existing handlers' `schema: 'bali'`;
   - add imperative `applyPlaceUpsert` / `applyPlaceRemoval` (mirroring `applyStayUpsert` / `applyStayRemoval`) so the acting member sees their edit **instantly**;
   - add `places`, `applyPlaceUpsert`, `applyPlaceRemoval` to `UseRealtimeBoardResult`.

**Without all four steps the `places` array starts empty on every load and only populates when a realtime echo fires — POIs would silently vanish on refresh.** This is a hard acceptance criterion (§13).

---

## 6. Geocoding + distance architecture

The app has **zero** of this today: no API key, no geocoding, no routing, just a keyless Google embed. This is the **largest new addition** and the real gating work — the scoring math is cheap by comparison.

### 6.1 Recommended provider stack (from research)

| Concern | Provider | Why | Key? | Free tier |
|---|---|---|---|---|
| **Geocoding** (address → lat/lng) | **LocationIQ** | Free tier sufficient for a group app; **ToS permits storing the returned coordinates** (many free geocoders forbid persistence) | yes (server-only) | ~5k req/day |
| **Routing / time** (per mode) | **Valhalla** | **Has a native `motor_scooter` profile** — the only stack in the research that delivers a real scooter mode rather than an approximation; self-hostable if we outgrow a hosted tier | yes | free / self-host |
| **Fallback** (no key / API down) | **Haversine** | Keyless, instant, zero-dependency straight-line distance → estimated time via mode speed × detour factor | no | unlimited |

**Recommendation: Valhalla `motor_scooter` for routing + LocationIQ for geocoding, with a haversine fallback** so the feature degrades to *approximate* rather than *broken* when a key is missing or a provider is down. **Phase 1 uses haversine only — it ships before any routing key exists.**

### 6.2 Scooter strategy — and the mainstream-API gap

**Mainstream routing APIs (Google Distance Matrix, Mapbox Matrix) do NOT have a scooter/moped profile.** They expose `driving`, `walking`, and `cycling` — so on those stacks "scooter" can only be *approximated* (treat as `cycling`, or take `driving` and apply a Bali-specific speed adjustment). Since scooter is the **dominant Bali mode**, an approximation is a poor default. **Valhalla is the one provider in the research with a first-class `motor_scooter` profile**, which is why it's the recommended router. If we ever swap to a mainstream provider, document that scooter becomes an approximation:

- **Scooter time** ≈ road-distance ÷ **~22 km/h** (Bali traffic-adjusted, *not* open-road). **Car is often *slower* than scooter** in Bali (~25 km/h, plus parking) — the model must allow car ≥ scooter time, never assume car is faster.

### 6.3 Where calls run — keys never leave the server

All external calls run **server-side only**, following the established action pattern (`assertGate()` first, then `getServiceClient()`):

- **`src/actions/locations.ts`** (new):
  - `submitPlace({ stayId, label, category, address, importance, closerIsBetter, ... })` → validates via the pure helper, geocodes the address (LocationIQ), writes the `places` row with `lat/lng` + `geocode_status`.
  - `updatePlace(id, patch)` / `deletePlace(id)` / `reorderPlaces(...)` *(reorder Phase 2)*.
  - `geocodePlace(id)` / `geocodeAccommodation(id)` → (re)geocode on demand; write `lat/lng`, `geocode_status`, `geocoded_at`.
  - `setManualLocation(kind, id, lat, lng)` → user-corrected coordinates (coordinate field, **not** pin-drop in Phase 1), sets `geocode_status='manual'`.
  - `computeDistances(stayId, mode)` (Phase 2/3) → for the leg's `(accommodation × place)` grid, call Valhalla, upsert `bali.distances`. Rate-limited and batched (§6.4).
- Keys live in **server-only env vars**: `LOCATIONIQ_API_KEY`, `VALHALLA_BASE_URL` (+ key if hosted). **No `NEXT_PUBLIC_*`** — these must never reach the client. Document them in the existing **`.env.example`** (the repo has no `.env.local.example`) under the Supabase block, un-prefixed. Per the project's custom-Next caveat (`AGENTS.md`), the routing/geocoding fetches go in a **Server Action / server util**, and any `process.env` read is guarded server-only; consult `node_modules/next/dist/docs/` before choosing a route handler vs. action.

### 6.4 Caching, invalidation, rate-limit, batching

- **Geocode once, cache forever (until address changes).** Geocoding happens on place/accommodation **create or address-edit**, not on render. `geocoded_at` + `geocode_status` record the result. Re-geocode only when `address` actually changes (compare normalized old/new in the action).
- **Distance cache (`bali.distances`)** keyed by `(accommodation_id, place_id, mode)`. **Invalidate on COORDINATE change, not address-string change.** After **any** write that sets `lat/lng` (`geocodePlace`, `geocodeAccommodation`, **`setManualLocation`**), if the new `(lat, lng)` differs from the old, **delete the affected `bali.distances` rows**. Comparing coordinates (not the free-form `address`) is what makes the **manual-pin/coordinate path** correct and also catches **provider drift** (same address string, different returned coords). Deletes also cascade automatically when a place/accommodation is removed. Recompute lazily on next view.
- **Batch the matrix.** A leg with 10 accommodations × 5 POIs = 50 origin→dest pairs **per mode**. Valhalla's matrix endpoint takes many sources/targets in one request — issue **one matrix call per (leg, mode)**, not 50 point-to-point calls.
- **Rate-limit the trigger.** `computeDistances` is debounced per leg and guarded against rapid re-clicks (a simple in-flight guard / minimum interval). Background-compute on POI/address change rather than on every board open.
- **Haversine needs no key, no cache, no network** — it's a pure function and the always-available floor.

---

## 7. Scoring model

Ship a **single pure module** `src/lib/location-score.ts` — **env-free, no DB, importable on server *and* client, unit-tested** in `src/test/location-score.test.ts`. It mirrors existing lib conventions: **null-returning for missing data** (like `effectiveNightly`, `formatMoney`, and `mapQuery`, which returns `null` when nothing is usable), and reduce-style aggregation (like `tripBudget`). The data-acquisition step (geocode/route) is the gating work; **this math is the cheap, testable part and must work — showing "needs-address" — before geocoding lands.**

### 7.1 Per-POI sub-score: absolute, mode-specific time thresholds (NOT min-max)

Convert a one-way travel **time** `t` (minutes) for a mode into a 0–100 sub-score by **linear interpolation between fixed anchors**, clamped to `[0,100]`:

```
 t ≤ excellent → 100   (e.g. ≤5 min  "right there")
 t = good      →  80   (e.g. 10 min)
 t = ok        →  60   (e.g. 15 min)
 t = far       →  30   (e.g. 30 min)
 t ≥ tooFar    →   0   (e.g. ≥45 min "a trek")
```

**Why absolute thresholds, not min-max:** the board is **realtime** (`use-realtime-board.ts`) — members add/edit/remove listings live, and because addresses are free-form, geocoded times appear/change **asynchronously**. Min-max normalization rescales **every** listing whenever the candidate set changes, so a place's score would move **without its location moving** — confusing on a live board and non-reproducible in unit tests. Absolute anchors give each listing a **fixed, explainable, neighbour-independent** score. Anchors are **per-mode** (15 min on foot ≠ 15 min by scooter; foot anchors are tighter, which is how "walkability" falls out naturally).

**Distance-only fallback** (no routing API, haversine path): derive time from straight-line distance with a mode speed and a **1.3× road-detour factor**, then feed it through the *same* curve:

```
tEst = (distanceKm * 1.3 / speedKmh) * 60
speeds: foot ≈ 4.5 km/h, scooter ≈ 22 km/h (Bali traffic-adjusted), car ≈ 25 km/h (often ≤ scooter in Bali)
```

One scoring path whether the time came from Valhalla or from haversine.

**`closer_is_better = false`** (Quiet persona / nightlife POIs): invert the curve so *farther = higher* for that POI. Inversion is applied **at scoring time only** — it never mutates the stored `closer_is_better` value.

### 7.2 Aggregation: importance-weighted mean (recommended)

```
location = Σ(wᵢ · sᵢ) / Σ(wᵢ)        // wᵢ ∈ {1 nice, 2 want, 3 must}
```

Smooth, intuitive ("on average, well-placed"), and **degrades gracefully**: a POI with no reachable time is **dropped from the weighted mean** and decrements coverage — one failed geocode never zeroes the whole location score. Also return a **coverage%** companion ("weighted share of POIs within N min") and optionally expose **worst-POI** as a tiebreaker/hard filter. We **reject** pure max/coverage as the *sole* number, and **reject min-max** for the churn reason above.

### 7.3 "Best for X" composite — two transparent weight layers (Phase 3)

**Layer A — POI importance** (inside `location`, above). **Layer B — pillar mix** across the four pillars, self-normalizing by the weight sum (weights need not total 1; any pillar can be zeroed):

```
bestForX = (W_loc·location + W_price·price + W_rating·rating + W_votes·votes)
           / (W_loc + W_price + W_rating + W_votes)
```

All four pillars are normalized to **0–100** so the mix is meaningful:

- `rating = (stars / 5) * 100`
- `votes = ((net / voters) + 1) / 2 * 100` — net-vote ratio; **0 votes is neutral (null/dropped), not a downvote**.
- `price` — **see §7.3.1 for the exact function** (median-relative, bounded). Price is the one pillar where a within-leg relative anchor is acceptable because "cheap" is inherently comparative, but it is bounded and outlier-resistant.

#### 7.3.1 Price sub-score — exact definition (load-bearing; was previously hand-waved)

`price` is referenced by every composite, so it is defined precisely as a pure function — not asserted:

```
ratio = effectiveNightly / legMedianNightly
priceSubScore = clamp( interpolate(ratio, anchors), 0, 100 )

anchors (ratio → score), linearly interpolated, clamped:
  ≤ 0.60×median → 100
    1.00×median →  70
    1.50×median →  30
  ≥ 2.00×median →   0
```

- `effectiveNightly` is the listing's effective nightly cost (the cheapest member price, else the parsed price — same value the existing `effectiveNightly` helper produces).
- `legMedianNightly` is the **median** of `effectiveNightly` over the leg's priced options (median, not max — a single luxury outlier can't crush everyone else). If the leg has no priced options, `price = null` (dropped).
- This makes the §7.7 worked example's price value **derived from the formula**, not "say 88" (see §7.7).

#### 7.3.2 Canonical category enum (locks persona multipliers)

The earlier draft had **three mismatched category lists** (schema comment, UI select, persona table), so several persona multipliers (`surf`, `cafe`, `market`, `club`) could never fire. **Lock one canonical enum**, enforced in `preparePlaceInput` (mirroring the `source` enum) and used verbatim by the persona multiplier tables and the UI select:

```
category ∈ { 'beach', 'surf', 'restaurant', 'cafe', 'market',
             'bar', 'club', 'nature', 'temple', 'other' }
```

#### 7.3.3 Persona presets (Phase 3)

**Personas = named presets that set both layers at once** (pillar weights **+** per-POI category importance multipliers **+** per-POI curve inversion). **Personas never mutate stored `closer_is_better` / `importance`** — inversion and multipliers are applied **only at scoring time** as a pure `(place, persona) → effective weight` transform. Keep the preset table as **plain data in `src/lib`** so it's diffable and unit-testable; the scorer takes weights as an **argument** and stays pure:

| Persona | `{loc, price, rating, votes}` | POI category multiplier | Notes |
|---|---|---|---|
| **Beach lover** | `{.5, .2, .2, .1}` | `beach` ×1.5, `surf` ×1.5 | |
| **Foodie** | `{.4, .2, .25, .15}` | `restaurant` ×1.5, `cafe` ×1.5, `market` ×1.5 | |
| **Nightlife** | `{.45, .2, .15, .2}` | `bar` ×1.5, `club` ×1.5 | suggests **scooter** mode ("you ride home late") — but the mode toggle wins |
| **Quiet/remote** | `{.25, .25, .3, .2}` | — | **inverts the curve at scoring time** for `bar`/`club` POIs (treats far = good); `nature`/`beach`/`temple` stay normal. Does **not** write `closer_is_better`. |
| **Group consensus** | `{.25, .25, .2, .3}` | — | leans on the existing net-vote signal |

**Manual mode** exposes the four pillar sliders + per-POI importance directly; a preset is just a starting point a group can override.

### 7.4 Per-mode scoring (Phase 2)

Score the **same POIs** under scooter / foot / car by swapping the **anchor set** and the **distance→time speed**. Return **one score per mode** so the UI can offer "best by scooter" vs "best on foot". **Default: scooter** (Bali), with the UI noting car is often no faster. **Persona may suggest a mode; the toggle always wins** (§4.4).

### 7.5 Missing-data handling (core rule: absence ≠ 0)

A `0` is a real bad value ("45+ min away"); **absence of data is a different state** and must read as **"needs info"** — mirroring the codebase's null-returning convention.

- **No coordinates / un-geocoded address** (the common case today): `location = null`, **not 0**. Composite is computed over **only the present pillars** (renormalize by present weights). Tag `status: 'needs-address'`; UI shows a "Needs address" chip, not a number.
- **No price** → price sub-score `null`, dropped, tag `needs-price`.
- **No votes yet** → votes `null`, dropped (zero votes is neutral, not a downvote).
- **One POI with no reachable time** → exclude *that POI* from the location weighted mean, decrement coverage; don't zero the whole score.
- **Renormalize:** `composite = Σ_present(W_k · score_k) / Σ_present(W_k)`. If **every** pillar is missing → `score: null, status: 'needs-info'`, **not** a number.
- Always return a **breakdown** `{ location, price, rating, votes, coveragePct, missing: [...], completeness }` so confidence is visible (a listing ranked on 2 of 4 pillars is visibly less certain than one on all 4).
- **Sorting:** scored listings first; `needs-X` listings grouped at the **end**, never interleaved as if they scored low. (And per §4.2, cards mid-scoring do **not** transiently jump into that group.)

### 7.6 Function shape

```ts
// src/lib/location-score.ts  (pure; tested in src/test/location-score.test.ts)
export interface PillarWeights { location: number; price: number; rating: number; votes: number; }

export function scoreAccommodation(input: {
  poiTimes: { minutes: number | null; importance: number; closerIsBetter: boolean }[];
  effectiveNightly: number | null;
  legMedianNightly: number | null;
  rating: number | null;
  votes: { value: boolean }[];
  voterCount: number;
  mode: TravelMode;          // swaps anchor set + speed
  weights: PillarWeights;
}): {
  location: number | null;
  composite: number | null;
  coveragePct: number | null;
  breakdown: { location: number | null; price: number | null; rating: number | null; votes: number | null; missing: string[]; completeness: number };
  status: "ok" | "needs-address" | "needs-price" | "needs-info";
};
```

Companion pure helpers (also tested): `timeToSubScore(minutes, mode, closerIsBetter)`, `priceSubScore(effectiveNightly, legMedianNightly)` (§7.3.1), `distanceToTime(km, mode)`, `haversineKm(a, b)`, and the persona preset table `PERSONAS` (plain data).

### 7.7 Worked numeric example (frozen fixture)

**Leg: Ubud.** One candidate villa. POIs with one-way **scooter** times + group importance `w`:

| POI | w | time | sub-score |
|---|---|---|---|
| Monkey Forest (must) | 3 | 6 min | between 5→100 & 10→80: `100 − (1/5)·20 = 96` |
| Rice Terraces (want) | 2 | 18 min | between 15→60 & 30→30: `60 − (3/15)·30 = 54` |
| Warung (nice) | 1 | 4 min | ≤5 → `100` |
| Campuhan (want) | 2 | 11 min | between 10→80 & 15→60: `80 − (1/5)·20 = 76` |

**Location (weighted mean):** `(3·96 + 2·54 + 1·100 + 2·76) / (3+2+1+2) = 648 / 8 = 81.0`
**Coverage (≤15 min, weighted):** `(3+1+2)/8 = 75%`.

**Other pillars:**
- rating `4.7/5 → 94`.
- price — `effectiveNightly = $52`, `legMedianNightly = $65` → `ratio = 52/65 = 0.80`. Interpolating the §7.3.1 anchors between `0.60→100` and `1.00→70`: `100 − ((0.80−0.60)/(1.00−0.60))·30 = 100 − 0.5·30 = 85`. **price = 85** (derived, not asserted).
- votes `4 yes / 1 no → ((3/5)+1)/2·100 = 80`.

**"Best for X" = Foodie** `{loc .40, price .20, rating .25, votes .15}` (sum = 1.0):
`(.40·81 + .20·85 + .25·94 + .15·80) = 32.4 + 17.0 + 23.5 + 12.0 = 84.9`

→ **location 81, overall (Foodie) 84.9**, breakdown `{loc 81, price 85, rating 94, votes 80, coverage 75%, missing: []}`. **These exact numbers are the frozen test fixture (§11).**

**Missing-address variant:** if this villa had no address → `location = null`, dropped, renormalize over price+rating+votes: `(.20·85 + .25·94 + .15·80)/(.60) = (17.0 + 23.5 + 12.0)/0.60 = 87.5` — **but** the card is tagged **"Needs address"** and sorted into the **"needs info"** group, not competing on a phantom location score.

---

## 8. Technical implementation plan (phased)

> **Phasing governs what "done" means — §13 acceptance criteria are split per-phase to match.** Phase 1 is the thinnest loop that answers the **primary ask only**. Personas, multi-mode, reorder, category, closer-is-better, and cached routing are explicitly later.

### Phase 1 — MVP: the thin loop (pick spots → sort by haversine distance → needs-info grouping)
Zero routing dependency (haversine only); ships before any routing key exists. **Pick ONE input path: geocode-on-save** (with `setManualLocation` coordinate-field as the escape hatch). **Cut from Phase 1:** reorder, the `category` select, `closer_is_better` semantics, persona picker, manual pillar sliders, multi-mode toggle (scooter-only), and the `bali.distances` table (compute in-memory from haversine).

- **Migrations:** `supabase/migrations/20260617090000_places.sql` (§5.1, repo plain style) + `20260617090500_accommodation_coords.sql` (§5.2). **Mirror both into `docs/deploy/bali-cloud-setup.sql` in that file's idempotent idiom. Apply to the cloud DB before merging code that reads them.**
- **Types:** `src/lib/types.ts` — add `Place`, `GeocodeStatus`, `TravelMode`; extend `Accommodation` with **optional** `latitude/longitude/geocode_status/geocoded_at` (§5.5).
- **Pure lib:**
  - `src/lib/places.ts` — `preparePlaceInput()` (validate label/importance, **clamp importance**, **validate category against the canonical enum** even though the UI doesn't expose it yet, trim address→null — mirrors `prepareStayInput`/`prepareAccommodationEdit`).
  - `src/lib/location-score.ts` — full §7 scorer + `priceSubScore`, `haversineKm`, `distanceToTime`, `timeToSubScore`, `PERSONAS` (scorer is mode/persona-aware from day one even though the Phase-1 UI only uses scooter + default weights).
- **Actions:** `src/actions/locations.ts` — `submitPlace`, `updatePlace`, `deletePlace`, `setManualLocation` (coordinate field), and a **LocationIQ** `geocodePlace`/`geocodeAccommodation` (geocode-on-create; haversine for distances). *(No `reorderPlaces`, no `computeDistances` yet.)*
- **Data:** `src/lib/data.ts` — add the **separate `places` query** with `console.warn` fallback (§5.4), gated by the flag; return `places` as a top-level key; update the return type.
- **Realtime:** the **full seed chain** of §5.6 (page.tsx → trip-board.tsx → use-realtime-board.ts), including `initialPlaces`, `useState`, reducers, `.on()` (`{ schema: 'bali', table: 'places' }`), and `applyPlaceUpsert/applyPlaceRemoval`.
- **UI:**
  - Places manager in **`stay-section.tsx`** (add/edit/remove + importance toggle; add/edit form in a sheet). *(No reorder, no category select yet.)*
  - **Location** sort option + location score badge + "Needs info" grouping in `stay-section.tsx`/`accommodation-carousel.tsx`, with the **no-jump-while-scoring** behavior (§4.2).
  - Distances section + per-POI bars in the accommodation detail dialog (mode fixed to scooter), plus the **accommodation-has-no-coords** empty state (§4.3).
- **Tests:** `src/test/location-score.test.ts` (anchors, interpolation, weighted mean, **priceSubScore**, missing-data renormalization, the **frozen worked example** §7.7, tie-breaking), `src/test/places.test.ts` (`preparePlaceInput` — trim→null, importance clamp, category enum validation).

### Phase 2 — Real routing + travel modes + reorder + category
- **Routing util:** server-only `src/lib/routing/valhalla.ts` (matrix call, `motor_scooter`/`pedestrian`/`auto` → our `scooter`/`foot`/`car`), with haversine fallback when the key is absent or the call fails.
- **Action:** `computeDistances(stayId, mode)` in `src/actions/locations.ts` — one matrix call per (leg, mode), batched (§6.4). Add `reorderPlaces`.
- **Score:** `location-score.ts` already mode-aware; wire `mode` from the detail-dialog toggle and persist as client view-state.
- **UI:** mode toggle (🛵/🚶/🚗) in the detail dialog; reorder drag handle; the **`category`** select (canonical enum) in the POI form; transient-vs-not-found geocode-failure copy (§4.1).
- **Env:** `LOCATIONIQ_API_KEY`, `VALHALLA_BASE_URL` (server-only). Document in **`.env.example`**.
- **Tests:** unit-test the Valhalla **response→our-shape mapper** (`src/test/routing-mapper.test.ts`, pure) with fixtures; the action is integration-tested.

### Phase 3 — Personas + cached distances + polish
- **Migration:** `20260618090000_distances.sql` (§5.3) + cloud mirror; **separate read query** in `data.ts` (§5.4), flag-gated. (No realtime publication for `distances` — read cache only.)
- **Cache:** `computeDistances` upserts `bali.distances`; **invalidate (delete rows) on COORDINATE change** inside `geocode*`/`setManualLocation` (§6.4).
- **Personas:** full preset picker + manual sliders (§4.4), per-POI category multipliers + scoring-time curve inversion wired through; `closer_is_better` UI exposed; persona-vs-mode precedence enforced.
- **Polish:** coverage badges, completeness/confidence indicator, skeleton/loading/error states, mobile bottom-sheet persona picker + collapsed "top-3 + show all" distances list (§4.5).
- **Tests:** persona-multiplier application (per the canonical enum), Quiet scoring-time inversion against fixtures, cache-invalidation logic (pure parts), end-to-end action integration.

---

## 9. Edge cases & failure modes

- **No API key (geocoding or routing):** never crash. Geocoding without a key → `geocode_status='pending'`, card shows **"Needs address"**. Routing without a key → **haversine** distances (`source='haversine'`), scores still compute. The feature is *fully usable* keyless, just approximate.
- **Geocode transient failure (rate-limit / 5xx):** the POI/accommodation still **saves**; `geocode_status` stays `pending`; UI shows *"Couldn't reach the locator — tap to retry."* Retry re-runs the same geocode. **Distinct from "not found."**
- **Geocode not-found / address typo (e.g. "Jl. Raya Ubud"):** Bali has many same-named roads. On a genuine miss → `geocode_status='failed'`, surface *"Couldn't find this — set the location"* and let the user enter coordinates (`geocode_status='manual'`). **Garbage in → garbage out** is mitigated by always *showing the resolved point* for user review.
- **Accommodation (origin) lacks coordinates, POIs geocoded:** detail-dialog Distances section shows *"Add an address to this stay to see distances"* instead of a list of null rows (§4.3).
- **POI far outside the leg area:** no special-casing — a far POI simply scores low (and `tooFar` clamps to 0). **The "warn if >X km from area centroid" idea is de-scoped** (stays have no coordinates — it would need a fourth geocoding target; see §3).
- **Stale coordinates:** address edited but not re-geocoded → re-geocode triggers automatically when `address` changes in the action; `geocoded_at` lets the UI flag stale rows. Distance-cache staleness is handled by **coordinate-change invalidation** (§6.4), which also catches provider drift.
- **Ties:** identical composite scores → break by **worst-POI** sub-score, then **coverage%**, then `created_at` (stable). Documented so sort order is deterministic in tests.
- **Single accommodation on a leg:** absolute thresholds mean it still gets a real, fixed score (min-max would have made this meaningless). A key reason for choosing absolute anchors.
- **No POIs on a leg yet:** location pillar is `null` for every card; composite renormalizes over price/rating/votes; the leg shows the empty-state CTA to add places. Sorting falls back to the chosen non-location pillar.
- **Cross-leg / duplicated POIs:** POIs are strictly per-`stay_id` (cascade-deleted with the leg). The same real-world place added to two legs is two independent rows — acceptable for a small group app; no dedup needed.
- **Mid-scoring reorder churn:** un-scored cards stay put and animate once when a score lands; they never transiently jump into the "needs info" group (§4.2) — critical on a realtime board.
- **Realtime disconnect / offline:** the existing `use-realtime-board.ts` has no reconnect/disconnect UI. This feature **does not add one** — explicitly deferred; POI reads still work from the server snapshot on reload.
- **PostgREST embed trap:** if anyone is tempted to "just embed" `places(*)` onto the accommodations query, a cloud DB missing the table breaks the whole board. **Enforced separate queries** (§5.4) prevent this.
- **Realtime payload has no relations:** the `accommodations` upsert handler must preserve nested `votes/prices/comments` (it already does) and keep computed scores out of the row (scores are derived, not stored).

---

## 10. Privacy, cost & rate limits

- **Scale:** a single group trip — a handful of legs, ~5–15 accommodations and ~3–8 POIs per leg, a few members. Distance grids are tens of pairs per (leg, mode), not thousands. This sits **comfortably inside free tiers** (LocationIQ ~5k geocodes/day; a self-hostable Valhalla has no per-request cost).
- **Cost control:** geocode **once** per address (cache via `geocode_status`/`geocoded_at`); compute distances **once** per `(accommodation, place, mode)` (cache via `bali.distances`); recompute **only on coordinate change**. One batched matrix call per (leg, mode). A debounce/in-flight guard prevents click-spam from burning quota.
- **No new PII:** POIs and addresses are trip places, not people. No member location tracking. Gate-based auth is unchanged; service-role writes only via gated actions.
- **Geocoder ToS:** **store coordinates only from a provider whose terms permit persistence.** LocationIQ permits storing returned coords (chosen partly for this). If a Nominatim/OSM-backed geocoder is ever used, **respect OSM/Nominatim usage policy** — heavy automated querying and unbounded persistent storage may violate terms; cache aggressively, attribute OSM data, and prefer a paid/self-hosted instance for anything beyond light use. Document the chosen provider's storage clause next to the env-var config.
- **Keys never client-side:** server-only env vars, calls only in actions/server utils. No `NEXT_PUBLIC_*` geocoding/routing keys.

---

## 11. Testing & rollout

- **Unit (pure, vitest, the bulk of confidence):** `src/test/location-score.test.ts` — anchor interpolation per mode, weighted mean, coverage%, **`priceSubScore` (median-relative anchors, exact §7.3.1 curve)**, missing-data renormalization (location/price/votes null paths), persona presets + **canonical-enum** category multipliers, `closer_is_better` **scoring-time** inversion, haversine + `distanceToTime`, the **frozen worked example** (§7.7: location 81, price 85, votes 80, rating 94, Foodie 84.9) as fixed assertions, **tie-breaking determinism**. `src/test/places.test.ts` — `preparePlaceInput` (trim→null, importance clamp, **category-enum validation**). `src/test/routing-mapper.test.ts` — Valhalla response→our-shape mapper against fixtures. **Match the 50+-case rigor of `accommodations.test.ts`.**
- **Integration:** `src/actions/locations.ts` actions tested against the real DB (gated mutations), like other actions — `submitPlace` writes + geocodes, `computeDistances` upserts cache, **coordinate-change invalidation deletes** rows (including via `setManualLocation`).
- **Manual QA:** add POIs to Ubud, verify scores + coverage match hand-calc; submit a listing with no address → "Needs address" chip + bottom grouping with **no mid-scoring jump**; kill the routing key → haversine fallback still scores; trigger a transient geocode error → "tap to retry" vs a genuine miss → "set the location"; open a detail dialog for an accommodation with no coords → "add an address" message; **(Phase 2)** switch modes and confirm ranking changes; **(mobile)** confirm the Distances section and persona picker are usable at **380px without horizontal scroll** (collapsed top-3 + "show all"; persona as bottom-sheet).
- **Feature-flagging:** gate the whole feature behind `LOCATION_SCORING_ENABLED`. **With the flag off, `getBoardData()` runs no `places`/`distances` queries and reads no new columns** — an un-migrated cloud DB is provably untouched and the board behaves exactly as today.
- **Backfill:** a one-off script/action to geocode **existing** accommodation rows (`geocode_status='pending'` → `'ok'`/`'failed'`), run after the columns are applied to the cloud DB. POIs start empty; nothing to backfill there.
- **Rollout order:** (1) apply migrations to cloud DB → (2) **verify `bali.places` appears in `pg_publication_tables`** (realtime won't fire otherwise — a silent partial failure where reads work but live updates don't) → (3) deploy code behind flag → (4) backfill geocoding → (5) flip flag.

---

## 12. Open questions / decisions needed

1. **Routing provider for production scooter** — hosted Valhalla vs. self-hosted vs. an approximation on a mainstream API. **RECOMMENDED:** Valhalla `motor_scooter` (the only researched stack with a real scooter profile); start hosted, self-host if quota bites.
2. **Geocoder** — LocationIQ vs. OSM/Nominatim vs. Google. **RECOMMENDED:** LocationIQ (free-tier headroom + **storage-permitting ToS**).
3. **Cache distances in a table now, or compute in-memory per view?** **RECOMMENDED:** Phase 1 computes in-memory from haversine (no table); add `bali.distances` only in Phase 3 when real routing makes recompute expensive — as a **read cache, not a realtime entity**.
4. **Where do persona/weight selections persist?** **RECOMMENDED:** client view-state in MVP (no DB); optionally a `member_preferences` row later if groups want it sticky.
5. **One score-per-mode shown together, or a single active-mode score?** **RECOMMENDED:** single active-mode badge on cards (default scooter) + all three modes in the detail dialog (Phase 2). **Resolved jointly with #6:** default = **no persona, equal weights `{1,1,1,1}`, mode = scooter**; a persona may *suggest* a mode but the **toggle always wins**.
6. **Default persona/weights when none chosen?** **RECOMMENDED:** equal pillar weights `{1,1,1,1}` with mode = scooter — a neutral "balanced" view. (See #5 for persona/mode precedence.)
7. **Manual location in MVP, or geocode-only?** **RECOMMENDED:** include `setManualLocation` from Phase 1 as the escape hatch — **but its Phase-1 UI is a coordinate field / "paste coords or a Maps link," NOT an interactive pin-drop** (the keyless iframe can't capture clicks; true pin-drop needs a new map widget and belongs in a later phase).
8. **Warn on POIs far from the leg area?** **RECOMMENDED:** **No (de-scoped).** It would require geocoding the leg `area` string — a fourth geocoding integration that doesn't exist (stays have no coordinates). Revisit far-future only.

---

## 13. Acceptance criteria (split per phase)

### Phase 1 — MVP (primary ask: pick spots → sort by distance)
- [ ] A member can **add / edit / remove** places-to-visit on a leg, each with `label`, an `address`, and an importance of **must / want / nice**, from the **`stay-section.tsx`** area (add/edit form in a sheet). *(No reorder, no category select in Phase 1.)*
- [ ] New `bali.places` table + new `latitude/longitude/geocode_status/geocoded_at` columns on `bali.accommodations` exist via migrations in the **repo's versioned style**, with **grants + RLS + realtime publication for `places`**, and are **mirrored in `docs/deploy/bali-cloud-setup.sql` using that file's idempotent idiom**.
- [ ] **`bali.places` is confirmed present in `pg_publication_tables`** after applying to the cloud DB (else realtime silently won't fire).
- [ ] `getBoardData()` returns **`places` as a new top-level key** via a **separate query with graceful `console.warn` fallback** — a missing table degrades, **never breaks the board**; **no new embed is added to the accommodations query**.
- [ ] The **full realtime seed chain** is wired: `page.tsx` passes `initialPlaces`, `trip-board.tsx` threads it, `use-realtime-board.ts` has `initialPlaces` arg + `useState` + reducers + `.on()` (`{ schema: 'bali', table: 'places' }`) + `applyPlaceUpsert/applyPlaceRemoval`. **POIs survive a page refresh** (don't start empty) and a POI added by one member **appears for others**; the acting member sees their edit **instantly** via the imperative merge.
- [ ] Submitting/editing a place or accommodation **geocodes the address server-side** (keys never reach the client); a **transient** failure leaves `geocode_status='pending'` with a "retry" affordance, a **not-found** sets `'failed'` with a "set the location" path, and a manual coordinate entry sets `'manual'`.
- [ ] With **no routing key**, the board scores via **haversine** (scooter), and each accommodation card shows a **0–100 location score** + a plain-language coverage line; cards with no coordinates show a **"Needs address"** chip and sort into a **separate "needs info" group**, never a fake low score, and **do not transiently jump there while scoring**.
- [ ] The leg list can **sort by Location** (Phase 1's one new sort option); the detail dialog shows **per-POI time+distance bars** (scooter), and shows **"add an address to this stay"** when the origin accommodation has no coordinates.
- [ ] `src/lib/location-score.ts` is a **pure, env-free, server+client-importable** module whose output **exactly matches the frozen worked example (§7.7: location 81, price 85, votes 80, rating 94, Foodie 84.9)** and whose **missing-data paths return `null`, never 0**; `priceSubScore` is the exact §7.3.1 curve; tie-break order (worst-POI → coverage% → `created_at`) is deterministic — all covered in `src/test/location-score.test.ts`, with `preparePlaceInput` (trim, importance clamp, **category-enum validation**) in `src/test/places.test.ts`.
- [ ] The feature is **behind `LOCATION_SCORING_ENABLED`**; with the flag **off and columns un-applied**, `getBoardData()` runs **no `places`/`distances` queries and reads no new columns**, and the board behaves exactly as today.
- [ ] A **backfill** geocodes existing accommodation rows after the cloud DB columns are applied.

### Phase 2 — Routing + modes + reorder + category
- [ ] With a routing key, scores use **Valhalla `motor_scooter` / `pedestrian` / `auto`** times; the **`src/test/routing-mapper.test.ts` fixture** asserts the Valhalla-JSON → `{ minutes, distance_km, source }` mapping for each mode.
- [ ] The detail dialog has a **scooter / foot / car toggle** that updates per-POI bars and the location score in place (default scooter); the board can additionally **sort by Price / Rating / Votes**.
- [ ] POIs can be **reordered** (drag handle → `sort_order`), and the POI form exposes the **`category`** select bound to the canonical enum.
- [ ] `computeDistances` is **batched** (one matrix call per leg+mode) and **rate-limited**.

### Phase 3 — Personas + cache + polish
- [ ] A **persona picker** (Beach / Foodie / Nightlife / Quiet / Consensus) + **manual sliders** are available; **selecting persona X yields a specific composite score for the worked-example fixture** (assertable), persona category multipliers fire against the **canonical enum**, **Quiet correctly treats "far from bar/club" as good at scoring time without mutating `closer_is_better`**, and a persona may suggest a mode but the **toggle always wins**.
- [ ] The board can **sort by Best-for-X**, with **deterministic tie-breaking** (worst-POI → coverage% → `created_at`) covered by a unit test.
- [ ] `bali.distances` caches routed results; **coordinate-change invalidation** (including via `setManualLocation`) deletes affected rows — covered by integration tests.
- [ ] **Mobile:** the Distances section (collapsed top-3 + "show all") and the persona **bottom-sheet** are usable at **380px without horizontal scroll**.

---

**Key files** (paths are absolute):
- New pure lib: `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/location-score.ts`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/places.ts`
- New actions: `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/actions/locations.ts`; new routing util `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/routing/valhalla.ts`
- Changed: `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/data.ts`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/types.ts`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/lib/accommodations.ts`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/hooks/use-realtime-board.ts`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/app/page.tsx`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/components/trip-board.tsx`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/components/stay-section.tsx`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/components/accommodation-carousel.tsx`, `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/components/leg-sheet.tsx`
- New migrations: `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/supabase/migrations/20260617090000_places.sql`, `…/20260617090500_accommodation_coords.sql`, `…/20260618090000_distances.sql`; mirror into `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/docs/deploy/bali-cloud-setup.sql`
- New tests: `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/src/test/location-score.test.ts`, `…/places.test.ts`, `…/routing-mapper.test.ts`
- Env: document `LOCATIONIQ_API_KEY`, `VALHALLA_BASE_URL` (server-only, un-prefixed) in `/Users/ovidiucotorogea/WebstormProjects/accomodation-comparison/.env.example`
