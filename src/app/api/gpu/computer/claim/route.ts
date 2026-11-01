import { principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { claim } from "@/server/computer/tasks";

/**
 * The person's Fuobe tab asks for a job to run on its ComfyUI: one it started before and lost track of (a reload), or,
 * when this computer runs the waiting jobs, the oldest one. The answer is the graph exactly as the server built it, the
 * inputs to send under the names it chose, the prompt id it minted, and a new token for every call about it. No job:
 * 204.
 */
export async function POST(request: Request) {
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "claim", 60);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { device?: unknown; running?: unknown } | null;
  const running = Array.isArray(body?.running) ? body.running.filter((x): x is string => typeof x === "string").slice(0, 32) : [];
  try {
    const task = claim(principal, String(body?.device ?? ""), running);
    if (!task) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return Response.json({ task }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return relayAnswer(e);
  }
}
