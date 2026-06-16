# Bali Accommodation Comparison — Implementation Plan

> **For agentic workers:** This plan is executed via orchestrated workflows (ultracode). Foundation + all Node/toolchain commands run in the main loop; isolated modules are built by parallel file-writing agents against the shared contracts in §3. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A mobile-first, realtime web app where a friend group, gated by one shared code, collects Airbnb/Booking links into trip legs and votes 👍/👎 — with a lush "paradisey" design.

**Architecture:** Next.js App Router (Server Components for reads, Server Actions for writes) + Supabase Postgres/Realtime (no Supabase Auth). A signed gate cookie guards all routes via middleware; the browser holds the Supabase anon key for SELECT-only realtime; all writes go through gated Server Actions using the service-role key.

**Tech Stack:** Next.js (latest), React 19, TypeScript, Tailwind v4, shadcn/ui, `@supabase/supabase-js`, `@supabase/ssr`, `jose`, `zod`, Vitest, Playwright. Local dev via Supabase CLI (`npx supabase`) on Docker.

**Toolchain note:** Node 22 is required. Every Node command MUST be prefixed with:
`export PATH="/Users/ovidiucotorogea/.nvm/versions/node/v22.13.1/bin:$PATH"`

---

## 1. Decisions locked from spec

- No per-user auth → single static `GATE_CODE` + IP-hashed rate-limit lockout.
- Identity = pick-your-name (named votes & submissions).
- Multiple legs (`stays`), each with candidate `accommodations`.
- Realtime required; best-effort OpenGraph parsing with manual fallback.
- Mobile-first, paradisey aesthetic.
- Local-first Supabase (Docker) for dev/test; cloud deploy documented.

## 2. File Structure

```
.
├── .env.example / .env.local / .nvmrc / .gitignore
├── package.json / next.config.ts / tsconfig.json
├── vitest.config.ts / playwright.config.ts
├── middleware.ts            # gate guard (proxy.ts if Next 16)
├── README.md
├── supabase/
│   ├── config.toml
│   ├── migrations/0001_init.sql   # tables + RLS + realtime publication + indexes
│   └── seed.sql                   # trip legs + sample members
└── src/
    ├── app/
    │   ├── layout.tsx             # fonts, html shell, paradise backdrop
    │   ├── globals.css            # Tailwind v4 @theme — paradisey tokens
    │   ├── page.tsx               # trip board (server: initial data → client board)
    │   ├── gate/page.tsx          # code entry
    │   └── name/page.tsx          # pick-your-name
    ├── actions/
    │   ├── gate.ts                # verifyGateCode (rate-limited)
    │   ├── identity.ts            # listMembers, createMember
    │   ├── accommodations.ts      # submitAccommodation, deleteAccommodation
    │   ├── votes.ts               # castVote (upsert/toggle)
    │   └── stays.ts               # listStays, createStay
    ├── lib/
    │   ├── supabase/server.ts     # service-role client (server only)
    │   ├── supabase/browser.ts    # anon client (realtime)
    │   ├── gate/session.ts        # jose sign/verify gate cookie
    │   ├── gate/ratelimit.ts      # failed-attempt windowing
    │   ├── parsing/parse-listing.ts   # PURE html,url → ParsedListing
    │   ├── parsing/fetch-listing.ts   # impure fetch wrapper
    │   ├── parsing/source.ts          # url → 'airbnb'|'booking'|'other'
    │   ├── types.ts               # domain types (§3.1)
    │   └── utils.ts               # cn, nights(), pickColor(), formatters
    ├── components/
    │   ├── ui/                    # shadcn primitives
    │   ├── trip-board.tsx         # client; holds state + realtime
    │   ├── stay-section.tsx       # one leg + its cards
    │   ├── accommodation-card.tsx # paradisey card
    │   ├── vote-buttons.tsx       # 👍/👎 toggle (≥44px)
    │   ├── voter-chips.tsx        # who voted
    │   ├── submit-sheet.tsx       # add place (bottom sheet/dialog)
    │   ├── name-picker.tsx
    │   ├── gate-form.tsx
    │   └── paradise-backdrop.tsx  # animated tropical bg
    ├── hooks/use-realtime-board.ts
    └── test/
        ├── parse-listing.test.ts
        ├── session.test.ts
        ├── ratelimit.test.ts
        └── fixtures/*.html
```

## 3. Shared Contracts (the source of truth for all agents)

### 3.1 Domain types — `src/lib/types.ts`

```ts
export type AccommodationSource = 'airbnb' | 'booking' | 'other';
export type ParseStatus = 'pending' | 'ok' | 'failed' | 'manual';

export interface Member {
  id: string; name: string; color: string; created_at: string;
}
export interface Stay {
  id: string; label: string; area: string | null;
  start_date: string | null; end_date: string | null;
  sort_order: number; created_at: string;
}
export interface Accommodation {
  id: string; stay_id: string; url: string; source: AccommodationSource;
  title: string | null; image_url: string | null; price_text: string | null;
  notes: string | null; submitted_by: string | null;
  parse_status: ParseStatus; parsed_at: string | null; created_at: string;
}
export interface Vote {
  id: string; accommodation_id: string; member_id: string;
  value: boolean; updated_at: string;   // value: true = yes, false = no
}
export interface ParsedListing {
  title: string | null; imageUrl: string | null;
  priceText: string | null; description: string | null;
}
// View model the board renders:
export interface AccommodationWithVotes extends Accommodation {
  votes: Vote[];
}
```

### 3.2 Environment variables — `.env.example`

```
# Gate
GATE_CODE=change-me                 # the shared entry code
SESSION_SECRET=change-me-32-bytes   # HMAC secret for the gate cookie
GATE_MAX_ATTEMPTS=5
GATE_WINDOW_MINUTES=15
# Supabase (local values come from `npx supabase start`)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### 3.3 Function signatures (cross-module API)

```ts
// lib/parsing/source.ts
export function detectSource(url: string): AccommodationSource;
// lib/parsing/parse-listing.ts  (PURE — TDD this)
export function parseListing(html: string, url: string): ParsedListing;
// lib/parsing/fetch-listing.ts
export async function fetchAndParse(url: string):
  Promise<{ parsed: ParsedListing; status: 'ok' | 'failed' }>;

// lib/gate/session.ts
export async function createGateToken(): Promise<string>;
export async function verifyGateToken(token: string | undefined): Promise<boolean>;
export const GATE_COOKIE = 'bali_gate';
// lib/gate/ratelimit.ts
export async function isLockedOut(ipHash: string): Promise<boolean>;
export async function recordAttempt(ipHash: string, success: boolean): Promise<void>;
export function hashIp(ip: string): string;

// actions/gate.ts            "use server"
export async function verifyGateCode(formData: FormData):
  Promise<{ ok: boolean; error?: string }>;
// actions/identity.ts
export async function listMembers(): Promise<Member[]>;
export async function createMember(name: string): Promise<Member>;
// actions/accommodations.ts
export async function submitAccommodation(input: {
  url: string; stayId: string; memberId: string;
  title?: string; priceText?: string; notes?: string;
}): Promise<Accommodation>;
export async function deleteAccommodation(id: string): Promise<void>;
// actions/votes.ts
export async function castVote(input: {
  accommodationId: string; memberId: string; value: boolean;
}): Promise<void>;   // same value again → removes the vote (toggle off)
// actions/stays.ts
export async function listStays(): Promise<Stay[]>;
```

### 3.4 Database schema — `supabase/migrations/0001_init.sql`

Tables exactly as spec §5 (`members`, `stays`, `accommodations`, `votes`, `gate_attempts`). Plus:
- Enable RLS on all five tables.
- Policies: `anon` + `authenticated` may `SELECT` on `members`, `stays`, `accommodations`, `votes`. No anon write. No anon access to `gate_attempts`.
- Add `members`, `stays`, `accommodations`, `votes` to publication `supabase_realtime`.
- Indexes: `accommodations(stay_id)`, `votes(accommodation_id)`, unique `votes(accommodation_id, member_id)`, `gate_attempts(ip_hash, attempted_at)`.

### 3.5 Paradisey design tokens — `src/app/globals.css` (Tailwind v4 `@theme`)

CSS variables (HSL/hex) the components consume:
- `--lagoon` turquoise, `--ocean` deep teal, `--palm` green, `--sunset` coral,
  `--hibiscus` pink, `--sand` cream, `--foam` off-white, plus gradient helpers
  `--grad-sky` (sunset) and `--grad-sea` (ocean).
- Rounded radii (`--radius: 1.25rem`), soft shadows, glass surface
  (`--glass: color-mix(...)` with backdrop-blur).
- Fonts: a warm display font for headings + clean sans for body via `next/font`.

## 4. Execution Phases

### Phase 0 — Foundation (main loop, sequential)
- [ ] Scaffold Next.js (TS, Tailwind, App Router, src dir, import alias `@/*`).
- [ ] `git init` + `.gitignore` (env, node_modules, .next, supabase/.branches).
- [ ] Install deps: `@supabase/supabase-js @supabase/ssr jose zod`; dev: `vitest @vitejs/plugin-react jsdom @testing-library/react playwright`; `supabase` CLI (dev dep).
- [ ] `npx supabase init`.
- [ ] Init shadcn/ui; add base components (button, card, dialog, sheet, input, badge, avatar, sonner).
- [ ] Write `src/lib/types.ts`, `.env.example`, `.nvmrc`, `vitest.config.ts`.
- [ ] Establish paradisey theme in `globals.css` + fonts in `layout.tsx` (design pass).
- [ ] Commit: "chore: scaffold + foundation".

### Phase 1 — Isolated modules (parallel agents, build against §3)
- [ ] **Parsing** (TDD): `source.ts`, `parse-listing.ts` (+ tests w/ fixtures), `fetch-listing.ts`.
- [ ] **Gate core**: `session.ts` (+ test), `ratelimit.ts` (+ test).
- [ ] **DB**: `0001_init.sql` (schema/RLS/realtime/indexes), `seed.sql` (legs + members).
- [ ] **Supabase clients**: `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `utils.ts`.

### Phase 2 — App layer (parallel agents, depend on Phase 1 contracts)
- [ ] **Server Actions**: `gate.ts`, `identity.ts`, `accommodations.ts`, `votes.ts`, `stays.ts`.
- [ ] **Middleware** gate guard (`middleware.ts`/`proxy.ts`).
- [ ] **Realtime hook**: `use-realtime-board.ts`.
- [ ] **Components** (paradisey, mobile-first): card, vote-buttons, voter-chips, stay-section, submit-sheet, name-picker, gate-form, paradise-backdrop, trip-board.
- [ ] **Pages**: `page.tsx`, `gate/page.tsx`, `name/page.tsx`, `layout.tsx` wiring.

### Phase 3 — Integration & verification (main loop + review agents)
- [ ] `tsc --noEmit` + `next build` green; fix loop via build-error agents.
- [ ] `vitest run` green (parser, session, ratelimit).
- [ ] `npx supabase start`; apply migrations + seed; smoke-test gate → name → submit → vote → realtime (best-effort, Docker permitting).
- [ ] Adversarial review: gate cannot be bypassed; anon cannot write; rate-limit holds; no service-role key in client bundle.
- [ ] README with setup/run/deploy. Final commit.

## 5. Testing Strategy
- **TDD** `parseListing` against fixtures (airbnb-like, booking-like, generic, garbage) → assert title/image/price extraction + graceful nulls.
- **Unit** `session` (sign→verify round-trip, reject tampered/expired), `ratelimit` (windowing math).
- **Integration** server actions against local Supabase (vote toggle, submit creates row); RLS (anon SELECT ok, anon write denied).
- **E2E** Playwright at mobile viewport: gate → name → submit (mocked fetch) → vote → tally.

## 6. Run / Deploy (README)
- Local: set Node 22, `npx supabase start` → copy keys to `.env.local`, `npm run dev`.
- Deploy: `npx supabase link` + `db push`; Vercel project + env vars; `vercel deploy`.

## 7. Self-Review
- Spec coverage: gate+lockout (§3.3/3.4, Phase1/2), identity (Phase2), legs+candidates (schema), realtime (hook+publication), parsing (Phase1 TDD), mobile-first+paradisey (Phase0 theme + Phase2 components), testing (§5). ✔ all mapped.
- No placeholders: contracts and signatures are concrete. ✔
- Type consistency: types in §3.1 reused verbatim across signatures (§3.3) and schema (§3.4). ✔
