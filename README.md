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

## Deploying (Supabase cloud + Vercel)

### 1. Supabase schema

This app lives entirely in a dedicated **`bali` Postgres schema**, so it can
share an **existing** Supabase project without touching any other app's tables.

1. **Apply the schema.** In your project's **SQL Editor**, run the two files in
   `supabase/migrations/` in order — they create the `bali` schema, its tables,
   RLS, grants, and register the realtime tables. (On a fresh dedicated project
   you can instead `npx supabase link --project-ref <ref> && npx supabase db push`.)
2. **Expose the schema.** Settings → API → **Exposed schemas** → add `bali`
   (next to `public`, `graphql_public`). Skipping this gives "Invalid schema:
   bali" at runtime.
3. **Seed your legs.** Edit `supabase/seed.sql` with your real itinerary and run
   it in the SQL Editor — the app needs at least the `bali.stays` rows to render.
4. Grab the keys from **Settings → API**: Project **URL**, **anon** key, and
   **service_role** key.

The app reads/writes `bali.*` automatically (the Supabase clients set
`db: { schema: "bali" }`); no extra config beyond exposing the schema.

### 2. Vercel

1. Install the CLI and deploy from the repo root:
   ```bash
   npm i -g vercel
   vercel            # first run logs in (browser) + links/creates the project
   ```
2. Set the production environment variables (CLI or the dashboard → Settings →
   Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `GATE_CODE` | your shared entry code |
   | `SESSION_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server-only) |
   | `GATE_MAX_ATTEMPTS` / `GATE_WINDOW_MINUTES` | optional (default 5 / 15) |

   ```bash
   vercel env add GATE_CODE production        # repeat per variable
   ```
3. Ship it: `vercel --prod`. Open the URL, enter your gate code, pick a name, and
   share the link + code with the crew.

**Good to know**
- Cookies are `secure` in production automatically (`NODE_ENV=production` → HTTPS).
- Realtime works on cloud out of the box (the migration adds the tables to the
  `supabase_realtime` publication).
- `next/image` is configured to allow any `https` host, so Airbnb/Booking photos
  render without extra setup.

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
