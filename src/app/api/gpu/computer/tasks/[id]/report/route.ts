import { RELAY_LIMITS, TAB_FAILURES, type ReportEvent } from "@/lib/relay";
import { gateAsProxy, readBodyWithin } from "@/server/direct-gate";
import { principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { leased, report, type TaskRow } from "@/server/computer/tasks";
import { onComputer, planRelayOutputs } from "@/server/providers/comfyui";
import { enter } from "@/server/rate";

const EVENTS = new Set(["sent", "refused", "queued", "running", "finished", "passes", "gone", "comfy-down", "stopped", "failed"]);

/** Reports read at once: one person's, and across the server (each holds its body in memory while it is read). */
const AT_ONCE = { person: 2, all: 16 };
/** A report over this size counts against a lower limit a minute. */
const LARGE_BYTES = 64 * 1024;

/** The event as the tab sent it, with only the fields each one has, or null. */
function eventOf(b: Record<string, unknown>): ReportEvent | null {
  const e = b.event;
  if (typeof e !== "string" || !EVENTS.has(e)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  switch (e) {
    case "sent":
      return typeof b.promptId === "string" ? { event: e, promptId: b.promptId, number: num(b.number) } : null;
    case "refused":
      return { event: e, status: num(b.status) ?? 400, body: b.body };
    case "queued":
      return { event: e, position: num(b.position) ?? -1 };
    case "running":
      return { event: e, value: num(b.value), max: num(b.max), nodesDone: num(b.nodesDone), ...(typeof b.node === "string" && { node: b.node }) };
    case "finished":
      return b.entry && typeof b.entry === "object" ? { event: e, entry: b.entry as never } : null;
    case "passes":
      return Array.isArray(b.entries) && b.entries.length <= 64 ? { event: e, running: b.running === true, entries: b.entries as never } : null;
    case "failed":
      return typeof b.reason === "string" && (TAB_FAILURES as readonly string[]).includes(b.reason) ? { event: e, reason: b.reason as never, status: num(b.status) } : null;
    case "comfy-down":
      return { event: e, ...(b.why === "setting" && { why: "setting" as const }) };
    default:
      return { event: e as "gone" | "stopped" };
  }
}

/** The most a report about this job may weigh now: a finished entry while ComfyUI has it, a refusal while it sends. */
const capFor = (t: TaskRow) => (t.state === "queued" || t.state === "running" ? RELAY_LIMITS.reportBytes : t.state === "sending" ? RELAY_LIMITS.refusalBytes : RELAY_LIMITS.smallReportBytes);
/** The reports that carry ComfyUI's own answer; every other one is a few words. */
const LARGE_EVENTS = new Set(["finished", "passes", "refused"]);

const no = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * The tab's report about a job it took (its token in X-Fuobe-Lease, checked before the body is read): sent, refused,
 * where it is in the queue, its steps, its finished /history entry (up to 8 MB, only while ComfyUI has the job), ComfyUI
 * gone or down, a stop done. Each is taken only where the job is. The answer to a finished prompt names the files to
 * upload. Two of one person's reports are read at once, a few across the server. The proxy doesn't run on this route (a
 * big entry): its checks run here.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/report">) {
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "report", 300);
  if (limited) return limited;
  const { id } = await ctx.params;
  const lease = request.headers.get("x-fuobe-lease");
  let cap: number;
  try {
    cap = capFor(leased(principal, id, lease));
  } catch (e) {
    return relayAnswer(e);
  }
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) return no(413, "That report is too large");
  if (cap > LARGE_BYTES && !(declared <= LARGE_BYTES)) {
    const big = rateOf(principal, "report-large", 30);
    if (big) return big;
  }
  const mine = enter(`relay-report:${principal}`, AT_ONCE.person);
  if (!mine) return no(429, "Too many at once. Fuobe tries again by itself.", { "Retry-After": "1" });
  const all = enter("relay-report", AT_ONCE.all);
  if (!all) {
    mine();
    return no(429, "The studio is busy. Fuobe tries again by itself.", { "Retry-After": "2" });
  }
  try {
    const raw = await readBodyWithin(request, cap);
    if (raw === "too-big") return no(413, "That report is too large");
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : null;
    } catch {}
    const event = body && typeof body === "object" ? eventOf(body) : null;
    if (!event) return no(400, "Not a report");
    if (!LARGE_EVENTS.has(event.event) && raw!.length > RELAY_LIMITS.smallReportBytes) return no(413, "That report is too large");
    // Where the job is now (it may have moved while the body arrived).
    const t = leased(principal, id, lease);
    return Response.json(
      report(t, event, (entries, passes) => onComputer(principal, () => planRelayOutputs(t, entries, passes))),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return relayAnswer(e);
  } finally {
    all();
    mine();
  }
}
