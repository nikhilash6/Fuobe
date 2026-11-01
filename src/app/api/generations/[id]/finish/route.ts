import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "@/server/account-files";
import { requestAccount } from "@/server/auth";
import { gateAsProxy, readFormWithin } from "@/server/direct-gate";
import { FinishError, finishOutput } from "@/server/generations";
import { enter, hit, unhit } from "@/server/rate";

const MAX_BYTES = 64 * 1024 * 1024;
/** An account's finished picture (its own result: the proxy checks): smaller. */
const ACCOUNT_MAX_BYTES = 32 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fuobe Soul's finished picture (the look's grade and overlay, made in the browser): it replaces the raw output,
 * which stays as meta.original. Form fields: file (PNG), index (the output's place). An account's file is stored as
 * its own (through the generation), and counts as its uploads and results do: room on the server, room in its files,
 * and an hourly limit.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/generations/[id]/finish">) {
  // The proxy doesn't run on this route (a big form): its checks run here (an account: only its own run).
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const account = requestAccount(request);
  const max = account ? ACCOUNT_MAX_BYTES : MAX_BYTES;
  const tooLarge = () => Response.json({ error: `That picture is too large (${max / 2 ** 20} MB max)` }, { status: 413 });
  // An account's pictures are read two at a time at most, each never past its limit (a chunked body included).
  const reading = account ? enter(`finish-now:${account.id}`, 2) : () => {};
  if (!reading) return Response.json({ error: ACCOUNT_MESSAGES.finishBusy }, { status: 429, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  let form: FormData | "too-big" | null;
  try {
    form = await readFormWithin(request, max);
  } finally {
    reading();
  }
  if (form === "too-big") return tooLarge();
  const file = form?.get("file");
  const index = Number(form?.get("index"));
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > max) return tooLarge();
  const data = Buffer.from(await file.arrayBuffer());
  if (file.type !== "image/png" || !data.subarray(0, 8).equals(PNG_MAGIC)) return Response.json({ error: "Finished pictures are PNG images" }, { status: 415 });
  if (account) {
    const refuse = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
    if (!diskHasRoom()) return refuse(503, ACCOUNT_MESSAGES.diskLow);
    if (accountUsage(account.id).total + data.length > accountTotalBytes(account.id)) return refuse(413, filesFullMessage(account.id));
    const rate = hit(`finish:${account.id}`, ACCOUNT_LIMITS.finishesPerHour, 60 * 60_000);
    if (!rate.ok) return refuse(429, ACCOUNT_MESSAGES.finishRate, { "Retry-After": String(rate.retryAfterS) });
  }
  try {
    return Response.json(finishOutput(id, index, data));
  } catch (e) {
    if (account) unhit(`finish:${account.id}`);
    if (e instanceof FinishError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
