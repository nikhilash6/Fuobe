import { enhancePrompt, writeLyrics } from "@/server/enhance";
import { getModel } from "@/lib/catalog";
import { appliesOwnStyle } from "@/lib/catalog/applied-style";
import type { MediaKind, Operation } from "@/lib/catalog/types";
import { GUEST_HEADER, GUEST_RUN_MESSAGE, ownGpuToolMessage, SIGN_IN_CODE } from "@/lib/guest-access";
import { LoginGuard, requestViewer } from "@/server/auth";
import { hostedRunsOn } from "@/server/hosted-switch";
import { runAsTenant, type Tenant } from "@/server/tenant";
import type { HelperAnswer } from "@/server/text-helper";
import { limitFields, limitWords } from "@/lib/limit-words";

type HelperTrouble = Exclude<HelperAnswer, { text: string }>;

/** A guest's call for the free helper: the page opens "Create a free account" (the 401 marked as a guest's). */
const signIn = () => Response.json({ error: GUEST_RUN_MESSAGE, code: SIGN_IN_CODE }, { status: 401, headers: { [GUEST_HEADER]: "1", "Cache-Control": "no-store" } });

/** Why no lyrics came, in words, with a code the page reads ("no-llm" offers Settings → AI helper to the owner). */
function noLyrics(owner: boolean, why: HelperTrouble | null): Response {
  const headers = { "Cache-Control": "no-store" };
  if (why?.error === "sign-in") return signIn();
  if (why?.error === "limit") {
    const wait = why.retryAfterS ?? 60;
    return Response.json({ error: limitWords("replies", wait), code: "helper-limit", ...limitFields("replies", wait) }, { status: 429, headers: { ...headers, "Retry-After": String(wait) } });
  }
  if (why?.error === "blocked") return Response.json({ error: why.message || "These lyrics can't be written here.", code: "helper-blocked" }, { status: 403, headers });
  if (owner && !why) {
    return Response.json({ error: "Writing lyrics needs an AI helper. Set up Claude or a local model in Settings → AI helper, or type your own.", code: "no-llm" }, { status: 503, headers });
  }
  return Response.json({ error: "Lots of people are writing lyrics right now — try again in a moment, or type your own.", code: owner ? "no-llm" : "helper-busy" }, { status: 503, headers });
}

export async function POST(request: Request) {
  const { prompt, kind, op, target, seconds, max, modelId } = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    kind?: MediaKind;
    op?: Operation;
    /** "lyrics": Audio → Music's "Write the lyrics" (words to sing for the song `prompt` describes). */
    target?: "lyrics";
    seconds?: number;
    max?: number;
    /** The composer's model: one that puts its own look on the clip (an H3 Max look) gets no look of Fuobe's. */
    modelId?: string;
  };
  if (!prompt?.trim()) return Response.json({ error: "Empty prompt" }, { status: 400 });
  // A visitor (only while hosted runs are on: the proxy lets nothing else through) gets the free helper, as itself.
  const viewer = requestViewer(request);
  const owner = viewer.kind === "owner";
  // A guest's lyrics need the free helper: sign up first. A guest's rewrite stays the offline one (freeHelperOn).
  if (viewer.kind === "guest" && target === "lyrics") return signIn();
  if (!owner && !hostedRunsOn()) return Response.json({ error: ownGpuToolMessage(false), code: "own-gpu-tool" }, { status: 403 });
  const as: Tenant | null = viewer.kind === "account" ? { kind: "account", id: viewer.account.id } : viewer.kind === "guest" ? { kind: "guest" } : null;
  const guestKey = viewer.kind === "guest" ? LoginGuard.clientKey(request.headers) : undefined;
  const run = <T,>(fn: () => Promise<T>) => (as ? runAsTenant(as, fn) : fn());
  const words = owner ? prompt : prompt.slice(0, 4000);
  const key = guestKey === LoginGuard.DIRECT ? "shared" : guestKey;
  try {
    if (target === "lyrics") {
      let why: HelperTrouble | null = null;
      const helper = { guestKey: key, onHelper: (a: HelperTrouble) => (why = a) };
      const lyrics = await run(() => writeLyrics(words.slice(0, 4000), { seconds: Number(seconds) || undefined, max: Number(max) || undefined, helper }));
      if (!lyrics) return noLyrics(owner, why);
      return Response.json({ lyrics });
    }
    const ownStyle = !!modelId && !!getModel(modelId)?.routes.some(appliesOwnStyle);
    return Response.json({ prompt: await run(() => enhancePrompt(words, kind ?? "image", op ?? "t2i", { ownStyle }, { guestKey: key, waitMs: 45_000 })) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
