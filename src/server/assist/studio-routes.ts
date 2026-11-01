import "server-only";
import fs from "node:fs";
import type { PlannedJob } from "@/lib/assist";
import { dubLanguageFor, facelessStyleFor, shortsPresetFor } from "@/lib/assist-studios";
import { BURN_MODELS, burnPricePerMinute, burnRequest, CAPTIONS_FEATURE, lookFor, OPEN_FONT_SIZE, styleById, transcribeRequest, type BurnRoute, type CaptionLook } from "@/lib/av/captions";
import { DUB_STEP_MODELS, prepareSteps, translateKey, type OneShotModel } from "@/lib/av/dub";
import { getModel } from "@/lib/catalog";
import { routesFor } from "@/lib/catalog/plan";
import { defaultSettings, genreInfo, PART_LABELS, type EpisodeAspect, type EpisodeSettings, type NarratorVoice, type StepPart } from "@/lib/catalog/faceless";
import { AD_RATIOS, emptyKit, type BrandKit, type Product } from "@/lib/catalog/marketing";
import { lookFromPreset, SHORTS, SHORTS_MODELS, type ShortsLook } from "@/lib/catalog/shorts";
import type { Engine, GenerationRequest, MediaKind, Operation } from "@/lib/catalog/types";
import { modeHref } from "@/lib/hubs";
import { imageSize } from "@/lib/image-size";
import { clampLayers, decomposeCost, defaultLayers, TOOL_MODELS, TOOL_LABELS, type LayerJobInput } from "@/lib/layers";
import { createBatch, estimateBatch, listCreatives, type BatchInput } from "../ads";
import { createManualBrand, createProduct, DuplicateProductError, getBrand, getProduct, heuristicManualKit, listProducts, updateProduct } from "../brand";
import { createPipeline, providerNames, type PipelineStep } from "../chains";
import { createDubSession, previewDub, videoLength, type CreateDubInput } from "../dub";
import { createChannel, createEpisode, estimateEpisode, listChannels } from "../faceless";
import { chooseRoute } from "../generations";
import { createProject, deleteProject, FileUrl, jobSteps, startJob } from "../layers";
import { firstOn } from "../model-access";
import { engineMode } from "../settings";
import { createSession, estimateWith, sourceInfo, type ShortsBody, type SourceInfo } from "../shorts";
import { absolutePath, getAsset } from "../storage";
import type { ToolContext } from "./define";
import { planSteps, STUDIO_ROUTES, type AdsToolInput, type CaptionsToolInput, type DubToolInput, type FacelessToolInput, type LayersToolInput, type RestyleToolInput, type StudioRoute } from "./studio-tools";

/**
 * The Assist / MCP studio tools, wired to the studios' own server modules: each adapter turns a tool
 * call into the studio's input, prices it with the studio's estimate, refuses what the studio can't
 * take (the tool then runs its own pipeline in the Library) and starts the job there, so it opens as
 * a Layers project, a Shorts session, a dub to review, a Faceless episode, an Ads Studio batch or the
 * Captions editor. Imported for its effect by tools.ts (and so by the MCP server).
 */

const engineOf = (ctx: ToolContext): Engine => (engineMode() === "both" ? ctx.engine : (engineMode() as Engine));

// ---------------------------------------------------------------------------
// Files

/** A file saved in Fuobe, read from disk (null: not an /api/files/ path, or gone). */
function localFile(ref: string, maxBytes?: number): Buffer | null {
  if (!ref.startsWith("/api/files/")) return null;
  try {
    const abs = absolutePath(decodeURIComponent(ref.slice("/api/files/".length)));
    if (!maxBytes) return fs.readFileSync(abs);
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, fs.fstatSync(fd).size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Clip headers by URL: a call is checked, priced and run, and a stored file never changes, so it's read once. */
const clips = new Map<string, SourceInfo | null>();

function clipInfo(ref: string): SourceInfo | null {
  if (!clips.has(ref)) {
    const data = localFile(ref);
    clips.set(ref, data ? sourceInfo(data) : null);
    if (clips.size > 32) clips.delete(clips.keys().next().value!);
  }
  return clips.get(ref)!;
}

/** The name the file was uploaded with, without its extension ("beach day"). */
function fileTitle(ref: string): string | undefined {
  const id = /\/([A-Za-z0-9_-]+)\.[a-z0-9]+$/i.exec(ref)?.[1];
  const name = id ? getAsset(id)?.name : null;
  return name?.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || undefined;
}

/** A description's first words as a name, capitalised ("claymation, warm light" → "Claymation, warm light"; longer ones end in "…"). */
const shortName = (words: string, max = 40) => {
  const s = words.replace(/\s+/g, " ").trim();
  const cut = s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}…` : s;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
};

type Checked<T> = T | { problem: string };
const problemOf = <T extends object>(c: Checked<T>): string | null => ("problem" in c ? c.problem : null);
function ok<T extends object>(c: Checked<T>): T {
  if ("problem" in c) throw new Error(c.problem);
  return c;
}

// ---------------------------------------------------------------------------
// Layers: a project on the image, decomposed at once (src/server/layers.ts)

/** The shape the Layers editor sends with a job ("3:2", or "1.78:1" for odd sizes). */
function ratioOf(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h) || 1;
  return w / g <= 64 && h / g <= 64 ? `${w / g}:${h / g}` : `${(w / h).toFixed(2)}:1`;
}

function layersJob(i: LayersToolInput, ctx: ToolContext): Checked<{ input: LayerJobInput; width: number; height: number; layers: number }> {
  const engine = engineOf(ctx);
  if (!FileUrl.safeParse(i.image).success) return { problem: "Layers opens pictures saved in Fuobe (an upload or a result)" };
  // PNG, JPEG, WebP and GIF keep their size in the first bytes; SVG in its root tag.
  const head = localFile(i.image, 512 * 1024);
  if (!head) return { problem: "That image is gone — upload it again" };
  const size = imageSize(head);
  if (!size) return { problem: "Layers couldn't read that image's size (PNG, JPEG, WebP, GIF or SVG)" };
  const models = TOOL_MODELS.decompose[engine];
  if (i.model_id && !models.includes(i.model_id)) return { problem: `${getModel(i.model_id)?.name ?? i.model_id} isn't one of Layers' decomposition models on this engine` };
  const modelId = i.model_id ?? firstOn(models, engine)!;
  const layers = clampLayers(modelId, i.layers ?? defaultLayers("decompose", modelId));
  return {
    width: size.width,
    height: size.height,
    layers,
    input: {
      tool: "decompose",
      engine,
      modelId,
      image: i.image,
      prompt: i.focus?.trim() || undefined,
      frame: [0, 0, size.width, size.height],
      label: TOOL_LABELS.decompose,
      settings: { layers, resolution: "1K", mode: "standard", aspect: ratioOf(size.width, size.height) },
    },
  };
}

const layersRoute: StudioRoute<LayersToolInput> = {
  studio: "Layers",
  page: "/layers",
  refuse: (i, ctx) => problemOf(layersJob(i, ctx)),
  plan: (i, ctx) => {
    const job = ok(layersJob(i, ctx));
    // Priced like the editor: Seedream bills each layer it returns (decomposeCost), up to the count asked for.
    const usd = decomposeCost(job.input.modelId!, job.layers, "1K");
    return planSteps("split_layers", jobSteps(job.input)).map((j) =>
      j.op === "layers" ? { ...j, note: `Layer decomposition · up to ${job.layers} layers`, ...(!j.demo && !j.error && usd !== null && { costUsd: usd }) } : j,
    );
  },
  async run(i, ctx) {
    const job = ok(layersJob(i, ctx));
    const view = createProject({ source: i.image, width: job.width, height: job.height });
    const id = view.project.id;
    try {
      const started = startJob(id, job.input);
      return {
        ids: started.generationIds.slice(-1),
        href: `/layers/${id}`,
        info: { project: id, note: "The layers are laid out on the project when it's opened in Layers; each can then be moved, edited, relit or exported." },
      };
    } catch (e) {
      deleteProject(id);
      throw e;
    }
  },
};

// ---------------------------------------------------------------------------
// Shorts Studio: a session on the clip (src/server/shorts.ts)

/** The look: a preset the words name outright, else the words themselves (with any reference images). */
function shortsLook(i: RestyleToolInput): ShortsLook {
  const refs = [...new Set(i.references ?? [])].slice(0, SHORTS.maxReferences);
  const preset = shortsPresetFor(i.style);
  if (preset && !refs.length) return lookFromPreset(preset);
  const words = preset?.look ?? i.style.trim();
  return { presetId: "assist", name: preset?.name ?? shortName(i.style), look: words, ...(refs.length && { references: refs }), custom: true, described: true };
}

function shortsJob(i: RestyleToolInput, ctx: ToolContext): Checked<{ body: ShortsBody; info: SourceInfo; notes: string[] }> {
  const engine = engineOf(ctx);
  if (!i.video.startsWith("/api/files/")) return { problem: "Shorts Studio restyles clips saved in Fuobe (an upload or a result)" };
  if (i.model_id && !SHORTS_MODELS[engine].includes(i.model_id)) return { problem: `${getModel(i.model_id)?.name ?? i.model_id} isn't one of Shorts Studio's restyle models on this engine` };
  const info = clipInfo(i.video);
  if (!info) return { problem: "That clip is gone — upload it again" };
  if (!info.duration) return { problem: "Shorts Studio couldn't read how long the clip is (it reads MP4, MOV and WebM)" };
  if (info.duration < SHORTS.minSeconds - 0.05) return { problem: `Shorts Studio restyles clips of ${SHORTS.minSeconds} s or more` };
  const notes: string[] = [];
  const end = Math.min(info.duration, SHORTS.maxSeconds);
  if (end < info.duration) notes.push(`Shorts Studio restyles up to ${SHORTS.maxSeconds / 60} minutes: the first ${SHORTS.maxSeconds / 60} of this clip`);
  const look = shortsLook(i);
  const body: ShortsBody = {
    engine,
    presetId: look.presetId,
    look,
    source: { url: i.video, name: fileTitle(i.video), duration: info.duration, width: info.width, height: info.height },
    range: { start: 0, end },
    // The clip keeps its orientation.
    aspectRatio: info.width && info.height && info.width > info.height ? "16:9" : "9:16",
    language: "auto",
    modelId: i.model_id,
  };
  try {
    notes.push(...estimateWith(body, info).notes);
  } catch (e) {
    return { problem: (e as Error).message };
  }
  return { body, info, notes };
}

const shortsRoute: StudioRoute<RestyleToolInput> = {
  studio: "Shorts Studio",
  page: "/shorts",
  refuse: (i, ctx) => problemOf(shortsJob(i, ctx)),
  plan: (i, ctx) => {
    const { body, info, notes } = ok(shortsJob(i, ctx));
    const est = estimateWith(body, info);
    const modelId = body.modelId ?? firstOn(SHORTS_MODELS[body.engine], body.engine)!;
    const job: PlannedJob = {
      tool: "restyle_footage",
      modelId,
      modelName: getModel(modelId)?.name ?? modelId,
      kind: "video",
      op: "v2v",
      prompt: body.look!.look,
      count: 1,
      costUsd: est.costUsd,
      demo: est.demo,
      note: [`${est.segments} segment${est.segments === 1 ? "" : "s"} of ${est.seconds} s, stitched under the original sound`, ...notes].join(" · "),
      atomic: true,
    };
    return [job];
  },
  async run(i, ctx) {
    const { body, info } = ok(shortsJob(i, ctx));
    const s = await createSession(body, info);
    return {
      ids: [s.stitches[0].final],
      href: `/shorts/${s.id}`,
      info: { session: s.id, segments: s.segments.length, note: "Each segment can be regenerated or swapped for another take in Shorts Studio, then stitched again." },
    };
  },
};

// ---------------------------------------------------------------------------
// Translate & dub: a dub session, reviewed in Audio → Translate (src/server/dub.ts)

const ONE_SHOT_NAMES: Record<OneShotModel, string> = { "heygen-translate": "HeyGen Translate", "heygen-translate-fast": "HeyGen Translate Speed", "elevenlabs-dubbing": "ElevenLabs Dubbing" };

/**
 * Why the review flow's first stage (voice, transcript, translations) can't start as one pipeline, or
 * null: a step no provider can run, or a demo step among real ones, which createPipeline refuses (a
 * fal key without Claude or a local model: the translation would be a demo while the rest runs for real).
 */
function prepareProblem(input: Pick<CreateDubInput, "engine" | "video" | "source" | "targets">): string | null {
  const modes: { label: string; needs: string; demo: boolean }[] = [];
  for (const s of prepareSteps({ engine: input.engine, video: input.video, source: input.source, targets: input.targets })) {
    const m = getModel(s.request.modelId);
    if (!m || !s.request.op) continue;
    const label = s.request.step?.label ?? s.key;
    const needs = providerNames(m, s.request.op);
    try {
      modes.push({ label, needs, demo: chooseRoute(routesFor(m, s.request.op)).demo });
    } catch {
      return `${label} needs ${needs}`;
    }
  }
  const demo = modes.find((x) => x.demo);
  return demo && modes.some((x) => !x.demo) ? `${demo.label} would run as a demo (it needs ${demo.needs}) while the other steps run for real` : null;
}

/** `blocked`: the studio takes the call but can't start it (shown on the card, thrown on run); `notes` go on the card. */
function dubJob(i: DubToolInput, ctx: ToolContext): Checked<{ input: CreateDubInput; names: string[]; notes: string[]; blocked?: string }> {
  const engine = engineOf(ctx);
  if (!i.video.startsWith("/api/files/")) return { problem: "Translate & dub works on videos saved in Fuobe (an upload or a result)" };
  const asked = [...new Set(i.languages.map((l) => l.trim()).filter(Boolean))].slice(0, 4);
  if (!asked.length) return { problem: "Name the language to dub into" };
  const langs = asked.map((l) => ({ asked: l, lang: dubLanguageFor(l) }));
  const unknown = langs.find((l) => !l.lang);
  if (unknown) return { problem: `Translate & dub doesn't list ${unknown.asked}` };
  if (i.review === false && engine === "open") return { problem: "Dubbing in one go is a cloud service; on the open engine Translate & dub reviews the lines first" };
  const oneShot: OneShotModel = i.lipsync === false ? "elevenlabs-dubbing" : "heygen-translate";
  const base = {
    engine,
    video: i.video,
    title: fileTitle(i.video),
    source: (i.source_language && dubLanguageFor(i.source_language)?.code) || "auto",
    targets: [...new Set(langs.map((l) => l.lang!.code))],
  };
  const steps: CreateDubInput = { ...base, mode: "steps" };
  const once: CreateDubInput = { ...base, mode: "oneshot", model: oneShot };
  const names = langs.map((l) => l.lang!.name);
  const priced = (input: CreateDubInput): string | null => {
    try {
      previewDub(input);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  if (i.review === false) {
    const problem = priced(once);
    return problem ? { problem } : { input: once, names, notes: [] };
  }
  const problem = priced(steps);
  if (problem) return { problem };
  // The review flow needs its first stage to run all for real (or all as a demo). When it can't and the
  // review wasn't asked for outright, the cloud dubs in one go instead, still as a dub in the studio.
  const why = prepareProblem(steps);
  if (!why) return { input: steps, names, notes: [] };
  const stuck = `Reviewing the lines can't start: ${why}`;
  if (engine === "cloud" && i.review === undefined && !priced(once)) {
    return { input: once, names, notes: [`${stuck} — so it dubs in one go with ${ONE_SHOT_NAMES[oneShot]} (connect it in Settings to review every line first)`] };
  }
  return { input: steps, names, notes: [], blocked: `${stuck} — connect it in Settings${engine === "cloud" ? ", or dub in one go (review: false)" : ", or turn on demo mode to try it all as a demo"}` };
}

const dubRoute: StudioRoute<DubToolInput> = {
  studio: "Translate & dub",
  page: modeHref("audio", "translate"),
  refuse: (i, ctx) => problemOf(dubJob(i, ctx)),
  plan: (i, ctx) => {
    const { input, names, notes, blocked } = ok(dubJob(i, ctx));
    const price = previewDub(input);
    const oneshot = input.mode === "oneshot";
    const extra = price.unpriced.length ? ` · plus ${price.unpriced.join(" and ")} at the provider's own rate` : "";
    const note = oneshot
      ? `Dubbed in one go${input.model === "elevenlabs-dubbing" ? ", no lip re-sync" : ", lip-synced"}${extra}`
      : `Transcribe and translate (${price.steps} steps)${extra} · then review every line and voice it in Translate & dub, priced there`;
    const job: PlannedJob = {
      tool: "dub_video",
      modelId: input.model ?? DUB_STEP_MODELS[input.engine].translate,
      modelName: oneshot ? ONE_SHOT_NAMES[input.model!] : "Translate & dub",
      kind: oneshot ? "video" : "text",
      op: oneshot ? "dub" : "translate",
      prompt: `Into ${names.join(", ")}`,
      count: input.targets.length,
      costUsd: price.costUsd,
      demo: price.demo,
      note: [note, ...notes].join(" · "),
      atomic: true,
      ...(blocked && { error: blocked }),
    };
    return [job];
  },
  async run(i, ctx) {
    const { input, notes, blocked } = ok(dubJob(i, ctx));
    if (blocked) throw new Error(blocked);
    const s = createDubSession(input);
    const steps = s.mode === "steps";
    const ids = steps ? s.targets.map((c) => s.prepare?.[translateKey(c)]).filter((x): x is string => !!x) : Object.values(s.oneshot ?? {});
    return {
      ids,
      href: modeHref("audio", "translate", { dub: s.id }),
      info: {
        dub: s.id,
        // Why it dubs in one go when the review was the default (tell the user).
        ...(notes.length && { changed: notes.join(" ") }),
        ...(steps && {
          next: `Once the translation is ready, the user reviews every line in Translate & dub and presses Voice${i.lipsync === false ? " (with Lip sync switched off)" : ""}; the dubbed video is made then.`,
        }),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Faceless Studio: an episode on the "Assist" channel (src/server/faceless.ts)

/** The channel Assist's episodes go to, made the first time (no avatar is drawn for it). */
export const ASSIST_CHANNEL = "Assist";

async function assistChannel(engine: Engine): Promise<string> {
  const found = listChannels().find((c) => c.name === ASSIST_CHANNEL);
  if (found) return found.id;
  const c = await createChannel({ idea: "Narrated episodes made from Fuobe Assist chats", genre: "education", engine, name: ASSIST_CHANNEL, avatar: false });
  return c.id;
}

function facelessJob(i: FacelessToolInput, ctx: ToolContext): Checked<{ settings: EpisodeSettings; blocks: { narration: string; visual: string }[]; title: string }> {
  const engine = engineOf(ctx);
  const aspect = (i.aspect_ratio ?? "9:16") as EpisodeAspect;
  if (aspect !== "9:16" && aspect !== "16:9") return { problem: "Faceless Studio makes 16:9 and 9:16 episodes" };
  const styleId = i.style_id ?? facelessStyleFor(i.style);
  if (!styleId) return { problem: `“${shortName(i.style, 60)}” isn't one of Faceless Studio's styles (pass style_id to open it there)` };
  const blocks = i.scenes.filter((s) => s.visual.trim() || s.narration.trim()).slice(0, 8);
  if (blocks.length < 2) return { problem: "Give at least 2 scenes" };
  const sample = i.voice_sample?.trim();
  const base = defaultSettings(engine, genreInfo("education"));
  const voice: NarratorVoice | null = sample ? { kind: "sample", url: sample } : engine === "cloud" && i.voice ? { kind: "preset", id: i.voice } : base.voice;
  return {
    settings: { ...base, aspect, styleId, voice },
    blocks: blocks.map((b) => ({ narration: b.narration, visual: b.visual })),
    title: i.title?.trim() || blocks[0].narration.trim().slice(0, 80) || "Faceless episode",
  };
}

const PART_JOB: Record<StepPart, { kind: MediaKind; op: Operation }> = {
  still: { kind: "image", op: "t2i" },
  clip: { kind: "video", op: "i2v" },
  join: { kind: "video", op: "concat" },
  narration: { kind: "audio", op: "tts" },
  music: { kind: "audio", op: "music" },
  mix: { kind: "video", op: "mux" },
  words: { kind: "text", op: "transcribe" },
  captions: { kind: "video", op: "captions" },
};

const facelessRoute: StudioRoute<FacelessToolInput> = {
  studio: "Faceless Studio",
  page: "/faceless",
  refuse: (i, ctx) => problemOf(facelessJob(i, ctx)),
  plan: (i, ctx) => {
    const { settings, blocks, title } = ok(facelessJob(i, ctx));
    // The studio's own estimate: every step of the episode graph, by part (pictures, animation, narration…).
    const est = estimateEpisode({ kind: "faceless", settings, blocks, genre: "education" });
    const parts = Object.entries(est.estimate.parts) as [StepPart, number][];
    const jobs: PlannedJob[] = parts.map(([part, usd], k) => ({
      tool: "faceless_episode",
      modelId: `faceless-${part}`,
      modelName: PART_LABELS[part],
      ...PART_JOB[part],
      prompt: k === 0 ? `${title} · ${est.blocks} scenes, about ${Math.round(est.seconds)} s` : PART_LABELS[part],
      count: part === "still" ? est.blocks : 1,
      costUsd: usd,
      demo: est.demo,
      note: `Faceless Studio · ${PART_LABELS[part]}`,
      atomic: true,
    }));
    if (!jobs.length) jobs.push({ tool: "faceless_episode", modelId: "faceless", modelName: "Faceless episode", kind: "video", op: "concat", prompt: title, count: 1, costUsd: null, demo: est.demo, atomic: true });
    if (est.error) jobs[0] = { ...jobs[0], error: est.error };
    if (est.notes?.length) jobs[jobs.length - 1] = { ...jobs[jobs.length - 1], note: `${jobs[jobs.length - 1].note} · ${est.notes.join(" ")}` };
    return jobs;
  },
  async run(i, ctx) {
    const { settings, blocks, title } = ok(facelessJob(i, ctx));
    const channelId = await assistChannel(settings.engine);
    const ep = createEpisode({ kind: "faceless", channelId, topic: title, settings, blocks, autoRender: true, saveLook: false });
    const href = `/faceless/${channelId}/${ep.id}`;
    if (ep.status !== "rendering") throw new Error(`${ep.error ?? "The episode couldn't start"} — it's in Faceless Studio to fix: ${href}`);
    const stills = Object.entries(ep.plan?.ids ?? {})
      .filter(([k]) => k.startsWith("still-"))
      .map(([, id]) => id);
    return {
      ids: stills.slice(0, 8),
      href,
      info: {
        episode: ep.id,
        channel: channelId,
        style: settings.styleId,
        note: "The pictures and the narration come first; once the narration is timed, each scene is animated and cut to its lines, then music and subtitles are mixed in. The finished episode is in Faceless Studio.",
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Ads Studio: a batch for a product, on its brand kit (src/server/ads.ts)

/** The kit "Describe your business" would make from the brief, before the LLM fills it in (for pricing only). */
function draftKit(brief: string, name: string): BrandKit {
  const h = heuristicManualKit(brief);
  return {
    ...emptyKit(h.name || name),
    tagline: h.tagline,
    overview: brief,
    colors: h.colors ?? [],
    fonts: h.fonts ?? {},
    aesthetics: h.aesthetics ?? [],
    tone: h.tone ?? [],
    id: "draft",
    status: "ready",
    source: "manual",
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A product's name from the brief: its first words ("Oat milk for runners"). */
const productName = (brief: string) => shortName(brief.split(/[.,;:!?\n—–]/)[0] || brief, 48).replace(/…$/, "");

function adsJob(i: AdsToolInput, ctx: ToolContext): Checked<{ input: BatchInput; brand: BrandKit | null; product: Product | null; draft: { brand: BrandKit; product: Product | null }; name: string }> {
  const engine = engineOf(ctx);
  const ratios = [...new Set(i.aspect_ratios?.length ? i.aspect_ratios : ["4:5"])];
  const odd = ratios.filter((r) => !(AD_RATIOS as readonly string[]).includes(r));
  if (odd.length) return { problem: `Ads Studio makes 1:1, 4:5 and 9:16 ads (not ${odd.join(", ")})` };
  if (i.product_image && !i.product_image.startsWith("/api/files/")) return { problem: "Ads Studio uses product photos saved in Fuobe (an upload or a result)" };
  const brand = i.brand_id ? getBrand(i.brand_id) : null;
  if (i.brand_id && !brand) return { problem: "That brand kit isn't in Ads Studio" };
  if (brand?.status === "researching") return { problem: "That brand's research is still running" };
  const product = i.product_id ? getProduct(i.product_id) : null;
  if (i.product_id && (!product || (brand && product.brandId !== brand.id))) return { problem: "That product isn't in Ads Studio" };
  const name = product?.name ?? productName(i.brief);
  // Before anything is saved, the price is worked out on stand-ins: the kit a description gives, the product as it'll be.
  const kit = brand ?? (product?.brandId ? getBrand(product.brandId) : null);
  const draftBrand: BrandKit = kit ?? draftKit(i.brief, name);
  const draftProduct: Product = product ?? { id: "draft", brandId: kit?.id ?? null, name, description: i.brief, sellingPoints: [], images: i.product_image ? [i.product_image] : [], createdAt: 0, updatedAt: 0 };
  const direction = [i.brief.trim(), i.headline && `Headline: “${i.headline.trim()}”`, i.cta && `Call to action: “${i.cta.trim()}”`].filter(Boolean).join(". ").slice(0, 1000);
  const input: BatchInput = {
    brandId: kit?.id ?? "draft",
    engine,
    // Every ad comes in 1:1, 4:5 and 9:16 from Fuobe's compositor, its headline and call to action editable.
    items: [{ productId: draftProduct.id, count: Math.max(1, Math.min(8, i.count ?? 4)) }],
    direction,
  };
  try {
    estimateBatch(input, { brand: draftBrand, product: draftProduct });
  } catch (e) {
    return { problem: (e as Error).message };
  }
  return { input, brand: kit, product, draft: { brand: draftBrand, product: draftProduct }, name };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The product the ads are for, made from the brief. A product of the same name already in the kit is
 * used: in a kit Assist made, a new photo becomes its first; the user's own products are never changed
 * (a new photo makes a second product of that name, as Ads Studio's "Create anyway" does).
 */
function adsProduct(brand: BrandKit, name: string, i: AdsToolInput): Product {
  const images = i.product_image ? [i.product_image] : [];
  try {
    return createProduct({ name, brandId: brand.id, description: i.brief, images });
  } catch (e) {
    if (!(e instanceof DuplicateProductError)) throw e;
    const same = listProducts(brand.id).filter((p) => sameName(p.name, name));
    const fits = same.find((p) => !images.length || p.images[0] === images[0]);
    if (fits) return fits;
    if (brand.origin === "assist" && same[0]) return updateProduct(same[0].id, { images: [...images, ...same[0].images.filter((u) => !images.includes(u))] }) ?? same[0];
    return createProduct({ name, brandId: brand.id, description: i.brief, images }, { force: true });
  }
}

const adsRoute: StudioRoute<AdsToolInput> = {
  studio: "Ads Studio",
  page: "/ads",
  refuse: (i, ctx) => problemOf(adsJob(i, ctx)),
  plan: (i, ctx) => {
    const { input, draft } = ok(adsJob(i, ctx));
    const est = estimateBatch(input, draft);
    const job: PlannedJob = {
      tool: "create_ads",
      modelId: est.modelId,
      modelName: est.modelName,
      kind: "image",
      op: draft.product?.images.length ? "edit" : "t2i",
      prompt: i.brief,
      count: est.total,
      costUsd: est.costUsd,
      demo: est.demo,
      note: `${est.total} ad${est.total === 1 ? "" : "s"} · copy by ${est.copyBy === "llm" ? "the AI copywriter" : "the offline copywriter"} · each in 1:1, 4:5 and 9:16`,
      atomic: true,
    };
    return [job];
  },
  async run(i, ctx) {
    const job = ok(adsJob(i, ctx));
    // A brief without a brand kit gets one of its own, the way Ads Studio's "Describe your business" makes
    // it (marked as Assist's); the same product asked for again goes back to that kit. The user's own
    // kits are only used when named (brand_id).
    const again = job.brand
      ? null
      : listProducts()
          .filter((p) => p.brandId && sameName(p.name, job.name))
          .map((p) => getBrand(p.brandId!))
          .find((b): b is BrandKit => b?.origin === "assist" && b.status === "ready");
    const brand = job.brand ?? again ?? (await createManualBrand({ description: i.brief, origin: "assist" }));
    const product = job.product ?? adsProduct(brand, job.name, i);
    const { batchId, run } = createBatch({ ...job.input, brandId: brand.id, items: [{ productId: product.id, count: job.input.items[0].count }] }, { headline: i.headline, cta: i.cta });
    // The copy is written first (one LLM call), then each ad's picture starts: wait for that, not for the pictures.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([run, new Promise((r) => (timer = setTimeout(r, 30_000)))]).finally(() => clearTimeout(timer));
    const ads = listCreatives({ brandId: brand.id, batchId });
    return {
      ids: ads.flatMap((c) => (c.generationId ? [c.generationId] : [])),
      href: `/ads/${brand.id}`,
      info: {
        brand: brand.id,
        // The kit's name, to tell the user where the ads are (a kit made from the brief is named by it).
        brandName: brand.name,
        product: product.id,
        batch: batchId,
        ads: ads.map((c) => ({ headline: c.headline, cta: c.cta, status: c.status })),
        note: "In Ads Studio each ad is laid out with the headline, body and call to action in 1:1, 4:5 and 9:16; the words can be edited there and everything downloaded at once.",
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Captions (Video tools → Captions): the studio's jobs, then its editor opened on the video

const CAPTION_LOOK: CaptionLook = { style: "clean", size: "M", position: "bottom" };

/** Per-second and per-minute steps priced for the video's length, as the studio's notes price them. */
const timed = (r: GenerationRequest, seconds?: number): GenerationRequest => {
  const unit = getModel(r.modelId)?.pricing?.unit;
  return seconds && (unit === "second" || unit === "minute") && r.params?.duration === undefined ? { ...r, params: { ...r.params, duration: seconds } } : r;
};

function captionsJob(i: CaptionsToolInput, ctx: ToolContext): Checked<{ steps: PipelineStep[]; route: BurnRoute; transcript?: string; seconds?: number }> {
  const engine = engineOf(ctx);
  if (!i.video.startsWith("/api/files/")) return { problem: "Captions works on videos saved in Fuobe (an upload or a result)" };
  const spoken = i.spoken_language ? dubLanguageFor(i.spoken_language)?.code : undefined;
  const seconds = videoLength(i.video);
  const route: BurnRoute = engine === "open" ? "open" : i.translate_to ? "veed" : "auto";
  const steps: PipelineStep[] = [];
  let transcript: string | undefined;
  if (engine === "cloud") {
    if (i.translate_to) {
      // VEED Subtitles transcribes, translates and burns in one job.
      steps.push({
        key: "captions",
        request: { feature: CAPTIONS_FEATURE, modelId: BURN_MODELS.veed, op: "captions", inputs: { video: i.video }, params: { sourceLanguage: i.spoken_language, targetLanguage: i.translate_to }, title: `Captions · ${i.translate_to}`, step: { label: `Captions in ${i.translate_to}`, index: 0, of: 1 } },
      });
    } else {
      // The studio's quick karaoke burn, plus the transcript its editor opens with (fix a line, burn again).
      steps.push(
        { key: "words", request: { ...transcribeRequest({ engine, video: i.video, sourceLanguage: spoken }), step: { label: "Transcript", index: 0, of: 2 } } },
        { key: "captions", request: { ...burnRequest({ route, video: i.video, cues: [], look: lookFor(route, CAPTION_LOOK), sourceLanguage: spoken }), step: { label: "Captioned video", index: 1, of: 2 } } },
      );
      transcript = "words";
    }
  } else {
    // Open engine: Qwen3-ASR's timed lines (translated by the local LLM when asked) burned in by ComfyUI.
    const n = i.translate_to ? 3 : 2;
    steps.push({ key: "words", request: { ...transcribeRequest({ engine, video: i.video, sourceLanguage: spoken }), step: { label: "Transcript", index: 0, of: n } } });
    if (i.translate_to) {
      steps.push({ key: "tr", after: "words", chain: [{ slot: "prompt" }], request: { feature: CAPTIONS_FEATURE, modelId: "oss-text-llm", op: "translate", params: { targetLanguage: i.translate_to }, step: { label: `Translation · ${i.translate_to}`, index: 1, of: n } } });
    }
    const look = lookFor(route, CAPTION_LOOK);
    const style = styleById(look.style);
    transcript = i.translate_to ? "tr" : "words";
    steps.push({
      key: "captions",
      after: transcript,
      chain: [{ slot: "prompt" }],
      request: {
        feature: CAPTIONS_FEATURE,
        modelId: BURN_MODELS.open,
        op: "captions",
        inputs: { video: i.video },
        params: { extra: { fontSize: OPEN_FONT_SIZE[look.size], fontColor: style.color, captionPosition: look.position === "top" ? "top" : "bottom", wordsPerCaption: style.karaoke ? 3 : 0 } },
        title: `Captions · ${style.name}`,
        step: { label: "Captioned video", index: n - 1, of: n },
      },
    });
  }
  return { steps: steps.map((s) => ({ ...s, request: timed(s.request, seconds) })), route, transcript, seconds };
}

const captionsRoute: StudioRoute<CaptionsToolInput> = {
  studio: "Captions",
  page: modeHref("video-tools", "captions"),
  refuse: (i, ctx) => problemOf(captionsJob(i, ctx)),
  plan: (i, ctx) => {
    const { steps, route, seconds } = ok(captionsJob(i, ctx));
    // The burn at the studio's own rate per minute (VEED's dynamic styles cost double), plus VEED's translation when it translates.
    const burn = seconds && route !== "open" ? Math.round(burnPricePerMinute(route, CAPTION_LOOK.style, route === "veed" && !!i.translate_to) * (seconds / 60) * 1000) / 1000 : null;
    return planSteps("add_captions", steps).map((j) => (j.op === "captions" && burn !== null && !j.demo && !j.error ? { ...j, costUsd: burn } : j));
  },
  async run(i, ctx) {
    const { steps, transcript } = ok(captionsJob(i, ctx));
    const p = createPipeline(steps.map((s) => ({ ...s, request: { ...s.request, batchTitle: i.translate_to ? `Captions in ${i.translate_to}` : "Captions" } })));
    const words = transcript ? p.byKey[transcript].id : undefined;
    return {
      ids: [p.byKey.captions.id],
      // The Captions editor opens on the video with these lines loaded (it keeps no session of its own).
      href: modeHref("video-tools", "captions", { video: i.video, ...(words && { transcript: words }) }),
      info: { note: "The captioned video is listed under Captioned videos in Captions; the editor there opens on this video with its lines, to fix any line or restyle and burn again." },
    };
  },
};

STUDIO_ROUTES.split_layers = layersRoute;
STUDIO_ROUTES.restyle_footage = shortsRoute;
STUDIO_ROUTES.dub_video = dubRoute;
STUDIO_ROUTES.faceless_episode = facelessRoute;
STUDIO_ROUTES.create_ads = adsRoute;
STUDIO_ROUTES.add_captions = captionsRoute;
