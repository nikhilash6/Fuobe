import { readBodyWithin } from "@/server/direct-gate";
import { BROWSER_INVENTORY_BYTES, cleanInventory } from "@/server/gpu/browser-inventory";
import { preflightOn } from "@/server/gpu/index-file";
import { interactiveRefusal } from "@/server/gpu/gate";
import { readinessView } from "@/server/gpu/readiness-service";
import { writeSnapshot } from "@/server/gpu/snapshots";
import { gpuTargetFor } from "@/server/gpu/target";
import { hit } from "@/server/rate";

/**
 * GPU pre-flight, browser-direct: the person's Fuobe tab read the ComfyUI on their own computer ("Use the ComfyUI on
 * this computer") and sends what it found. Taken only for that person's own computer (an account in that mode, or the
 * owner when Settings says ComfyUI runs on the owner's computer), never for a ComfyUI the server reads itself: a
 * browser's facts never stand in for a server check (review 18). The answer is the board, as GET /api/gpu/readiness.
 */
export async function PUT(request: Request) {
  if (!preflightOn()) return Response.json({ error: "The GPU pre-flight is switched off on this studio." }, { status: 404 });
  const refused = interactiveRefusal(request);
  if (refused) return Response.json({ error: refused }, { status: 403 });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "install" || t.kind === "account") return Response.json({ error: "This ComfyUI is checked by the server.", code: "server-check" }, { status: 409 });
  if (t.kind === "none") return Response.json({ error: "Connect your GPU first.", code: "connect-gpu" }, { status: 409 });
  const rate = hit(`gpu-inventory:${t.key}`, 12, 60_000);
  if (!rate.ok) return Response.json({ error: "Checked a moment ago." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  const raw = await readBodyWithin(request, BROWSER_INVENTORY_BYTES);
  if (raw === "too-big") return Response.json({ error: "That check is too large." }, { status: 413 });
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw.toString("utf8")) : null;
  } catch {}
  const inventory = cleanInventory(body);
  if (!inventory) return Response.json({ error: "That isn't a check of a ComfyUI." }, { status: 400 });
  writeSnapshot(t, inventory);
  return Response.json(readinessView(t), { headers: { "Cache-Control": "private, no-store" } });
}
