// Recipes from the research (docs/research/fuobe-originals-recipes-5.json): a Soul look's template,
// triggers, LoRAs and sampler settings, and a motion's or effect's LoRAs. The harness applies them on
// the client so the recipe under test is explicit and can be varied (LoRAs off, strengths scaled),
// and records them with every result. Licence rules (§Build plan → "Licence rules for Originals")
// are applied here: a LoRA that may not run on a hosted service never goes to the cloud engine.
import fs from "node:fs";
import path from "node:path";
import { RESEARCH_DIR } from "./paths.mjs";

export const RECIPES_FILE = "docs/research/fuobe-originals-recipes-5.json";
export const LOOKS_FILE = "docs/research/parity-image-studios.json";

let cache = null;

/** The two research files (read once). */
export function research() {
  if (!cache) {
    const read = (f) => JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, path.basename(f)), "utf8"));
    cache = { recipes: read(RECIPES_FILE), looks: read(LOOKS_FILE) };
  }
  return cache;
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Soul v1 → "v1", Soul 2.0 → "v2". */
const family = (model) => (model === "soul-v2" ? "v2" : "v1");

/** The 139 Soul looks: id, slug ("v1-general"), name, family, category, and the research recipe. */
export function soulLooks() {
  const { recipes, looks } = research();
  const byId = new Map(recipes.presets.map((p) => [p.id, p]));
  return looks.soulPresets.map((p) => ({
    id: p.id,
    slug: `${family(p.model)}-${slug(p.name)}`,
    name: p.name,
    family: family(p.model),
    category: p.category,
    categories: p.categories ?? [],
    recipe: byId.get(p.id) ?? null,
  }));
}

export function soulLook(idOrSlug) {
  const key = String(idOrSlug).toLowerCase();
  return soulLooks().find((l) => l.id === key || l.slug === key || slug(l.name) === key) ?? null;
}

/** The research's motion / effect entry that lists this preset name (case-insensitive). */
export function motionEntry(name) {
  const want = String(name).toLowerCase();
  return research().recipes.motionsEffects.find((m) => m.presets.some((p) => p.toLowerCase() === want)) ?? null;
}

const HF_MAIN = /^(https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/)main\//;

/**
 * A LoRA's Hugging Face file at the commit the research pinned it to (loraLibrary[].revision, as the app's LoRA
 * library downloads it), so a push upstream can't change a baseline. Other links come back as they are.
 * @param {{ key?: string, file?: string, url?: string, revision?: string }} l
 */
export function pinnedLora(l) {
  const lib = research().recipes.loraLibrary.find((x) => (l.key && x.key === l.key) || (l.file && x.file === l.file));
  const rev = l.revision ?? lib?.revision;
  if (!rev || !HF_MAIN.test(l.url ?? "")) return { url: l.url };
  return { url: l.url.replace(HF_MAIN, `$1${rev}/`), version: rev };
}

/** Licence flags in one place: civitai "RentCivit"-only or explicit hostedOk:false never leave the user's GPU. */
const loraRecord = (l) => ({
  ...(l.key && { key: l.key }),
  name: l.name,
  file: l.file,
  ...pinnedLora(l),
  ...(l.hostedUrl && { hostedUrl: l.hostedUrl }),
  ...(l.version && { version: l.version }),
  ...(l.page && { page: l.page }),
  strength: l.strength ?? 1,
  trigger: l.trigger ?? "",
  ...(l.target && { target: l.target }),
  base: l.base,
  licence: l.licence,
  commercial: l.commercial !== false,
  hostedOk: l.hostedOk !== false,
  download: l.download ?? (/civitai\.com/.test(l.url ?? "") ? "civitai-token" : "direct"),
});

/**
 * A case's recipe as recorded with its results (null when the suite has none).
 * @param {"soul-look" | "motion" | "none"} kind
 * @param {{ look?: string, motion?: string, presetId?: string }} kase
 */
export function recipeFor(kind, kase) {
  if (kind === "soul-look" && kase.look) {
    const look = soulLook(kase.look);
    if (!look?.recipe) throw new Error(`No research recipe for the Soul look ${kase.look} (${RECIPES_FILE} → presets)`);
    const r = look.recipe;
    const soul = research().recipes.soul;
    const s = soul.settings?.comfyui ?? {};
    return {
      kind: "soul-look",
      source: `${RECIPES_FILE} → presets[id=${r.id}] (checked ${r.checked ?? "?"})`,
      look: { id: look.id, slug: look.slug, name: look.name, family: look.family, category: look.category },
      base: r.base,
      comfyWorkflow: r.comfyWorkflow,
      hostedEndpoint: r.hostedEndpoint,
      template: r.template,
      triggers: r.triggers ?? "",
      tail: r.tail,
      grade: r.grade ?? null,
      coverage: r.coverage,
      trainOwn: !!r.trainOwn,
      loras: (r.loras ?? []).map(loraRecord),
      settings: { steps: s.steps, cfg: s.cfg, sampler: s.sampler, scheduler: s.scheduler, shift: s.shift },
      commercialOk: r.commercialOk !== false,
      hostedOk: r.hostedOk !== false,
      needsCivitaiToken: !!r.needsCivitaiToken,
      ...(r.notes && { notes: r.notes }),
    };
  }
  if (kind === "motion" && kase.motion) {
    const m = motionEntry(kase.motion);
    if (!m) throw new Error(`No research entry for the motion or effect “${kase.motion}” (${RECIPES_FILE} → motionsEffects)`);
    return {
      kind: m.kind,
      motion: kase.motion,
      source: `${RECIPES_FILE} → motionsEffects (${m.presets.join(", ")})`,
      presets: m.presets,
      status: m.status,
      loras: (m.loras ?? []).map(loraRecord),
      hosted: m.hosted ?? null,
      localOnly: m.status === "local-only",
      bothEnginesToday: !!m.bothEnginesToday,
      ...(m.notes && { notes: m.notes }),
      ...(kase.presetId && { presetId: kase.presetId }),
    };
  }
  return null;
}

/** "{prompt}. Look words. Tail." with the user's words in, LoRA triggers in front ("hardflashy, …"). */
export function composeLookPrompt(template, prompt, triggers = "") {
  const words = String(prompt ?? "").trim().replace(/[.\s]+$/, "");
  const body = template?.includes("{prompt}") ? template.replace("{prompt}", words) : [words, template].filter(Boolean).join(". ");
  const t = String(triggers ?? "").trim();
  return t ? `${t}, ${body}` : body;
}

/** Which LoRA bases a model loads (a LoRA for another base is left out); models not listed take any. */
const MODEL_BASES = [
  [/^(oss-z-image-turbo|z-image-turbo-cloud|fuobe-soul|fuobe-soul-cinema)$/, /^z-image/],
  [/^(oss-qwen-image(-lightning)?|fuobe-soul-hd)$/, /^qwen-image-2512/],
  [/^(oss-wan22-14b(-fast)?|fuobe-dop)$/, /^wan2\.[12]/],
  // LTX-2.3 LoRAs (and LTX-2 19B ones, unverified there) on Fuobe DoP · LTX; LTX-2.5 LoRAs on the open LTX-2.5 graph.
  [/^fuobe-dop-ltx$/, /^ltx-2(\.3-|-19b)/],
  [/^oss-ltx25$/, /^ltx-2\.5/],
];

/** Can `modelId` load a LoRA trained for `base`? (true when either is unknown) */
export function baseFits(modelId, base) {
  if (!base || !modelId) return true;
  const row = MODEL_BASES.find(([m]) => m.test(modelId));
  return row ? row[1].test(base) : true;
}

/**
 * The LoRAs a variant sends on an engine, with what was left out and why.
 * @param {ReturnType<typeof recipeFor>} recipe
 * @param {{ loras?: "recipe" | "none" | object[], loraScale?: number }} variant
 * @param {"demo" | "open" | "cloud"} engine
 */
export function lorasFor(recipe, variant, engine, fallback = "none", modelId = "") {
  const pick = variant.loras ?? fallback;
  const notes = [];
  if (pick === "none") return { loras: [], notes };
  const list = pick === "recipe" ? (recipe?.loras ?? []) : pick.map((l) => ({ commercial: true, hostedOk: true, trigger: "", ...l }));
  const scale = variant.loraScale ?? 1;
  const out = [];
  for (const l of list) {
    if (!baseFits(modelId, l.base)) {
      notes.push(`${l.name ?? l.file} left out: it is a ${l.base} LoRA and ${modelId} can't load it`);
      continue;
    }
    if (engine === "cloud" && (!l.hostedOk || recipe?.localOnly)) {
      notes.push(`${l.name ?? l.file} left out on the cloud: its licence doesn't allow hosted use (open engine only)`);
      continue;
    }
    // A civitai download link answers 401 without the user's token, so a hosted service can't fetch it: the
    // cloud takes a mirrored copy (O1's hostedUrl) or a direct link (Hugging Face), never the civitai link.
    const cloudUrl = l.hostedUrl ?? (l.download === "civitai-token" ? null : l.url);
    if (engine === "cloud" && !cloudUrl) {
      notes.push(`${l.name ?? l.file} left out on the cloud: ${l.url ? "its civitai link needs a token, and there is no mirrored copy yet (O1)" : "no URL to send"}`);
      continue;
    }
    if (!l.commercial) notes.push(`${l.name ?? l.file} is non-commercial: a recipe with it can't become a default`);
    const url = engine === "cloud" ? cloudUrl : l.url;
    out.push({
      file: l.file,
      ...(url && { url }),
      strength: Math.round((l.strength ?? 1) * scale * 1000) / 1000,
      ...(l.trigger && { trigger: l.trigger }),
      ...(l.target && { target: l.target }),
    });
  }
  return { loras: out, notes, wanted: list.length };
}

/** Each LoRA's trigger once, in order ("hardflashy, emoessence"). */
export const triggersOf = (loras) => [...new Set(loras.map((l) => l.trigger).filter(Boolean))].join(", ");
