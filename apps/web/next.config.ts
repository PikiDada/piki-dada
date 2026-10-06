import type { NextConfig } from "next";

// The site is built as plain files (every page renders in the browser) and served by Caddy,
// so there's no Node server in production. That also means security headers (CSP etc.) can't
// be set here; they live in the repo's Caddyfile.
const nextConfig: NextConfig = {
  output: "export",
  // No server to resize images on request; the app's images are small static assets.
  images: { unoptimized: true },
};

export default nextConfig;
