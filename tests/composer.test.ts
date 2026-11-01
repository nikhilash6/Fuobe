import { describe, expect, it } from "vitest";
import { APPS, EFFECTS, getModel, getPreset, modelsFor, MODELS, MOTIONS } from "@/lib/catalog";
import type { InputSlot, ModelDef } from "@/lib/catalog/types";
import {
  acceptedKinds,
  bestForStudio,
  blockerFor,
  blockerLine,
  slotCaption,
  costLabel,
  filterModels,
  firstMissingSlot,
  groupModels,
  hasMention,
  hiddenChanges,
  matchScore,
  placeAttachment,
  pushRecent,
  replaceAttachment,
  settingsShape,
  settingsSummary,
  slotMessage,
  toggleIn,
  type Attachment,
} from "@/lib/composer";
import { appRoute, engineSwitchModel, presetFallback, presetOriginal, presetParams, routeParams } from "@/lib/composer";
import { withRecipe } from "@/lib/catalog/preset-recipes";
import { needsKey } from "@/lib/your-keys";
import { appStudio, EDIT_STUDIO, IMAGE_STUDIO, JOIN_CLIPS_STUDIO, LIPSYNC_STUDIO, TRANSCRIBE_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { asrLanguage, whisperLanguage } from "@/lib/comfy";
import { matchSpokenLanguage, spokenLanguageName, spokenLanguageOptions } from "@/lib/speech-languages";

const model = (id: string) => {
  const m = getModel(id);
  if (!m) throw new Error(`no model ${id}`);
  return m;
};

const att = (id: string, kind: Attachment["kind"] = "image", extra: Partial<Attachment> = {}): Attachment => ({ id, ref: `/api/files/${id}`, preview: `/api/files/${id}`, kind, ...extra });

describe("settings summary", () => {
  it("summarises a video model's output settings in reading order", () => {
    const m = model("seedance-2-5");
    const shape = settingsShape(m, "t2v", "video", true);
    expect(settingsSummary(shape, { ...m.defaults }, m)).toEqual(["16:9", "720p", "5s", "×1"]);
    expect(settingsSummary(shape, { ...m.defaults, aspectRatio: "9:16", numOutputs: 2, draft: true, generateAudio: false, enhancePrompt: true }, m)).toEqual([
      "9:16",
      "720p",
      "5s",
      "×2",
      "Draft",
      "No audio",
      "Enhance",
    ]);
  });

  it("drops the aspect ratio when a start frame frames the shot, and the duration when shots set it", () => {
    const m = model("seedance-2-5");
    expect(settingsShape(m, "i2v", "video", true).aspect).toBeNull();
    const shots = [
      { prompt: "a", duration: 3 },
      { prompt: "b", duration: 3 },
    ];
    const shape = settingsShape(m, "t2v", "video", true, { shots });
    expect(shape.duration).toBeNull();
    expect(settingsSummary(shape, { ...m.defaults, shots }, m)).toContain("2 shots");
  });

  it("has no batch count for one-take transforms, even before the operation is known", () => {
    expect(settingsShape(model("kling-avatar-2"), "avatar", "video", true).count).toBe(false);
    expect(settingsShape(model("kling-avatar-2"), undefined, "video", true, {}, LIPSYNC_STUDIO.ops).count).toBe(false);
    expect(settingsShape(model("seedance-2-5"), undefined, "video", true, {}, VIDEO_STUDIO.ops).count).toBe(true);
    expect(settingsShape(model("nano-banana-pro"), "t2i", "image", true).count).toBe(true);
    expect(settingsShape(undefined, "concat", "video", false).count).toBe(false);
  });

  it("offers the spoken language for transcribers on both engines, detected by default, sent where the API reads it", () => {
    for (const id of ["scribe-v2", "wizper", "oss-qwen3-asr"]) {
      const m = model(id);
      const shape = settingsShape(m, undefined, "text", false);
      expect(shape.sourceLanguages, id).toEqual(m.options.sourceLanguages);
      // Detect automatically is the default: nothing on the chip, nothing sent.
      expect(settingsSummary(shape, {}, m)).toEqual([]);
      expect(settingsSummary(shape, { sourceLanguage: "es" }, m)).toEqual(["Spanish"]);
    }
    expect(settingsShape(model("nano-banana-pro"), "t2i", "image", true).sourceLanguages).toBeNull();
    // The picked code reaches each API's own language field (Scribe's language_code) or the ComfyUI node's name.
    const scribe = model("scribe-v2").routes[0].map!;
    expect(buildPayload(scribe, { audio: "a.mp3", sourceLanguage: "es" })).toMatchObject({ language_code: "es" });
    for (const code of model("oss-qwen3-asr").options.sourceLanguages!) expect(asrLanguage(code), code).not.toBe("auto");
    for (const code of model("oss-captions-whisper").options.sourceLanguages!) expect(whisperLanguage(code), code).not.toBe("auto");
  });

  it("names spoken languages for the picker, by name and once each", () => {
    expect(["de", "yue", "jw", "fil"].map(spokenLanguageName)).toEqual(["German", "Cantonese", "Javanese", "Filipino"]);
    const options = spokenLanguageOptions(["fr", "en", "de", "en"]);
    expect(options.map((o) => o.name)).toEqual(["English", "French", "German"]);
    expect(spokenLanguageOptions(model("whisper").options.sourceLanguages!).length).toBeGreaterThan(90);
  });

  it("finds a model's code for a language stored as a name, a locale or an alias", () => {
    const scribe = model("scribe-v2").options.sourceLanguages!;
    // Assist stores the language as free text ("Spanish"): reused in Audio → Transcribe, the picker
    // selects Spanish and the request sends the code, as the chip says.
    expect(matchSpokenLanguage("Spanish", scribe)).toBe("es");
    expect(matchSpokenLanguage("spanish", scribe)).toBe("es");
    expect(matchSpokenLanguage("es", scribe)).toBe("es");
    expect(matchSpokenLanguage("ES-mx", scribe)).toBe("es");
    expect(matchSpokenLanguage("pt_BR", scribe)).toBe("pt");
    expect(matchSpokenLanguage("German (de)", scribe)).toBe("de");
    // The picker lists one code per name: another code for the same language finds it.
    expect(matchSpokenLanguage("tl", ["en", "fil"])).toBe("fil");
    expect(matchSpokenLanguage("Klingon", scribe)).toBeUndefined();
    expect(matchSpokenLanguage("  ", scribe)).toBeUndefined();
  });

  it("counts the changes the chip doesn't spell out", () => {
    const m = model("elevenlabs-v4");
    const slider = m.options.sliders![0];
    expect(hiddenChanges({}, "", m)).toBe(0);
    expect(hiddenChanges({ seed: 4, extra: { [slider.param]: slider.default } }, "  ", m)).toBe(1);
    expect(hiddenChanges({ seed: 4, extra: { [slider.param]: slider.min } }, "blurry", m)).toBe(3);
  });
});

describe("blockers", () => {
  it("names a slot in the studio's own words", () => {
    expect(slotMessage("Target photo")).toBe("Add a target photo");
    expect(slotMessage("Image")).toBe("Add an image");
    expect(slotMessage("Your clip")).toBe("Add your clip");
    expect(slotMessage("Face")).toBe("Add a face");
    expect(slotMessage("Driving video")).toBe("Add a driving video");
    expect(slotMessage("End frame")).toBe("Add an end frame");
    expect(slotMessage("Photos")).toBe("Add photos");
    expect(slotMessage("SVG logo")).toBe("Add a SVG logo");
  });

  it("points at the first empty required slot (not one still uploading)", () => {
    const face = getPreset("app-face-swap")!;
    expect(firstMissingSlot(face.inputs, {})?.label).toBe(face.inputs.find((s) => s.required)!.label);
    const [first, second] = face.inputs;
    expect(firstMissingSlot(face.inputs, { [first.key]: { ref: "/a.png" } })?.key).toBe(second.key);
    expect(firstMissingSlot(face.inputs, { [first.key]: { ref: "", uploading: true }, [second.key]: { ref: "/b.png" } })).toBeUndefined();
  });

  it("orders blockers from most to least actionable", () => {
    const slot: InputSlot = { key: "image", label: "Target photo", accept: "image", required: true };
    const base = { model: true, uploading: false, promptMissing: false };
    expect(blockerFor({ ...base, loading: "Loading models…", model: false })).toEqual({ message: "Loading models…", quiet: true });
    expect(blockerFor({ ...base, model: false })).toEqual({ message: "Pick a model" });
    expect(blockerFor({ ...base, missing: slot, uploading: true, planError: "Add an image to edit", promptMissing: true })).toEqual({ message: "Add a target photo", slot: "image" });
    expect(blockerFor({ ...base, uploading: true, planError: "Add an image to edit" })).toEqual({ message: "Uploading…", quiet: true });
    expect(blockerFor({ ...base, planError: "Pick a language to translate into", promptMissing: true })?.message).toBe("Pick a language to translate into");
    expect(blockerFor({ ...base, promptMissing: true })?.message).toBe("Write a prompt first");
    expect(blockerFor({ ...base, engineError: "Face Swap has no cloud version yet", missing: slot })?.message).toMatch(/no cloud version/);
    expect(blockerFor(base)).toBeNull();
  });

  it("captions a filled tile with the slot's role", () => {
    expect(slotCaption("Target photo")).toBe("Target");
    expect(slotCaption("Face")).toBe("Face");
    expect(slotCaption("Start frame")).toBe("Start");
    expect(slotCaption("End frame")).toBe("End");
    expect(slotCaption("Reference images")).toBe("Reference");
    expect(slotCaption("Your clip")).toBe("Your clip");
    expect(slotCaption("Image")).toBe("Image");
    expect(slotCaption("Voice sample")).toBe("Voice sample");
  });

  it("spells the blocker out under the composer where its tooltip can't be seen", () => {
    const slot: InputSlot = { key: "image", label: "Target photo", accept: "image", required: true };
    const base = { model: true, uploading: false, promptMissing: false };
    const missing = blockerFor({ ...base, missing: slot });
    // A folded docked composer shows it everywhere; with its tiles open, only screens without hover (the tooltip elsewhere).
    expect(blockerLine(missing, true)).toBe("always");
    expect(blockerLine(missing, false)).toBe("touch");
    expect(blockerLine(blockerFor({ ...base, planError: "Pick a voice" }), false)).toBe("touch");
    expect(blockerLine(blockerFor({ ...base, engineError: "Face Swap has no cloud version yet" }), true)).toBe("always");
    // Never for what passes by itself or is plain to see: loading, uploading, the empty prompt box.
    const plannerPrompt = blockerFor({ ...base, planError: "Write a prompt first", promptMissing: true });
    for (const quiet of [blockerFor({ ...base, loading: "Loading models…" }), blockerFor({ ...base, uploading: true }), blockerFor({ ...base, promptMissing: true }), plannerPrompt]) {
      expect(blockerLine(quiet, true)).toBeNull();
    }
    expect(blockerLine(null, true)).toBeNull();
  });
});

describe("attachments", () => {
  const videoSlots = VIDEO_STUDIO.slots;

  it("fills the first empty slot of the file's kind, then the references, then replaces", () => {
    let s = { slots: {}, refs: [] as Attachment[] } as { slots: Record<string, Attachment | null>; refs: Attachment[] };
    s = { ...s, ...placeAttachment(s, videoSlots, VIDEO_STUDIO.multiRef, 2, att("a"))! };
    expect(s.slots.image?.id).toBe("a");
    s = { ...s, ...placeAttachment(s, videoSlots, VIDEO_STUDIO.multiRef, 2, att("b"))! };
    expect(s.slots.endImage?.id).toBe("b");
    s = { ...s, ...placeAttachment(s, videoSlots, VIDEO_STUDIO.multiRef, 2, att("c"))! };
    expect(s.refs.map((r) => r.id)).toEqual(["c"]);
    s = { ...s, ...placeAttachment(s, videoSlots, VIDEO_STUDIO.multiRef, 1, att("d"))! };
    // References full: the first image slot is replaced.
    expect(s.slots.image?.id).toBe("d");
    expect(placeAttachment(s, videoSlots, VIDEO_STUDIO.multiRef, 2, att("v", "audio"))).toBeNull();
  });

  it("puts clips in a clip list (Join clips) and never into mask/sketch slots", () => {
    const s = { slots: {}, refs: [] as Attachment[] };
    expect(placeAttachment(s, JOIN_CLIPS_STUDIO.slots, JOIN_CLIPS_STUDIO.multiRef, 4, att("v", "video"))?.refs?.[0].id).toBe("v");
    const masked: InputSlot[] = [{ key: "mask", label: "Mask", accept: "image" }];
    expect(placeAttachment(s, masked, undefined, 0, att("m"))).toBeNull();
  });

  it("swaps an upload for its result by id, and never brings back one that was removed", () => {
    const uploading = att("up", "image", { ref: "", uploading: true });
    const state = { slots: { image: uploading }, refs: [att("r1"), { ...att("r2"), ref: "", uploading: true }] };
    expect(replaceAttachment(state, "up", att("done"))?.slots?.image).toMatchObject({ id: "up", ref: "/api/files/done" });
    expect(replaceAttachment(state, "r2", att("x"))?.refs?.map((r) => r.ref)).toEqual(["/api/files/r1", "/api/files/x"]);
    // Failure: the placeholder goes away.
    expect(replaceAttachment(state, "r2", null)?.refs?.map((r) => r.id)).toEqual(["r1"]);
    expect(replaceAttachment(state, "up", null)?.slots?.image).toBeNull();
    // Removed meanwhile: nothing to update.
    expect(replaceAttachment({ slots: {}, refs: [] }, "up", att("done"))).toBeNull();
  });

  it("lists what the + menu can take", () => {
    expect(acceptedKinds(IMAGE_STUDIO.slots, IMAGE_STUDIO.multiRef)).toEqual(["image"]);
    expect(acceptedKinds(LIPSYNC_STUDIO.slots, LIPSYNC_STUDIO.multiRef).sort()).toEqual(["audio", "image", "video"]);
    expect(acceptedKinds([], undefined)).toEqual([]);
  });
});

describe("model picker groups", () => {
  const models = filterModels(MODELS, { kind: IMAGE_STUDIO.kind, ops: IMAGE_STUDIO.ops });
  const cloud = models.filter((m) => m.engine === "cloud");

  it("shows the same models as the catalog query", () => {
    expect(models.map((m) => m.id)).toEqual(modelsFor({ kind: IMAGE_STUDIO.kind, ops: IMAGE_STUDIO.ops }).map((m) => m.id));
  });

  it("puts Recent, Starred and Best above More models, and shows every model once", () => {
    const best = bestForStudio(models, "cloud", IMAGE_STUDIO.defaultModels.cloud).map((m) => m.id);
    expect(best[0]).toBe("nano-banana-pro");
    expect(best.length).toBeLessThanOrEqual(4);
    const recent = [cloud[3].id, "oss-z-image-turbo", cloud[1].id, cloud[2].id, cloud[5].id];
    const starred = [cloud[1].id, cloud[6].id];
    const { groups, count } = groupModels({ models, engine: "cloud", engines: ["cloud", "open"], query: "", recent, starred, best });
    expect(groups.map((g) => g.id)).toEqual(["recent", "starred", "best", "all"]);
    expect(groups[3].label).toBe("More models");
    // Last 3 used of this engine; the open model is skipped.
    expect(groups[0].models.map((m) => m.id)).toEqual([cloud[3].id, cloud[1].id, cloud[2].id]);
    // cloud[1] is already in Recent.
    expect(groups[1].models.map((m) => m.id)).toEqual([cloud[6].id]);
    const top = new Set([...groups[0].models, ...groups[1].models, ...groups[2].models].map((m) => m.id));
    expect(top.size).toBe(groups[0].models.length + groups[1].models.length + groups[2].models.length);
    // More models leaves out what the sections above already show; the count is still every model.
    expect(groups[3].models.some((m) => top.has(m.id))).toBe(false);
    expect(groups[3].models).toHaveLength(cloud.length - top.size);
    expect(groups.flatMap((g) => g.models.map((m) => m.id)).sort()).toEqual(cloud.map((m) => m.id).sort());
    expect(count).toBe(cloud.length);
  });

  it("drops More models when the sections above already show every model", () => {
    const few = cloud.slice(0, 3);
    const { groups, count } = groupModels({ models: few, engine: "cloud", engines: ["cloud"], query: "", recent: [few[0].id], starred: [few[1].id], best: [few[2].id] });
    expect(groups.map((g) => g.id)).toEqual(["recent", "starred", "best"]);
    expect(count).toBe(3);
  });

  it("calls the list All models when nothing shows above it", () => {
    const { groups } = groupModels({ models: cloud, engine: "cloud", engines: ["cloud"], query: "", recent: [], starred: [], best: [] });
    expect(groups.map((g) => [g.id, g.label])).toEqual([["all", "All models"]]);
    expect(groups[0].models).toHaveLength(cloud.length);
  });

  it("searches both engines (best match first) and respects a locked engine", () => {
    const both = groupModels({ models, engine: "cloud", engines: ["cloud", "open"], query: "qwen", recent: [], starred: [], best: [] });
    expect(both.groups).toHaveLength(1);
    expect(new Set(both.groups[0].models.map((m) => m.engine))).toEqual(new Set(["cloud", "open"]));
    expect(both.count).toBe(both.groups[0].models.length);
    const open = groupModels({ models, engine: "open", engines: ["open"], query: "qwen", recent: [], starred: [], best: [] });
    expect(open.groups[0].models.every((m) => m.engine === "open")).toBe(true);
    expect(groupModels({ models, engine: "cloud", engines: ["cloud"], query: "zzzz", recent: [], starred: [], best: [] })).toEqual({ groups: [], count: 0 });
  });

  it("ranks name prefixes above words above anywhere", () => {
    const m = { name: "Nano Banana Pro", vendor: "Google", family: "gemini", tagline: "best text rendering" } as ModelDef;
    expect(matchScore(m, "nano")).toBe(0);
    expect(matchScore(m, "banana")).toBe(1);
    expect(matchScore(m, "ana")).toBe(2);
    expect(matchScore(m, "google text")).toBe(1);
    expect(matchScore(m, "flux")).toBe(-1);
  });

  it("keeps recent and starred lists tidy", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("cost and mentions", () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  it("labels the cost", () => {
    expect(costLabel({ demo: true, cost: 0.4 }, fmt)).toBe("Placeholder · free");
    expect(costLabel({ demo: true, cost: 0.4, compact: true }, fmt)).toBe("Placeholder");
    expect(costLabel({ demo: false, cost: 0 }, fmt)).toBe("Free");
    expect(costLabel({ demo: false, cost: 0.4 }, fmt)).toBe("≈ $0.40");
    expect(costLabel({ demo: false, cost: null }, fmt)).toBe("");
    // A price the provider hasn't published (fal's MOSS-Image with LoRAs) is said, never shown as free.
    expect(costLabel({ demo: false, cost: null, unknown: true }, fmt)).toBe("Price unknown");
    expect(costLabel({ demo: false, cost: null, unknown: true, compact: true }, fmt)).toBe("Price unknown");
  });
  it("spots @mentions (spellcheck off)", () => {
    expect(hasMention("@Koi_Pond_Night at dusk")).toBe(true);
    expect(hasMention("a shot of @Maya")).toBe(true);
    expect(hasMention("mail me@example.com")).toBe(false);
    expect(hasMention("no handles here")).toBe(false);
  });
});

describe("studio catalog slice", () => {
  it("ships only the studio's models, without provider field maps", () => {
    const video = studioCatalog(VIDEO_STUDIO);
    expect(video.models.map((m) => m.id)).toEqual(expect.arrayContaining(["seedance-2-5", "oss-wan22-14b-fast"]));
    expect(video.models.length).toBeLessThan(MODELS.length / 2);
    expect(video.models.every((m) => m.kind === "video")).toBe(true);
    expect(video.models.every((m) => m.routes.every((r) => r.map === undefined))).toBe(true);
    expect(JSON.stringify(video).length).toBeLessThan(JSON.stringify(MODELS).length / 3);
  });

  it("includes the defaults and an app's own (hidden) models", () => {
    const relight = getPreset("app-relight")!;
    const app = studioCatalog(appStudio(relight));
    expect(app.models.map((m) => m.id)).toEqual(expect.arrayContaining([relight.cloud!.modelId, relight.open!.modelId]));
    const edit = studioCatalog(EDIT_STUDIO);
    expect(edit.models.map((m) => m.id)).toEqual(expect.arrayContaining([EDIT_STUDIO.defaultModels.cloud, EDIT_STUDIO.defaultModels.open]));
  });
});

describe("a preset opens on the model its preview was made with", () => {
  const inCatalog = (id: string) => !!getModel(id);
  // An account with a Replicate token only: hosted MiniMax H3 is on fal alone.
  const replicateOnly = { viewer: { kind: "account" as const, keys: ["replicate" as const] } };
  const runs = (id: string) => inCatalog(id) && !needsKey(getModel(id), replicateOnly);

  it("ships an app's two models in its slice and offers both", () => {
    const face = withRecipe(appStudio(getPreset("app-face-swap")!), inCatalog);
    const ids = studioCatalog(face).models.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["oss-qwen-image-21-turbo", "oss-reactor", "nano-banana-pro"]));
    const dance = withRecipe(appStudio(getPreset("app-dance")!), inCatalog);
    expect(studioCatalog(dance).models.map((m) => m.id)).toEqual(expect.arrayContaining(["oss-minimax-h3", "minimax-h3", "oss-wan22-14b", "kling-2-5-turbo"]));
  });

  it("starts a motion on H3 at the Quality its cover was made at, and an app on its route's settings", () => {
    expect(presetOriginal(getPreset("motion-crash-zoom-in")!, "open", inCatalog)).toBe("oss-minimax-h3");
    expect(presetParams(getPreset("motion-crash-zoom-in")!, "open", inCatalog)).toEqual({ duration: 5, extra: { quality: "best" } });
    // Fast is H3's default: nothing to set (Director stays on Auto). The orbit stays the preset's (the planner adds it).
    expect(presetParams(getPreset("motion-truck-left")!, "open", inCatalog)).toEqual({ duration: 5 });
    expect(presetParams(getPreset("motion-360-orbit")!, "open", inCatalog)).toEqual({ duration: 3 });
    // A colour-grade effect starts on Fuobe DoP.
    expect(presetOriginal(getPreset("effect-candy-pink")!, "open", inCatalog)).toBe("fuobe-dop");
    const dance = getPreset("app-dance")!;
    expect(routeParams(appRoute(dance, "open", "oss-wan22-14b", inCatalog), "app")).toEqual(dance.open!.params);
    expect(routeParams(appRoute(dance, "open", "oss-minimax-h3", inCatalog), "app")).toEqual({ duration: 5 });
  });

  it("falls back to the preset's own route where the viewer can't run its recipe (a Replicate-only account)", () => {
    const dance = getPreset("app-dance")!;
    expect(presetFallback(dance, "cloud", "minimax-h3", inCatalog, runs)?.modelId).toBe("kling-2-5-turbo");
    // A viewer who can run the recipe stays on it; so does one on another model already.
    expect(presetFallback(dance, "cloud", "minimax-h3", inCatalog, inCatalog)).toBeUndefined();
    expect(presetFallback(dance, "cloud", "kling-2-5-turbo", inCatalog, runs)).toBeUndefined();
    // A motion: its own cloud route (Fuobe DoP · LTX for Truck Left), when the move is picked and when it is open.
    const truck = getPreset("motion-truck-left")!;
    expect(presetOriginal(truck, "cloud", runs)).toBe(truck.cloud!.modelId);
    expect(presetFallback(truck, "cloud", "minimax-h3", inCatalog, runs)?.modelId).toBe(truck.cloud!.modelId);
    // A model switched off in Settings: the GPU's H3 gives way to Fuobe DoP.
    const offH3 = (id: string) => id !== "oss-minimax-h3" && inCatalog(id);
    expect(presetFallback(truck, "open", "oss-minimax-h3", inCatalog, offH3)?.modelId).toBe("fuobe-dop");
    // Nothing runnable: the recipe stays (Generate asks for the key).
    expect(presetFallback(dance, "cloud", "minimax-h3", inCatalog, () => false)).toBeUndefined();
    // A preset with one route has nowhere to go.
    expect(presetFallback(getPreset("effect-candy-pink")!, "open", "fuobe-dop", inCatalog, () => false)).toBeUndefined();
  });

  it("lists an app's two models once each, in their order", () => {
    const models = ["oss-qwen-image-21-turbo", "oss-reactor"].map((id) => getModel(id)!);
    const flat = groupModels({ models, engine: "open", engines: ["cloud", "open"], query: "", recent: ["oss-reactor"], starred: [], best: ["oss-qwen-image-21-turbo"], flat: true });
    expect(flat.groups.map((g) => g.models.map((m) => m.id))).toEqual([["oss-qwen-image-21-turbo", "oss-reactor"]]);
    expect(flat.count).toBe(2);
    const grouped = groupModels({ models, engine: "open", engines: ["cloud", "open"], query: "", recent: [], starred: [], best: ["oss-qwen-image-21-turbo"] });
    expect(grouped.groups.map((g) => g.id)).toEqual(["best", "all"]);
  });

  it("keeps an app on its own models when the engine changes (AI Influencer's cloud Original on the GPU)", () => {
    const influencer = getPreset("app-ai-influencer")!;
    const defaults = { cloud: "fuobe-soul", open: "oss-zimage-soul-cast" };
    const soulOnGpu = { id: "fuobe-soul", engine: "open" as const };
    expect(engineSwitchModel({ model: soulOnGpu, preset: influencer, engine: "open", from: "cloud", defaults, has: inCatalog })).toBe("oss-zimage-soul-cast");
    expect(engineSwitchModel({ model: soulOnGpu, preset: influencer, engine: "open", from: "open", defaults, has: inCatalog })).toBe("oss-zimage-soul-cast");
    expect(engineSwitchModel({ model: { id: "fuobe-soul", engine: "cloud" }, preset: influencer, engine: "cloud", from: "open", defaults, has: inCatalog })).toBeUndefined();
    // An app on its own route stays; on the other engine's model it moves to this engine's recipe.
    const face = getPreset("app-face-swap")!;
    expect(engineSwitchModel({ model: { id: "oss-reactor", engine: "open" }, preset: face, engine: "open", from: "open", defaults, has: inCatalog })).toBeUndefined();
    expect(engineSwitchModel({ model: { id: "nano-banana-pro", engine: "cloud" }, preset: face, engine: "open", from: "cloud", defaults, has: inCatalog })).toBe("oss-qwen-image-21-turbo");
    // An app with no version on the engine keeps its model (Generate says so).
    expect(engineSwitchModel({ model: { id: "oss-wan22-animate", engine: "open" }, preset: getPreset("app-recast")!, engine: "cloud", from: "open", defaults, has: inCatalog })).toBeUndefined();
  });
});

describe("an app page's hero", () => {
  it("says what you get: the notes stay in Details, a missing engine is said", () => {
    for (const id of ["app-similarity-score", "app-angles", "app-rap-god", "app-video-background-remover", "app-gtai", "app-shots", "app-clipcut"]) {
      const p = getPreset(id)!;
      expect(appStudio(p).subtitle ?? "", id).not.toMatch(/Higgsfield|Approximation|silent|LoRA/);
    }
    const cloudOnly = getPreset("app-similarity-score")!;
    expect(appStudio({ ...cloudOnly, open: null }).subtitle).toBe("Cloud only for now");
    expect(appStudio({ ...cloudOnly, cloud: null }).subtitle).toBe("Open source only for now");
  });

  it("Details says what Fuobe makes, naming no other product and no developer notes", () => {
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) {
      expect(p.parity ?? "", p.id).not.toMatch(/Higgsfield|Approximation|Not reproducible|Not yet measured|evaluation suite|\.safetensors|Kling 2\.5 \/ Wan 2\.2/i);
      // No LoRA file names, research notes or GPU sizes and licences of a route in brackets.
      expect(p.parity ?? "", p.id).not.toMatch(/_\d+_epochs|\[wan|already in the map|research holds|civitai|evaluated|White_to_Scene|\(\d+ GB GPU/i);
      // Each note is whole sentences.
      if (p.parity) expect(p.parity, p.id).toMatch(/[.!?]$/);
    }
    const note = (id: string) => getPreset(id)!.parity;
    expect(note("app-similarity-score")).toBe("Finds logos and recognizable characters and replaces them with unbranded ones of the same shape and color.");
    expect(note("app-clipcut")).toBe("Makes one continuous clip from your selfie. Add music with Video to audio.");
    for (const id of ["app-asmr-classic", "app-rap-god"]) expect(note(id), id).toBe("This makes a silent clip. Add sound with Video to audio.");
    expect(note("app-asmr-add-on")).toMatch(/This makes a silent clip\. Add sound with Video to audio\.$/);
  });

  it("names IP Cleanup for what it does, on its old address", () => {
    expect(getPreset("app-similarity-score")!.name).toBe("IP Cleanup");
  });

  it("points the silent clip apps at Video to audio", () => {
    for (const id of ["app-asmr-classic", "app-rap-god"]) expect(appStudio(getPreset(id)!).related, id).toEqual({ href: "/audio/video", label: "Add sound to your clip" });
  });
});

describe("Audio → Transcribe", () => {
  it("lists the transcribers of both engines, each with its spoken languages, and asks for a recording or a video", () => {
    const ids = studioCatalog(TRANSCRIBE_STUDIO).models.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["scribe-v2", "wizper", "whisper", "oss-qwen3-asr"]));
    expect(filterModels(studioCatalog(TRANSCRIBE_STUDIO).models, { ops: TRANSCRIBE_STUDIO.ops }).every((m) => m.options.sourceLanguages?.length)).toBe(true);
    const missing = firstMissingSlot(TRANSCRIBE_STUDIO.slots, {}, TRANSCRIBE_STUDIO.anyOf);
    expect(blockerFor({ model: true, missing, uploading: false, promptMissing: false })).toEqual({ message: "Add a recording or a video", slot: "audio" });
    expect(firstMissingSlot(TRANSCRIBE_STUDIO.slots, { video: att("v", "video") }, TRANSCRIBE_STUDIO.anyOf)).toBeUndefined();
  });
});

