import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { offlineBrief, type SeriesEstimate, type SeriesView } from "@/lib/catalog/content-factory";
import { tempDir } from "./helpers/temp-dir";

// Content Factory's server (r4/content-factory): references (an upload, a link through the guard and the
// SSRF-safe fetch, a preset), reading them into a brief on both engines (demo mode here), prices, "Generate
// here" (a channel and Faceless episodes that carry the brief), "Next episode", and the message for Claude.
const dir = tempDir("fuobe-content-factory-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: cloud and open models run on the demo provider, and there's no LLM (the offline writers run).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { getGeneration } = await import("@/server/generations");
const faceless = await import("@/server/faceless");
const cf = await import("@/server/content-factory");
const seriesRoute = await import("@/app/api/content-factory/series/route");
const oneRoute = await import("@/app/api/content-factory/series/[id]/route");
const generateRoute = await import("@/app/api/content-factory/series/[id]/generate/route");
const episodesRoute = await import("@/app/api/content-factory/series/[id]/episodes/route");
const readRoute = await import("@/app/api/content-factory/series/[id]/read/route");
const estimateRoute = await import("@/app/api/content-factory/estimate/route");
const claudeRoute = await import("@/app/api/content-factory/claude/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const view = (id: string): SeriesView => JSON.parse(JSON.stringify(cf.seriesView(id)));

async function readied(id: string, ms = 60_000): Promise<SeriesView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = view(id);
    if (v.analysis?.status !== "reading") {
      await cf.briefWritten(id);
      return view(id);
    }
    if (Date.now() > end) throw new Error(`still reading: ${v.analysis.stage}`);
    await sleep(300);
  }
}

const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-portrait.mp4")), contentType: "video/mp4", name: "reference.mp4", source: "upload" }).url;
const settings = { engine: "cloud" as const, length: 30, episodes: 3, animation: "scene-by-scene" as const, genre: "history" as const, aspect: "9:16" as const };

describe("the reference", () => {
  it("refuses bad links before fetching anything, and asks for an upload where a platform keeps its video", async () => {
    const local = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "http://localhost:3000/clip.mp4" }, engine: "cloud" }));
    expect(local.status).toBe(400);
    expect((await local.json()).error).toMatch(/public link/);
    const profile = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "https://www.tiktok.com/@someone" }, engine: "cloud" }));
    expect(profile.status).toBe(400);
    const yt = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "https://youtu.be/dQw4w9WgXcQ" }, engine: "cloud" }));
    expect(yt.status).toBe(422);
    expect(await yt.json()).toMatchObject({ needsUpload: true, error: expect.stringMatching(/upload it here/) });
  });

  it("fetches a link only through the SSRF-safe fetch: a private address is refused", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "link", link: "http://10.1.2.3/reference.mp4" }, engine: "cloud" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ needsUpload: true, error: expect.stringMatching(/private network/) });
  });

  it("refuses an upload that isn't a video", async () => {
    const img = saveFile({ data: Buffer.from("GIF89a"), contentType: "image/gif", name: "x.gif", source: "upload" }).url;
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: img }, engine: "cloud" }));
    expect(res.status).toBe(400);
  });

  it("a preset's brief is ready straight away, for nothing", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "dark-history" }, engine: "cloud" }));
    expect(res.status).toBe(201);
    const v: SeriesView = await res.json();
    expect(v.analysis).toMatchObject({ status: "ready", costUsd: 0 });
    expect(v.brief?.styleId).toBeTruthy();
    expect(v.reference).toMatchObject({ kind: "preset", presetId: "dark-history" });
  });
});

describe("reading a clip into a brief", () => {
  it("cloud: frames and a transcript as generations, then the brief (offline in demo mode, and it says so)", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip(), title: "My reference" }, engine: "cloud" }));
    expect(res.status).toBe(201);
    const v: SeriesView = await res.json();
    expect(v.reference).toMatchObject({ kind: "upload", title: "My reference" });
    expect(v.reference?.seconds).toBeGreaterThan(0);
    expect(v.reference?.height).toBeGreaterThan(v.reference!.width!);
    expect(v.analysis).toMatchObject({ engine: "cloud", status: "reading", demo: true });
    const frames = getGeneration(v.analysis!.steps.frames!)!;
    const words = getGeneration(v.analysis!.steps.transcript!)!;
    expect(frames.request).toMatchObject({ feature: "content-factory", modelId: "extract-frames", op: "extract-frames" });
    expect(frames.request.params?.frameInterval).toBeGreaterThanOrEqual(1);
    // JPEG frames: fal's default PNG runs to 3 MB a full-HD frame, past what one Claude request takes.
    expect(frames.request.params?.extra).toMatchObject({ output_format: "jpg", quality: 80 });
    expect(words.request).toMatchObject({ modelId: "scribe-v2", op: "transcribe" });
    const ready = await readied(v.id);
    expect(ready.analysis).toMatchObject({ status: "ready", offline: true, note: expect.stringMatching(/^Demo brief/) });
    // The clip's own shape wins: a portrait clip gives a 9:16 brief.
    expect(ready.brief).toMatchObject({ aspect: "9:16" });
  }, 90_000);

  it("open: one Gemma 4 generation (reference-brief-gemma4), its first 30 s", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip() }, engine: "open" }));
    const v: SeriesView = await res.json();
    expect(Object.keys(v.analysis!.steps)).toEqual(["brief"]);
    const g = getGeneration(v.analysis!.steps.brief!)!;
    expect(g.request).toMatchObject({ modelId: "oss-reference-brief", op: "write", inputs: { video: expect.stringMatching(/^\/api\/files\//) } });
    expect(g.request.params?.duration).toBeLessThanOrEqual(30);
    const ready = await readied(v.id);
    expect(ready.analysis).toMatchObject({ status: "ready", offline: true, note: expect.stringMatching(/start ComfyUI/) });
    // Read again on the other engine: a new read replaces the old one.
    const again = await readRoute.POST(json("POST", { engine: "cloud" }), params({ id: v.id }));
    expect(((await again.json()) as SeriesView).analysis).toMatchObject({ engine: "cloud", status: "reading" });
    await readied(v.id);
  }, 90_000);

  it("Claude gets the frames that fit one request: none over 5 MB as base64, all within the budget, still spread over the clip", () => {
    const f = (bytes: number) => ({ data: Buffer.alloc(bytes) });
    const total = (l: { data: Buffer }[]) => l.reduce((n, x) => n + x.data.length, 0);
    // 20 noisy full-HD PNG frames (3.07 MB each, 61 MB in all) would be an 82 MB request.
    const png = Array.from({ length: 20 }, () => f(3_070_000));
    const fit = cf.fitFrames(png);
    expect(total(fit)).toBeLessThanOrEqual(cf.FRAME_BUDGET_BYTES);
    expect(fit).toHaveLength(4);
    expect(fit[0]).toBe(png[0]);
    expect(fit.at(-1)).toBe(png[19]);
    expect((cf.FRAME_BUDGET_BYTES / 3) * 4).toBeLessThan(32 * 1024 * 1024 * 0.7);
    expect(Math.ceil(cf.MAX_FRAME_BYTES / 3) * 4).toBeLessThanOrEqual(5_000_000);
    // JPEG frames all fit; one too big for Claude is left out.
    expect(cf.fitFrames(Array.from({ length: 20 }, () => f(400_000)))).toHaveLength(20);
    expect(cf.fitFrames([f(4_500_000), f(300_000)])).toHaveLength(1);
  });

  it("while the clip is read, the price comes from its length and shape, and says it comes again", async () => {
    const v: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip() }, engine: "cloud" }))).json();
    expect(v.analysis?.status).toBe("reading");
    const during: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "x", settings, seriesId: v.id }))).json();
    expect(during.briefPending).toBe(true);
    await readied(v.id);
    const after: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "x", settings, seriesId: v.id }))).json();
    expect(after.briefPending).toBeUndefined();
    expect(after.scenes).toBe(during.scenes);
  }, 90_000);

  it("a draft the composer leaves is deleted (its reading stops); a made series is never deleted as a draft", async () => {
    const v: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "upload", url: clip() }, engine: "cloud" }))).json();
    const del = (id: string, draft: boolean) => oneRoute.DELETE(new Request(`http://x/api${draft ? "?draft=1" : ""}`, { method: "DELETE" }), params({ id }));
    expect((await del(v.id, true)).status).toBe(204);
    expect(() => cf.seriesView(v.id)).toThrow(/not found/);
    const made: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    await cf.generateSeries(made.id, { prompt: "What if cats ruled the world", settings: { ...settings, episodes: 1 } });
    expect((await del(made.id, true)).status).toBe(204);
    expect(view(made.id).made).toBe(true);
    expect((await del(made.id, false)).status).toBe(204);
    expect(() => cf.seriesView(made.id)).toThrow(/not found/);
  }, 90_000);

  it("knows a link's clip by its bytes, and keeps a malformed file name as written", () => {
    const head = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(16)]);
    expect(cf.clipType(head("isom"), "application/octet-stream")).toEqual({ contentType: "video/mp4", name: "reference.mp4" });
    expect(cf.clipType(head("qt  "), "video/mp4")).toEqual({ contentType: "video/quicktime", name: "reference.mov" });
    expect(cf.clipType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]), "video/mp4")).toEqual({ contentType: "video/webm", name: "reference.webm" });
    expect(cf.clipType(Buffer.from("????????"), "video/webm")).toEqual({ contentType: "video/webm", name: "reference.webm" });
    expect(cf.linkTitle("https://cdn.example.com/clips/my%20clip.mp4")).toBe("my clip.mp4");
    expect(cf.linkTitle("https://cdn.example.com/clip%E0%A4%A.mp4")).toBe("clip%E0%A4%A.mp4");
    expect(cf.linkTitle("https://cdn.example.com/")).toBeUndefined();
  });

  it("the frame interval asks for about a frame a second, at most 20 over the clip", () => {
    expect(cf.frameInterval(10, 30)).toBe(30);
    expect(cf.frameInterval(60, 30)).toBe(90);
    expect(cf.frameInterval(300, 60)).toBe(300);
    expect(cf.frameInterval(undefined, undefined)).toBe(45);
    expect(cf.spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(cf.spread([1, 2], 4)).toEqual([1, 2]);
  });
});

describe("prices, Generate here and Next episode", () => {
  let series: SeriesView;

  it("prices the series before anything runs: one episode at the brief's pace × the episodes", async () => {
    const res = await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "dark-history" }, engine: "cloud" }));
    series = await res.json();
    const est: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings, seriesId: series.id }))).json();
    expect(est.price.episodes).toBe(3);
    expect(est.price.total).toBeCloseTo(est.price.perEpisode * 3, 1);
    expect(est.scenes).toBeGreaterThan(3);
    expect(est.demo).toBe(true);
    const one: SeriesEstimate = await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, episodes: 1 }, seriesId: series.id }))).json();
    expect(one.price.total).toBeCloseTo(one.price.perEpisode, 2);
    // The open engine needs a narrator's voice sample first (in demo mode the demo narrator stands in).
    expect(((await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, engine: "open" }, seriesId: series.id, voice: null }))).json()) as SeriesEstimate).demo).toBe(true);
    setSetting("demoMode", "off");
    const g = globalThis as unknown as { __fuobeComfyReach?: { ok: boolean; at: number; url: string } };
    const before = g.__fuobeComfyReach;
    try {
      const ask = async () => (await (await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, engine: "open" }, seriesId: series.id, voice: null }))).json()) as SeriesEstimate;
      // Nothing connected: the price says to connect ComfyUI first.
      expect((await ask()).error).toMatch(/Connect ComfyUI in Settings/);
      // A ComfyUI that answers: then the voice sample is what's missing.
      g.__fuobeComfyReach = { ok: true, at: Date.now(), url: "http://127.0.0.1:9" };
      const open = await ask();
      expect(open.error).toMatch(/narrator's voice/);
      expect(open.analysisPerMinute).toBe(0);
    } finally {
      g.__fuobeComfyReach = before;
      setSetting("demoMode", "auto");
    }
    // A length outside 30 s – 5 min is refused.
    expect((await estimateRoute.POST(json("POST", { prompt: "x", settings: { ...settings, length: 45 }, seriesId: series.id }))).status).toBe(400);
  });

  it("makes the channel and one Faceless episode per planned title, each carrying the brief", async () => {
    const res = await generateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings }), params({ id: series.id }));
    expect(res.status).toBe(200);
    const v: SeriesView = await res.json();
    expect(v.channel).toBeTruthy();
    expect(v.channel!.settings.brief?.script.join(" ")).toMatch(/Format:/);
    expect(v.plan).toHaveLength(3);
    expect(v.episodes.map((e) => e.title)).toEqual(v.plan.map((p) => p.title));
    const ep = faceless.episodeView(v.episodes[0].id).episode;
    expect(ep.settings).toMatchObject({ length: 30, animation: "frames", aspect: "9:16", brief: { sceneSeconds: expect.any(Number) } });
    expect(ep.topic).toMatch(/^Episode 1 of the series “The lost city of Ys”/);
    expect(faceless.episodeView(v.episodes[2].id).episode.topic).toMatch(/Earlier episodes: .+; .+\./);
    // The offline writer keeps a 30-second episode near 30 s, even at the brief's faster pace.
    await faceless.scriptWritten(v.episodes[0].id);
    const written = faceless.episodeView(v.episodes[0].id).episode;
    expect(written.script.blocks.reduce((n, b) => n + b.seconds, 0)).toBeLessThanOrEqual(30 * 1.15);
    // A second click doesn't make it twice.
    expect((await generateRoute.POST(json("POST", { prompt: "The lost city of Ys", settings }), params({ id: series.id }))).status).toBe(409);
    // GET handlers start with connection(), which needs a request scope: read through the server module.
    const list = cf.listSeries();
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: series.id, episodes: 3, channelId: v.channel!.id })]));
  });

  it("plans the next episodes after the ones already made", async () => {
    const res = await episodesRoute.POST(json("POST", { count: 2, next: "The bells under the sea ring again" }), params({ id: series.id }));
    const v: SeriesView = await res.json();
    expect(v.plan).toHaveLength(5);
    expect(v.episodes).toHaveLength(5);
    expect(v.plan[3].synopsis).toBe("The bells under the sea ring again");
    const ep = faceless.episodeView(v.episodes[3].id).episode;
    expect(ep.topic).toMatch(/^Episode 4 of the series/);
    expect(ep.settings.brief).toBeTruthy();
  });

  it("a one-video series lets the script writer name it, and a draft without a brief can't run", async () => {
    const one: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const v: SeriesView = await (await generateRoute.POST(json("POST", { prompt: "What if the Moon had a city", settings: { ...settings, episodes: 1, animation: "fully-animated" } }), params({ id: one.id }))).json();
    expect(v.episodes).toHaveLength(1);
    expect(faceless.episodeView(v.episodes[0].id).episode.settings.animation).toBe("animated");
    const empty: SeriesView = await (await seriesRoute.POST(json("POST", { reference: null, engine: "cloud" }))).json();
    const res = await generateRoute.POST(json("POST", { prompt: "x", settings }), params({ id: empty.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reference or pick a preset/);
  });

  it("one Generate at a time: a second one while the first plans gets 409, and only one channel is made", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "countdown" }, engine: "cloud" }))).json();
    const channels = faceless.listChannels().length;
    const input = { prompt: "Inventions that happened by accident", settings };
    const both = await Promise.allSettled([cf.generateSeries(s.id, input), cf.generateSeries(s.id, input)]);
    expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = both.find((r): r is PromiseRejectedResult => r.status === "rejected")!.reason as InstanceType<typeof faceless.FacelessError>;
    expect(refused.status).toBe(409);
    expect(faceless.listChannels().length).toBe(channels + 1);
    expect(view(s.id).episodes).toHaveLength(3);
    // Next episode twice at once: one runs, and the plan keeps every episode it made.
    const more = await Promise.allSettled([cf.addEpisodes(s.id, { count: 1 }), cf.addEpisodes(s.id, { count: 1 })]);
    expect(more.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const v = view(s.id);
    expect(v.plan).toHaveLength(4);
    expect(v.episodes.map((e) => e.title)).toEqual(v.plan.map((p) => p.title));
  });

  it("a brief edited while episodes are planned is kept", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "tiny-worlds" }, engine: "cloud" }))).json();
    const run = cf.generateSeries(s.id, { prompt: "A day in a paper city", settings });
    cf.updateSeries(s.id, { brief: { ...s.brief!, hook: "Open inside a matchbox" } });
    const v = await run;
    expect(v.brief?.hook).toBe("Open inside a matchbox");
    expect(v.plan).toHaveLength(3);
  });

  it("a series whose channel was deleted in Faceless Studio says so, and the next new series clears it away", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "myth-retold" }, engine: "cloud" }))).json();
    const made = await cf.generateSeries(s.id, { prompt: "Prometheus steals fire", settings: { ...settings, episodes: 1 } });
    await faceless.deleteChannel(made.channel!.id);
    expect(view(s.id)).toMatchObject({ made: true, channel: null });
    expect(cf.listSeries().some((c) => c.id === s.id)).toBe(false);
    // Generating it again can't work: it says so instead of making a second channel.
    await expect(cf.generateSeries(s.id, { prompt: "x", settings })).rejects.toMatchObject({ status: 409 });
    await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }));
    expect(() => cf.seriesView(s.id)).toThrow(/not found/);
  });

  it("deletes the series with its channel", async () => {
    const channelId = view(series.id).channel!.id;
    expect((await oneRoute.DELETE(json("DELETE"), params({ id: series.id }))).status).toBe(204);
    expect(faceless.getChannel(channelId)).toBeNull();
    expect(() => cf.seriesView(series.id)).toThrow(/not found/);
  });
});

describe("Generate in Claude", () => {
  it("composes the message from the brief, with nothing sent anywhere", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const res = await claudeRoute.POST(json("POST", { prompt: "What if cats ruled the world", settings, seriesId: s.id, voice: { kind: "preset", id: "JBFqnCBsd6RMkjVDRZzb" } }));
    const out = await res.json();
    expect(out.needsToken).toBe(false);
    expect(out.bytes).toBeLessThanOrEqual(64 * 1024);
    expect(out.message).toContain("series of 3 episodes");
    expect(out.message).toContain('voice "JBFqnCBsd6RMkjVDRZzb"');
    expect(out.message).toContain("faceless_episode");
    expect((await claudeRoute.POST(json("POST", { prompt: "  ", settings, seriesId: s.id }))).status).toBe(400);
  });

  it("writes the message for the engine Claude's runs use (Settings → Engine mode), and says when that isn't the composer's", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "dark-history" }, engine: "cloud" }))).json();
    const ask = (body: object) => claudeRoute.POST(json("POST", { prompt: "The town that vanished", settings, seriesId: s.id, ...body })).then((r) => r.json());
    // "Both": Fuobe's MCP server runs on the cloud, whatever the composer's switch says.
    const open = await ask({ settings: { ...settings, engine: "open" }, voice: { kind: "sample", url: "/api/files/me.wav" } });
    expect(open).toMatchObject({ engine: "cloud", engineNote: expect.stringMatching(/cloud engine and your paid providers/) });
    expect(open.message).not.toMatch(/open-source engine|voice_sample "/);
    expect((await ask({})).engineNote).toBeUndefined();
    // A 5-minute episode comes out as parts, and the dialog says how many.
    expect(await ask({ settings: { ...settings, length: 300 } })).toMatchObject({ parts: 4, partSeconds: 75 });
    setSetting("engineMode", "open");
    try {
      const onlyOpen = await ask({ settings: { ...settings, engine: "open" }, voice: { kind: "sample", url: "/api/files/me.wav" } });
      expect(onlyOpen.engine).toBe("open");
      expect(onlyOpen.engineNote).toBeUndefined();
      expect(onlyOpen.message).toContain('voice_sample "/api/files/me.wav"');
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("edits the brief by hand", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const res = await oneRoute.PATCH(json("PATCH", { brief: { ...s.brief!, hook: "Start on the punchline" } }), params({ id: s.id }));
    expect(((await res.json()) as SeriesView).brief?.hook).toBe("Start on the punchline");
  });

  it("saves an edited offline brief read from a fast talker (its pace within the editor's limits)", async () => {
    const s: SeriesView = await (await seriesRoute.POST(json("POST", { reference: { kind: "preset", presetId: "what-if" }, engine: "cloud" }))).json();
    const fast = Array.from({ length: 3 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: "one two three four five six seven eight nine ten eleven twelve" }));
    const brief = { ...offlineBrief({ cues: fast }), hook: "Straight in" };
    const res = await oneRoute.PATCH(json("PATCH", { brief }), params({ id: s.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as SeriesView).brief?.voice.wordsPerMinute).toBe(260);
  });
});
