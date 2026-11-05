import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/catalog";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { composeWorkflow, withoutSaveMetadata, type ComposeCatalog } from "@/lib/comfy-compose";
import { ceilingProblem, cleanCeiling, lanesInside, textProblem, ticketProblem, wordProblem, type JobTicket } from "@/lib/job-ticket";
import type { MediaInfo } from "@/lib/media-probe";
import { catalogKnows, composeTicket, ticketFor, workerFactsFrom } from "@/lib/ticket-compose";
import { catalogVersion as builtVersion, composerFiles } from "../bin/lib/worker/composer-files.mjs";
import { ceilingFrom, ceilingOf, graphInside } from "../bin/lib/worker/tickets.mjs";

/**
 * Job tickets (src/lib/job-ticket.ts): an account's run reaches a worker as a ticket, and the worker composes the graph
 * itself with the studio's own composer. A ticket composes the very graph the studio builds, for every workflow a run on
 * the workers can use; a ticket with an unknown workflow, another catalog, settings outside their rules or a path in a
 * text field is refused; the PC's ceiling is the most a worker runs.
 */

vi.setConfig({ testTimeout: 60_000 });

const { loadManifest, getWorkflow } = await import("@/server/providers/comfyui");
const { computeCatalogVersion } = await import("@/server/computer/catalog-version");

const ROOT = path.resolve(__dirname, "..");
const VERSION = computeCatalogVersion(ROOT)!;
const catalog: ComposeCatalog = { has: (id) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** The files a run sends, by kind, with what the studio read from their headers. */
const FACTS: Record<string, MediaInfo> = {
  png: { container: "image", width: 1024, height: 768, hasVideo: false, hasAudio: false },
  mp4: { container: "mp4", duration: 4, videoDuration: 4, width: 1280, height: 720, fps: 24, frames: 96, hasVideo: true, hasAudio: true, channels: 2 },
  wav: { container: "wav", duration: 5, hasVideo: false, hasAudio: true, channels: 2 },
  glb: undefined as unknown as MediaInfo,
};
const TYPES: Record<string, string> = { png: "image/png", mp4: "video/mp4", wav: "audio/wav", glb: "model/gltf-binary" };

/** A run's files: named as the studio names staged inputs, each with its SHA-256 and header facts. */
function files() {
  const all = new Map<string, { sha256: string; contentType: string; facts?: MediaInfo }>();
  let n = 0;
  const file = (ext: string, data?: Buffer) => {
    const name = `fuobe_t${String(++n).padStart(9, "0")}.${ext}`;
    all.set(name, { sha256: sha(data ?? name), contentType: TYPES[ext], ...(FACTS[ext] && { facts: FACTS[ext] }) });
    return name;
  };
  return { all, file };
}

const REFERENCE_SLOTS = ["image", "image2", "image3", "image4", "image5", "image6", "image7", "image8", "image9", "image10"];

/** A request that fills what a workflow's graph binds (pictures, clips, sound, a 3D model) for a route's operation. */
function requestFor(id: string, op: Operation, f: ReturnType<typeof files>["file"]): GenInput {
  const m = loadManifest().workflows.find((w) => w.id === id.replace("{n}", "2"))!;
  const b = m.bindings as Record<string, unknown>;
  const input: GenInput = { prompt: "A calm portrait in soft window light, black/white grade", seed: 1234, numOutputs: 1 };
  const images = REFERENCE_SLOTS.filter((k) => b[k]).length;
  if (images) input.images = Array.from({ length: images }, () => f("png"));
  if (b.endImage) input.endImage = f("png");
  if (b.mask) input.mask = f("png");
  const clips = ["video", "video2", "video3", "video4"].filter((k) => b[k]).length;
  if (id.includes("{n}")) input.videos = [f("mp4"), f("mp4")];
  else if (clips > 1) input.videos = Array.from({ length: clips }, () => f("mp4"));
  else if (clips) input.video = f("mp4");
  if (b.audio) input.audio = f("wav");
  if (m.expand === "audios" || op === "timeline") input.audios = [f("wav"), f("wav")];
  if (op === "tts" || op === "voice-change" || op === "dialogue") input.voiceAudio = f("wav");
  if (op === "dialogue") {
    input.voiceAudio2 = f("wav");
    input.dialogue = [{ text: "Good evening.", voice: "A" }, { text: "Welcome back.", voice: "B" }];
  }
  if (op === "voice-design") input.voiceDescription = "A warm, low voice with a slow pace";
  if (b.model3d) input.model3d = f("glb");
  return input;
}

/** Every route a run on the workers can take: each ComfyUI route of the catalog's models, once. */
function poolRoutes() {
  const seen = new Map<string, { endpoint: string; op: Operation; extra?: Record<string, unknown>; loraSlot?: boolean; kind: string }>();
  for (const m of MODELS) {
    for (const r of m.routes ?? []) {
      if (r.provider !== "comfyui") continue;
      const key = `${r.endpoint} ${r.op} ${JSON.stringify(r.extra ?? {})} ${!!r.loraSlot}`;
      if (!seen.has(key)) seen.set(key, { endpoint: r.endpoint, op: r.op, extra: r.extra, loraSlot: r.loraSlot, kind: m.kind });
    }
  }
  return [...seen.values()];
}

/** The studio's side, as prepareWorkflow composes an account's run on the workers (the seed picked, the files staged). */
async function studioSide(r: ReturnType<typeof poolRoutes>[number], gid: string, own?: (f: ReturnType<typeof files>["file"]) => GenInput) {
  const f = files();
  const asked = own ? own(f.file) : requestFor(r.endpoint, r.op, f.file);
  const input = r.extra ? { ...asked, extra: { ...r.extra, ...asked.extra } } : asked;
  const made: string[] = [];
  const out = await composeWorkflow(r.endpoint, input, {
    generationId: gid,
    op: r.op,
    catalog,
    loraSlot: r.loraSlot === true,
    sent: [],
    accountOnInstall: true,
    made: async (data, contentType, name) => {
      const ext = (name.split(".").pop() ?? "bin").toLowerCase();
      const staged = `fuobe_m${String(made.length).padStart(9, "0")}.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin"}`;
      f.all.set(staged, { sha256: sha(Buffer.from(data)), contentType });
      made.push(staged);
      return staged;
    },
    media: (name) => f.all.get(name)?.facts,
  });
  const used = out.dropped.length && input.extra ? { ...input, extra: Object.fromEntries(Object.entries(input.extra).filter(([k]) => !out.dropped.includes(k))) } : input;
  const ticket = ticketFor(
    { endpoint: r.endpoint, op: r.op, input: used, made, ...(r.loraSlot && { loraSlot: true }) },
    { catalogVersion: VERSION, sent: [], file: (n) => f.all.get(n) ?? null, facts: (n) => f.all.get(n)?.facts, outputs: { count: Math.max(1, out.manifest.outputs.length), kind: r.kind }, size: out.size },
  );
  const inputs = [...f.all.entries()].map(([name, x]) => ({ name, sha256: x.sha256 }));
  return { graph: withoutSaveMetadata(out.workflow), ticket, inputs, size: out.size };
}

describe("a ticket composes the graph the studio builds", () => {
  it("for every catalog workflow a run on the workers can use", async () => {
    const routes = poolRoutes();
    const composed = new Set<string>();
    const refusedByStudio: string[] = [];
    for (const [i, r] of routes.entries()) {
      const gid = `ticket-gen-${i}`;
      let studio: Awaited<ReturnType<typeof studioSide>>;
      try {
        studio = await studioSide(r, gid);
      } catch {
        // The studio refuses this request as it stands (a setting it needs): no ticket is made for it.
        refusedByStudio.push(`${r.endpoint} ${r.op}`);
        continue;
      }
      expect(ticketProblem(studio.ticket, { catalogVersion: VERSION, known: (id) => catalogKnows(catalog, id), inputs: studio.inputs }), r.endpoint).toBeNull();
      // Through JSON, as the claim hands it over.
      const ticket = JSON.parse(JSON.stringify(studio.ticket)) as JobTicket;
      const worker = await composeTicket({ ticket, generationId: gid, inputs: studio.inputs }, { catalog, catalogVersion: VERSION });
      expect(worker.ok ? null : worker, `${r.endpoint} ${r.op}`).toBeNull();
      if (!worker.ok) continue;
      expect(worker.graph, `${r.endpoint} ${r.op}`).toEqual(studio.graph);
      expect(worker.size).toEqual(studio.size);
      composed.add(worker.workflowId);
    }
    // Most of the catalog's workflows are reached this way (the rest need a setting a plain request doesn't carry).
    expect(composed.size).toBeGreaterThan(loadManifest().workflows.length * 0.6);
    expect(refusedByStudio.length).toBeLessThan(routes.length * 0.25);
  }, 240_000);

  it("with the files the graph makes itself (a palette swatch) made again on the worker, to the byte", async () => {
    const r = { endpoint: "palette-transfer-image", op: "color-match" as Operation, kind: "image" };
    const studio = await studioSide(r, "palette-gen-1", (f) => ({ images: [f("png")], palette: ["#112233", "#ddeeff", "#884422"], seed: 7 }));
    const made = studio.ticket.inputs.filter((i) => i.slot.startsWith("made."));
    expect(made.length).toBeGreaterThan(0);
    const worker = await composeTicket({ ticket: studio.ticket, generationId: "palette-gen-1", inputs: studio.inputs }, { catalog, catalogVersion: VERSION });
    expect(worker.ok && worker.made.map((m) => [m.name, sha(m.data)])).toEqual(made.map((m) => [m.name, m.sha256]));
    // A made file the studio says is something else: the ticket wasn't made for this graph.
    const other = { ...studio.ticket, inputs: studio.ticket.inputs.map((i) => (i.slot === "made.0" ? { ...i, sha256: "0".repeat(64) } : i)) };
    const refused = await composeTicket({ ticket: other, generationId: "palette-gen-1", inputs: studio.inputs }, { catalog, catalogVersion: VERSION });
    expect(refused).toMatchObject({ ok: false, reason: "bad-ticket" });
  });

  it("the worker's PC makes the choices that depend on it (its device, its memory)", async () => {
    const facts = workerFactsFrom({ stats: { system: { ram_total: 64 * 2 ** 30 }, devices: [{ type: "cuda", vram_total: 32 * 2 ** 30 }] }, dbs: ["DBS-BSRNN-DnR/model.safetensors", "DBS-BSRNN-DnR/config.json"], reuse: null, idol: { IdolPruneSplat: {} } });
    expect(facts).toEqual({ device: "cuda", vramBytes: 32 * 2 ** 30, ramBytes: 64 * 2 ** 30, dbsModels: ["DBS-BSRNN-DnR"], reuseModels: null, idolPack: true });
    // What it couldn't read stays unknown.
    expect(workerFactsFrom({ stats: undefined, dbs: undefined, reuse: undefined, idol: {} })).toEqual({ idolPack: false });
    expect(workerFactsFrom({ stats: { devices: [{ type: "../x", vram_total: -1 }] } })).toEqual({});
  });
});

describe("a ticket a worker refuses", () => {
  const base = async () => studioSide({ endpoint: "selftest-image", op: "edit", kind: "image" }, "refuse-gen-1");
  const compose = (ticket: unknown, inputs: { name: string; sha256: string }[], o: { version?: string } = {}) =>
    composeTicket({ ticket, generationId: "refuse-gen-1", inputs }, { catalog, catalogVersion: o.version ?? VERSION });

  it("composes the plain one", async () => {
    const s = await base();
    expect(await compose(s.ticket, s.inputs)).toMatchObject({ ok: true, workflowId: "selftest-image" });
  });

  it("an unknown workflow", async () => {
    const s = await base();
    expect(await compose({ ...s.ticket, workflowId: "no-such-workflow" }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
    expect(await compose({ ...s.ticket, workflowId: "../selftest-image" }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
  });

  it("a newer catalog version: update the worker", async () => {
    const s = await base();
    expect(await compose({ ...s.ticket, catalogVersion: "f".repeat(64) }, s.inputs)).toMatchObject({ ok: false, reason: "update-worker" });
    expect(await compose(s.ticket, s.inputs, { version: "e".repeat(64) })).toMatchObject({ ok: false, reason: "update-worker" });
    expect(await compose({ ...s.ticket, v: 2 }, s.inputs)).toMatchObject({ ok: false, reason: "update-worker" });
  });

  it("settings out of range, of the wrong kind, or unknown", async () => {
    const s = await base();
    for (const settings of [
      { ...s.ticket.settings, numOutputs: 99 },
      { ...s.ticket.settings, numOutputs: 1.5 },
      { ...s.ticket.settings, seed: -1 },
      { ...s.ticket.settings, duration: "long" },
      { ...s.ticket.settings, aspectRatio: "wide" },
      { ...s.ticket.settings, easing: "bounce" },
      { ...s.ticket.settings, generateAudio: "yes" },
      { ...s.ticket.settings, somethingElse: 1 },
      { ...s.ticket.settings, extra: { steps: Infinity } },
      { ...s.ticket.settings, extra: { "bad key": 1 } },
      { ...s.ticket.settings, loras: [{ file: "../../secrets.safetensors" }] },
      { ...s.ticket.settings, loras: [{ file: "C:/models/x.safetensors" }] },
    ]) {
      expect(await compose({ ...s.ticket, settings }, s.inputs), JSON.stringify(settings)).toMatchObject({ ok: false, reason: "bad-ticket" });
    }
    // Inside their rules, they compose.
    expect(await compose({ ...s.ticket, settings: { ...s.ticket.settings, numOutputs: 2, seed: 99 } }, s.inputs)).toMatchObject({ ok: true });
    expect(ticketProblem({ ...s.ticket, settings: { ...s.ticket.settings, loras: [{ file: "styles/film grain.safetensors", strength: 0.8, target: "both" }] } })).toBeNull();
  });

  it("a path in a text field, a file named in a setting, or a file the job doesn't send", async () => {
    const s = await base();
    for (const prompt of ["C:\\Windows\\System32\\config", "see ../../etc/passwd here", "/etc/passwd", "file:///home/me/x.png", "\\\\server\\share\\x.png", "~/secrets.txt"]) {
      expect(textProblem(prompt), prompt).toBe("a path");
      expect(await compose({ ...s.ticket, settings: { ...s.ticket.settings, prompt } }, s.inputs), prompt).toMatchObject({ ok: false, reason: "bad-ticket" });
    }
    // Words with a slash are words.
    expect(textProblem("black/white grade, 50/50 split")).toBeNull();
    for (const v of ["models/x", "x.safetensors", "https://example.com/a", "%APPDATA%", "${HOME}"]) expect(wordProblem(v), v).not.toBeNull();
    expect(await compose({ ...s.ticket, settings: { ...s.ticket.settings, extra: { image: "fuobe_someone_elses.png" } } }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
    expect(await compose({ ...s.ticket, settings: { ...s.ticket.settings, images: ["fuobe_t000000001.png"] } }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
    // An input the job doesn't send, or sends with other bytes.
    expect(await compose(s.ticket, [])).toMatchObject({ ok: false, reason: "bad-ticket" });
    expect(await compose(s.ticket, s.inputs.map((i) => ({ ...i, sha256: "0".repeat(64) })))).toMatchObject({ ok: false, reason: "bad-ticket" });
    // A slot that isn't one, or a name the studio never makes.
    expect(await compose({ ...s.ticket, inputs: s.ticket.inputs.map((i) => ({ ...i, slot: "workflow" })) }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
    expect(await compose({ ...s.ticket, inputs: s.ticket.inputs.map((i) => ({ ...i, name: "../../x.png" })) }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
    // A graph in a ticket's place is no ticket.
    expect(await compose({ "1": { class_type: "LoadImage", inputs: { image: "x.png" } } }, s.inputs)).toMatchObject({ ok: false, reason: "bad-ticket" });
  });
});

describe("the PC's ceiling", () => {
  it("a ticket bigger than the PC allows is refused before composing, and after (by the size the graph came out at)", async () => {
    const s = await studioSide({ endpoint: "selftest-image", op: "edit", kind: "image" }, "ceil-gen-1");
    expect(s.size.megapixels).toBeGreaterThan(0);
    const run = (ceiling: Parameters<typeof ceilingProblem>[0], ticket: JobTicket = s.ticket) => composeTicket({ ticket, generationId: "ceil-gen-1", inputs: s.inputs }, { catalog, catalogVersion: VERSION, ceiling, laneOf: () => "small" });
    expect(await run({ maxMegapixels: s.size.megapixels / 2 })).toMatchObject({ ok: false, reason: "outside-ceiling" });
    expect(await run({ workflows: ["video-trim"] })).toMatchObject({ ok: false, reason: "outside-ceiling" });
    expect(await run({ lanes: ["small"] })).toMatchObject({ ok: true });
    expect(await run({ maxMegapixels: 100, maxOutputs: 4, workflows: ["selftest-image"] })).toMatchObject({ ok: true });
    // A ticket that understates its size is held to the size its graph comes out at.
    expect(await run({ maxMegapixels: s.size.megapixels / 2 }, { ...s.ticket, size: { ...s.ticket.size, megapixels: 0 } })).toMatchObject({ ok: false, reason: "outside-ceiling" });
  });

  it("a workflow that picks its graph at run time (a join of clips) is held to the graph it picks, as the studio offers it", async () => {
    const s = await studioSide({ endpoint: "video-concat-{n}", op: "concat" as Operation, kind: "video" }, "ceil-gen-2");
    expect(s.ticket.workflowId).toBe("video-concat-{n}");
    const lanes: Record<string, string> = { "video-concat-2": "join-lane-2", "video-concat-3": "join-lane-3" };
    const run = (ceiling: Parameters<typeof ceilingProblem>[0]) => composeTicket({ ticket: s.ticket, generationId: "ceil-gen-2", inputs: s.inputs }, { catalog, catalogVersion: VERSION, ceiling, laneOf: (id) => lanes[id] ?? "small" });
    // The two clips make the two-clip graph: a ceiling that names it, or its lane, lets it run.
    expect(await run({ workflows: ["video-concat-2"] })).toMatchObject({ ok: true, workflowId: "video-concat-2" });
    expect(await run({ lanes: ["join-lane-2"] })).toMatchObject({ ok: true });
    // One that names only another graph, or another lane, refuses it (after composing, by the graph it came out as).
    expect(await run({ workflows: ["video-concat-3"] })).toMatchObject({ ok: false, reason: "outside-ceiling" });
    expect(await run({ lanes: ["small"] })).toMatchObject({ ok: false, reason: "outside-ceiling" });
    // Its sizes are held before composing as for any ticket.
    expect(await run({ workflows: ["video-concat-2"], maxSeconds: 0.5 })).toMatchObject({ ok: false, reason: "outside-ceiling" });
  });

  it("a ceiling is kept the same way on the worker (worker.json) and in the studio", () => {
    const raw = { lanes: ["small", "0123456789ab", "nope"], workflows: ["selftest-image", "../x"], maxMegapixels: 4, maxSeconds: 0, maxOutputs: 2.7, other: true };
    expect(ceilingOf(raw)).toEqual(cleanCeiling(raw));
    expect(cleanCeiling(raw)).toEqual({ lanes: ["0123456789ab", "small"], workflows: ["selftest-image"], maxMegapixels: 4, maxOutputs: 2 });
    expect(ceilingOf({})).toBeNull();
    expect(ceilingOf("all")).toBeNull();
    // The studio's allowed lanes only narrow inside it.
    expect(lanesInside(["small", "aaaaaaaaaaaa"], { lanes: ["small"] })).toEqual(["small"]);
    expect(lanesInside(["small", "aaaaaaaaaaaa"], null)).toEqual(["small", "aaaaaaaaaaaa"]);
    // A graph job (the owner's own) by its lane or workflow.
    expect(graphInside({ lanes: ["small"] }, { lane: "small" })).toBe(true);
    expect(graphInside({ workflows: ["video-trim"] }, { lane: "small", workflowId: "selftest-image" })).toBe(false);
    expect(graphInside(null, { lane: "x" })).toBe(true);
  });

  it("setup's answers make the ceiling, and a name that isn't in the catalog is refused", () => {
    const known = (id: string) => catalog.has(id);
    expect(ceilingFrom({ work: "all", megapixels: "0", seconds: "", outputs: "0" }, known)).toEqual({ ceiling: null });
    expect(ceilingFrom({ work: "selftest-image, small", megapixels: "4.2", seconds: "10", outputs: "2" }, known)).toEqual({ ceiling: { lanes: ["small"], workflows: ["selftest-image"], maxMegapixels: 4.2, maxSeconds: 10, maxOutputs: 2 } });
    expect(ceilingFrom({ work: "not-a-workflow" }, known)).toHaveProperty("error");
    expect(ceilingFrom({ work: "all", megapixels: "lots" }, known)).toHaveProperty("error");
    expect(ceilingFrom({ work: "all", seconds: "-1" }, known)).toHaveProperty("error");
  });
});

describe("the catalog version", () => {
  it("is the same in the studio and in the worker's build, and changes with the composer or the catalog", async () => {
    expect(VERSION).toMatch(/^[0-9a-f]{64}$/);
    expect(builtVersion(ROOT)).toBe(VERSION);
    const fsMod = await import("node:fs");
    const os = await import("node:os");
    // A copy whose catalog differs in one workflow: another version.
    const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), "fuobe-catalog-version-"));
    try {
      const lib = path.join(ROOT, "workflows/comfyui");
      for (const f of fsMod.readdirSync(lib).filter((x) => x.endsWith(".json"))) fsMod.copyFileSync(path.join(lib, f), path.join(dir, f));
      expect(builtVersion(ROOT, dir)).toBe(VERSION);
      fsMod.writeFileSync(path.join(dir, "selftest-image.json"), fsMod.readFileSync(path.join(dir, "selftest-image.json"), "utf8").replace("ImageInvert", "ImageInvert "));
      expect(builtVersion(ROOT, dir)).not.toBe(VERSION);
      expect(computeCatalogVersion(ROOT, dir)).toBe(builtVersion(ROOT, dir));
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
    // The composer's files: its own, and every one it imports (no package: the worker installs none).
    const names = composerFiles(ROOT);
    expect(names).toEqual(expect.arrayContaining(["src/lib/ticket-compose.ts", "src/lib/comfy-compose.ts", "src/lib/job-ticket.ts"]));
    expect(names.every((n: string) => n.startsWith("src/"))).toBe(true);
  });

  it("stays the same after a change people only read or see, and changes with the composer's code or a workflow", async () => {
    const fsMod = await import("node:fs");
    const os = await import("node:os");
    const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), "fuobe-catalog-narrow-"));
    try {
      // A copy of the composer's files and the catalog.
      for (const rel of composerFiles(ROOT)) {
        fsMod.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fsMod.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
      }
      const lib = path.join(ROOT, "workflows/comfyui");
      fsMod.mkdirSync(path.join(dir, "workflows/comfyui"), { recursive: true });
      for (const f of fsMod.readdirSync(lib).filter((x) => x.endsWith(".json"))) fsMod.copyFileSync(path.join(lib, f), path.join(dir, "workflows/comfyui", f));
      const both = () => {
        const built = builtVersion(dir);
        expect(computeCatalogVersion(dir)).toBe(built);
        return built;
      };
      expect(both()).toBe(VERSION);
      const change = (rel: string, edit: (text: string) => string) => {
        const file = path.join(dir, rel);
        const before = fsMod.readFileSync(file, "utf8");
        const after = edit(before);
        expect(after, rel).not.toBe(before);
        fsMod.writeFileSync(file, after);
      };
      // What people only read or see: a comment, a blank line and an indent in the composer, a model's one-line
      // description, a tile's cover, the cloud models, the record of real renders.
      change("src/lib/comfy-compose.ts", (t) => t.replace("/**", "// A note for whoever reads this.\n\n/**\n * One more line of its comment.").replace(/\n {2}if \(/, "\n      if ("));
      change("src/lib/catalog/models.ts", (t) => t.replace(/tagline: "/, 'tagline: "Sharper. '));
      change("src/lib/template-covers.generated.ts", (t) => t.replace("?v=", "?v=0"));
      change("src/lib/catalog/cloud-models.generated.ts", (t) => t.replace('"name": "', '"name": "New '));
      change("workflows/comfyui/gpu-tested.json", (t) => t.replace("{", '{\n  "a-note": "seen",'));
      expect(both()).toBe(VERSION);
      // The composer's code: a new version.
      change("src/lib/comfy-compose.ts", (t) => `${t}\nexport const PROBE = 1;\n`);
      const code = both();
      expect(code).not.toBe(VERSION);
      // A model's route or setting (not its description): a new one again.
      change("src/lib/catalog/models.ts", (t) => t.replace(/routes: \[comfy\("/, 'routes: [comfy("x'));
      expect(both()).not.toBe(code);
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the composer as built into the worker composes the same graph as the studio's", async () => {
    const { spawnSync } = await import("node:child_process");
    const fsMod = await import("node:fs");
    const os = await import("node:os");
    const out = fsMod.mkdtempSync(path.join(os.tmpdir(), "fuobe-composer-built-"));
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-worker.mjs"), "--out", out], { cwd: ROOT, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(fsMod.readFileSync(path.join(out, "catalog-version.json"), "utf8")).version).toBe(VERSION);
      const built = (await import(pathToFileURL(path.join(out, "compose/lib/ticket-compose.mjs")).href)) as typeof import("@/lib/ticket-compose");
      const { workerCatalog } = await import("../bin/lib/worker/tickets.mjs");
      const s = await studioSide({ endpoint: "palette-transfer-image", op: "color-match", kind: "image" }, "built-gen-1", (f) => ({ images: [f("png")], palette: ["#102030", "#f0e0d0"], seed: 7 }));
      expect(s.ticket.inputs.some((i) => i.slot === "made.0")).toBe(true);
      const got = await built.composeTicket({ ticket: JSON.parse(JSON.stringify(s.ticket)), generationId: "built-gen-1", inputs: s.inputs }, { catalog: workerCatalog(path.join(ROOT, "workflows/comfyui")), catalogVersion: VERSION });
      expect(got.ok && got.graph).toEqual(s.graph);
    } finally {
      fsMod.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
