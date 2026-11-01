import { describe, expect, it } from "vitest";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";
import { onEngine } from "@/lib/catalog/engines";
import { BURN_CAPS, burnPricePerMinute, burnRequest, burnRouteFor, CAPTION_STYLES, lookFor, nearestColorName, OPEN_FONT_SIZE, previewText, styleById, usesCues, type CaptionLook } from "@/lib/av/captions";
import { animateSpinHref, model3dRequest, model3dView, MODELS_3D } from "@/lib/av/model3d";
import { frameParams, frameRequest } from "@/lib/av/frames";
import type { Cue } from "@/lib/cues";

const cues: Cue[] = [
  { start: 0, end: 1.5, text: "hello there friends" },
  { start: 1.6, end: 3, text: "  " },
  { start: 3.1, end: 4.2, text: "second line" },
];
const look = (o: Partial<CaptionLook> = {}): CaptionLook => ({ style: "clean", size: "M", position: "bottom", ...o });

describe("caption style → burn params", () => {
  it("picks the burner per engine and says which take the edited lines", () => {
    expect(burnRouteFor("open", true)).toBe("open");
    expect(burnRouteFor("cloud", false)).toBe("veed");
    expect(burnRouteFor("cloud", true)).toBe("auto");
    expect([usesCues("open"), usesCues("veed"), usesCues("auto")]).toEqual([true, true, false]);
  });

  it("open: the edited cues, size as % of the frame, top/bottom, karaoke as a few words at a time", () => {
    const r = burnRequest({ route: "open", video: "v.mp4", cues, look: look({ style: "karaoke", size: "L", position: "center" }) });
    expect(r).toMatchObject({ modelId: "oss-captions-burnin", op: "captions", inputs: { video: "v.mp4" } });
    expect(r.params?.extra).toEqual({
      cues: [
        { start: 0, end: 1.5, text: "HELLO THERE FRIENDS" },
        { start: 3.1, end: 4.2, text: "SECOND LINE" },
      ],
      fontSize: OPEN_FONT_SIZE.L,
      fontColor: "#ffffff",
      captionPosition: "bottom", // the open burner has no centre: bottom
      wordsPerCaption: 3,
    });
    const plain = burnRequest({ route: "open", video: "v.mp4", cues, look: look({ color: "#ff0000", position: "top" }) });
    expect(plain.params?.extra).toMatchObject({ fontColor: "#ff0000", captionPosition: "top", wordsPerCaption: 0 });
    expect(() => burnRequest({ route: "open", video: "v.mp4", cues: [{ start: 0, end: 1, text: " " }], look: look() })).toThrow(/no lines/);
  });

  it("VEED: its preset, the lines as SRT and dotted customization keys that nest into the payload", () => {
    const r = burnRequest({ route: "veed", video: "v.mp4", cues, look: look({ style: "boxed", position: "top" }) });
    const extra = r.params!.extra as Record<string, unknown>;
    expect(extra.preset).toBe("backdrop");
    expect(extra.srt_content).toBe("1\n00:00:00,000 --> 00:00:01,500\nhello there friends\n\n2\n00:00:03,100 --> 00:00:04,200\nsecond line\n");
    expect(extra["customization.position"]).toBe("top");
    expect(extra["customization.shadow"]).toBe("none");
    const veed = getModel("veed-subtitles")!;
    const payload = buildPayload(veed.routes[0].map!, { prompt: "", video: "https://x/v.mp4", extra });
    expect(payload.customization).toMatchObject({ position: "top", text_customizations: { baseline: { font: "Inter", weight: 700, color: "#ffffff" } } });
    const karaoke = burnRequest({ route: "veed", video: "v.mp4", cues, look: look({ style: "karaoke" }) });
    expect((karaoke.params!.extra as Record<string, unknown>)["customization.text_customizations.highlighted.color"]).toBe("#8b5cf6");
  });

  it("Auto Subtitle: named colours, size in px, words per subtitle, the spoken language", () => {
    const r = burnRequest({ route: "auto", video: "v.mp4", cues: [], look: look({ style: "bold", size: "S" }), sourceLanguage: "es" });
    expect(r.params).toEqual({
      sourceLanguage: "es",
      extra: { font_name: "Montserrat", font_weight: "black", font_color: "yellow", highlight_color: "yellow", position: "bottom", font_size: 60, words_per_subtitle: 6, background_color: "none" },
    });
    const k = burnRequest({ route: "auto", video: "v.mp4", cues: [], look: look({ style: "karaoke" }), sourceLanguage: "auto" });
    expect(k.params).not.toHaveProperty("sourceLanguage");
    expect(k.params!.extra).toMatchObject({ highlight_color: "purple", words_per_subtitle: 3 });
    expect(nearestColorName("#00e5ff")).toBe("cyan");
    expect(nearestColorName("#fefefe")).toBe("white");
  });

  it("every style has a VEED preset and a distinct id; the preview shows the line on screen", () => {
    expect(new Set(CAPTION_STYLES.map((s) => s.id)).size).toBe(CAPTION_STYLES.length);
    for (const s of CAPTION_STYLES) expect(s.veed).toBeTruthy();
    expect(styleById("nope").id).toBe("clean");
    expect(previewText(cues, 0.5, look())?.text).toBe("hello there friends");
    expect(previewText(cues, 5, look())).toBeNull();
  });

  it("the controls and the preview promise only what each burner draws", () => {
    // Open: top or bottom only (Middle falls back), no box, karaoke in 3-word groups without a highlight.
    expect(lookFor("open", look({ position: "center" })).position).toBe("bottom");
    expect(lookFor("veed", look({ position: "center" })).position).toBe("center");
    expect(BURN_CAPS.open).toMatchObject({ box: false, highlight: "none", karaokeWords: 3 });
    const karaoke = look({ style: "karaoke" });
    const six: Cue[] = [{ start: 0, end: 3, text: "hello there friends how are you" }];
    expect(previewText(six, 0.6, karaoke, "open")).toEqual({ text: "HELLO THERE FRIENDS" });
    expect(previewText(six, 0.6, karaoke, "auto")).toEqual({ text: "HELLO THERE FRIENDS", highlight: 1 });
    // VEED renders the whole line (its preset animates it) and sizes text itself: Size isn't offered.
    expect(previewText(six, 0.6, karaoke, "veed")).toEqual({ text: "HELLO THERE FRIENDS HOW ARE YOU" });
    expect(BURN_CAPS.veed.sizes).toBe(false);
    expect(burnRequest({ route: "veed", video: "/v.mp4", cues, look: look({ size: "L" }) }).params?.extra).not.toHaveProperty("font_size");
    // Karaoke, Boxed and Neon map to VEED's dynamic presets, which cost twice as much.
    expect(CAPTION_STYLES.filter((s) => burnPricePerMinute("veed", s.id) === 0.2).map((s) => s.id)).toEqual(["karaoke", "boxed", "neon"]);
    expect(burnPricePerMinute("veed", "clean")).toBe(0.1);
    expect(burnPricePerMinute("open", "karaoke")).toBe(0);
    // The feed names a burn by its style.
    expect(burnRequest({ route: "open", video: "/v.mp4", cues, look: look({ style: "karaoke" }) }).title).toBe("Captions · Karaoke");
    expect(burnRequest({ route: "auto", video: "/v.mp4", cues: [], look: look() }).title).toBe("Captions · Quick karaoke");
  });

  it("an old app id still finds its app (generations made before the rename keep Reuse and Retry)", () => {
    expect(getPreset("app-virality-predictor")?.id).toBe("app-hook-frame");
    expect(getPreset("app-hook-frame")?.name).toBe("Hook Frame");
    expect(getPreset("app-nope")).toBeUndefined();
  });
});

describe("3D viewer data flow", () => {
  it("asks the engine's 3D model for the photo; an unknown pick falls back to the default", () => {
    expect(model3dRequest({ engine: "cloud", photo: "p.png" })).toEqual({ feature: "image-to-3d", modelId: "hunyuan-3d-3-1-pro", op: "image-to-3d", inputs: { images: ["p.png"] } });
    expect(model3dRequest({ engine: "open", photo: "p.png", modelId: "trellis-2" }).modelId).toBe("oss-pixal3d");
    expect(model3dRequest({ engine: "cloud", photo: "p.png", modelId: "tripo-h3-1" }).modelId).toBe("tripo-h3-1");
    for (const m of [...MODELS_3D.image.cloud, ...MODELS_3D.image.open]) expect(getModel(m.id)?.routes.some((r) => r.op === "image-to-3d"), m.id).toBe(true);
  });

  it("a cloud GLB with formats and a preview → viewer, downloads, and Animate the spin from the photo", () => {
    const outputs = extractOutputs(
      { model_glb: { url: "https://cdn/x/model.glb", content_type: "application/octet-stream" }, model_urls: { glb: { url: "https://cdn/x/model.glb" }, obj: { url: "https://cdn/x/model.obj" }, usdz: { url: "https://cdn/x/model.usdz" } }, thumbnail: { url: "https://cdn/x/thumb.png" } },
      "image-to-3d",
    );
    const view = model3dView({ outputs: outputs.map((o) => ({ ...o, meta: o.meta ?? {} })) as never, request: model3dRequest({ engine: "cloud", photo: "/api/files/p.png" }) });
    expect(view).toEqual({ glb: "https://cdn/x/model.glb", web: "https://cdn/x/model.glb", poster: "https://cdn/x/thumb.png", photo: "/api/files/p.png", turntable: undefined, formats: { glb: "https://cdn/x/model.glb", obj: "https://cdn/x/model.obj", usdz: "https://cdn/x/model.usdz" } });
    const href = animateSpinHref(view)!;
    expect(href.startsWith("/video?")).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]).get("image")).toBe("/api/files/p.png");
    // A turntable recorded in the browser takes over: restyle it in Edit video.
    const recorded = animateSpinHref(view, "/api/files/turn.webm")!;
    expect(recorded.startsWith("/video-edit?")).toBe(true);
    expect(new URLSearchParams(recorded.split("?")[1]).get("video")).toBe("/api/files/turn.webm");
  });

  it("an open (server-rendered) / demo result brings its own turntable", () => {
    const view = model3dView({
      outputs: [
        { url: "/api/files/m.glb", kind: "model3d", meta: { format: "glb" } },
        { url: "/api/files/turn.mp4", kind: "video", meta: { turntable: true } },
      ] as never,
      request: model3dRequest({ engine: "open", photo: "p.png" }),
    });
    expect(view.turntable).toBe("/api/files/turn.mp4");
    expect(animateSpinHref(view)).toMatch(/^\/video-edit\?video=%2Fapi%2Ffiles%2Fturn\.mp4/);
    expect(model3dView({ outputs: [], request: { feature: "x", modelId: "y", op: "image-to-3d" } as never })).toMatchObject({ glb: undefined, formats: {} });
    expect(animateSpinHref({ formats: {} })).toBeNull();
  });
});

describe("extract frame on both engines", () => {
  it("cloud names the frame; open decodes a short window and takes its first frame", () => {
    expect(frameParams("cloud", "last")).toEqual({ extra: { frame_type: "last" } });
    expect(() => frameParams("cloud", { at: 2 })).toThrow(/first, middle or last/);
    expect(frameParams("open", "last")).toBeUndefined();
    expect(frameParams("open", "first")).toEqual({ startTime: 0, endTime: 0.5, extra: { frameIndex: 0 } });
    expect(frameParams("open", { at: 3.2 })).toEqual({ startTime: 3.2, endTime: 3.7, extra: { frameIndex: 0 } });
    expect(frameRequest({ feature: "f", engine: "open", video: "v.mp4", pick: "last" })).toEqual({ feature: "f", modelId: "oss-extract-frame", op: "frame", inputs: { video: "v.mp4" } });
    expect(getModel("oss-extract-frame")?.routes[0]).toMatchObject({ provider: "comfyui", endpoint: "frame-extract", op: "frame" });
  });
});

describe("apps on the new models", () => {
  // Every app this package routes runs with only its inputs on both engines: no note needed, the pinned model, its settings.
  const ids = ["app-virtual-try-on", "app-angles", "app-fuobe-angles", "app-product-shot", "app-image-to-3d", "app-hook-frame"];
  const plan = (id: string, engine: "cloud" | "open", presetOptions?: Record<string, string>) => {
    const preset = getPreset(id)!;
    const route = engine === "cloud" ? preset.cloud! : preset.open!;
    const images = (preset.inputs ?? []).filter((s) => s.accept === "image").map((_, i) => `/api/files/in${i}.png`);
    // An Original (Fuobe Angles) plans as it runs on the engine asked for.
    const lookup = (m: string) => (getModel(m)?.engines ? onEngine(getModel(m)!, engine) : getModel(m));
    return planGeneration({ feature: `app:${id}`, presetId: id, modelId: route.modelId, inputs: { images }, presetOptions }, lookup, getPreset);
  };

  it.each(ids.flatMap((id) => [[id, "cloud"] as const, [id, "open"] as const]))("%s plans on %s without a prompt", (id, engine) => {
    expect(() => plan(id, engine)).not.toThrow();
  });

  it("pins the dedicated models", () => {
    expect(plan("app-virtual-try-on", "cloud").model.id).toBe("fashn-tryon");
    expect(plan("app-virtual-try-on", "open").model.id).toBe("oss-tryon-klein");
    expect(plan("app-product-shot", "cloud").model.id).toBe("bria-product-shot");
    expect(plan("app-product-shot", "open").model.id).toBe("oss-product-shot");
    expect(plan("app-image-to-3d", "cloud").model.id).toBe("hunyuan-3d-3-1-pro");
    expect(plan("app-image-to-3d", "open").model.id).toBe("oss-pixal3d");
  });

  it("Angles: the choices set the camera sliders on the cloud and the LoRA's words on the open engine", () => {
    const choice = { angle: "back-left", height: "high-angle", distance: "close-up" };
    const cloud = plan("app-angles", "cloud", choice);
    expect(cloud.model.id).toBe("qwen-multiple-angles");
    expect(cloud.params.extra).toMatchObject({ horizontal_angle: 225, vertical_angle: 60, zoom: 10 });
    expect(cloud.prompt.length).toBeGreaterThan(0);
    const open = plan("app-angles", "open", choice);
    expect(open.prompt).toMatch(/^<sks> back-left quarter view high-angle shot close-up/);
    expect(open.loras[0]?.file).toMatch(/multiple-angles/);
  });

  it("Fuobe Angles: the choices set the camera fields on the cloud and the LoRA's words on the open engine (O11)", () => {
    const choice = { rotate: "45-right", height: "from-above", distance: "close-up" };
    const cloud = plan("app-fuobe-angles", "cloud", choice);
    expect(cloud.model.id).toBe("fuobe-angles");
    expect(cloud.params.extra).toMatchObject({ rotate_right_left: -45, vertical_angle: -1, move_forward: 10 });
    const open = plan("app-fuobe-angles", "open", choice);
    expect(open.prompt).toMatch(/^将镜头向右旋转45度 Rotate the camera 45 degrees to the right\. .*Turn the camera to a close-up\. .*bird's-eye view\.$/);
    expect(open.loras[0]?.file).toMatch(/multiple-angles/);
  });

  it("Video Background Remover mattes the whole clip with BiRefNet on both engines (no more single frame)", () => {
    const preset = getPreset("app-video-background-remover")!;
    expect(preset.inputs).toEqual([expect.objectContaining({ key: "video", accept: "video", required: true })]);
    for (const [engine, model] of [["cloud", "birefnet-video"], ["open", "oss-video-matte-birefnet"]] as const) {
      const route = engine === "cloud" ? preset.cloud! : preset.open!;
      const p = planGeneration({ feature: `app:${preset.id}`, presetId: preset.id, modelId: route.modelId, inputs: { video: "/api/files/in.mp4" } }, getModel, getPreset);
      expect([p.model.id, p.op]).toEqual([model, "bg-remove-video"]);
    }
    expect(preset.parity).not.toMatch(/no video matting|single frame/);
  });

  it("Product Shot sends a scene description only (Bria takes a description or a reference photo, never both)", () => {
    expect(plan("app-product-shot", "cloud", { scene: "beach" }).prompt).toMatch(/^The product on warm sand at the beach/);
    expect(getPreset("app-product-shot")!.inputs!.some((s) => s.key === "image2")).toBe(false);
  });
});
