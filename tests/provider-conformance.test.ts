/**
 * The hosted routes no live call has passed yet (src/lib/catalog/hosted-untested.ts) checked against the providers' own
 * API schemas, kept in tests/fixtures/provider-schemas/ by scripts/refresh-provider-schemas.mjs (public GETs only):
 *
 * - Each route's request, for every setting the studio offers it (shape, size, length, the model's own controls, sound,
 *   seed, negative words, references up to the model's limits), is built by the real planner and payload builder (as
 *   fal.ts and replicate.ts submit it) and validated with ajv against the endpoint's input schema, with no field the
 *   schema doesn't name (a song's files/upload body too).
 * - Each endpoint's answer, made from its output schema (its examples, else a value of each field's type), is read by
 *   the real result parser: it gives the files the run makes, of the kind the run makes, and nothing else.
 *
 * Paths these one-setting-at-a-time variants don't reach (uploads, chained steps, film gaps, lyrics, maxima together, edge
 * values) are in tests/provider-conformance-paths.test.ts; the shared readers are in tests/helpers/provider-schemas.ts.
 *
 * A provider that changes an endpoint shows up as a fixture diff when the schemas are refreshed, and here as the request
 * or answer that no longer fits.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { HOSTED_UNTESTED_ENDPOINTS, isHostedUntested } from "@/lib/catalog/hosted-untested";
import { extractOutputs } from "@/lib/catalog/payload";
import { planGeneration, routesFor } from "@/lib/catalog/plan";
import { operationOutput, type GenerationRequest, type GenParams, type ModelDef, type ModelRoute, type Operation } from "@/lib/catalog/types";
import {
  bodyProblems,
  CLIP,
  documentedAnswer,
  END,
  GLB,
  handOverInput,
  IMG,
  PROMPT,
  routeRequest,
  SCHEMA_INDEX as INDEX,
  schemaFile as fileFor,
  SONG,
  VOICE,
  type Variant,
} from "./helpers/provider-schemas";

// ---------------------------------------------------------------------------
// The runs the studio can send each route.

/** What each operation's run carries (a clip's length, a song's), as the studio sends it. */
function baseRun(model: ModelDef, op: Operation): Omit<Variant, "label"> {
  const o = model.options;
  const words = model.options.promptless ? undefined : PROMPT;
  switch (op) {
    case "i2v":
      return { inputs: { images: [IMG] }, params: {}, prompt: words };
    case "flf2v":
      return { inputs: { images: [IMG], endImage: END }, params: {}, prompt: words };
    case "ref2v":
      return { inputs: { images: [IMG] }, params: {}, prompt: words };
    case "avatar":
      return { inputs: { images: [IMG], audio: VOICE }, params: { sourceDuration: 12 }, prompt: words };
    case "relight-video":
      // The light is a sphere picture the studio picks.
      return { inputs: { video: CLIP, images: o.lightSphere ? ["https://v3b.fal.media/files/in/sphere.png"] : undefined }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 } } };
    case "insert-moment":
      // The new moment goes between the marks.
      return { inputs: { video: CLIP }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 }, startTime: 2, endTime: 5 }, prompt: PROMPT };
    case "extend":
    case "bg-remove-video":
    case "upscale-video": {
      // A clip within the model's own window (Kandinsky VSR takes up to 5 s).
      const seconds = Math.min(8, o.maxSourceSeconds ?? 8);
      return { inputs: { video: CLIP }, params: { sourceDuration: seconds, sourceSize: { width: 1280, height: 720 } }, prompt: o.promptless ? undefined : PROMPT };
    }
    case "song-extend":
    case "song-remix":
    case "song-stems":
      return { inputs: { audio: SONG }, params: { sourceDuration: 120, extra: o.lyrics?.required ? { lyrics: "[Verse]\nCity lights are calling me home" } : undefined }, prompt: op === "song-stems" ? undefined : "Warm synth-pop, female vocal" };
    case "music":
      return { inputs: {}, params: {}, prompt: "Warm synth-pop with a driving bass line" };
    case "enhance-voice":
      return { inputs: { audio: VOICE }, params: { sourceDuration: 12 } };
    case "bg-remove":
    case "splat":
    case "image-to-3d":
      return { inputs: { images: [IMG] }, params: {}, prompt: op === "bg-remove" && o.guided ? "the person" : undefined };
    case "retexture-3d":
      return { inputs: { model3d: GLB }, params: {}, prompt: "Weathered bronze with green patina" };
    default:
      return { inputs: {}, params: {}, prompt: words };
  }
}

/** Every value of every control (cartesian, small), so each quality picks its own route. */
function controlCombos(model: ModelDef): Record<string, string | number>[] {
  let combos: Record<string, string | number>[] = [{}];
  for (const c of model.options.controls ?? []) combos = combos.flatMap((x) => c.values.map((v) => ({ ...x, [c.param]: v })));
  return combos;
}

/** The settings the studio offers, one at a time off the model's defaults, under each control combination. */
function variants(model: ModelDef, op: Operation): Variant[] {
  const o = model.options;
  const base = baseRun(model, op);
  const out: Variant[] = [];
  for (const extra of controlCombos(model)) {
    const tag = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(",");
    const add = (label: string, change: Partial<Variant> & { params?: GenParams } = {}) =>
      out.push({
        ...base,
        ...change,
        label: [tag, label].filter(Boolean).join(" "),
        inputs: { ...base.inputs, ...change.inputs },
        params: { ...base.params, ...change.params, extra: { ...base.params.extra, ...extra, ...change.params?.extra } },
      });
    add("defaults");
    for (const a of o.aspectRatios ?? []) add(`aspect ${a}`, { params: { aspectRatio: a } });
    for (const r of o.resolutions ?? []) add(`resolution ${r}`, { params: { resolution: r } });
    for (const d of o.durations ?? []) add(`duration ${d}`, { params: { duration: d } });
    if (o.audio) for (const on of [true, false]) add(`audio ${on}`, { params: { generateAudio: on } });
    if (o.seed) add("seed", { params: { seed: 1234567 } });
    if (o.negativePrompt) add("negative words", { negativePrompt: "blur, flicker" });
    for (const s of o.sliders ?? []) for (const v of [s.min, s.max]) add(`${s.param} ${v}`, { params: { extra: { [s.param]: v } } });
    if (op === "ref2v") {
      // Each list at the catalog's own maximum (tests/provider-conformance-paths.test.ts also sends them together).
      const imgs = o.maxImages ?? 1;
      const vids = o.maxVideos ?? 0;
      const auds = o.maxAudios ?? 0;
      if (imgs > 1) add(`${imgs} pictures`, { inputs: { images: Array.from({ length: imgs }, (_, i) => `https://v3b.fal.media/files/in/ref${i}.png`) } });
      if (vids) add(`${vids} clips`, { inputs: { videos: Array.from({ length: vids }, (_, i) => `https://v3b.fal.media/files/in/ref${i}.mp4`) } });
      if (auds) add(`${auds} voices`, { inputs: { audios: Array.from({ length: auds }, (_, i) => `https://v3b.fal.media/files/in/voice${i}.mp3`) } });
    }
    if (op === "extend" && o.maxAudios) add("voices", { inputs: { audios: [VOICE] } });
    if (op === "retexture-3d") add("style picture", { inputs: { images: [IMG] }, prompt: undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The routes.

const untested: { model: ModelDef; op: Operation; route: ModelRoute }[] = MODELS.flatMap((model) =>
  model.routes.filter((r) => isHostedUntested(model.id, r)).map((route) => ({ model, op: route.op, route })),
);

describe("provider conformance: the untested hosted routes", () => {
  it("keeps a schema for every untested endpoint and every endpoint they switch to", () => {
    const kept = new Set([...INDEX.fal.map((e) => `fal:${e}`), ...INDEX.replicate.map((e) => `replicate:${e}`)]);
    const needed = new Set<string>();
    for (const { route } of untested) {
      needed.add(`${route.provider}:${route.endpoint.split(":")[0]}`);
      if (route.loraEndpoint) needed.add(`${route.provider}:${route.loraEndpoint.split(":")[0]}`);
      if (route.map?.songSource) needed.add(`fal:${route.map.songSource.upload.endpoint}`);
    }
    for (const e of HOSTED_UNTESTED_ENDPOINTS) expect([...needed].some((n) => n.endsWith(`:${e}`)), `${e} is listed but no route uses it`).toBe(true);
    expect([...needed].filter((n) => !kept.has(n))).toEqual([]);
    for (const k of kept) expect(fs.existsSync(fileFor(k.split(":")[0], k.slice(k.indexOf(":") + 1))), k).toBe(true);
  });

  for (const { model, op, route } of untested) {
    const provider = route.provider as "fal" | "replicate";
    const name = `${model.id} ${op} → ${provider} ${route.endpoint}`;
    // A chained route is never sent itself: its steps go to the routes it names (Fuobe Animation's film: one
    // start-and-end-frame run per gap on the flf2v route, checked below, then a join).
    if (route.chained) continue;

    it(`${name}: every request the studio sends fits the input schema`, () => {
      const problems: string[] = [];
      let checked = 0;
      for (const v of variants(model, op)) {
        const req: GenerationRequest = { feature: model.kind, modelId: model.id, op, prompt: v.prompt, negativePrompt: v.negativePrompt, inputs: v.inputs, params: v.params };
        let plan: ReturnType<typeof planGeneration>;
        try {
          plan = planGeneration(req, getModel, getPreset);
        } catch (e) {
          problems.push(`${v.label}: refused before sending (${(e as Error).message})`);
          continue;
        }
        // The variant's route (a quality control picks Kandinsky's Pro or Lite endpoint): only this one is checked here.
        if (!routesFor(model, plan.op, plan.params).includes(route)) continue;
        const { endpoint, body, upload } = routeRequest(route, handOverInput(plan, v));
        checked++;
        // The schema, and no field it doesn't name (fal ignores those without a word).
        const wrong = bodyProblems(provider, endpoint, body);
        if (wrong.length) problems.push(`${v.label} → ${endpoint} ${JSON.stringify(body)}: ${wrong.join("; ")}`);
        // A song Mureka didn't make goes through its files/upload first: that body too.
        const upWrong = upload ? bodyProblems("fal", upload.endpoint, upload.body) : [];
        if (upWrong.length) problems.push(`${v.label} → ${upload!.endpoint} ${JSON.stringify(upload!.body)}: ${upWrong.join("; ")}`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });

    it(`${name}: its documented answer reads as the run's result`, () => {
      const answer = documentedAnswer(provider, route.endpoint.split(":")[0]);
      // Stems come back as one zip (Mureka's zip_url), which fal.ts unpacks into one result per stem.
      if (op === "song-stems") return expect(typeof (answer as { zip_url?: unknown })?.zip_url).toBe("string");
      const outs = extractOutputs(answer, op);
      const want = operationOutput(op, model.kind);
      expect(outs.length, JSON.stringify(answer)).toBeGreaterThan(0);
      expect(outs.map((o) => `${o.kind} ${o.url}`), JSON.stringify(answer)).toEqual(outs.map((o) => `${want} ${o.url}`));
    });
  }
});
