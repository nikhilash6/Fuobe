import "server-only";
import { POST as generationsPOST } from "@/app/api/generations/route";
import { getModel } from "@/lib/catalog";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { ChatPlan, ChatPlanJob } from "@/lib/chat/types";
import { formatCost } from "@/lib/format";
import { accountEngineMode } from "../account-keys";
import { offlinePlan } from "../assist/agent";
import { asRequest, planFor } from "../assist/tools";
import { asAccount } from "../generations";

/**
 * Chat's making layer. A request to make something becomes a plan: read by Assist's planner (counts, formats, shots,
 * music, voice-overs, an edit or animation of a sent picture), priced step by step by the studios' own route
 * (POST /api/generations?preview=1) as the person asking, and run through that same route when they say so. So an
 * account's plan gets every check a studio run gets: its own limits, only its own files, where it runs and what it costs,
 * and the moderation and GPU checks. One step per plan: a still that is animated after is two plans (the results offer
 * Animate), because an account's runs start one by one.
 */

type Job = Parameters<typeof asRequest>[0];

/** The request headers a run is made with: the person's own session, as if the studio had sent it. */
function forwarded(from: Request): Headers {
  const h = new Headers();
  for (const k of ["cookie", "authorization", "host", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip", "user-agent", "origin"]) {
    const v = from.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("content-type", "application/json");
  return h;
}

async function callStudio(from: Request, req: GenerationRequest, preview: boolean): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const url = new URL(`/api/generations${preview ? "?preview=1" : ""}`, from.url);
  const res = await generationsPOST(new Request(url, { method: "POST", headers: forwarded(from), body: JSON.stringify(req) }));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** What Run shows for a step, from the studio's own price check. */
function priceOf(body: Record<string, unknown>): string | null {
  const quote = body.quote as { text?: unknown; allowed?: unknown } | undefined;
  if (quote && typeof quote.text === "string") return quote.allowed === false ? null : quote.text;
  const cost = typeof body.costUsd === "number" ? body.costUsd : null;
  if (body.demo === true) return null;
  return cost === null ? null : cost === 0 ? "Free" : formatCost(cost);
}

/**
 * The plan for a message that asks to make something, or null when the planner reads no picture, clip or sound in it
 * (the chat then answers it as words). `image`: a picture sent with the message (edited or animated).
 */
export async function planMake(from: Request, who: string, text: string, image: string | null): Promise<{ say: string; plan: ChatPlan } | null> {
  const engine = who === "owner" ? "cloud" : accountEngineMode(who) === "open" ? "open" : "cloud";
  // The thing to make, without the asking ("Can you make me a poster for…" → "A poster for…").
  const what = text
    .trim()
    .replace(/^(?:(?:hey|hi|ok|okay|so|now|please|pls)[,!.]?\s+)*(?:(?:can|could|would|will) you\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+|let'?s\s+)?(?:please\s+)?(?:make|create|generate|render|draw|design|produce|give me|show me)\s+(?:me\s+|us\s+)?/i, "")
    .replace(/[?]+$/, "");
  const ask = what.length >= 3 && what !== text ? what.charAt(0).toUpperCase() + what.slice(1) : text;
  const message = image ? `${ask}\n\nAttached files:\n- image 1: ${image}` : ask;
  const read = offlinePlan(message, engine);
  if (!read || read.tool !== "generate") return null;
  const input = read.input as { summary?: string; jobs?: Job[] };
  const all = (input.jobs ?? []).slice(0, 4);
  // One step per plan: a job that waits for another (animate the still) comes after, from its results.
  const jobs = all.filter((j) => j.after === undefined);
  const then = jobs.length < all.length ? ("animate" as const) : undefined;
  if (!jobs.length) return null;

  // The planner's own check first (an unknown model, a model the GPUs here can't run moves to one that can).
  const planned = (() => {
    const run = () => planFor("generate", { summary: input.summary ?? text.slice(0, 80), jobs }, { engine });
    try {
      return who === "owner" ? run() : asAccount(who, run);
    } catch {
      return null;
    }
  })();

  const out: ChatPlanJob[] = [];
  const requests: GenerationRequest[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const p = planned?.jobs[i];
    // The model it runs on: the planner's pick when it moved the job, else the one asked for.
    const job: Job = p && !p.error ? { ...jobs[i], model_id: p.modelId } : jobs[i];
    const req = { ...asRequest(job), feature: "chat" };
    const model = getModel(req.modelId);
    const check = await callStudio(from, req, true);
    const price = check.ok ? priceOf(check.body) : null;
    const error = !check.ok ? (str(check.body.error) ?? "This step can't run here.") : p?.error;
    out.push({
      modelId: str(check.body.modelId) ?? req.modelId,
      modelName: str(check.body.modelName) ?? model?.name ?? req.modelId,
      kind: (str(check.body.kind) as ChatPlanJob["kind"]) ?? p?.kind ?? model?.kind ?? "image",
      prompt: req.prompt ?? null,
      count: typeof check.body.outputs === "number" ? check.body.outputs : (req.params?.numOutputs ?? 1),
      price: error ? null : price,
      ...(error && { error }),
      ...(p?.changes?.length && { note: p.changes.join(" ") }),
    });
    requests.push(req);
  }
  const say = then ? `${read.say.replace(/\s*[—-]\s*the video starts by itself.*$/i, ".")} Once it's ready, tap Animate on the one you like.` : read.say;
  return { say, plan: { summary: input.summary ?? text.slice(0, 80), jobs: out, requests, status: "ready", ids: [], errors: [], ...(then && { then }) } };
}

/** Run a plan's steps through the studios' route, as the person; each refusal is kept in its own words. */
export async function runPlan(from: Request, plan: ChatPlan): Promise<ChatPlan> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < plan.requests.length; i++) {
    if (plan.jobs[i]?.error) continue;
    const r = await callStudio(from, plan.requests[i], false).catch(() => ({ ok: false, status: 500, body: {} as Record<string, unknown> }));
    const items = Array.isArray(r.body.items) ? (r.body.items as { id?: unknown }[]) : [];
    if (r.ok && items.length) ids.push(...items.map((g) => String(g.id)));
    else errors.push(str(r.body.error) ?? `${plan.jobs[i]?.modelName ?? "This step"} didn't start. Tap Make it again.`);
  }
  return { ...plan, status: "running", ids, errors };
}
