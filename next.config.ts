import type { NextConfig } from "next";

/** A cover URL's content version (?v=, scripts/eval/lib/covers.mjs): Next matches the value whole. */
const COVER_VERSION = { type: "query" as const, key: "v", value: "[0-9a-f]{8}" };

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  poweredByHeader: false,
  partialPrefetching: true,
  // A deploy can set FUOBE_SKIP_BUILD_TYPECHECK=1 to skip the build's own TypeScript pass: on a small server it holds
  // another ~1 GB for minutes and can run the build out of memory (Next's memory guide, "Disable static analysis").
  // `pnpm typecheck` still checks every change before it's pushed; local builds keep the check.
  typescript: { ignoreBuildErrors: process.env.FUOBE_SKIP_BUILD_TYPECHECK === "1" },
  experimental: {
    // A deploy can set FUOBE_BUILD_CPUS (e.g. 1) to build with fewer workers: each one loads the whole server bundle, and
    // on a small server three of them pushed the build past its memory cap until it crawled.
    ...(Number(process.env.FUOBE_BUILD_CPUS) > 0 && { cpus: Number(process.env.FUOBE_BUILD_CPUS) }),
    // The sign-in proxy holds every request body it sees in memory, up to this size, even one it refuses: a small limit
    // keeps many open requests from filling the server's memory. The routes that take a file in a form (uploads, a Soul
    // finish, a Layers render, a skill, an Assist source, an explainer document) and Split soundtrack's mix export (16 MB
    // parts) skip the proxy and check the asker themselves (src/proxy.ts matcher). Everything else sends JSON: Evolution's
    // 2 MB frame is the largest. A body over the limit reaches the route cut short, with no error (POST /api/generations
    // then says it is too large).
    proxyClientMaxBodySize: "4mb",
  },
  async headers() {
    return [
      // Pages: a fixed policy that holds without nonces (pages are prerendered): no plugins, no <base> elsewhere, no
      // framing by other sites, forms post only here. Stored files (/api/files, a share's /s/<token>/f/) keep their own,
      // stricter policy (src/server/file-response.ts).
      {
        source: "/:path((?!api/|s/[^/]+/f/).*)",
        headers: [{ key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" }],
      },
      // Vendored scripts (public/vendor: the 3D viewer's meshopt decoder) keep their name across upgrades:
      // a day, then revalidated in the background.
      { source: "/vendor/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      // Sample media (public/samples: Clean up voice's demo, the demo engine's clips) keep their name too: the same.
      { source: "/samples/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      // Preset covers (public/previews, pnpm eval:covers) keep their name when a cover is made again, but every URL the
      // site gives them ends in the file's content version (?v=, 8 hex digits of its sha256, from the generated
      // manifests): a changed file gets a new URL, so a browser keeps a versioned one for a year and never revalidates
      // it. The CDN keeps it a day (s-maxage): a page loaded before a deploy can still ask for an old version and get the
      // new file under it, and a revert or rollback that gives that version back must not find the wrong file pinned
      // there for a year. One asked for without its version (a link from elsewhere) keeps a day's cache, revalidated in
      // the background.
      { source: "/previews/:path*", has: [COVER_VERSION], headers: [{ key: "Cache-Control", value: "public, max-age=31536000, s-maxage=86400, immutable" }] },
      { source: "/previews/:path*", missing: [COVER_VERSION], headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
  async redirects() {
    return [
      { source: "/characters", destination: "/elements", permanent: true },
      { source: "/characters/:id", destination: "/elements/:id", permanent: true },
      // The product-link ad apps open the Click to Ad flow (src/lib/catalog/apps.ts).
      { source: "/apps/:id(app-click-to-ad|app-link-to-video-ad)", destination: "/marketing/click-to-ad", permanent: false },
      // The Virality Predictor app became the /virality page (its frame step is the Hook Frame app).
      { source: "/apps/app-virality-predictor", destination: "/virality", permanent: true },
      // Studio hubs have one path per mode (src/lib/hubs.ts). Old `?mode=` links go to it in src/proxy.ts (hubModeLink),
      // which drops the mode from the query; a clip handed to Upscale or Audio without a mode opens Sound for video / Video.
      ...["audio", "upscale"].map((hub) => ({
        source: `/${hub}`,
        has: [{ type: "query" as const, key: "video" }],
        missing: [{ type: "query" as const, key: "mode" }],
        destination: `/${hub}/video`,
        permanent: false,
      })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
