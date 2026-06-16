# Bali Stays 🌴

A mobile-first, **realtime** web app for a friend group to compare accommodation
(Airbnb / Booking.com links) for a multi-leg trip and vote 👍 / 👎 together. The
whole app is locked behind **one shared code**; after entering it you pick your
name, and every vote and submission is attributed to you.

Built for our Bali trip, but the structure (trip → legs → candidate places) works
for any multi-stop trip.

## Features

- 🔒 **One shared gate code** (no per-user accounts) with brute-force lockout.
- 🙋 **Pick-your-name** identity — see who added what and who voted which way.
- 🗺️ **Legs** (e.g. Ubud → Canggu → Uluwatu), each with its own candidate list.
- ⚡ **Realtime** — new places and votes appear instantly on everyone's screen.
- 🔎 **Rich link parsing** — auto-fills the name, photo, rating, review count and
  room details (guests · bedrooms · beds · baths) from Airbnb/Booking links.
- 💸 **Budgeting** — add a nightly price (Airbnb hides it) to see the per-leg total.
- 📱 **Mobile-first** — designed for phones, with a bottom-sheet "add a place"
  form and big thumb-friendly vote buttons.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui ·
Supabase (Postgres + Realtime, **no** Supabase Auth) · `jose` (signed gate
cookie) · Vitest · deployed on Vercel.

**Architecture:** Server Components read; Server Actions write (using the
service-role key, which never reaches the browser). The browser holds only the
anon key for a **SELECT-only** Realtime subscription. A signed gate cookie guards
routes in `src/proxy.ts`, and — because that is only an optimistic check — every
mutating action re-verifies it with `assertGate()`.

## Prerequisites

- **Node 22** (`.nvmrc` pins `22.13.1`; run `nvm use`)
- **Docker** (for the local Supabase stack)

## Local development

```bash
nvm use                 # Node 22
npm install

# 1. Start the local Supabase stack (Postgres + Realtime + Studio) via Docker
npm run db:start        # first run pulls images; prints local keys

# 2. Create .env.local from the example, then paste the keys printed above
cp .env.example .env.local
#    - NEXT_PUBLIC_SUPABASE_URL        -> "API URL"
#    - NEXT_PUBLIC_SUPABASE_ANON_KEY   -> "anon key"
#    - SUPABASE_SERVICE_ROLE_KEY       -> "service_role key"
#    - GATE_CODE                       -> whatever code you want to share
#    (run `npx supabase status` anytime to re-print the keys)

# 3. Apply the schema + seed (3 legs + 2 sample members)
npm run db:reset

# 4. Run the app
npm run dev             # http://localhost:3100
```

Open the app, enter your `GATE_CODE`, pick a name, and start dropping links.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3100 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (parser, gate token, rate-limit) |
| `npm run db:start` / `db:stop` | Start / stop local Supabase |
| `npm run db:reset` | Recreate the local DB from migrations + seed |

## Database

Schema lives in `supabase/migrations/` (tables, RLS, grants, indexes, and the
Realtime publication) and sample data in `supabase/seed.sql`. Edit
`supabase/seed.sql` to set your real trip legs, then `npm run db:reset`.

Security model: RLS is on for every table. The four content tables
(`members`, `stays`, `accommodations`, `votes`) allow **anon SELECT** (so the
shared board streams over Realtime) and **no** anon writes. `gate_attempts` is
server-only. The gate cookie is the real access boundary.

## Deploying

1. **Supabase (cloud):** create a project, then
   `npx supabase link --project-ref <ref>` and `npx supabase db push` to apply
   the migrations. Run the seed once if you want sample data.
2. **Vercel:** import the repo and set the env vars from `.env.example`
   (`GATE_CODE`, `SESSION_SECRET`, and the three `*_SUPABASE_*` values from your
   cloud project). Deploy.

Cookies are marked `secure` automatically in production (`NODE_ENV=production`).

## Notes

- **Parsing is best-effort.** We read OpenGraph tags + JSON-LD, so Airbnb/Booking
  links auto-fill the name, photo, rating, reviews and room details. **Price is the
  exception** — Airbnb computes it per-dates after login and never ships it in the
  page, so add a nightly price by hand to drive the budget totals.
- Voting is a toggle: tap 👍 or 👎 to vote, tap the same side again to clear your
  vote, or tap the other side to switch.

---

Design docs: [`docs/superpowers/specs/`](docs/superpowers/specs/) ·
plan: [`docs/superpowers/plans/`](docs/superpowers/plans/).
