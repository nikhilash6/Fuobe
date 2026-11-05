import { requestAccount } from "@/server/auth";
import { generationAccount } from "@/server/account-library";
import { getGeneration } from "@/server/generations";
import { hit, unhit } from "@/server/rate";
import { SmallerCopyBusy, SmallerCopyError, withSmallerCopy } from "@/server/smaller-copy";

/**
 * "Send a smaller copy" (an account's own failed run whose file was too big, or too slow, to send to its GPU): a smaller
 * copy of that file is made and kept as a new file of the account's, and the run's request comes back with it. The
 * studio then starts it as any run (POST /api/generations: every limit applies there).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/generations/[id]/smaller">) {
  const account = requestAccount(request);
  if (!account) return Response.json({ error: "Log in to send a smaller copy." }, { status: 400 });
  const { id } = await ctx.params;
  const g = generationAccount(id) === account.id ? getGeneration(id) : null;
  if (!g) return Response.json({ error: "We can't find that run." }, { status: 404 });
  const cause = g.status === "failed" ? g.trouble?.cause : undefined;
  if (cause !== "gpu-too-big" && cause !== "gpu-slow-upload") return Response.json({ error: "This run's files weren't too big. Press Retry." }, { status: 409 });
  // A copy is real work (a clip is encoded again): a few for each run, and a few more for the account, each hour.
  const keys = [`smaller:${account.id}:${id}`, `smaller:${account.id}`];
  const limits = [SMALLER_RATE.perRun, SMALLER_RATE.perAccount];
  for (let i = 0; i < keys.length; i++) {
    const rate = hit(keys[i], limits[i], 60 * 60_000);
    if (!rate.ok) {
      for (const k of keys.slice(0, i)) unhit(k);
      const minutes = Math.max(1, Math.ceil(rate.retryAfterS / 60));
      return Response.json({ error: `You've made a few smaller copies already. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
    }
  }
  try {
    const { request: again, bytes } = await withSmallerCopy(account.id, g.request);
    return Response.json({ request: again, note: `Sent a smaller copy (${Math.max(1, Math.round(bytes / 2 ** 20))} MB).` });
  } catch (e) {
    // Busy (its last copy, or the server's few at once): not counted, and said with when to try again.
    if (e instanceof SmallerCopyBusy) {
      for (const k of keys) unhit(k);
      return Response.json({ error: e.message }, { status: 429, headers: { "Retry-After": "30" } });
    }
    if (e instanceof SmallerCopyError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}

/** Smaller copies an account may ask for in an hour: of one run, and in all. */
const SMALLER_RATE = { perRun: 3, perAccount: 12 };
