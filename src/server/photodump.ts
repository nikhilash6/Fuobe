import "server-only";
import { nanoid } from "nanoid";
import { getModel, getPreset } from "@/lib/catalog";
import { CAST_LOOK, CAST_SHEET_MODEL, castPrompt, SOUL_BUILDER_MODEL, type CastValues } from "@/lib/catalog/cinema";
import { soulRecipe } from "@/lib/catalog/soul";
import {
  castSheetModel,
  customPack,
  fashionBaseRequest,
  fashionOutfitRequest,
  fashionPhotosetRequests,
  getPack,
  getTemplate,
  MAX_PACK_REFS,
  planPhotodump,
  sheetFromReference,
  type Pack,
  type PhotoSubject,
  type PlanCaps,
} from "@/lib/catalog/packs";
import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { createPipeline } from "./chains";
import { db } from "./db";
import { getElement } from "./elements";
import { createGenerations, currentRequest, getGeneration, pickOutput, previewGeneration } from "./generations";
import { trashGenerations } from "./library";
import { engineMode } from "./settings";
import { isOffered } from "./model-access";
import { loadManifest } from "./providers/comfyui";

/**
 * Photodump / Instadump, Fashion Factory and Character Sheet runs: plan with the pure pack logic
 * (src/lib/catalog/packs.ts), validate every request, then create them as one batch so the feed and
 * the Library stack them under the run's name.
 */

// ---------------------------------------------------------------------------
// User packs (Instadump "Create pack")

interface PackRow {
  id: string;
  name: string;
  refs_json: string;
  created_at: number;
}

export interface UserPack {
  id: string;
  name: string;
  refs: string[];
  createdAt: number;
}

const toPack = (r: PackRow): UserPack => ({ id: r.id, name: r.name, refs: JSON.parse(r.refs_json) as string[], createdAt: r.created_at });

export function listUserPacks(): UserPack[] {
  return (db().prepare("SELECT * FROM photodump_packs ORDER BY created_at DESC").all() as PackRow[]).map(toPack);
}

export function getUserPack(id: string): UserPack | null {
  const r = db().prepare("SELECT * FROM photodump_packs WHERE id = ?").get(id) as PackRow | undefined;
  return r ? toPack(r) : null;
}

export function createUserPack(input: { name: string; refs: string[] }): UserPack {
  const name = input.name.trim();
  if (!name) throw new Error("Give the pack a name");
  if (name.length > 60) throw new Error("Keep the pack name under 60 characters");
  const refs = [...new Set(input.refs)];
  if (!refs.length) throw new Error("Upload your reference set up to 15 photos");
  if (refs.length > MAX_PACK_REFS) throw new Error(`A pack holds up to ${MAX_PACK_REFS} photos`);
  const row: PackRow = { id: `user-${nanoid(8)}`, name, refs_json: JSON.stringify(refs), created_at: Date.now() };
  db().prepare("INSERT INTO photodump_packs (id, name, refs_json, created_at) VALUES (@id, @name, @refs_json, @created_at)").run(row);
  return toPack(row);
}

export function deleteUserPack(id: string): boolean {
  return db().prepare("DELETE FROM photodump_packs WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Planning helpers

/** What this install can do, for the pure planners. */
export function planCaps(): PlanCaps {
  return { has: (id, engine) => !!getModel(id) && isOffered(id, engine) };
}

/** The engine a run uses: the one asked for, unless Settings locks the other. */
export function runEngine(asked: Engine): Engine {
  const mode = engineMode();
  return mode === "both" ? asked : mode;
}

export function subjectFor(input: { elementId?: string; selfie?: string }): PhotoSubject {
  if (input.elementId) {
    const el = getElement(input.elementId);
    if (!el) throw new Error("That character no longer exists");
    if (el.kind !== "character") throw new Error(`${el.name} isn't a character`);
    return { kind: "element", handle: el.handle, name: el.name, references: el.references.filter((r) => !/\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(r)), loras: el.loras };
  }
  if (input.selfie) return { kind: "selfie", url: input.selfie };
  throw new Error("Pick a character or add a selfie");
}

export function packFor(id: string): Pack {
  const builtIn = getPack(id);
  if (builtIn) return builtIn;
  const user = getUserPack(id);
  if (user) return customPack(user);
  throw new Error("That pack no longer exists");
}

/** The closest aspect ratio the model offers (by value), or the request's own when the model doesn't list any. */
export function fitAspect(modelId: string, aspect: string | undefined): string | undefined {
  const opts = getModel(modelId)?.options.aspectRatios;
  if (!aspect || !opts?.length || opts.includes(aspect)) return aspect;
  const val = (a: string) => {
    const [w, h] = a.split(":").map(Number);
    return w && h ? Math.log(w / h) : NaN;
  };
  const want = val(aspect);
  const best = opts.filter((o) => Number.isFinite(val(o))).sort((a, b) => Math.abs(val(a) - want) - Math.abs(val(b) - want))[0];
  return best ?? undefined;
}

const fitted = (r: GenerationRequest): GenerationRequest => ({ ...r, params: { ...r.params, aspectRatio: fitAspect(r.modelId, r.params?.aspectRatio) } });

/** Price a set of requests without starting them (the first error is returned, not thrown). */
export function previewRun(requests: GenerationRequest[], notes: string[] = []) {
  try {
    const previews = requests.map((r) => previewGeneration(fitted(r)));
    const first = previews[0];
    const costs = previews.map((p) => p.costUsd);
    // No aspect ratio setting (Qwen-Image-Edit 2511's open workflow), or a GPU graph that takes no size (Qwen-Image
    // 2.1's edit, whose model has ratios for text to image): the result follows image 1's shape — say so.
    const sized = first.route.provider !== "comfyui" || !!loadManifest().workflows.find((w) => w.id === first.route.endpoint)?.bindings.width;
    const fixedAspect = !first.model.options.aspectRatios?.length || !sized;
    const asked = requests.some((r) => r.params?.aspectRatio && r.params.aspectRatio !== "auto");
    return {
      modelId: first.model.id,
      modelName: first.model.name,
      count: previews.reduce((n, p) => n + p.outputs, 0),
      costUsd: costs.some((c) => c === null) ? null : Math.round(costs.reduce((a, b) => a! + b!, 0)! * 1000) / 1000,
      demo: previews.some((p) => p.demo),
      fixedAspect,
      notes: fixedAspect && asked ? [...notes, `${first.model.name} keeps the shape of your photo — the aspect ratio doesn't apply`] : notes,
    };
  } catch (e) {
    return { error: (e as Error).message, notes };
  }
}

/**
 * Independent requests created as one batch (validated together first, so a bad one starts nothing,
 * and a demo/real mix is refused), stacked in the Library under `title`.
 */
export function createBatch(requests: GenerationRequest[], title: string): { batchId: string; items: Generation[] } {
  if (!requests.length) throw new Error("Nothing to make");
  const { batchId, items } = createPipeline(requests.map((r, i) => ({ key: `p${i}`, request: { ...fitted(r), batchTitle: title } })));
  return { batchId, items };
}

/** The steps a generation waited for (its chain), by id. */
function dependsOn(id: string): string[] {
  const dep = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null } | undefined)?.depends_on;
  return dep ? (dep.startsWith("[") ? (JSON.parse(dep) as string[]) : [dep]) : [];
}

/**
 * Whether a chained step got its earlier steps' outputs: the runner writes them into its request when it
 * launches it, so a step that failed or was canceled while it waited still has only its own inputs.
 * (A text dependency fills the prompt instead and counts as given.)
 */
function gotChainInputs(g: Generation, before: Generation[]): boolean {
  const given = new Set(Object.values(g.request.inputs ?? {}).flat());
  return before.every((d, i) => {
    const slot = g.request.chain?.[i] ?? { slot: "images" as const };
    if (slot.slot === "prompt") return true;
    const url = pickOutput(d.outputs, slot)?.url;
    return !!url && given.has(url);
  });
}

/** The features whose photos can be retried from their run's grid (Photodump, Fashion Factory, Character Sheet). */
const RETRY_FEATURES = new Set(["photodump", "fashion", "character-sheet", "app:app-ai-influencer", "influencer"]);

/**
 * Run a failed or canceled photo again inside its run: the same request in the same batch (so the
 * run's grid, Download all and the Library stack keep it), and the failed one goes to the Trash.
 * A job that was one of several made from one request (×4 base shots on a one-per-job model) is
 * retried as one job of its own share of photos.
 */
export function retryPhoto(id: string): Generation[] {
  const g = getGeneration(id);
  if (!g) throw new Error("That photo is gone");
  if (!RETRY_FEATURES.has(g.feature)) throw new Error("This result isn't part of a photo run");
  if (g.status !== "failed" && g.status !== "canceled") throw new Error("Only a failed or canceled photo can be retried");
  // A photo made on a model Fuobe retired (Soul 2.0 for a Cast sheet, the AI Influencer app's model) runs again on the
  // one that replaced it (src/lib/catalog/replaced.ts), sized for that model.
  const request = currentRequest(g.request).request;
  // A chained photo (the AI Influencer builder's face pass) whose earlier step failed never got that step's
  // image: both run again, chained as before.
  const deps = dependsOn(id);
  const before = deps.map((d) => getGeneration(d, { includeDeleted: true }));
  if (before.some((d) => d?.status !== "succeeded")) {
    const step = before[0];
    if (deps.length !== 1 || !step || dependsOn(step.id).length || (step.status !== "failed" && step.status !== "canceled")) throw new Error("The step before it didn't finish — press Generate to run both again");
    const { items } = createPipeline(
      [
        { key: "before", request: currentRequest(step.request).request },
        { key: "photo", request, after: "before" },
      ],
      g.batchId ? { batchId: g.batchId } : {},
    );
    trashGenerations([step.id, id]);
    return items;
  }
  // Its earlier steps finished, but it never launched (it failed or was canceled while it waited): it waits
  // for them again, so the runner hands it their outputs (the sheet goes in as image 1) and launches it.
  if (deps.length && !gotChainInputs(g, before as Generation[])) {
    const items = createGenerations(fitted(request), { ...(g.batchId && { batchId: g.batchId }), dependsOn: deps });
    trashGenerations([id]);
    return items;
  }
  const req = fitted(request);
  const p = previewGeneration(req);
  const per = p.jobs > 1 ? Math.max(1, Math.round(p.outputs / p.jobs)) : undefined;
  const items = createGenerations(per ? { ...req, params: { ...req.params, numOutputs: per } } : req, g.batchId ? { batchId: g.batchId } : {});
  trashGenerations([id]);
  return items;
}

// ---------------------------------------------------------------------------
// Photodump

export interface PhotodumpRun {
  packId: string;
  engine: Engine;
  elementId?: string;
  selfie?: string;
  aspectRatio?: string;
  modelId?: string;
}

function photodumpPlan(input: PhotodumpRun) {
  const pack = packFor(input.packId);
  const subject = subjectFor(input);
  return { pack, subject, plan: planPhotodump({ pack, subject, engine: runEngine(input.engine), aspectRatio: input.aspectRatio, modelId: input.modelId }, planCaps()) };
}

export function previewPhotodump(input: PhotodumpRun) {
  try {
    const { plan } = photodumpPlan(input);
    return previewRun(plan.requests, plan.notes);
  } catch (e) {
    return { error: (e as Error).message, notes: [] };
  }
}

export function createPhotodump(input: PhotodumpRun) {
  const { pack, subject, plan } = photodumpPlan(input);
  const who = subject.kind === "element" ? subject.name : "Selfie";
  const { batchId, items } = createBatch(plan.requests, `${pack.name} · ${who}`);
  return { batchId, items, notes: plan.notes, modelId: plan.modelId };
}

// ---------------------------------------------------------------------------
// Fashion Factory

export type FashionRun =
  | { step: "base"; templateId: string; elementId: string; engine: Engine }
  | { step: "outfit"; templateId: string; base: string; garment: string; engine: Engine; modelId?: string }
  | { step: "photoset"; templateId: string; dressed: string; engine: Engine; modelId?: string };

function fashionRequests(input: FashionRun): { requests: GenerationRequest[]; title: string } {
  const t = getTemplate(input.templateId);
  if (!t) throw new Error("Template required");
  const engine = runEngine(input.engine);
  if (input.step === "base") {
    const subject = subjectFor({ elementId: input.elementId });
    if (subject.kind !== "element") throw new Error("Pick or create a character first");
    return { requests: [fashionBaseRequest(t, subject, engine, planCaps())], title: `${t.name} · ${subject.name}` };
  }
  // A model switched off in Settings → Models & licences (or Fuobe Try-On with its try-on LoRA off) moves on to the next.
  if (input.step === "outfit") return { requests: [fashionOutfitRequest(t, input.base, input.garment, engine, input.modelId, planCaps())], title: `${t.name} · outfit` };
  return { requests: fashionPhotosetRequests(t, input.dressed, engine, input.modelId, planCaps()), title: `${t.name} · photoset` };
}

export function previewFashion(input: FashionRun) {
  try {
    return previewRun(fashionRequests(input).requests);
  } catch (e) {
    return { error: (e as Error).message, notes: [] };
  }
}

export function createFashion(input: FashionRun) {
  const { requests, title } = fashionRequests(input);
  if (requests.length === 1) {
    // One request (base shots ×4, outfit ×2): the generations share a batch on their own.
    const items = createGenerations({ ...fitted(requests[0]), batchTitle: title });
    return { batchId: items[0]?.batchId ?? items[0]?.id, items };
  }
  return createBatch(requests, title);
}

// ---------------------------------------------------------------------------
// Character Sheet

const AI_INFLUENCER = "app-ai-influencer";

export type SheetRun =
  | { mode: "reference"; engine: Engine; images: string[]; details?: string }
  | { mode: "cast"; engine: Engine; cast: CastValues; details?: string }
  | { mode: "describe"; engine: Engine; prompt: string };

function sheetRequest(input: SheetRun): { request: GenerationRequest; notes: string[] } {
  const engine = runEngine(input.engine);
  if (input.mode === "reference") return sheetFromReference(input.images, engine, input.details);
  if (input.mode === "cast") {
    const modelId = castSheetModel(engine, planCaps());
    const m = getModel(modelId);
    const aspect = m?.options.aspectRatios?.includes("16:9") ? "16:9" : undefined;
    const resolution = m?.options.resolutions?.includes("2K") ? "2K" : m?.options.resolutions?.includes("1080p") ? "1080p" : undefined;
    // Fuobe Soul runs on both engines (the run's engine picks its half) and draws the cast in Cinema's casting look; the
    // Soul Cast sheet graph is Soul's own base, so the look's words and LoRAs go on it too (as Cinema's Soul Cast does).
    const soul = modelId === SOUL_BUILDER_MODEL;
    const sheet = modelId === CAST_SHEET_MODEL ? soulRecipe("soul", castPrompt(input.cast, input.details), { look: CAST_LOOK }) : undefined;
    return {
      request: {
        feature: "character-sheet",
        modelId,
        ...(soul && { engine, presetId: CAST_LOOK }),
        prompt: sheet?.prompt ?? castPrompt(input.cast, input.details),
        ...(sheet?.loras.length && { loras: sheet.loras }),
        params: { numOutputs: 1, ...(aspect && { aspectRatio: aspect }), ...(resolution && { resolution }) },
      },
      notes: modelId === "nano-banana-pro" ? ["Fuobe Soul is switched off in Settings → Models & licences — Nano Banana Pro draws the sheet"] : [],
    };
  }
  // A description: the AI Influencer app (Fuobe Soul in the cloud, the Soul Cast sheet graph on your GPU).
  if (!input.prompt.trim()) throw new Error("Describe your character first");
  const route = engine === "open" ? getPreset(AI_INFLUENCER)?.open : getPreset(AI_INFLUENCER)?.cloud;
  const modelId = route?.modelId ?? (engine === "open" ? "oss-zimage-soul-cast" : SOUL_BUILDER_MODEL);
  return {
    // Fuobe Soul runs on both engines: the app's cloud route names it, so the run says which.
    request: { feature: "app:app-ai-influencer", presetId: AI_INFLUENCER, modelId, ...(modelId === SOUL_BUILDER_MODEL && { engine }), prompt: input.prompt.trim() },
    notes: [],
  };
}

export function previewSheet(input: SheetRun) {
  try {
    const { request, notes } = sheetRequest(input);
    return previewRun([request], notes);
  } catch (e) {
    return { error: (e as Error).message, notes: [] };
  }
}

export function createSheet(input: SheetRun) {
  const { request, notes } = sheetRequest(input);
  const items = createGenerations(fitted({ ...request, title: "Character sheet" }));
  return { items, notes };
}
