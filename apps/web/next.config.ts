import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";
const apiWsUrl = apiUrl.replace(/^http/, "ws");
const isProd = process.env.NODE_ENV === "production";

// `script-src` includes 'unsafe-inline' because Next.js's own hydration scripts need it
// (verified live: a stricter nonce/strict-dynamic policy broke Next's own static chunk
// loading under this Next.js/Turbopack version — not worth shipping a CSP that looks
// stricter on paper but is actually broken). This app has no dangerouslySetInnerHTML
// anywhere, so there's no current injection point for this to matter in practice; the
// other directives below (connect-src, img-src, frame-ancestors) still do real work,
// e.g. blocking exfiltration to arbitrary domains and clickjacking.
const csp = isProd
  ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://res.cloudinary.com https://*.googleusercontent.com",
      `connect-src 'self' ${apiUrl} ${apiWsUrl} https://maps.googleapis.com`,
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  : [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://res.cloudinary.com https://*.googleusercontent.com",
      `connect-src 'self' ${apiUrl} ${apiWsUrl} http://localhost:* ws://localhost:* https://maps.googleapis.com`,
      "font-src 'self' data:",
      "frame-ancestors 'none'",
    ].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
