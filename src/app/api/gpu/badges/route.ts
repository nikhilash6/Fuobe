import { connection } from "next/server";
import { preflightOn } from "@/server/gpu/index-file";
import { badgesView } from "@/server/gpu/readiness-service";
import { gpuTargetFor } from "@/server/gpu/target";

/**
 * GPU pre-flight: one chip per open model operation and per preset, from the viewer's last check
 * ([state, steps, GB × 10, flags]; a missing key means no chip). Guests and the switched-off pre-flight get
 * { connected: false }, and no chips.
 */
export async function GET(request: Request) {
  await connection();
  if (!preflightOn()) return Response.json({ connected: false, off: true, models: {}, presets: {} }, { headers: { "Cache-Control": "private, max-age=30" } });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "none") return Response.json({ connected: false, models: {}, presets: {} }, { headers: { "Cache-Control": "private, no-store" } });
  return Response.json(badgesView(t), { headers: { "Cache-Control": "private, max-age=30" } });
}
