/**
 * Fixed, full-bleed tropical backdrop: a paradise gradient washed with soft,
 * slowly drifting color blobs (sun, lagoon, palm, hibiscus). Purely decorative
 * and non-interactive, so it stays a server component.
 */
export function ParadiseBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-grad-paradise"
    >
      <div
        className="absolute -top-24 -right-16 h-80 w-80 rounded-full bg-mango/50 blur-3xl"
        style={{ animation: "paradise-float 9s ease-in-out infinite" }}
      />
      <div
        className="absolute top-1/3 -left-24 h-96 w-96 rounded-full bg-lagoon/40 blur-3xl"
        style={{ animation: "paradise-drift 14s ease-in-out infinite" }}
      />
      <div
        className="absolute -bottom-32 right-1/4 h-[28rem] w-[28rem] rounded-full bg-palm/30 blur-3xl"
        style={{ animation: "paradise-float 12s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-10 left-6 h-64 w-64 rounded-full bg-hibiscus/20 blur-3xl"
        style={{ animation: "paradise-drift 16s ease-in-out infinite" }}
      />
      {/* subtle top sheen so glass cards read against the wash */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/40 to-transparent" />
    </div>
  );
}
