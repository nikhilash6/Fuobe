import { cleanNodeTimes } from "@/lib/node-times";
import { GIVE_BACK, PREVIEW_LIMITS, previewOf, RELAY_LIMITS, TAB_FAILURES, type ReportEvent } from "@/lib/relay";
import { gateAsProxy, readBodyWithin } from "@/server/direct-gate";
import { callerKey, principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { noteFinished } from "@/server/computer/bench";
import { planFinish } from "@/server/computer/finish";
import { leased, report, type TaskRow } from "@/server/computer/tasks";
import { onComputer, planRelayOutputs } from "@/server/providers/comfyui";
import { enter } from "@/server/rate";

const EVENTS = new Set(["sent", "refused", "queued", "running", "finished", "passes", "gone", "give-back", "comfy-down", "stopped", "failed"]);

/** Reports read at once: one person's, and across the server (each holds its body in memory while it is read). */
const AT_ONCE = { person: 2, all: 16 };
/** A report over this size counts against a lower limit a minute. */
const LARGE_BYTES = 64 * 1024;
/** A worker's: its progress report with a live preview stays under it. */
const LARGE_BYTES_WORKER = 128 * 1024;
/**
 * The most a progress report with a worker's live preview may weigh: its preview (a JPEG of at most 64 KB, as base64)
 * and a few KB for the rest, about 91 KB in all.
 */
const RUNNING_BYTES = Math.ceil(PREVIEW_LIMITS.maxBytes / 3) * 4 + 4 * 1024;

/** The event as the tab sent it, with only the fields each one has, or null. */
function eventOf(b: Record<string, unknown>): ReportEvent | null {
  const e = b.event;
  if (typeof e !== "string" || !EVENTS.has(e)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  // A worker's results kept from an earlier try (nothing new runs).
  const kept = b.kept === true ? { kept: true } : {};
  // A worker's measured execution time and GPU name, with a finished job.
  const exec = { ...measured(b), ...kept };
  // ComfyUI's reason a job failed, in one short line (the server cleans it again before it keeps it).
  const why = typeof b.why === "string" && b.why.trim() ? { why: b.why.slice(0, 4_000) } : {};
  switch (e) {
    case "sent":
      return typeof b.promptId === "string" ? { event: e, promptId: b.promptId, number: num(b.number), ...kept } : null;
    case "refused":
      return { event: e, status: num(b.status) ?? 400, body: b.body, ...why };
    case "queued":
      return { event: e, position: num(b.position) ?? -1 };
    case "running": {
      // A worker's live preview: kept only as a JPEG of at most 64 KB (a larger one is dropped, the report kept).
      const preview = previewOf(b.preview);
      return { event: e, value: num(b.value), max: num(b.max), nodesDone: num(b.nodesDone), ...(typeof b.node === "string" && { node: b.node }), ...(preview && { preview }) };
    }
    case "finished": {
      // A worker's slowest nodes, as its ComfyUI's socket timed them (cleaned: ids, classes, times and step counts only).
      const nodes = cleanNodeTimes(b.nodes);
      return b.entry && typeof b.entry === "object" ? { event: e, entry: b.entry as never, ...(num(b.peakVramBytes) !== undefined && { peakVramBytes: num(b.peakVramBytes) }), ...exec, ...why, ...(nodes && { nodes }) } : null;
    }
    case "passes":
      return Array.isArray(b.entries) && b.entries.length <= 64 ? { event: e, running: b.running === true, entries: b.entries as never, ...(b.running !== true && { ...exec, ...why }) } : null;
    case "give-back":
      return typeof b.why === "string" && (GIVE_BACK as readonly string[]).includes(b.why) ? { event: e, why: b.why as never } : null;
    case "failed":
      return typeof b.reason === "string" && (TAB_FAILURES as readonly string[]).includes(b.reason) ? { event: e, reason: b.reason as never, status: num(b.status), ...why } : null;
    case "comfy-down":
      return { event: e, ...(b.why === "setting" && { why: "setting" as const }) };
    default:
      return { event: e as "gone" | "stopped" };
  }
}

/** A worker's measured run: its ComfyUI's time on the job (at most a day) and its GPU's name, as far as each is sound. */
function measured(b: Record<string, unknown>): { execMs?: number; device?: string } {
  const ms = typeof b.execMs === "number" && Number.isFinite(b.execMs) && b.execMs >= 0 && b.execMs <= 24 * 3_600_000 ? Math.round(b.execMs) : undefined;
  const device = typeof b.device === "string" ? b.device.replace(/[^\p{L}\p{N} ._:()+/-]/gu, "").trim().slice(0, 120) : "";
  return { ...(ms !== undefined && { execMs: ms }), ...(device && { device }) };
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
  const limited = rateOf(callerKey(request, principal), "report", 300);
  if (limited) return limited;
  const { id } = await ctx.params;
  const lease = request.headers.get("x-fuobe-lease");
  let cap: number;
  let largeAt = LARGE_BYTES;
  let worker = false;
  try {
    const held = leased(principal, id, lease);
    cap = capFor(held);
    worker = !!held.pools;
    if (worker) largeAt = LARGE_BYTES_WORKER;
  } catch (e) {
    return relayAnswer(e);
  }
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) return no(413, "That report is too large");
  if (cap > largeAt && !(declared <= largeAt)) {
    const big = rateOf(callerKey(request, principal), "report-large", 30);
    if (big) return big;
  }
  const mine = enter(`relay-report:${callerKey(request, principal)}`, AT_ONCE.person);
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
    // A progress report is a few KB, unless it carries a worker's live preview.
    const withPreview = worker && event.event === "running" && typeof body?.preview === "string";
    if (!LARGE_EVENTS.has(event.event) && raw!.length > (withPreview ? RUNNING_BYTES : RELAY_LIMITS.smallReportBytes)) return no(413, "That report is too large");
    // Where the job is now (it may have moved while the body arrived).
    const t = leased(principal, id, lease);
    // A finishing job (src/lib/finish-ticket.ts) names its results by role; any other job, by its workflow's outputs.
    const answer = report(t, event, (entries, passes) => onComputer(t.principal, () => (t.finish_json ? planFinish(t, entries) : planRelayOutputs(t, entries, passes))));
    // A worker's finished job counts toward its lane's times there (not results kept from an earlier try: their time
    // there would be only the upload's; not a CPU slot's work, which uses no GPU). The workers' log keeps its measured
    // run (tasks.ts report).
    if (t.pools && !t.slot && (event.event === "finished" || event.event === "passes") && answer.state !== "running" && !event.kept) noteFinished(t, Date.now(), event.event === "finished" ? event.peakVramBytes : undefined);
    return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return relayAnswer(e);
  } finally {
    all();
    mine();
  }
}
