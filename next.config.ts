import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't pick up an unrelated lockfile
  // higher up the filesystem (e.g. ~/package-lock.json).
  turbopack: {
    root: import.meta.dirname,
  },
  images: {
    // Listing images come from arbitrary hosts (Airbnb, Booking, OG images).
    // This is an internal, gated app, so we allow any https image source.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
