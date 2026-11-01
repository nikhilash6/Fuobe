import { connection } from "next/server";
import { requestViewer } from "@/server/auth";
import { getModel, MODELS } from "@/lib/catalog";
import { onEngine, runsOn } from "@/lib/catalog/engines";
import { ENGINE_MODELS } from "@/lib/catalog/faceless";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef, type Operation } from "@/lib/catalog/types";
import { findModels, MODEL_KINDS, toModelInfo } from "@/lib/model-list";
import { rowPrice } from "@/lib/model-rows";
import { AUDIO_STUDIO, DIALOGUE_STUDIO, EDIT_STUDIO, IMAGE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { provider } from "@/server/providers";
import { llmBackends } from "@/server/providers/llm";
import { offeredDefault, offeredModels, reachableDefault } from "@/server/model-access";
import { accountEngineMode } from "@/server/account-keys";
import { asAccount } from "@/server/generations";
import { engineMode, getSetting } from "@/server/settings";

/** A provider for one of its routes is set up. */
const connected = (m: ModelDef) => m.routes.some((r) => (r.provider === "llm" ? llmBackends(r).length > 0 : provider(r.provider).isConfigured()));

/**
 * How a run of the model goes today, the way chooseRoute decides: "real" on its provider, "demo"
 * (placeholder media, free: placeholder results on, or "auto" with no provider set up) or "refused" (placeholders
 * off and no provider: the run fails with "Connect … in Settings").
 */
function runsAs(m: ModelDef, demoMode: string): "real" | "demo" | "refused" {
  if (demoMode === "on") return "demo";
  if (connected(m)) return "real";
  return demoMode === "off" ? "refused" : "demo";
}

/** Per engine, the ids that clone voices (a dialogue studio's cloud default uses premade voices only). */
const cloning = (ids: { cloud?: string; open?: string }) => Object.fromEntries(Object.entries(ids).filter(([, id]) => id && getModel(id)?.options.voiceClone));

/**
 * The studios' own picks per engine: image, edit (images attached), video, audio (text to speech),
 * dialogue, clone (text to speech in the voice of a sample) and cloneDialogue (two speakers, each
 * cloned from a sample).
 */
const DEFAULTS: Record<string, { cloud?: string; open?: string }> = {
  image: IMAGE_STUDIO.defaultModels,
  edit: EDIT_STUDIO.defaultModels,
  video: VIDEO_STUDIO.defaultModels,
  audio: AUDIO_STUDIO.defaultModels,
  dialogue: DIALOGUE_STUDIO.defaultModels,
  clone: cloning({ cloud: ENGINE_MODELS.cloud.cloneNarration, open: ENGINE_MODELS.open.cloneNarration }),
  cloneDialogue: cloning(DIALOGUE_STUDIO.defaultModels),
};

/**
 * Models this install can run, for scripts and the `fuobe` CLI. Filters: kind, engine (open |
 * cloud), op, q (words that must all match), hidden=1 (chain helpers too). Models of an engine the
 * install has switched off (Settings → Engine mode) are left out. `defaults` are the studios' own
 * picks per engine (DEFAULTS); each item says whether its provider is `connected` and how a run
 * goes today (`runs`, which follows Settings → Demo mode). Models switched off in Settings → Models & licences
 * are left out, and a default that is off gives way to the next model that is on.
 */
export async function GET(request: Request) {
  await connection();
  const p = new URL(request.url).searchParams;
  const kind = p.get("kind") || undefined;
  if (kind && !MODEL_KINDS.includes(kind as MediaKind)) return Response.json({ error: `kind is one of ${MODEL_KINDS.join(", ")}` }, { status: 400 });
  const engine = p.get("engine") || undefined;
  if (engine && engine !== "open" && engine !== "cloud") return Response.json({ error: "engine is open or cloud" }, { status: 400 });
  const op = p.get("op") || undefined;
  if (op && !(op in OPERATION_LABELS)) return Response.json({ error: `Unknown operation ${op}` }, { status: 400 });
  // A guest runs open models on its own GPU: no cloud models, no demo. An account too, until it adds its own fal.ai or
  // Replicate key: then it gets those providers' paid models, each `connected` by its own keys (asAccount).
  const viewer = requestViewer(request);
  const account = viewer.kind === "account" ? viewer.account.id : null;
  const visitor = viewer.kind !== "owner";
  const list = () => {
    const mode = account ? accountEngineMode(account) : visitor ? "open" : engineMode();
    // A Fuobe Original runs on both engines: on a list for one engine (asked for, or the install's only one) it is
    // that engine's model (its routes, its price), else it is listed once with both.
    const only = (engine as Engine | undefined) ?? (mode === "both" ? undefined : mode);
    // The install's only engine counts as asked for: an Original's operations there are that engine's.
    // Settings → Models & licences: what is switched off isn't listed, and each model lists the routes that are on.
    const found = findModels(offeredModels(MODELS), { kind: kind as MediaKind | undefined, engine: only, op: op as Operation | undefined, q: p.get("q") ?? undefined, hidden: p.get("hidden") === "1" })
      .filter((m) => mode === "both" || runsOn(m, mode))
      .map((m) => (only ? onEngine(m, only) : m));
    // A default that is switched off gives way to the next model that is on and does the same job; an account's paid
    // default, to one its own keys can run.
    const pick = (id: string | undefined, e: Engine) => (account && e === "cloud" ? reachableDefault(offeredDefault(id, e), e, connected) : offeredDefault(id, e));
    const defaults = Object.fromEntries(
      Object.entries(DEFAULTS).map(([k, ids]) => [k, { ...(mode !== "open" && ids.cloud && { cloud: pick(ids.cloud, "cloud") }), ...(mode !== "cloud" && ids.open && { open: pick(ids.open, "open") }) }]),
    );
    const demoMode = visitor ? "off" : getSetting("demoMode");
    // The price of the day asked (a launch price while it lasts); the row keeps the launch price and its last day too.
    const now = Date.now();
    const items = found.map((m) => {
      const info = toModelInfo(m);
      const reach = account ? connected(m) : visitor || connected(m);
      return { ...info, price: rowPrice(info, now), connected: reach, runs: account ? (reach ? ("real" as const) : ("refused" as const)) : visitor ? ("real" as const) : runsAs(m, demoMode) };
    });
    return { engineMode: mode, demoMode, defaults, items };
  };
  return Response.json(account ? asAccount(account, list) : list());
}
