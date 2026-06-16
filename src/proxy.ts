/**
 * Edge proxy (Next.js 16's replacement for middleware).
 *
 * This is an OPTIMISTIC gate: it cheaply verifies the gate token cookie on every
 * navigation and steers people toward (or away from) /gate. It is NOT the
 * security boundary — the authoritative check is assertGate() inside each Server
 * Action, which re-verifies the same token before any DB access. Keeping the
 * real check in the actions means a forged/stale cookie can never mutate data,
 * even if this proxy is bypassed.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, verifyGateToken } from "@/lib/gate/session";

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(GATE_COOKIE)?.value;
  const ok = await verifyGateToken(token);
  const pathname = req.nextUrl.pathname;

  // Not gated-in and trying to reach anything but the gate -> send to /gate.
  if (!ok && pathname !== "/gate") {
    return NextResponse.redirect(new URL("/gate", req.url));
  }

  // Already gated-in but sitting on /gate -> bounce to the board.
  if (ok && pathname === "/gate") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

// Run on everything except Next internals and common static asset requests.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
