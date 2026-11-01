import { connection } from "next/server";
import { KEEP_LADDER, LIVE_LADDER } from "@/lib/live/sizes";
import { MAX_LIVE_TEXT } from "@/lib/live/text";
import { asWho, liveWho } from "@/server/live/access";
import { liveFacts, liveSocket } from "@/server/live/comfy-live";
import { endSession, openSession, sessionOf } from "@/server/live/sessions";
import { hit } from "@/server/rate";
import { onOwnGpu } from "@/server/providers/comfyui";

/**
 * Open a live edit session for one editor on the server path (the owner's local ComfyUI, or an account's linked GPU),
 * or end one: { sessionId, end: true }. Every editor opens its own (a duplicated tab never shares one), and a person
 * has at most four. The tab on "Use the ComfyUI on this computer" never calls it (it talks to its ComfyUI itself).
 */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const body = ((await request.json().catch(() => null)) ?? {}) as { sessionId?: unknown; end?: unknown };
  if (body.end === true) {
    const had = sessionOf(who.principal, body.sessionId);
    if (had) endSession(had.id);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const rate = hit(`live-session:${who.principal}`, 20, 60_000);
  if (!rate.ok) return Response.json({ error: "Live edit opened too often. Try again in a moment." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  const gpu = who.kind === "account" ? who.gpu : undefined;
  const s = openSession(who.principal, gpu);
  if (!gpu) liveSocket();
  const facts = await asWho(who, () => (gpu ? onOwnGpu(gpu, liveFacts) : liveFacts()));
  return Response.json(
    {
      sessionId: s.id,
      mode: gpu ? "link" : "server",
      seed: s.seed,
      sizes: { live: LIVE_LADDER, keep: KEEP_LADDER },
      nodes: { live: facts.nodes > 0, version: facts.nodes, outdated: facts.outdated, ws: !gpu },
      highvram: facts.highvram,
      missing: facts.missing,
      maxText: MAX_LIVE_TEXT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
