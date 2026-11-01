import { preflightOn } from "@/server/gpu/index-file";
import { interactiveRefusal } from "@/server/gpu/gate";
import { readinessView } from "@/server/gpu/readiness-service";
import { checkWait, probe, probeRunning, readSnapshot, writeSnapshot } from "@/server/gpu/snapshots";
import { allLoraNames } from "@/server/gpu/tools";
import { gpuTargetFor, installExposed } from "@/server/gpu/target";

/**
 * GPU pre-flight: check the viewer's ComfyUI now (GET requests only, plus ComfyUI-Manager's read-only import-error
 * lookup; never a prompt, an upload or an install). The answer is a stream of NDJSON lines, one per checklist line
 * as each step ends, then the board: {type: "line", step, state, text} … {type: "report", …}. A person on this
 * site starts it (not an API token, not another website), at most once every 10 s per GPU; a second tab joins the
 * check that is already running.
 */
export async function POST(request: Request) {
  if (!preflightOn()) return Response.json({ error: "The GPU pre-flight is switched off on this studio." }, { status: 404 });
  const refused = interactiveRefusal(request);
  if (refused) return Response.json({ error: refused }, { status: 403 });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "none") {
    const error = t.reason === "refused" ? "Fuobe can't use this address. Connect your own ComfyUI." : "Connect your GPU first.";
    return Response.json({ error, code: "connect-gpu" }, { status: 409 });
  }
  // The ComfyUI on the person's own computer: their Fuobe tab checks it and sends what it found (PUT /api/gpu/inventory).
  if (t.kind === "computer") return Response.json({ error: "Your ComfyUI is on your computer: Fuobe checks it from this browser.", code: "browser" }, { status: 409 });
  const wait = checkWait(t);
  if (wait > 0 && !probeRunning(t)) {
    return Response.json({ error: `Checked a moment ago. Try again in ${wait} s.`, wait }, { status: 429, headers: { "Retry-After": String(wait) } });
  }
  const actor = t.kind === "account" ? t.accountId : "owner";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try {
          ctrl.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const inv = await probe(t, { actor, loraNames: allLoraNames(), onLine: (l) => send({ type: "line", ...l }) });
        if (t.kind === "install" && inv.reachable) {
          const exposed = await installExposed();
          const snap = readSnapshot(t);
          if (snap && exposed !== !!snap.inventory.exposed) writeSnapshot(t, { ...snap.inventory, exposed });
        }
        const view = readinessView(t);
        if (view.report) {
          const rows = view.report.studios.length;
          send({ type: "line", step: "match", state: "done", text: `Matched ${rows} studios to your GPU` });
        }
        send({ type: "report", ...view });
      } catch (e) {
        send({ type: "error", error: (e as Error).message || "The check stopped." });
      }
      if (open) ctrl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform: a proxy in front passes the lines on as they come instead of compressing the whole answer.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
