import { connection } from "next/server";
import { z } from "zod";
import { availability } from "@/server/assist/agent";
import { activeLocal, aiHelper, llmContext, localStatuses, pinnedKind, reloadLmStudio, testLocal } from "@/server/llm";
import { tryHosted } from "@/server/llm/hosted";

/**
 * The LLMs for Settings → AI helper. GET: each local server's status (up, key, its chat models, the model a
 * call would use, what's wrong), `?refresh=1` asks them again now; and the hosted providers Assist can use
 * (which are connected, the model Smart plans with and the one Free runs on, in words). Keys never leave the
 * server. POST {action: "test", kind?}: a tiny call to a local server, timed. POST {action: "load", model?}:
 * reloads an LM Studio model with the context from Settings. POST {action: "try", provider, model?}: a tiny
 * call to a hosted provider, timed (a fraction of a cent on a paid model).
 */
export async function GET(request: Request) {
  await connection();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const servers = await localStatuses(refresh);
  const [active, can] = await Promise.all([activeLocal(), availability()]);
  const hosted = {
    checked: can.checked,
    smart: can.smart.text,
    free: can.free.text,
    providers: can.manual.groups
      .filter((g) => g.models.some((m) => m.agent !== "local"))
      .map((g) => ({ id: g.id, status: g.status, models: g.models.filter((m) => !m.disabled && !m.manualOnly).map((m) => ({ model: m.model, name: m.name })) })),
  };
  return Response.json({ helper: aiHelper(), provider: pinnedKind() ?? "auto", context: llmContext(), active: active?.server.kind ?? null, servers, hosted });
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test"), kind: z.enum(["ollama", "lmstudio", "unsloth", "custom"]).nullish() }),
  z.object({ action: z.literal("load"), model: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("try"), provider: z.string().regex(/^[a-z0-9-]{2,32}$/), model: z.string().trim().max(200).nullish() }),
]);

export async function POST(request: Request) {
  const parsed = Action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, detail: "Unknown action" }, { status: 400 });
  const a = parsed.data;
  if (a.action === "test") return Response.json(await testLocal(a.kind));
  if (a.action === "try") return Response.json(await tryHosted(a.provider, a.model));
  try {
    const r = await reloadLmStudio(a.model);
    return Response.json({ ok: true, detail: `LM Studio loaded ${r.model}${r.context ? ` with ${r.context.toLocaleString("en-US")} tokens of context` : ""}${r.seconds ? ` in ${r.seconds.toFixed(1)} s` : ""}`, ...r });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message });
  }
}
