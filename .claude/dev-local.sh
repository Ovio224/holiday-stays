#!/usr/bin/env bash
# Dev server pointed at the LOCAL Supabase stack with location scoring ON, for
# verifying the location-aware-scoring feature end to end. Separate from dev.sh
# (which targets the cloud project on port 3100) so the two never collide.
export PATH="/Users/ovidiucotorogea/.nvm/versions/node/v22.13.1/bin:$PATH"
cd /Users/ovidiucotorogea/WebstormProjects/accomodation-comparison || exit 1

# Local Supabase (well-known demo keys — not secrets).
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

# Feature flag ON + a known local gate code (overrides .env.local for this server).
export LOCATION_SCORING_ENABLED="true"
export GATE_CODE="localtest"
export SESSION_SECRET="local-dev-only-secret-at-least-32-characters-long"

exec npm run dev -- --port 3200
