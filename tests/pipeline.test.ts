import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.mock("@/lib/catalog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/catalog")>();
  const { ROUND3_FIXTURES } = await import("./fixtures/round3-models");
  return { ...mod, MODELS: [...mod.MODELS, ...ROUND3_FIXTURES], getModel: (id: string) => ROUND3_FIXTURES.find((m) => m.id === id) ?? mod.getModel(id) };
});
vi.setConfig({ testTimeout: 90_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-pipeline-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createPipeline, assertOneMode } = await import("@/server/chains");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const { probeOllama } = await import("@/server/providers/llm");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 80_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const dependsOn = (id: string) => {
  const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
  return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
};

const step = (key: string, modelId: string, extra: Record<string, unknown> = {}) => ({ key, request: { feature: "dub", modelId, prompt: key, ...extra } });

describe("createPipeline validation", () => {
  it("rejects unknown and duplicate keys, loops and mismatched slots before creating anything", () => {
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    expect(() => createPipeline([])).toThrow(/at least one step/);
    expect(() => createPipeline([step("a", "nano-banana-pro"), step("a", "nano-banana-pro")])).toThrow(/Two steps are called “a”/);
    expect(() => createPipeline([{ ...step("a", "nano-banana-pro"), after: "ghost" }])).toThrow(/waits for “ghost”, which isn't in the pipeline/);
    expect(() => createPipeline([{ ...step("a", "nano-banana-pro"), after: "a" }])).toThrow(/can't wait for itself/);
    expect(() =>
      createPipeline([
        { ...step("a", "nano-banana-pro"), after: "b" },
        { ...step("b", "nano-banana-pro"), after: "a" },
      ]),
    ).toThrow(/in a loop: “a”, “b”/);
    expect(() => createPipeline([step("a", "nano-banana-pro"), { ...step("b", "kling-3"), after: "a", chain: [{ slot: "images" }, { slot: "endImage" }] }])).toThrow(/2 chain slots for 1 earlier step/);
    expect(() => createPipeline([step("a", "nano-banana-pro"), { ...step("b", "text-llm", { op: "translate" }), after: "a", chain: [{ slot: "prompt" }] }])).toThrow(/Step “b”: Pick a language/);
    expect(() => createPipeline([step("a", "kling-3", { params: { numOutputs: 2 } }), { ...step("b", "kling-3"), after: "a" }])).toThrow(/makes 2 jobs/);
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
  });

  it("refuses to mix demo and paid steps (S9)", () => {
    setSetting("falKey", "fal-test-key");
    try {
      // The fixtures run on fal (now "connected"); the LLM has nothing to run on.
      expect(() => createPipeline([step("words", "test-transcribe", { inputs: { audio: "/api/files/uploads/voice.wav" } }), { ...step("es", "text-llm", { op: "translate", params: { targetLanguage: "Spanish" } }), after: "words", chain: [{ slot: "prompt" }] }])).toThrow(
        /Step “es” would run as a demo \(Claude needs Claude or a local model\)/,
      );
      expect(() => assertOneMode([{ label: "Joining clips", modelId: "join-clips", op: "concat" }, { label: "Writing", modelId: "text-llm", op: "write" }])).toThrow(/Writing needs Claude or a local model/);
    } finally {
      setSetting("falKey", "");
    }
    expect(() => assertOneMode([{ label: "Joining clips", modelId: "join-clips", op: "concat" }, { label: "Writing", modelId: "text-llm", op: "write" }])).not.toThrow();
  });
});

describe("createPipeline on the demo provider", () => {
  it("dubs a clip: stems → transcript → translation → cloned voice → lipsync → mux", async () => {
    const video = saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-landscape.mp4")), contentType: "video/mp4", source: "upload" }).url;
    const p = createPipeline([
      { key: "film", request: { feature: "dub", modelId: "test-mux", op: "mux", prompt: "Final cut" }, after: ["lips", "voice"], chain: [{ slot: "video" }, { slot: "audio" }] },
      { key: "stems", request: { feature: "dub", modelId: "test-separate", op: "separate-audio", prompt: "Split", inputs: { video } } },
      { key: "words", request: { feature: "dub", modelId: "test-transcribe", op: "transcribe", prompt: "Transcribe" }, after: "stems", chain: [{ slot: "audio" }] },
      { key: "spanish", request: { feature: "dub", modelId: "text-llm", op: "translate", params: { targetLanguage: "Spanish" } }, after: "words", chain: [{ slot: "prompt" }] },
      { key: "voice", request: { feature: "dub", modelId: "chatterbox-cloud", op: "tts" }, after: ["spanish", "stems"], chain: [{ slot: "prompt" }, { slot: "voiceAudio" }] },
      { key: "lips", request: { feature: "dub", modelId: "sync-lipsync-3", op: "lipsync", inputs: { video } }, after: "voice", chain: [{ slot: "audio" }] },
    ]);
    // Created in dependency order, all in one batch, labelled by step.
    expect(p.items.map((g) => g.request.step?.label)).toEqual(["Step 1 of 6", "Step 2 of 6", "Step 3 of 6", "Step 4 of 6", "Step 5 of 6", "Step 6 of 6"]);
    expect(p.items.map((g) => g.op)).toEqual(["separate-audio", "transcribe", "translate", "tts", "lipsync", "mux"]);
    expect(new Set(p.items.map((g) => g.batchId))).toEqual(new Set([p.batchId]));
    expect(dependsOn(p.byKey.voice.id)).toEqual([p.byKey.spanish.id, p.byKey.stems.id]);
    expect(dependsOn(p.byKey.film.id)).toEqual([p.byKey.lips.id, p.byKey.voice.id]);
    // A waiting step shows its own words, not the placeholder text.
    expect(p.byKey.voice.prompt).toBeNull();

    const film = await settle(p.byKey.film.id);
    expect(film.status, film.error ?? "").toBe("succeeded");
    const get = (k: string) => gens.getGeneration(p.byKey[k].id)!;
    const [stems, words, spanish, voice, lips] = ["stems", "words", "spanish", "voice", "lips"].map(get);
    // The transcript goes in as cues, so the translation keeps the timing.
    expect(JSON.parse(spanish.request.prompt!)).toEqual(words.outputs[0].meta!.cues);
    expect((spanish.outputs[0].meta!.cues as { start: number }[]).map((c) => c.start)).toEqual((words.outputs[0].meta!.cues as { start: number }[]).map((c) => c.start));
    // "prompt": the translation is what gets spoken; "voiceAudio": the voice stem is cloned.
    expect(voice.request.prompt).toBe(spanish.outputs[0].text);
    expect(voice.prompt).toBe(spanish.outputs[0].text);
    expect(voice.request.inputs?.voiceAudio).toBe(stems.outputs.find((o) => o.meta?.stem === "voice")!.url);
    expect(words.request.inputs?.audio).toBe(stems.outputs[0].url);
    expect(lips.request.inputs).toMatchObject({ video, audio: voice.outputs[0].url });
    expect(film.request.inputs).toMatchObject({ video: lips.outputs[0].url, audio: voice.outputs[0].url });
  });
});

describe("stems and the second audio track", () => {
  const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-landscape.mp4")), contentType: "video/mp4", source: "upload" }).url;
  const providerInput = (id: string) => JSON.parse((db().prepare("SELECT provider_input_json FROM generations WHERE id = ?").get(id) as { provider_input_json: string }).provider_input_json) as Record<string, unknown>;

  it("separates once, clones the voice stem and mixes the new voice over the background stem", async () => {
    const video = clip();
    const p = createPipeline([
      { key: "stems", request: { feature: "dub", modelId: "oss-voice-separate", op: "separate-audio", inputs: { video } } },
      { key: "voice", request: { feature: "dub", modelId: "oss-chatterbox", op: "tts", prompt: "Hola a todos, bienvenidos." }, after: "stems", chain: [{ slot: "voiceAudio", stem: "voice" }] },
      {
        key: "film",
        request: { feature: "dub", modelId: "oss-mux", op: "mux", inputs: { video } },
        after: ["voice", "stems"],
        chain: [{ slot: "audio" }, { slot: "audio2", stem: "background" }],
      },
    ]);
    expect(p.items.map((g) => g.op)).toEqual(["separate-audio", "tts", "mux"]);
    expect(dependsOn(p.byKey.film.id)).toEqual([p.byKey.voice.id, p.byKey.stems.id]);

    const film = await settle(p.byKey.film.id);
    expect(film.status, film.error ?? "").toBe("succeeded");
    const stems = gens.getGeneration(p.byKey.stems.id)!;
    const voice = gens.getGeneration(p.byKey.voice.id)!;
    const stem = (name: string) => stems.outputs.find((o) => o.meta?.stem === name)!.url;
    // Two stems, then (like the real dub-prepare workflow) the voice stem's timed transcript.
    expect(stems.outputs.map((o) => o.meta?.stem ?? o.meta?.role)).toEqual(["voice", "background", "cues"]);
    // The voice stem is cloned; the background stem (not the first audio output) goes under the new voice.
    expect(voice.request.inputs?.voiceAudio).toBe(stem("voice"));
    expect(film.request.inputs).toEqual({ video, audio: voice.outputs[0].url, audio2: stem("background") });
    // …and reaches the provider as the canonical second track.
    const sent = providerInput(film.id);
    expect(sent.audio).toEqual(expect.stringMatching(/^data:audio\/wav/));
    expect(sent.audio2).toEqual(expect.stringMatching(/^data:audio\/wav/));
  });

  it("accepts audio2 on POST /api/generations", async () => {
    const { POST } = await import("@/app/api/generations/route");
    const res = await POST(
      new Request("http://localhost/api/generations", {
        method: "POST",
        body: JSON.stringify({ feature: "edit", modelId: "oss-mux", op: "mux", inputs: { video: "/api/files/a.mp4", audio: "/api/files/v.wav", audio2: "/api/files/bg.wav" } }),
      }),
    );
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: Generation[] };
    expect(items[0].request.inputs?.audio2).toBe("/api/files/bg.wav");
    await gens.cancelGeneration(items[0].id);
  });

  it("fails a step whose stem the earlier step didn't make, and refuses a stem on a non-audio slot", async () => {
    expect(() =>
      createPipeline([step("a", "oss-voice-separate", { op: "separate-audio", inputs: { video: "/api/files/a.mp4" } }), { ...step("b", "oss-mux", { op: "mux", inputs: { audio: "/api/files/v.wav" } }), after: "a", chain: [{ slot: "video", stem: "voice" }] }]),
    ).toThrow(/Step “b”: a stem \(“voice”\) only goes into an audio slot, not “video”/);
    const p = createPipeline([
      step("a", "oss-voice-separate", { op: "separate-audio", inputs: { video: clip() } }),
      { ...step("b", "oss-chatterbox", { op: "tts" }), after: "a", chain: [{ slot: "voiceAudio", stem: "drums" }] },
    ]);
    const b = await settle(p.byKey.b.id);
    expect(b.status).toBe("failed");
    expect(b.error).toBe("An earlier step has no drums stem to use");
  });

  it("picks stems by the names other providers use (Demucs: vocals)", () => {
    const outs = [
      { url: "/api/files/drums.wav", kind: "audio" as const, meta: { stem: "drums" } },
      { url: "/api/files/vocals.wav", kind: "audio" as const, meta: { stem: "vocals" } },
      { url: "/api/files/rest.wav", kind: "audio" as const, meta: { stem: "accompaniment" } },
    ];
    expect(gens.pickOutput(outs, { slot: "voiceAudio", stem: "voice" })?.url).toBe("/api/files/vocals.wav");
    expect(gens.pickOutput(outs, { slot: "audio2", stem: "Background" })?.url).toBe("/api/files/rest.wav");
    expect(gens.pickOutput(outs, { slot: "audio", stem: "drums" })?.url).toBe("/api/files/drums.wav");
    expect(gens.pickOutput(outs, { slot: "audio" })?.url).toBe("/api/files/drums.wav");
  });

  it("gives a translate step the cue list even when its op was left to be inferred", async () => {
    const p = createPipeline([
      step("words", "test-transcribe", { op: "transcribe", inputs: { video: clip() } }),
      // No op: text-llm's first route (translate) is planned, and the cues must still go in.
      { key: "es", request: { feature: "dub", modelId: "text-llm", params: { targetLanguage: "Spanish" } }, after: "words", chain: [{ slot: "prompt" }] },
    ]);
    expect(p.byKey.es.op).toBe("translate");
    const es = await settle(p.byKey.es.id);
    expect(es.status, es.error ?? "").toBe("succeeded");
    const words = gens.getGeneration(p.byKey.words.id)!;
    expect(JSON.parse(es.request.prompt!)).toEqual(words.outputs[0].meta!.cues);
    expect((es.outputs[0].meta!.cues as unknown[]).length).toBe((words.outputs[0].meta!.cues as unknown[]).length);
  });
});

describe("one mode per chain at launch (S9)", () => {
  const insertDone = (id: string, providerId: string, outputs: unknown[]) =>
    db()
      .prepare(
        `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, created_at, updated_at, completed_at)
         VALUES (?, 'video', 'kling-3', 'cloud', ?, 'i2v', 'video', 'succeeded', '{"feature":"video","modelId":"kling-3"}', ?, 'x', ?, ?, ?)`,
      )
      .run(id, providerId, JSON.stringify(outputs), Date.now(), Date.now(), Date.now());

  it("won't join paid clips on the demo provider, and cancels the clips still waiting", async () => {
    const { joinClips } = await import("@/server/chains");
    for (const id of ["paid-a", "paid-b"]) {
      db()
        .prepare(
          `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, depends_on, created_at, updated_at)
           VALUES (?, 'storyboard-film', 'kling-3', 'cloud', 'higgsfield', 'i2v', 'video', 'queued', '{"feature":"storyboard-film","modelId":"kling-3"}', '[]', 'frame-x', ?, ?)`,
        )
        .run(id, Date.now(), Date.now());
    }
    expect(() => joinClips(["paid-a", "paid-b"], { engine: "cloud", feature: "storyboard-film", batchId: "b1", title: "Film" })).toThrow(/Joining clips needs fal\.ai — connect it in Settings/);
    expect(gens.getGeneration("paid-a")!.status).toBe("canceled");
  });

  it("fails a demo-only step that follows real ones, saying what to connect", async () => {
    const clip = saveFile({ data: Buffer.from("not really a video"), contentType: "video/mp4", source: "generation" }).url;
    insertDone("real-clip-1", "fal", [{ url: clip, kind: "video" }]);
    insertDone("real-clip-2", "fal", [{ url: clip, kind: "video" }]);
    const [join] = gens.createGenerations({ feature: "video", modelId: "join-clips", op: "concat", chain: [{ slot: "videos" }, { slot: "videos" }] }, { dependsOn: ["real-clip-1", "real-clip-2"] });
    const done = await settle(join.id, 10_000);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/Join clips needs fal\.ai to continue what the earlier steps made for real/);
  });

  it("runs a real step after demo ones as a demo too", async () => {
    // A connected LLM (a stand-in Ollama) would run the step for real…
    const server = http.createServer((req, res) => res.end(JSON.stringify(req.url === "/api/tags" ? { models: [] } : { message: { content: "real" } })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    setSetting("ollamaUrl", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await probeOllama(true);
    try {
      insertDone("demo-words", "mock", [{ url: "/api/files/x.txt", kind: "text", text: "demo transcript" }]);
      const [w] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "write", prompt: "Summarize: {text}", chain: [{ slot: "prompt" }] }, { dependsOn: "demo-words" });
      const done = await settle(w.id, 15_000);
      // …but its input is a demo placeholder, so it stays a demo.
      expect(done.provider).toBe("mock");
      expect(done.status).toBe("succeeded");
      expect(done.request.prompt).toBe("Summarize: demo transcript");
    } finally {
      server.close();
      setSetting("ollamaUrl", "");
    }
  });
});

describe("round-4 inputs and params", () => {
  const providerInput = (id: string) => JSON.parse((db().prepare("SELECT provider_input_json FROM generations WHERE id = ?").get(id) as { provider_input_json: string }).provider_input_json) as Record<string, unknown>;
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");

  it("chains a mesh into the rigging step through the model3d slot", async () => {
    const photo = saveFile({ data: png, contentType: "image/png", source: "upload" }).url;
    const p = createPipeline([
      { key: "mesh", request: { feature: "3d", modelId: "test-3d", op: "image-to-3d", inputs: { images: [photo] } } },
      { key: "rig", request: { feature: "3d", modelId: "meshy-rigging", op: "rig-3d", params: { animation: 12 } }, after: "mesh", chain: [{ slot: "model3d" }] },
    ]);
    const mesh = await settle(p.byKey.mesh.id);
    const rig = await settle(p.byKey.rig.id);
    expect(rig.status, rig.error ?? "").toBe("succeeded");
    const glb = mesh.outputs.find((o) => o.kind === "model3d")!.url;
    expect(rig.request.inputs?.model3d).toBe(glb);
    expect(rig.kind).toBe("model3d");
    expect(providerInput(rig.id)).toMatchObject({ model3d: expect.stringMatching(/^data:model\/gltf-binary/), animation: 12 });
  });

  it("keeps the round-4 params and the 3D input on POST /api/generations", async () => {
    const { POST } = await import("@/app/api/generations/route");
    const post = async (body: unknown) => {
      const res = await POST(new Request("http://localhost/api/generations", { method: "POST", body: JSON.stringify(body) }));
      expect(res.status, await res.clone().text()).toBe(201);
      const { items } = (await res.json()) as { items: Generation[] };
      for (const g of items) await gens.cancelGeneration(g.id);
      return items[0];
    };
    const kf = await post({ feature: "video", modelId: "flux-3-max", prompt: "she puts on the hat", inputs: { images: ["/api/files/a.png", "/api/files/b.png"] }, params: { keyframeTimes: [0, 4], duration: 5 } });
    expect(kf.op).toBe("keyframes");
    expect(kf.request.params?.keyframeTimes).toEqual([0, 4]);
    const params = {
      points: [{ x: 10, y: 20, label: "negative" }],
      format: "prores_422_hq",
      zoomFrom: 1,
      zoomTo: 1.2,
      panFrom: { x: 0.5, y: 0.5 },
      panTo: { x: 0.3, y: 0.4 },
      easing: "ease-in-out",
      crossfade: 0.5,
      sourceDuration: 8,
      frameInterval: 2,
      targetFps: 60,
      slowdown: 2,
      colormap: "turbo",
      position: { x: 0.5, y: 0.8 },
      scale: 0.5,
      animation: 12,
    };
    const erase = await post({ feature: "video-tools", modelId: "bria-video-erase-points", inputs: { video: "/api/files/v.mp4" }, params });
    expect(erase.request.params).toMatchObject(params);
    const rig = await post({ feature: "3d", modelId: "meshy-rigging", inputs: { model3d: "/api/files/m.glb" } });
    expect(rig.request.inputs?.model3d).toBe("/api/files/m.glb");
    // Values outside the contract are refused, not passed on.
    const bad = await POST(new Request("http://localhost/api/generations", { method: "POST", body: JSON.stringify({ feature: "x", modelId: "topaz-sdr-to-hdr", inputs: { video: "/v.mp4" }, params: { format: "mpeg2" } }) }));
    expect(bad.status).toBe(400);
  });
});
