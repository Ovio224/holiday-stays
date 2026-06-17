/**
 * Centralized environment access. Getters (not top-level reads) so a missing
 * variable throws at request time with a clear message, never at build/import.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Truthy when an env var is explicitly "true" / "1" / "yes" (case-insensitive). */
function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export const env = {
  gateCode: () => requireEnv("GATE_CODE"),
  sessionSecret: () => requireEnv("SESSION_SECRET"),
  gateMaxAttempts: () => Number(process.env.GATE_MAX_ATTEMPTS ?? "5"),
  gateWindowMinutes: () => Number(process.env.GATE_WINDOW_MINUTES ?? "15"),
  supabaseUrl: () => requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),

  // ── Location-aware accommodation scoring (off by default) ──────────────────
  // Master flag. When off, getBoardData() runs NO places query and the board
  // behaves exactly as before — so an un-migrated cloud DB is provably untouched.
  locationScoringEnabled: () => envFlag("LOCATION_SCORING_ENABLED"),
  // Geocoding key (server-only, optional). Absent → addresses stay 'pending' and
  // the board falls back to manual coordinates + haversine. NEVER NEXT_PUBLIC_*.
  locationiqApiKey: () => process.env.LOCATIONIQ_API_KEY?.trim() || null,
  // Routing base URL (Phase 2, server-only, optional). Absent → haversine only.
  valhallaBaseUrl: () => process.env.VALHALLA_BASE_URL?.trim() || null,
};
