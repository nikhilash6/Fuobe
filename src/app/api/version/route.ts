/**
 * The build this server runs (next.config.ts NEXT_PUBLIC_FUOBE_BUILD, fixed when it was built). A page loaded from an
 * older build compares its own and offers Update. Open to everyone (src/proxy.ts OPEN): it says nothing but the build.
 */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_FUOBE_BUILD ?? null }, { headers: { "Cache-Control": "no-store" } });
}
