import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import {
  BRIEF_SYSTEM,
  briefCostUsd,
  briefRequest,
  CF_LENGTH_VALUES,
  claudeMessage,
  claudePlan,
  episodeTopic,
  getPreset,
  MAX_BRIEF_FRAMES,
  MAX_EPISODES,
  MAX_PROMPT,
  MAX_REFERENCE_SECONDS,
  noMediaMessage,
  offlineBrief,
  offlineSeries,
  OPEN_REFERENCE_SECONDS,
  pageMedia,
  parseBrief,
  parseSeries,
  PLATFORM_LABEL,
  referenceLink,
  seriesBrief,
  seriesPrice,
  seriesSettings,
  SERIES_SYSTEM,
  type AnimationStyleId,
  type ClaudePrompt,
  type ReferencePlatform,
  type SeriesAnalysis,
  type SeriesCard,
  type SeriesEpisodePlan,
  type SeriesEstimate,
  type SeriesReference,
  type SeriesSettings,
  type SeriesView,
  type StyleBrief,
} from "@/lib/catalog/content-factory";
import { genreInfo, pickerData, type ChannelSettings, type EpisodeSettings, type NarratorVoice, type TimedText } from "@/lib/catalog/faceless";
import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { probeMedia } from "@/lib/media-probe";
import { authEnabled } from "./auth";
import { db } from "./db";
import { llmText, llmTextBackend, type LlmImage } from "./enhance";
import { askLlm, createChannel, createEpisode, deleteChannel, estimateEpisode, FacelessError, getChannel, handle as facelessHandle, listEpisodes, VoiceSchema } from "./faceless";
import { cancelGeneration, createGenerations, getGeneration, previewGeneration } from "./generations";
import type { JsonSpec } from "./llm";
import { fetchRemote, RemoteFetchError } from "./remote-fetch";
import { engineMode } from "./settings";
import { readRef, saveFile } from "./storage";
import { probeWebm } from "./webm-probe";

/** BRIEF_SYSTEM's JSON as a schema, so a local model answers with a brief rather than prose (Claude reads the prompt). */
const S = { type: "string" };
const N = { type: "number" };
const oneOf = (...values: string[]) => ({ type: "string", enum: values });
const objectOf = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const BRIEF_SCHEMA: JsonSpec = {
  name: "style_brief",
  schema: objectOf({
    format: S,
    hook: S,
    pacing: objectOf({ average_shot_seconds: N, description: S }),
    shots: { type: "array", items: S },
    visual_style: objectOf({ medium: S, palette: S, lighting: S, texture: S }),
    animation_style: oneOf("Fully animated", "Seamless motion video", "Scene by scene video", "Frame by frame"),
    narration: objectOf({ tone: S, words_per_minute: N, language: S }),
    music: objectOf({ genre: S, mood: S, energy: oneOf("low", "medium", "high") }),
    captions: objectOf({ style: S, position: oneOf("top", "center", "bottom") }),
    aspect_ratio: oneOf("9:16", "16:9"),
    topic_ideas: { type: "array", items: S, minItems: 5, maxItems: 5 },
  }),
};

/*
 * Content Factory on the server: a series (a reference clip, a preset or nothing; the style brief read
 * from it; the planned episodes) whose episodes are Faceless episodes in a channel of its own. Nothing is
 * forked from Faceless: the series makes a channel with the brief in its settings, and every episode is
 * createEpisode with the brief applied (src/lib/catalog/faceless.ts reads EpisodeSettings.brief).
 *
 * Reading a reference:
 * - cloud: extract-frames (fal, about one frame a second, at most 20 sent on) and Scribe v2's transcript run
 *   as generations; when both are done Claude (llmText, with the frames as pictures) writes the brief.
 * - open: one generation, oss-reference-brief (reference-brief-gemma4 on ComfyUI: Gemma 4 E4B watches the
 *   first 30 s at a frame a second and hears the sound), whose answer is the brief.
 * Whatever can't be read (demo mode, no LLM, an answer that isn't a brief) gives way to the offline brief
 * from the clip's shape, length and narration pace, with a note that says so.
 *
 * The step generations live in the generations table (they survive restarts); the brief is written by
 * whoever reads the series first once they're done (seriesView), in this process.
 */

export class NeedsUpload extends FacelessError {
  constructor(message: string) {
    super(message, 422);
  }
}

// ---------------------------------------------------------------------------
// Rows

interface SeriesData {
  name: string | null;
  prompt: string;
  reference: SeriesReference | null;
  analysis: SeriesAnalysis | null;
  brief: StyleBrief | null;
  settings: SeriesSettings | null;
  plan: SeriesEpisodePlan[];
  /** Its episodes in series order (they're often made in the same millisecond). */
  episodeIds?: string[];
}

interface SeriesRow {
  id: string;
  channel_id: string | null;
  data_json: string;
  created_at: number;
  updated_at: number;
}

const seriesRow = (id: string) => db().prepare("SELECT * FROM content_series WHERE id = ?").get(id) as SeriesRow | undefined;
const dataOf = (r: SeriesRow) => JSON.parse(r.data_json) as SeriesData;

function mustRow(id: string): SeriesRow {
  const r = seriesRow(id);
  if (!r) throw new FacelessError("Series not found", 404);
  return r;
}

function save(id: string, data: SeriesData, channelId?: string | null): void {
  const now = Date.now();
  if (channelId !== undefined) db().prepare("UPDATE content_series SET data_json = ?, channel_id = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), channelId, now, id);
  else db().prepare("UPDATE content_series SET data_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), now, id);
}

/** Change a series' data in place (a re-read, so a brief written or edited meanwhile isn't lost). */
function patch(id: string, fn: (d: SeriesData) => SeriesData | void, channelId?: string | null): SeriesData | null {
  const r = seriesRow(id);
  if (!r) return null;
  const d = dataOf(r);
  const next = fn(d) ?? d;
  save(id, next, channelId);
  return next;
}

declare global {
  var __fuobeContentRuns: Set<string> | undefined;
}
/** Series a "Generate here" or "Next episode" is planning or starting right now (this process). */
const running = () => (globalThis.__fuobeContentRuns ??= new Set<string>());

/**
 * One run at a time per series, claimed before anything awaits: planning asks the LLM for up to 25 s, and a
 * second click (or Enter) meanwhile would otherwise make a second channel and bill every episode twice.
 */
function claim(id: string, busy: string): () => void {
  if (running().has(id)) throw new FacelessError(busy, 409);
  running().add(id);
  return () => void running().delete(id);
}

/** Drafts are kept this long (the composer's clip across reloads); "Generate here" makes them series. */
const DRAFT_MS = 3 * 24 * 60 * 60 * 1000;

/** Old drafts that never ran, and series whose channel was deleted in Faceless Studio (their episodes went with it). */
function pruneSeries(): void {
  const drafts = db().prepare("SELECT * FROM content_series WHERE channel_id IS NULL AND updated_at < ?").all(Date.now() - DRAFT_MS) as SeriesRow[];
  const orphans = db()
    .prepare("SELECT s.* FROM content_series s LEFT JOIN faceless_channels c ON c.id = s.channel_id WHERE s.channel_id IS NOT NULL AND c.id IS NULL")
    .all() as SeriesRow[];
  for (const r of [...drafts, ...orphans]) {
    if (running().has(r.id)) continue;
    for (const g of Object.values(dataOf(r).analysis?.steps ?? {})) void cancelGeneration(g).catch(() => {});
    db().prepare("DELETE FROM content_series WHERE id = ?").run(r.id);
  }
}

// ---------------------------------------------------------------------------
// The reference: an upload, a link (fetched through the SSRF-safe fetchRemote), or a preset

const MAX_CLIP_BYTES = 200 * 1024 * 1024;
const VIDEO_TYPE = /^video\/(mp4|quicktime|webm|x-m4v)$/;

/** Length and shape from the clip's own header (MP4/MOV or WebM), when it says. */
function clipFacts(data: Buffer): Pick<SeriesReference, "seconds" | "width" | "height" | "fps"> {
  const info = probeMedia(data);
  if (info?.hasVideo) return { seconds: info.videoDuration ?? info.duration, width: info.width, height: info.height, fps: info.fps };
  const webm = probeWebm(data);
  return webm ? { seconds: webm.duration, width: webm.width, height: webm.height, fps: webm.fps } : {};
}

const round1 = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 10) / 10);

async function saveClip(data: Buffer, contentType: string, name: string): Promise<Pick<SeriesReference, "url" | "seconds" | "width" | "height" | "fps">> {
  const facts = clipFacts(data);
  const url = saveFile({ data, contentType, name, source: "upload" }).url;
  return { url, seconds: round1(facts.seconds), width: facts.width, height: facts.height, fps: round1(facts.fps) };
}

/** What a fetched clip really is (its bytes over the server's word): MP4, MOV or WebM, with a file name to match. */
export function clipType(data: Buffer, said = ""): { contentType: string; name: string } {
  const head = data.subarray(0, 64);
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { contentType: "video/webm", name: "reference.webm" };
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp" && head.toString("latin1", 8, 12) === "qt  ") return { contentType: "video/quicktime", name: "reference.mov" };
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return { contentType: "video/mp4", name: "reference.mp4" };
  if (said === "video/webm") return { contentType: said, name: "reference.webm" };
  if (said === "video/quicktime") return { contentType: said, name: "reference.mov" };
  return { contentType: "video/mp4", name: "reference.mp4" };
}

/** A video behind a link, or null when the answer isn't one. */
async function fetchClip(url: string): Promise<{ data: Buffer; contentType: string; name: string } | null> {
  const res = await fetchRemote(url, { maxBytes: MAX_CLIP_BYTES, timeoutMs: 90_000 });
  const type = res.contentType?.split(";")[0].trim().toLowerCase() ?? "";
  if (VIDEO_TYPE.test(type) || (type === "application/octet-stream" && clipFacts(res.data).seconds)) return { data: res.data, ...clipType(res.data, type) };
  return null;
}

/** The file name in a link's path, as a title ("my%20clip.mp4" → "my clip.mp4"); a malformed escape is kept as written. */
export function linkTitle(url: string): string | undefined {
  const raw = new URL(url).pathname.split("/").pop() ?? "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // "%E0%A4%A" isn't UTF-8: the raw name still says which clip it was.
  }
  return name.slice(0, 120) || undefined;
}

const FETCH_FAILED = "Fuobe couldn't fetch that link. Check it opens in a private window, or upload the clip instead.";

/** A pasted link → the clip saved here, with the page's title and picture (fetched only through fetchRemote). */
async function readLink(raw: string): Promise<SeriesReference> {
  const checked = referenceLink(raw);
  if ("error" in checked) throw new FacelessError(checked.error);
  const { url, platform } = checked;
  // YouTube never hands its files out; a page from the platforms may (an og:video), so they're tried.
  if (platform === "youtube") throw new NeedsUpload(noMediaMessage(platform));
  const ref: SeriesReference = { kind: "link", link: url, platform };
  try {
    if (platform === "direct") {
      const title = linkTitle(url);
      const clip = await fetchClip(url);
      if (!clip) throw new NeedsUpload(noMediaMessage(platform));
      return { ...ref, ...(await saveClip(clip.data, clip.contentType, clip.name)), ...(title && { title }) };
    }
    const page = await fetchRemote(url, { maxBytes: 3 * 1024 * 1024, timeoutMs: 15_000 });
    const type = page.contentType?.split(";")[0].trim().toLowerCase() ?? "";
    if (VIDEO_TYPE.test(type)) {
      const t = clipType(page.data, type);
      return { ...ref, ...(await saveClip(page.data, t.contentType, t.name)) };
    }
    const media = pageMedia(page.data.toString("utf8"), page.url);
    if (!media.video) throw new NeedsUpload(noMediaMessage(platform));
    const clip = await fetchClip(media.video);
    if (!clip) throw new NeedsUpload(noMediaMessage(platform));
    const saved = await saveClip(clip.data, clip.contentType, clip.name);
    let thumbnail: string | undefined;
    if (media.image) {
      try {
        const img = await fetchRemote(media.image, { maxBytes: 4 * 1024 * 1024, timeoutMs: 8000 });
        const t = img.contentType?.split(";")[0] ?? "";
        if (/^image\/(jpeg|png|webp|gif)$/.test(t)) thumbnail = saveFile({ data: img.data, contentType: t, name: "reference-thumbnail.jpg", source: "upload" }).url;
      } catch {
        // The card shows the clip itself.
      }
    }
    return { ...ref, ...saved, ...(media.title && { title: media.title }), ...(thumbnail && { thumbnail }) };
  } catch (e) {
    if (e instanceof FacelessError) throw e;
    // A private address is refused with its own words; anything else (a 404, a timeout, a login wall) reads the same.
    throw new NeedsUpload(e instanceof RemoteFetchError && /private network|this machine/.test(e.message) ? e.message : FETCH_FAILED);
  }
}

/** An uploaded clip (already in this install's files). */
async function readUpload(url: string, title?: string): Promise<SeriesReference> {
  if (!url.startsWith("/api/files/")) throw new FacelessError("Upload the clip first");
  let file: Awaited<ReturnType<typeof readRef>>;
  try {
    file = await readRef(url);
  } catch {
    throw new FacelessError("That upload is gone — add the clip again");
  }
  if (!file.contentType.startsWith("video/")) throw new FacelessError("Add a video clip (MP4, MOV or WebM) as the reference");
  const facts = clipFacts(file.data);
  return { kind: "upload", url, title: title?.trim().slice(0, 120) || file.name, seconds: round1(facts.seconds), width: facts.width, height: facts.height, fps: round1(facts.fps) };
}

export type ReferenceInput = { kind: "upload"; url: string; title?: string } | { kind: "link"; link: string } | { kind: "preset"; presetId: string };

async function resolveReference(input: ReferenceInput): Promise<SeriesReference> {
  if (input.kind === "upload") return readUpload(input.url, input.title);
  if (input.kind === "link") return readLink(input.link);
  const p = getPreset(input.presetId);
  if (!p) throw new FacelessError("That preset isn't there any more — pick another");
  return { kind: "preset", presetId: p.id, title: p.name };
}

// ---------------------------------------------------------------------------
// Reading the reference into a brief

const STEP_LABEL = { frames: "Reference frames", transcript: "Reference transcript", brief: "Reference brief" } as const;

const engineAllowed = (engine: Engine) => engineMode() === "both" || engineMode() === engine;
function checkEngine(engine: Engine): void {
  if (!engineAllowed(engine)) throw new FacelessError(engine === "open" ? "This install is set to paid cloud APIs only (Settings → Engine mode)" : "This install is set to open source only (Settings → Engine mode)");
}

function request(ref: SeriesReference, key: keyof typeof STEP_LABEL, r: Omit<GenerationRequest, "feature">): GenerationRequest {
  return { feature: "content-factory", ...r, step: { label: STEP_LABEL[key], index: 0, of: 1 }, batchTitle: `Content Factory · ${ref.title ?? "reference"}` } as GenerationRequest;
}

/** Every Nth frame for about one a second, at most MAX_BRIEF_FRAMES over the clip (extract-frames counts frames). */
export function frameInterval(seconds: number | undefined, fps: number | undefined): number {
  const secs = Math.max(1, Math.min(MAX_REFERENCE_SECONDS, seconds ?? 30));
  const rate = fps && fps > 0 && fps <= 240 ? fps : 30;
  const frames = Math.max(1, Math.min(MAX_BRIEF_FRAMES, Math.round(secs)));
  return Math.max(1, Math.min(300, Math.round((secs * rate) / frames)));
}

/** The step generations for one read of the clip (none can start: the offline brief, with why). */
function startSteps(ref: SeriesReference, engine: Engine): { steps: SeriesAnalysis["steps"]; costUsd: number | null; demo: boolean; error?: string } {
  const steps: SeriesAnalysis["steps"] = {};
  let cost = 0;
  let demo = false;
  const errors: string[] = [];
  const run = (key: keyof typeof STEP_LABEL, r: GenerationRequest) => {
    try {
      const p = previewGeneration(r);
      const g = createGenerations(r)[0];
      steps[key] = g.id;
      cost += p.costUsd ?? 0;
      demo ||= p.demo;
    } catch (e) {
      errors.push((e as Error).message);
    }
  };
  if (engine === "open") {
    run("brief", request(ref, "brief", { modelId: "oss-reference-brief", op: "write", inputs: { video: ref.url }, params: { duration: Math.min(OPEN_REFERENCE_SECONDS, ref.seconds ?? OPEN_REFERENCE_SECONDS) } }));
  } else {
    // JPEG, not fal's default PNG: a full-HD PNG frame can weigh 3 MB, and Claude takes 32 MB a request.
    run("frames", request(ref, "frames", { modelId: "extract-frames", op: "extract-frames", inputs: { video: ref.url }, params: { frameInterval: frameInterval(ref.seconds, ref.fps), extra: { output_format: "jpg", quality: 80 } } }));
    run("transcript", request(ref, "transcript", { modelId: "scribe-v2", op: "transcribe", inputs: { video: ref.url }, params: { ...(ref.seconds && { duration: ref.seconds, sourceDuration: ref.seconds }) } }));
  }
  return { steps, costUsd: engine === "open" ? 0 : Math.round(cost * 1000) / 1000, demo, ...(errors.length && !Object.keys(steps).length && { error: errors[0] }) };
}

function beginAnalysis(id: string, ref: SeriesReference, engine: Engine): SeriesAnalysis {
  const started = startSteps(ref, engine);
  if (started.error) {
    // Nothing can read the clip on this engine right now: the brief from its header, and why.
    return { engine, status: "ready", steps: {}, offline: true, note: `${started.error}. This brief comes from the clip's shape and length only — fix that and read it again.`, costUsd: 0 };
  }
  return { engine, status: "reading", steps: started.steps, stage: engine === "open" ? "Gemma 4 is watching the clip…" : "Reading the frames and the words…", costUsd: started.costUsd, demo: started.demo };
}

declare global {
  var __fuobeContentBriefs: Map<string, Promise<void>> | undefined;
}
const writing = () => (globalThis.__fuobeContentBriefs ??= new Map<string, Promise<void>>());

/** Wait for a series' brief to be written (tests). */
export const briefWritten = (id: string) => writing().get(id) ?? Promise.resolve();

const done = (g: Generation | null) => !g || g.status === "succeeded" || g.status === "failed" || g.status === "canceled";
const textOf = (g: Generation | null) => (g?.status === "succeeded" ? g.outputs.find((o) => o.kind === "text") : undefined);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Up to `n` items spread evenly over a list (first and last kept). */
export function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  if (n <= 1) return list.slice(0, 1);
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

const IMAGE_TYPE = /^image\/(jpeg|png|gif|webp)$/;

/** Claude takes images of up to 5 MB each (as base64, 4/3 of the file) in a request of up to 32 MB. */
export const MAX_FRAME_BYTES = 3_750_000;
/** All the frames of one request together, as files: about 20 MB as base64, well inside the request limit. */
export const FRAME_BUDGET_BYTES = 15_000_000;

/** The frames that fit the request: none over the per-image limit, then fewer (still spread over the clip) until they fit the budget. */
export function fitFrames<T extends { data: Buffer }>(frames: T[], budget = FRAME_BUDGET_BYTES, each = MAX_FRAME_BYTES): T[] {
  const ok = frames.filter((f) => f.data.length <= each);
  const total = (list: T[]) => list.reduce((n, f) => n + f.data.length, 0);
  for (let n = ok.length; n > 0; n--) {
    const picked = spread(ok, n);
    if (total(picked) <= budget) return picked;
  }
  return [];
}

async function framesOf(g: Generation | null): Promise<LlmImage[]> {
  if (g?.status !== "succeeded") return [];
  const outs = g.outputs.filter((o) => o.kind === "image" && !o.meta?.demo);
  const picked = spread(
    [...outs].sort((a, b) => Number(a.meta?.index ?? 0) - Number(b.meta?.index ?? 0)),
    MAX_BRIEF_FRAMES,
  );
  const images: LlmImage[] = [];
  for (const o of picked) {
    try {
      const f = await readRef(o.url);
      if (IMAGE_TYPE.test(f.contentType)) images.push({ data: f.data, contentType: f.contentType });
    } catch {
      // A frame that can't be read is left out.
    }
  }
  return fitFrames(images);
}

async function writeBrief(id: string): Promise<void> {
  const r = seriesRow(id);
  if (!r) return;
  const d = dataOf(r);
  const a = d.analysis;
  const ref = d.reference;
  if (!a || a.status !== "reading" || !ref) return;
  const base = offlineBrief({ seconds: ref.seconds, width: ref.width, height: ref.height, title: ref.title });
  const header = ref.width && ref.height ? { aspect: base.aspect } : {};
  let brief: StyleBrief = base;
  let note: string | undefined;
  let offline = false;

  if (a.engine === "open") {
    const g = getGeneration(a.steps.brief ?? "", { includeDeleted: true });
    const out = textOf(g);
    const parsed = out && !out.meta?.demo ? parseBrief(out.text ?? "", base) : null;
    if (parsed) brief = { ...parsed.brief, ...header };
    else {
      offline = true;
      note = out?.meta?.demo
        ? "Demo brief — start ComfyUI (with Gemma 4 E4B) to read the clip for real. This one comes from the clip's shape and length."
        : g?.status === "failed"
          ? `Gemma 4 couldn't read the clip (${g.error ?? "it failed"}). This brief comes from the clip's shape and length — read it again to retry.`
          : "Gemma 4's answer wasn't a brief. This one comes from the clip's shape and length — read it again to retry.";
    }
  } else {
    const framesGen = getGeneration(a.steps.frames ?? "", { includeDeleted: true });
    const wordsGen = getGeneration(a.steps.transcript ?? "", { includeDeleted: true });
    const words = textOf(wordsGen);
    const cues = words && !words.meta?.demo && Array.isArray(words.meta?.cues) ? (words.meta.cues as TimedText[]) : [];
    const frames = await framesOf(framesGen);
    const fallback = offlineBrief({ seconds: ref.seconds, width: ref.width, height: ref.height, cues, title: ref.title });
    brief = fallback;
    const demo = (framesGen?.outputs.some((o) => o.meta?.demo) ?? false) || !!words?.meta?.demo;
    if (!frames.length && !cues.length) {
      offline = true;
      note = demo
        ? "Demo brief — connect fal and Claude in Settings to read the clip for real. This one comes from the clip's shape and length."
        : `The clip couldn't be read (${framesGen?.error ?? wordsGen?.error ?? "no frames or words came back"}). This brief comes from its shape and length — read it again to retry.`;
    } else if (!llmTextBackend()) {
      offline = true;
      note = "No LLM is connected (Settings → AI helper), so this brief comes from the clip's shape, length and narration pace.";
    } else {
      const transcript = cues.map((c) => `[${mmss(c.start)}] ${c.text.trim()}`).join("\n");
      const user = briefRequest({ seconds: ref.seconds, width: ref.width, height: ref.height, frames: frames.length, transcript, title: ref.title });
      // A text-only Ollama model can't take pictures: it answers from the words then.
      const json = { json: BRIEF_SCHEMA };
      const answer = (await llmText(BRIEF_SYSTEM, user, frames, json)) ?? (frames.length && llmTextBackend() === "ollama" ? await llmText(BRIEF_SYSTEM, user, json) : null);
      const parsed = answer ? parseBrief(answer, fallback) : null;
      if (parsed) brief = { ...parsed.brief, ...header };
      else {
        offline = true;
        note = "The LLM didn't answer with a brief, so this one comes from the clip's shape, length and narration pace — read it again to retry.";
      }
    }
  }
  patch(id, (cur) => {
    // Read again (or deleted) meanwhile: that read wins.
    if (cur.analysis?.status !== "reading" || JSON.stringify(cur.analysis.steps) !== JSON.stringify(a.steps)) return;
    cur.brief = brief;
    cur.analysis = { ...cur.analysis, status: "ready", stage: undefined, offline: offline || undefined, note };
  });
}

/** Moves a reading series on: the steps' progress, then the brief once they're all done. */
function advance(id: string, d: SeriesData): SeriesData {
  const a = d.analysis;
  if (!a || a.status !== "reading") return d;
  const gens = Object.values(a.steps).map((g) => getGeneration(g, { includeDeleted: true }));
  if (!gens.every(done)) {
    const running = gens.find((g) => g && !done(g));
    return { ...d, analysis: { ...a, stage: running?.status === "queued" ? "Waiting for its turn…" : a.stage } };
  }
  if (!writing().has(id)) {
    const job = writeBrief(id)
      .catch((e: Error) => {
        patch(id, (cur) => {
          if (cur.analysis?.status === "reading") cur.analysis = { ...cur.analysis, status: "failed", stage: undefined, error: e.message || "Couldn't write the brief" };
        });
      })
      .finally(() => writing().delete(id));
    writing().set(id, job);
  }
  return { ...d, analysis: { ...a, stage: a.engine === "open" ? "Writing the brief…" : "Claude is writing the brief…" } };
}

// ---------------------------------------------------------------------------
// Series

/** Episode 1 first: the series' own in plan order, then any made in Faceless Studio's channel page, oldest first. */
function inOrder<T extends { id: string; createdAt: number }>(cards: T[], ids: string[]): T[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  const rank = (c: T) => at.get(c.id) ?? ids.length;
  return [...cards].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

function toView(r: SeriesRow, d: SeriesData): SeriesView {
  const channel = r.channel_id ? getChannel(r.channel_id) : null;
  return {
    id: r.id,
    name: d.name ?? channel?.name ?? null,
    prompt: d.prompt,
    reference: d.reference,
    analysis: d.analysis,
    brief: d.brief,
    settings: d.settings,
    plan: d.plan,
    channel,
    made: !!r.channel_id,
    episodes: channel ? inOrder(listEpisodes({ channelId: channel.id, limit: 200 }), d.episodeIds ?? []) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function seriesView(id: string): SeriesView {
  const r = mustRow(id);
  return toView(r, advance(id, dataOf(r)));
}

/** A new series around a reference (reading starts straight away), a preset (its brief is ready), or nothing yet. */
export async function createSeries(input: { reference: ReferenceInput | null; engine: Engine; prompt?: string }): Promise<SeriesView> {
  checkEngine(input.engine);
  pruneSeries();
  const reference = input.reference ? await resolveReference(input.reference) : null;
  const id = nanoid(10);
  const now = Date.now();
  const preset = reference?.kind === "preset" ? getPreset(reference.presetId) : undefined;
  const data: SeriesData = { name: null, prompt: input.prompt?.trim().slice(0, MAX_PROMPT) ?? "", reference, analysis: null, brief: preset ? preset.brief : null, settings: null, plan: [] };
  if (preset) data.analysis = { engine: input.engine, status: "ready", steps: {}, costUsd: 0 };
  db().prepare("INSERT INTO content_series (id, channel_id, data_json, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)").run(id, JSON.stringify(data), now, now);
  if (reference?.url) {
    data.analysis = beginAnalysis(id, reference, input.engine);
    if (data.analysis.status === "ready") data.brief = offlineBrief({ seconds: reference.seconds, width: reference.width, height: reference.height, title: reference.title });
    save(id, data);
  }
  return seriesView(id);
}

/** Read the reference again (after an offline brief, a failure, or on the other engine). */
export async function rereadSeries(id: string, engine: Engine): Promise<SeriesView> {
  checkEngine(engine);
  const r = mustRow(id);
  const d = dataOf(r);
  if (!d.reference?.url) throw new FacelessError("This series has no clip to read — add one first");
  for (const g of Object.values(d.analysis?.steps ?? {})) void cancelGeneration(g).catch(() => {});
  d.analysis = beginAnalysis(id, d.reference, engine);
  if (d.analysis.status === "ready") d.brief = offlineBrief({ seconds: d.reference.seconds, width: d.reference.width, height: d.reference.height, title: d.reference.title });
  save(id, d);
  return seriesView(id);
}

export const BriefSchema = z.object({
  format: z.string().max(400),
  hook: z.string().max(400),
  shotSeconds: z.number().min(1).max(30),
  pacing: z.string().max(400),
  shots: z.array(z.string().max(120)).max(12),
  look: z.string().max(600),
  styleId: z.string().max(60),
  animation: z.enum(["fully-animated", "seamless", "scene-by-scene", "frame-by-frame"]),
  voice: z.object({ tone: z.string().max(200), wordsPerMinute: z.number().min(60).max(300).optional(), language: z.string().max(40).optional() }),
  music: z.object({ mood: z.string().max(300), energy: z.enum(["low", "medium", "high"]).optional() }),
  captions: z.object({ style: z.string().max(200), position: z.enum(["top", "center", "bottom"]), words: z.number().int().min(1).max(8) }),
  aspect: z.enum(["9:16", "16:9"]),
  topics: z.array(z.string().max(200)).max(12),
});

/** Edit the brief by hand, or rename the series. */
export function updateSeries(id: string, p: { brief?: StyleBrief; name?: string }): SeriesView {
  const r = mustRow(id);
  const d = dataOf(r);
  if (p.brief) {
    if (d.analysis?.status === "reading") throw new FacelessError("Wait for the brief to be read first", 409);
    d.brief = p.brief;
  }
  if (p.name !== undefined) d.name = p.name.trim().slice(0, 60) || null;
  save(id, d);
  return seriesView(id);
}

/** Deletes a series with its channel; `draftOnly` (the composer letting go of a clip) leaves a made series alone. */
export async function deleteSeries(id: string, o: { draftOnly?: boolean } = {}): Promise<void> {
  const r = mustRow(id);
  if (running().has(id)) throw new FacelessError("Its episodes are being planned — delete it once they've started", 409);
  if (o.draftOnly && r.channel_id) return;
  const d = dataOf(r);
  for (const g of Object.values(d.analysis?.steps ?? {})) void cancelGeneration(g).catch(() => {});
  if (r.channel_id && getChannel(r.channel_id)) await deleteChannel(r.channel_id);
  db().prepare("DELETE FROM content_series WHERE id = ?").run(id);
}

/** Series that have been made (drafts that never ran stay out of the list). */
export function listSeries(): SeriesCard[] {
  const rows = db().prepare("SELECT * FROM content_series WHERE channel_id IS NOT NULL ORDER BY updated_at DESC LIMIT 100").all() as SeriesRow[];
  return rows.flatMap((r) => {
    const channel = getChannel(r.channel_id!);
    if (!channel) return [];
    const d = dataOf(r);
    const eps = inOrder(listEpisodes({ channelId: channel.id, limit: 200 }), d.episodeIds ?? []);
    const first = eps.find((e) => e.still) ?? eps[0];
    return [
      {
        id: r.id,
        name: d.name ?? channel.name,
        prompt: d.prompt,
        channelId: channel.id,
        episodes: eps.length,
        done: eps.filter((e) => e.status === "done").length,
        rendering: eps.filter((e) => e.status === "rendering" || e.status === "writing").length,
        poster: first?.still ?? null,
        thumbnail: d.reference?.thumbnail ?? null,
        styleId: channel.settings.styleId,
        aspect: channel.settings.aspect,
        updatedAt: r.updated_at,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Settings, prices and the plan

export interface SeriesInput {
  prompt: string;
  settings: SeriesSettings;
  /** The narrator: null on the open engine until a sample is added; left out, one is picked for the brief's tone. */
  voice?: NarratorVoice | null;
  subtitles?: boolean;
  music?: boolean;
}

function briefFor(o: { seriesId?: string; presetId?: string; brief?: StyleBrief }): StyleBrief {
  if (o.brief) return o.brief;
  if (o.seriesId) {
    const d = dataOf(mustRow(o.seriesId));
    if (d.brief) return d.brief;
    if (d.analysis?.status === "reading") throw new FacelessError("The reference is still being read — a moment", 409);
  }
  const p = o.presetId ? getPreset(o.presetId) : undefined;
  if (p) return p.brief;
  throw new FacelessError("Add a reference or pick a preset style first");
}

const voices = () => pickerData(getModel).voices;

export function episodeSettings(input: SeriesInput, brief: StyleBrief): EpisodeSettings {
  const s = input.settings;
  if (!CF_LENGTH_VALUES.includes(s.length)) throw new FacelessError("Choose one of the offered lengths (30 sec to 5 min)");
  return seriesSettings({
    engine: s.engine,
    length: s.length,
    animation: s.animation,
    aspect: s.aspect,
    brief,
    genre: genreInfo(s.genre),
    ...(input.voice !== undefined && { voice: input.voice }),
    voices: voices(),
    subtitles: input.subtitles,
    music: input.music,
  });
}

/** What reading a minute of reference costs here (fal frames + Scribe v2 + Claude; nothing on the open engine or as a demo). */
function analysisPerMinute(engine: Engine): number {
  if (engine === "open") return 0;
  try {
    const frames = previewGeneration({ feature: "content-factory", modelId: "extract-frames", op: "extract-frames", inputs: { video: "/api/files/estimate.mp4" }, params: { frameInterval: 90 } });
    const words = previewGeneration({ feature: "content-factory", modelId: "scribe-v2", op: "transcribe", inputs: { video: "/api/files/estimate.mp4" }, params: { duration: 60, sourceDuration: 60 } });
    if (frames.demo && words.demo) return 0;
    return briefCostUsd({ seconds: 60, framesUsd: frames.costUsd ?? 0, transcribePerMinute: words.costUsd ?? 0, claude: llmTextBackend() === "claude" });
  } catch {
    return 0;
  }
}

/** The whole series' price before anything runs: one episode at the brief's pace, times the episodes. */
export function estimateSeries(input: SeriesInput & { seriesId?: string; presetId?: string; brief?: StyleBrief }): SeriesEstimate {
  const s = input.settings;
  const perMinute = analysisPerMinute(s.engine);
  let brief: StyleBrief;
  let pending = false;
  try {
    brief = briefFor(input);
  } catch {
    const row = input.seriesId ? seriesRow(input.seriesId) : undefined;
    const d = row ? dataOf(row) : null;
    pending = d?.analysis?.status === "reading";
    // Still reading: what the clip's length and shape already say (the price comes again with the brief).
    // No reference yet: the default look, so the composer always shows a price.
    brief = pending && d?.reference ? offlineBrief({ seconds: d.reference.seconds, width: d.reference.width, height: d.reference.height }) : getPreset("what-if")!.brief;
  }
  const settings = episodeSettings(input, brief);
  const est = estimateEpisode({ kind: "faceless", settings, genre: s.genre });
  return {
    price: seriesPrice(est.estimate, s.episodes),
    demo: est.demo,
    seconds: est.seconds,
    scenes: est.blocks,
    ...(est.error && { error: est.error }),
    ...(est.notes && { notes: est.notes }),
    analysisPerMinute: perMinute,
    ...(pending && { briefPending: true }),
  };
}

const PLAN_TIMEOUT_MS = 25_000;

/** Episode titles: the engine's LLM when it answers in time, else the genre's beats around the prompt. */
async function planEpisodes(o: { prompt: string; settings: SeriesSettings; brief: StyleBrief; count: number; previous: string[]; next?: string }): Promise<{ name: string | null; episodes: SeriesEpisodePlan[] }> {
  const genre = genreInfo(o.settings.genre);
  if (o.count === 1 && !o.previous.length && !o.next?.trim()) return { name: null, episodes: offlineSeries(o.prompt, genre.id, 1) };
  const answer = await askLlm(o.settings.engine, SERIES_SYSTEM, seriesBrief({ prompt: o.prompt, genre, count: o.count, format: o.brief.format, previous: o.previous, next: o.next }), { timeoutMs: PLAN_TIMEOUT_MS });
  const parsed = answer ? parseSeries(answer) : null;
  const got = (parsed?.episodes ?? []).slice(0, o.count);
  const fill = offlineSeries(o.prompt, genre.id, o.count - got.length, o.previous.length + got.length);
  // Without the LLM, the next episode is what the user said happens in it.
  const episodes = [...got, ...fill].map((e, i) => (i === 0 && !got.length && o.next?.trim() ? { ...e, synopsis: o.next.trim().slice(0, 400) } : e));
  return { name: parsed?.name ?? null, episodes };
}

const COULDNT_PLAN = "Couldn't plan your episodes. You weren't charged, so it's safe to try again.";

function startEpisodes(o: { channelId: string; prompt: string; plan: SeriesEpisodePlan[]; earlier: string[]; settings: EpisodeSettings; review: boolean; series: boolean }): string[] {
  const titles = [...o.earlier];
  const ids: string[] = [];
  o.plan.forEach((ep) => {
    const topic = episodeTopic(o.prompt, ep, { number: titles.length + 1, earlier: titles, series: o.series });
    const made = createEpisode({ kind: "faceless", channelId: o.channelId, topic, settings: o.settings, autoRender: !o.review, saveLook: false, ...(o.series && { title: ep.title }) });
    ids.push(made.id);
    titles.push(ep.title);
  });
  return ids;
}

/** "Generate here": plan the episodes, make the series' channel, and start every episode (rendered straight after its script unless `review`). */
export async function generateSeries(id: string, input: SeriesInput & { review?: boolean }): Promise<SeriesView> {
  const r = mustRow(id);
  if (r.channel_id) throw new FacelessError("This series is made — add episodes from its page", 409);
  const release = claim(id, "This series is being made — a moment");
  try {
    return await generateClaimed(id, input);
  } finally {
    release();
  }
}

async function generateClaimed(id: string, input: SeriesInput & { review?: boolean }): Promise<SeriesView> {
  checkEngine(input.settings.engine);
  const prompt = input.prompt.trim();
  if (!prompt) throw new FacelessError("Say what the video is about");
  const brief = briefFor({ seriesId: id });
  const settings = episodeSettings(input, brief);
  const est = estimateEpisode({ kind: "faceless", settings, genre: input.settings.genre });
  if (est.error) throw new FacelessError(est.error);
  const count = Math.max(1, Math.min(MAX_EPISODES, Math.round(input.settings.episodes)));
  let plan: { name: string | null; episodes: SeriesEpisodePlan[] };
  let channelId: string;
  try {
    plan = await planEpisodes({ prompt, settings: input.settings, brief, count, previous: [] });
    const channelSettings: ChannelSettings = {
      engine: settings.engine,
      styleId: settings.styleId,
      styleRefs: [],
      voice: settings.voice,
      aspect: settings.aspect,
      subtitles: settings.subtitles,
      music: settings.music,
      animation: settings.animation,
      length: settings.length,
      ...(settings.brief && { brief: settings.brief }),
    };
    const channel = await createChannel({ idea: prompt, genre: input.settings.genre, engine: settings.engine, ...(plan.name && { name: plan.name }), avatar: false, settings: channelSettings });
    channelId = channel.id;
  } catch (e) {
    if (e instanceof FacelessError) throw e;
    throw new FacelessError(COULDNT_PLAN, 500);
  }
  // Seen as made from here on (a second click gets "This series is made"); a brief edited meanwhile is kept.
  patch(id, (cur) => ({ ...cur, name: plan.name, prompt, settings: { ...input.settings, episodes: count }, plan: plan.episodes }), channelId);
  const ids = startEpisodes({ channelId, prompt, plan: plan.episodes, earlier: [], settings, review: !!input.review, series: count > 1 });
  patch(id, (cur) => ({ ...cur, episodeIds: ids }));
  return seriesView(id);
}

/** "Next episode": plan more after the ones already made, the first one following what the user says happens in it. */
export async function addEpisodes(id: string, input: { count: number; next?: string; review?: boolean }): Promise<SeriesView> {
  mustRow(id);
  const release = claim(id, "Episodes are being added to this series — a moment");
  try {
    return await addClaimed(id, input);
  } finally {
    release();
  }
}

async function addClaimed(id: string, input: { count: number; next?: string; review?: boolean }): Promise<SeriesView> {
  const r = mustRow(id);
  const d = dataOf(r);
  const channel = r.channel_id ? getChannel(r.channel_id) : null;
  if (!channel || !d.settings || !d.brief) throw new FacelessError("Make the series first", 409);
  checkEngine(channel.settings.engine);
  const count = Math.max(1, Math.min(MAX_EPISODES, Math.round(input.count)));
  const settings = episodeSettings({ prompt: d.prompt, settings: { ...d.settings, engine: channel.settings.engine }, voice: channel.settings.voice, subtitles: channel.settings.subtitles, music: channel.settings.music }, d.brief);
  const est = estimateEpisode({ kind: "faceless", settings, genre: d.settings.genre });
  if (est.error) throw new FacelessError(est.error);
  const previous = d.plan.map((e) => e.title);
  const more = await planEpisodes({ prompt: d.prompt, settings: d.settings, brief: d.brief, count, previous, next: input.next }).catch(() => {
    throw new FacelessError(COULDNT_PLAN, 500);
  });
  const ids = startEpisodes({ channelId: channel.id, prompt: d.prompt, plan: more.episodes, earlier: previous, settings, review: !!input.review, series: true });
  // Read again before writing: a brief edited while the episodes were planned is kept.
  patch(id, (cur) => {
    const plan = [...cur.plan, ...more.episodes];
    return { ...cur, plan, settings: { ...(cur.settings ?? d.settings!), episodes: plan.length }, episodeIds: [...(cur.episodeIds ?? []), ...ids] };
  });
  return seriesView(id);
}

// ---------------------------------------------------------------------------
// "Generate in Claude"

/** The engine Fuobe's MCP tools run on (src/server/mcp.ts: the cloud unless the install is open source only). */
const mcpEngine = (): Engine => (engineMode() === "open" ? "open" : "cloud");

export function claudePrompt(input: SeriesInput & { seriesId?: string; presetId?: string }): ClaudePrompt {
  const brief = briefFor(input);
  const s = input.settings;
  const d = input.seriesId ? dataOf(mustRow(input.seriesId)) : null;
  const ref = d?.reference;
  const reference = ref && ref.kind !== "preset" ? `${ref.title ? `“${ref.title}”` : "clip"}${ref.platform ? ` (${PLATFORM_LABEL[ref.platform as ReferencePlatform]})` : ""}` : null;
  const engine = mcpEngine();
  const voice = engine === "cloud" && input.voice?.kind === "preset" ? input.voice.id : null;
  const voiceSample = engine === "open" && input.voice?.kind === "sample" ? input.voice.url : null;
  const animation = s.animation as AnimationStyleId;
  const message = claudeMessage({ prompt: input.prompt, brief, length: s.length, episodes: s.episodes, animation, genre: genreInfo(s.genre), aspect: s.aspect, engine, voice, voiceSample, reference });
  const plan = claudePlan({ length: s.length, brief, animation });
  const engineNote =
    s.engine === engine
      ? undefined
      : engine === "open"
        ? "Claude's runs use the open-source engine (your ComfyUI): this install is set to Open source only."
        : engineMode() === "both"
          ? "Claude's runs use the cloud engine and your paid providers, not your GPU: Fuobe's MCP server follows Settings → Engine mode, which is set to both. Set it to Open source only to run them on your ComfyUI, or use Generate here."
          : "Claude's runs use the cloud engine and your paid providers: this install is set to paid cloud APIs only.";
  return { message, bytes: new TextEncoder().encode(message).length, needsToken: authEnabled(), engine, ...(engineNote && { engineNote }), parts: plan.parts, partSeconds: plan.partSeconds };
}

// ---------------------------------------------------------------------------
// Schemas and the API's error shape

export const SeriesSettingsSchema = z.object({
  engine: z.enum(["cloud", "open"]),
  length: z.number().int().min(15).max(600),
  episodes: z.number().int().min(1, "At least one episode").max(MAX_EPISODES, `Up to ${MAX_EPISODES} episodes at a time`),
  animation: z.enum(["fully-animated", "seamless", "scene-by-scene", "frame-by-frame"]),
  genre: z.enum(["education", "history", "kids", "storytelling"]),
  aspect: z.enum(["9:16", "16:9"]),
});

export const SeriesInputSchema = z.object({
  prompt: z.string().max(MAX_PROMPT, `Keep it under ${MAX_PROMPT} characters`),
  settings: SeriesSettingsSchema,
  voice: VoiceSchema.nullable().optional(),
  subtitles: z.boolean().optional(),
  music: z.boolean().optional(),
});

export const ReferenceSchema = z.union([
  z.object({ kind: z.literal("upload"), url: z.string().startsWith("/api/files/").max(500), title: z.string().max(200).optional() }),
  z.object({ kind: z.literal("link"), link: z.string().max(2000) }),
  z.object({ kind: z.literal("preset"), presetId: z.string().max(60) }),
]);

/** The faceless API's `{ error }` responses, plus `needsUpload` when a link gave no clip. */
export async function handle(fn: () => Promise<Response> | Response, request?: Request): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NeedsUpload) return Response.json({ error: e.message, needsUpload: true }, { status: e.status });
    return facelessHandle(() => {
      throw e;
    }, request);
  }
}
