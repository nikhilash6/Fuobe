import { principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { beat, type BeatInput } from "@/server/computer/tasks";

/** What a beat may weigh: the facts, with up to 20,000 LoRA names. */
const MAX_BYTES = 3 * 2 ** 20;

/**
 * "Use the ComfyUI on this computer": the person's Fuobe tab says it is there, every few seconds. The first computer to
 * beat runs the waiting jobs (another takes over when this one goes quiet for a minute, or when the person asks); the
 * answer says whether it does, how many wait, and which prompts to take off its ComfyUI. It may send its ComfyUI's
 * facts (the GPU, memory, version, LoRA names), never its command line.
 */
export async function POST(request: Request) {
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "beat", 30);
  if (limited) return limited;
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BYTES) return Response.json({ error: "Too much at once" }, { status: 413 });
  let body: BeatInput;
  try {
    body = JSON.parse(text) as BeatInput;
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  try {
    return Response.json(beat(principal, { device: String(body?.device ?? ""), port: body?.port, facts: body?.facts, running: Array.isArray(body?.running) ? body.running : [], takeover: body?.takeover === true, stopped: Array.isArray(body?.stopped) ? body.stopped : [], ready: body?.ready !== false, ...(body?.why === "setting" && { why: "setting" as const }), listen: body?.listen === true }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return relayAnswer(e);
  }
}
