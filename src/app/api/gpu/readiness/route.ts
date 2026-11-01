import { connection } from "next/server";
import { preflightOn } from "@/server/gpu/index-file";
import { readinessView } from "@/server/gpu/readiness-service";
import { gpuTargetFor } from "@/server/gpu/target";

/**
 * GPU pre-flight: the readiness board from the viewer's last check (the owner: the studio's own ComfyUI; an
 * account: the ComfyUI it connected). It never probes; POST /api/gpu/check does. Guests get { connected: false }.
 */
export async function GET(request: Request) {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  if (!preflightOn()) return Response.json({ connected: false, reason: "off" }, { headers });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "none") return Response.json({ connected: false, reason: t.reason }, { headers });
  return Response.json(readinessView(t), { headers });
}
