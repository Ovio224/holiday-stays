# Bali Accommodation Comparison — Design Spec

**Date:** 2026-06-16
**Status:** Approved design, pending spec review
**Author:** brainstormed with Claude

## 1. Overview

A small, internal web app for a group of friends to collect candidate
accommodations (mostly Airbnb / Booking.com links) for a multi-leg Bali trip and
vote **yes / no** on each one — live, so everyone sees votes and new places appear
in real time. The whole trip is broken into **legs** (e.g. Ubud → Canggu →
Uluwatu), each with its own date range and its own list of candidates.

The app is gated by a **single static code** (no individual accounts). After
entering the code, each person **picks a name** so votes and submissions are
attributed. The aesthetic is deliberately **"paradisey"** — lush, tropical,
vacation-joy.

## 2. Goals & Non-Goals

**Goals**
- Drop an Airbnb/Booking link, assign it to a leg, and have it appear for everyone instantly.
- Vote 👍 / 👎 per place; see live tallies and *who* voted which way.
- Best-effort auto-fill of title / image / price from the link, always hand-editable.
- Gate the app behind one shared code with brute-force protection.
- A genuinely delightful tropical visual design.
- **Mobile-first**: primarily used on phones — links shared from the group chat,
  voting on the go — and fully responsive up to desktop.

**Non-Goals (v1)**
- No per-user authentication, password reset, or email.
- No comment threads, maps, price history, or notifications.
- No multi-trip management UI (single Bali trip is assumed).
- Not public — internal use only.

## 3. Access & Identity Model

### 3.1 Gate (the only security boundary)
- A server-only `GATE_CODE` environment variable holds the shared code.
- `/gate` page → a Server Action verifies the submitted code against `GATE_CODE`.
- On success, set an **httpOnly, secure, signed** session cookie (signed with
  `SESSION_SECRET` via `jose`) — e.g. `gate_session=<jwt>`. This cookie is the
  proof-of-entry; it cannot be forged without the secret.
- `proxy.ts` (Next.js 16 middleware) intercepts every route except `/gate` and
  static assets; missing/invalid cookie → redirect to `/gate`.

### 3.2 Max-retry lockout
- A `gate_attempts` table logs each attempt (`ip_hash`, `success`, `attempted_at`).
- Before checking a code, count **failed** attempts for this IP in the last
  `WINDOW` minutes (e.g. 15). If ≥ `MAX_ATTEMPTS` (e.g. 5), reject with a cooldown
  message and do not check the code.
- IP is hashed (not stored raw) since this is friends-only and we don't need PII.

### 3.3 Identity ("pick your name")
- This is **attribution, not security** — it sits *behind* the gate.
- After entering the gate, the user lands on a name step: choose an existing
  member from a list or add a new name (+ an auto-assigned tropical accent color).
- The chosen `member_id` is stored in a regular cookie / localStorage. Changing
  device just means picking your name again.

## 4. Architecture

- **Next.js (App Router, latest) + TypeScript + Tailwind**, deployed on **Vercel**.
- **Supabase**: Postgres + Realtime only (NOT Supabase Auth).
- **Reads**: Server Components render initial data server-side.
- **Writes** (vote, submit place, add leg): **Server Actions**, executed only
  after the gate cookie is verified, using the **service-role** Supabase key
  (server-only, never shipped to the browser).
- **Realtime**: the browser uses `createBrowserClient` with the **anon** key
  (public by design) to subscribe to `postgres_changes`. RLS grants the anon role
  **SELECT only** — so the live subscription can read changes, but the browser
  can never write directly. Every write goes through a gated Server Action.
- **UI kit**: shadcn/ui, themed to the tropical palette.

```
Browser ──(anon key, SELECT-only realtime subscription)──► Supabase Realtime
   │                                                            ▲
   │ Server Action (gate cookie verified)                       │ row change
   ▼                                                            │
Next.js server ──(service-role key, writes)──► Supabase Postgres ┘
```

### Why this shape
- Realtime needs a browser↔Supabase websocket, so the anon key is necessarily
  public. Restricting anon to SELECT means the worst case is "someone with the
  app's anon key can *read* Bali listings" — acceptable for non-sensitive,
  internal data. All mutations stay behind the gated server.

## 5. Data Model (Postgres)

RLS enabled on all tables. Anon role: **SELECT only** on `members`, `stays`,
`accommodations`, `votes`. No anon access to `gate_attempts`. Service role
(server) does all writes.

```sql
-- People (name-pick attribution)
members (
  id          uuid pk default gen_random_uuid(),
  name        text not null,
  color       text,                    -- tropical accent for avatar chip
  created_at  timestamptz default now()
)

-- Trip legs
stays (
  id          uuid pk default gen_random_uuid(),
  label       text not null,           -- "Ubud"
  area        text,                     -- optional finer detail
  start_date  date,
  end_date    date,                     -- nights = end - start
  sort_order  int  not null default 0,
  created_at  timestamptz default now()
)

-- Candidate places
accommodations (
  id           uuid pk default gen_random_uuid(),
  stay_id      uuid not null references stays(id) on delete cascade,
  url          text not null,
  source       text not null default 'other'
                 check (source in ('airbnb','booking','other')),
  title        text,
  image_url    text,
  price_text   text,                    -- free-form "$120 / night"
  notes        text,
  submitted_by uuid references members(id) on delete set null,
  parse_status text not null default 'pending'
                 check (parse_status in ('pending','ok','failed','manual')),
  parsed_at    timestamptz,
  created_at   timestamptz default now()
)

-- Votes (one per person per place; re-voting flips it)
votes (
  id               uuid pk default gen_random_uuid(),
  accommodation_id uuid not null references accommodations(id) on delete cascade,
  member_id        uuid not null references members(id) on delete cascade,
  value            boolean not null,    -- true = yes, false = no
  updated_at       timestamptz default now(),
  unique (accommodation_id, member_id)
)

-- Brute-force protection
gate_attempts (
  id           uuid pk default gen_random_uuid(),
  ip_hash      text not null,
  success      boolean not null,
  attempted_at timestamptz default now()
)
```

- A place with **no vote row** for a member = "hasn't voted." Voting upserts;
  toggling the same value off deletes the row.
- `source` is derived from the URL host at submit time.

## 6. Core Flows

1. **Enter** — `/gate`: type the shared code (rate-limited). Success → cookie set.
2. **Pick your name** — choose existing or add new; stored locally.
3. **Browse** — legs render as sections in itinerary order; each shows its
   candidate cards with live tallies.
4. **Submit a place** — paste URL, pick the leg (a bottom sheet on mobile). Server
   runs best-effort parsing, pre-fills title/image/price; user can edit; save. Card
   appears for everyone live.
5. **Vote** — 👍/👎 toggle on each card. Tally + voter chips update live across all
   open devices.

## 7. Link Parsing (best-effort)

- Split into two units for testability:
  - `fetchListingHtml(url)` — server-side fetch with a browser-like User-Agent
    and timeout. (Impure; thin.)
  - `parseListing(html, url)` — **pure** function: extract `og:title`,
    `og:image`, `og:description`, and a **price heuristic** (currency regex +
    JSON-LD scan). Returns `ParsedListing | null`. **TDD this.**
- Orchestrated in the submit Server Action: fetch → parse → set fields +
  `parse_status` (`ok` / `failed`), cache on the row (`parsed_at`). On failure or
  blocked request, status `failed` and the user simply fills fields manually
  (`manual`).
- Airbnb commonly blocks bots and Booking.com is inconsistent — failure is a
  normal, gracefully-handled path, not an error state.

## 8. Realtime

- Browser subscribes via the anon client to `postgres_changes` on
  `accommodations`, `votes`, `stays`, `members`.
- Any INSERT/UPDATE/DELETE → reconcile local state → UI updates. Because writes go
  through Server Actions that hit Postgres, the writer also receives the same
  event, keeping a single update path.
- Vote changes animate in (see Visual Direction).

## 9. Visual Direction — "Paradisey" 🌴

Locked as a *direction*; exact pixels explored in a mockup as the **first
implementation step** before building screens.

- **Palette:** ocean turquoise, lagoon teal, deep palm green, sunset coral/peach,
  hibiscus pink, warm sand/cream, soft white. Sunset & ocean **gradients**.
- **Mood:** airy, lush, joyful. Generous whitespace, soft rounded cards, subtle
  **glassmorphism** over a tropical gradient backdrop, gentle palm/wave motifs.
- **Typography:** warm, characterful display font for headings; clean sans for body.
- **Motion:** satisfying vote toggle, live votes "pop" in, subtle ambient gradient
  / floating palm-shadow touches — delight without noise.
- **Base:** shadcn/ui themed to the palette.

### Responsive & touch (mobile-first)
- Designed for **phones first**, progressively enhanced for tablet/desktop.
- Candidate cards: single-column stack on mobile → multi-column grid on wider screens.
- **Touch targets ≥ 44px** — vote 👍/👎 buttons especially; comfortable thumb spacing.
- **Submit** opens as a **bottom sheet** on mobile, a centered dialog on desktop.
- Sticky/scrollable leg navigation so jumping between legs is one thumb-tap.
- `next/image` with sized variants for fast loads over cellular.

## 10. Testing Strategy

- **TDD `parseListing`** — fixture HTML (airbnb-like, booking-like, generic,
  garbage) → asserted metadata. Highest-value unit tests.
- **Unit** — gate token sign/verify; rate-limit counter (failed-attempt windowing).
- **Integration** — Server Actions (vote upsert/toggle, submit creates row);
  RLS (anon can SELECT, cannot write).
- **E2E (Playwright)** — gate code → pick name → submit (mocked fetch) → vote →
  see tally, run primarily at a **mobile viewport** (with a desktop pass). Realtime
  cross-client sync as an optional two-context check.

## 11. Tech Stack

- Next.js App Router + TypeScript + Tailwind
- Supabase (Postgres + Realtime), `@supabase/supabase-js`, `@supabase/ssr`
- `jose` (signed gate cookie)
- shadcn/ui
- Playwright (E2E), Vitest (unit/integration)
- Vercel (hosting)

## 12. Assumptions & Open Items

- **Single trip** — no `trips` table; legs are top-level. Add trip-scoping later if needed.
- **Data is non-sensitive**, so anon SELECT for realtime is acceptable for internal use.
- Supabase project + Vercel project to be provisioned during setup.
- Secrets via env: `GATE_CODE`, `SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Legs and members can be seeded/managed by anyone behind the gate (no admin role in v1).

## 13. Phase 2 (parked)

Realtime presence ("who's online"), comment threads, maps, price history,
per-user auth, notifications, multi-trip support.
