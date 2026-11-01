import { gateAsProxy, readBodyWithin } from "@/server/direct-gate";
import { MixExportError, PART_MAX, receiveMixPart } from "@/server/mix-export";

/**
 * Split soundtrack's Export mix, in parts: POST the WAV's bytes as the body, `?offset=` where they start, `&id=` from
 * the first part's answer, `&last=1&name=` on the last part, which answers with the Library asset (201).
 */
export async function POST(request: Request) {
  // The proxy doesn't run on this route (a part is bigger than the 4 MB of a body it holds): its checks run here.
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const offset = Number(q.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: "Say where the part starts (offset)" }, { status: 400 });
  // Never more than a part, with or without a Content-Length (a chunked body has none).
  const data = await readBodyWithin(request, PART_MAX);
  if (data === "too-big") return Response.json({ error: "That part is too large" }, { status: 413 });
  if (data === null) return Response.json({ error: "That part didn't arrive whole — export the mix again" }, { status: 400 });
  try {
    const r = receiveMixPart({ id: q.get("id"), offset, data, last: q.get("last") === "1", name: q.get("name") });
    return Response.json(r, { status: "relPath" in r ? 201 : 200 });
  } catch (e) {
    if (e instanceof MixExportError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[audio-tools/export]", e);
    return Response.json({ error: (e as Error).message || "Couldn't save the mix" }, { status: 500 });
  }
}
