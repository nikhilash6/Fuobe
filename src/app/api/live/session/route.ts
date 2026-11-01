import { connection } from "next/server";
import { KEEP_LADDER, LIVE_LADDER } from "@/lib/live/sizes";
import { MAX_LIVE_TEXT } from "@/lib/live/text";
import { asWho, liveWho } from "@/server/live/access";
import { liveFacts, liveSocket } from "@/server/live/comfy-live";
import { openSession } from "@/server/live/sessions";
import { onOwnGpu } from "@/server/providers/comfyui";

/**
 * Open (or renew) this tab's live edit session on the server path: the owner's local ComfyUI, or an account's linked
 * GPU. The tab on "Use the ComfyUI on this computer" never calls it (it talks to its ComfyUI itself).
 */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
  const gpu = who.kind === "account" ? who.gpu : undefined;
  const s = openSession(who.principal, gpu, typeof body.sessionId === "string" ? body.sessionId : undefined);
  if (!gpu) liveSocket();
  const facts = await asWho(who, () => (gpu ? onOwnGpu(gpu, liveFacts) : liveFacts()));
  return Response.json(
    {
      sessionId: s.id,
      mode: gpu ? "link" : "server",
      seed: s.seed,
      sizes: { live: LIVE_LADDER, keep: KEEP_LADDER },
      nodes: { live: facts.nodes > 0, version: facts.nodes, ws: !gpu },
      highvram: facts.highvram,
      missing: facts.missing,
      maxText: MAX_LIVE_TEXT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
