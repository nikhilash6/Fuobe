import fs from "node:fs";
import { connection } from "next/server";
import { RELAY_LIMITS } from "@/lib/relay";
import { gateAsProxy } from "@/server/direct-gate";
import { isUtf8File, outputType, principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { failTask, getTask, leased, outputFile, outputStatus, receivePart, RelayError, SNIFF_BYTES, wantedOf, type TaskRow } from "@/server/computer/tasks";
import { enter } from "@/server/rate";

/** Nothing arriving for this long ends a part. */
const IDLE_MS = 60_000;
/** Parts of results arriving at once across the server. */
const AT_ONCE = 8;

const no = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Append the request body to `file`: exactly `length` bytes, or less when it stops (the caller drops a short part). */
async function writeBody(request: Request, file: string, append: boolean, length: number): Promise<{ bytes: number; head: Buffer }> {
  const out = fs.openSync(file, append ? "a" : "w", 0o600);
  const reader = request.body?.getReader();
  let bytes = 0;
  const head: Buffer[] = [];
  let headBytes = 0;
  try {
    if (!reader) return { bytes: 0, head: Buffer.alloc(0) };
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      const idle = new Promise<"idle">((resolve) => (timer = setTimeout(() => resolve("idle"), IDLE_MS)));
      const step = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
      if (step === "idle") {
        reader.cancel().catch(() => {});
        break;
      }
      if (step.done) break;
      const chunk = Buffer.from(step.value.buffer, step.value.byteOffset, step.value.byteLength);
      if (bytes + chunk.length > length) {
        reader.cancel().catch(() => {});
        throw new RelayError(413, "More than the part said");
      }
      fs.writeSync(out, chunk);
      bytes += chunk.length;
      if (headBytes < SNIFF_BYTES) {
        head.push(chunk.subarray(0, SNIFF_BYTES - headBytes));
        headBytes += Math.min(chunk.length, SNIFF_BYTES - headBytes);
      }
    }
  } finally {
    fs.closeSync(out);
  }
  return { bytes, head: Buffer.concat(head) };
}

/**
 * A result of a job, uploaded by the tab that took it (its token in X-Fuobe-Lease) in parts of up to 16 MB:
 * `?offset=` where this part starts, `&total=` the file's size. Only a file the server asked for, only at the exact
 * offset already received, only once, never past its limit; its type comes from its first bytes and must be what the
 * job makes (a picture that is really a page is refused, and the run fails). One upload at a time per person, a few
 * across the server. GET says how far it got, so a reloaded tab goes on from there. The proxy doesn't run on this route
 * (a big body): its checks run here.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/outputs/[n]">) {
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "output", 600);
  if (limited) return limited;
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) return no(411, "Send the part with its size (Content-Length).");
  const length = Number(declared);
  const q = new URL(request.url).searchParams;
  const offset = Number(q.get("offset"));
  const total = Number(q.get("total"));
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total < 1) return no(400, "Say where the part goes (offset) and the file's size (total).");
  if (length > RELAY_LIMITS.partBytes) return no(413, "Send results in parts of 16 MB at most.");
  const { id, n: nRaw } = await ctx.params;
  const n = Number.parseInt(nRaw, 10);
  let t: TaskRow;
  try {
    t = leased(principal, id, request.headers.get("x-fuobe-lease"));
  } catch (e) {
    return relayAnswer(e);
  }
  const mine = enter(`relay-out:${principal}`, 1);
  if (!mine) return no(429, "Another result of yours is uploading. Fuobe tries again by itself.", { "Retry-After": "2" });
  const all = enter("relay-out", AT_ONCE);
  if (!all) {
    mine();
    return no(429, "The studio is busy saving other results. Fuobe tries again by itself.", { "Retry-After": "3" });
  }
  try {
    const owner = principal === "owner";
    const r = await receivePart(t, n, { offset, total, length }, (file, append) => writeBody(request, file, append, length), (head, w) => outputType(head, w, owner));
    // A text result is UTF-8 through to its end.
    const w = wantedOf(t).find((x) => x.n === n);
    if (r.done && w?.kind === "text" && !isUtf8File(outputFile(t.id, n))) {
      fs.rmSync(outputFile(t.id, n), { force: true });
      failTask(getTask(principal, t.id) ?? t, "Couldn't save a result from your ComfyUI: it isn't text.");
      return no(415, "That isn't text.");
    }
    return Response.json({ received: r.bytes, total: r.total, done: r.done }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof RelayError && e.extra.fail) {
      // A result that isn't what the job makes, or past what it may keep: the run fails, with why.
      failTask(getTask(principal, t.id) ?? t, e.message);
    }
    return relayAnswer(e);
  } finally {
    all();
    mine();
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/outputs/[n]">) {
  await connection();
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const { id, n } = await ctx.params;
  try {
    const t = leased(principal, id, request.headers.get("x-fuobe-lease"));
    const r = outputStatus(t, Number.parseInt(n, 10));
    return Response.json({ received: r.bytes, total: r.total, done: r.done }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return relayAnswer(e);
  }
}
