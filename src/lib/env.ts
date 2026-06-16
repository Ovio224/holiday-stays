/**
 * Centralized environment access. Getters (not top-level reads) so a missing
 * variable throws at request time with a clear message, never at build/import.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  gateCode: () => requireEnv("GATE_CODE"),
  sessionSecret: () => requireEnv("SESSION_SECRET"),
  gateMaxAttempts: () => Number(process.env.GATE_MAX_ATTEMPTS ?? "5"),
  gateWindowMinutes: () => Number(process.env.GATE_WINDOW_MINUTES ?? "15"),
  supabaseUrl: () => requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
};
