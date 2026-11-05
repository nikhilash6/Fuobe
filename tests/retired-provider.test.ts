import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mentionsRetiredName } from "./helpers/retired-name.mjs";
import { tempDir } from "./helpers/temp-dir";

/**
 * Build plan O7: Fuobe stopped calling a retired cloud provider. This file fails when a retired model comes back into
 * the catalog or code, when the catalog, a setting or a connection test offers that provider again, or when an id
 * stored before the switch no longer resolves to the model that replaced it. Rows stored then name the provider by
 * an id Fuobe no longer has; the fixtures below use "old-provider", which goes the same way. The provider's name
 * itself is checked everywhere by tests/neutral-names.test.ts.
 */

/** A provider id Fuobe doesn't have, as rows stored before the switch carry one. */
const OLD_PROVIDER = "old-provider";

const dir = tempDir("fuobe-retired-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { MODELS, getModel } = await import("@/lib/catalog");
const { enginesOf } = await import("@/lib/catalog/engines");
const { DIRECTOR_FIELDS, OPS_REPLACED_BY, REPLACED_BY, TRAINING_REPLACED_BY, currentModelId, migrateRequest, replacedBy, replacementOf } = await import("@/lib/catalog/replaced");
const { directorFieldWords } = await import("@/lib/catalog/cinema");
const { routesFor } = await import("@/lib/catalog/plan");
const { castSheetModel } = await import("@/lib/catalog/packs");
const { TRAINING_TARGETS } = await import("@/lib/catalog/training");
const { SOUL_LEGACY_IDS } = await import("@/lib/catalog/soul-looks.generated");
const { PROVIDER_SETTINGS } = await import("@/lib/connections");
const { PROVIDERS, provider, RETIRED_PROVIDER_ERROR } = await import("@/server/providers");
const { SETTINGS, getSetting, setSetting } = await import("@/server/settings");
const { db, MIGRATIONS } = await import("@/server/db");
const { withCurrentModels } = await import("@/lib/catalog/canvas");
const generationsRoute = await import("@/app/api/generations/route");
const { currentRequest, ensureRunner, getGeneration, listGenerations, previewGeneration } = await import("@/server/generations");
const { planCaps, retryPhoto } = await import("@/server/photodump");
const assistTools = await import("@/server/assist/tools");
const { saveFile } = await import("@/server/storage");

// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));

let rows = 0;
/** A generation row as one stored before the switch reads (the retired model and provider, as it was left). */
function storedRow(r: { feature: string; model: string; provider: string; op: string; kind?: string; status: string; request: object; externalId?: string; dependsOn?: string; outputs?: object[] }): string {
  const id = `old-${++rows}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, depends_on, created_at, updated_at)
       VALUES (?, ?, ?, 'cloud', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, r.feature, r.model, r.provider, r.op, r.kind ?? "image", r.status, JSON.stringify(r.request), JSON.stringify(r.outputs ?? []), r.externalId ?? null, r.dependsOn ?? null, now, now);
  return id;
}

/** Run the background runner until `done` holds (its own timer may be mid-tick). */
async function runUntil(done: () => boolean) {
  ensureRunner();
  for (let i = 0; i < 100 && !done(); i++) {
    await globalThis.__fuobeRunner!.tick();
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// No retired id in code (the studio's name itself is checked by tests/neutral-names.test.ts)

/** A retired model or training id in code (a stored one resolves through replaced.ts; nothing else names it). */
const RETIRED_IDS = new RegExp(`["'\`](${[...Object.keys(REPLACED_BY), ...Object.keys(TRAINING_REPLACED_BY)].join("|")})["'\`]`);
const RETIRED_ID_ALLOWED = new Set(["src/lib/catalog/replaced.ts", "src/server/db.ts"]);
const CODE = /\.(ts|tsx|mts|js|mjs|cjs)$/;

function walk(p: string, out: string[]) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return;
  const posix = p.replace(/\\/g, "/");
  // The worker's built parts are copies of scanned sources (scripts/build-worker.mjs), and never committed.
  if (posix === "bin/lib/worker/dist") return;
  if (fs.statSync(full).isFile()) {
    if (CODE.test(posix)) out.push(posix);
    return;
  }
  for (const name of fs.readdirSync(full)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    walk(path.join(p, name), out);
  }
}

describe("retired ids in code", () => {
  const files: string[] = [];
  for (const p of ["src", "bin"]) walk(p, files);

  it("scans every source file", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/server/providers/index.ts");
  });

  it("names no retired model or training id in code: stored ones resolve through replaced.ts", () => {
    const hits: string[] = [];
    for (const f of files.filter((x) => !RETIRED_ID_ALLOWED.has(x))) {
      fs.readFileSync(path.join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => RETIRED_IDS.test(line) && hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`));
    }
    expect(hits).toEqual([]);
    expect(RETIRED_IDS.test('if (draft.modelId !== "soul-2") return null;')).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The catalog, the providers and the settings

describe("the catalog and the providers run without it", () => {
  const KNOWN = new Set(["fal", "replicate", "comfyui", "mock", "local", "llm", "openai", "google", "worldcast"]);

  it("routes every model to a provider Fuobe has", () => {
    const odd = MODELS.flatMap((m) => m.routes.filter((r) => !KNOWN.has(r.provider) || mentionsRetiredName(r.endpoint)).map((r) => `${m.id}: ${r.provider} ${r.endpoint}`));
    expect(odd).toEqual([]);
    expect(Object.keys(PROVIDERS).sort()).toEqual([...KNOWN].sort());
  });

  it("has no setting, connection test or env var for it", () => {
    const named = Object.entries(SETTINGS).filter(([name, def]) => mentionsRetiredName(`${name} ${def.key} ${"env" in def ? def.env : ""}`));
    expect(named).toEqual([]);
    expect(Object.keys(PROVIDER_SETTINGS).filter((id) => !KNOWN.has(id) && mentionsRetiredName(id))).toEqual([]);
    expect(SETTINGS.cloudProvider.options).toEqual(["auto", "fal", "replicate"]);
  });

  it("fails a job stored under a provider Fuobe no longer has, with a way forward, instead of throwing", async () => {
    const gone = provider(OLD_PROVIDER as never);
    expect(gone.isConfigured()).toBe(false);
    const ctx = { externalId: "x", meta: {}, route: { op: "t2i" as const, provider: "fal" as const, endpoint: "x" }, model: getModel("nano-banana-pro")!, createdAt: 0 };
    await expect(gone.poll(ctx)).resolves.toEqual({ state: "failed", error: RETIRED_PROVIDER_ERROR });
    await expect(gone.cancel!(ctx)).resolves.toBeUndefined();
    expect(RETIRED_PROVIDER_ERROR).toMatch(/run it again/);
  });

  it("closes the partner gaps on fal: Happy Horse 1.1 runs there", () => {
    const hh = getModel("happy-horse-1-1")!;
    expect(hh.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([
      ["t2v", "fal", "alibaba/happy-horse/v1.1/text-to-video"],
      ["i2v", "fal", "alibaba/happy-horse/v1.1/image-to-video"],
      ["ref2v", "fal", "alibaba/happy-horse/v1.1/reference-to-video"],
    ]);
    expect(hh.pricing).toMatchObject({ unit: "second", usd: 0.14, byResolution: { "720p": 0.14, "1080p": 0.18 } });
  });
});

// ---------------------------------------------------------------------------
// What replaced each retired item

describe("REPLACED_BY", () => {
  /** Every model the deleted catalog had, and the AI Influencer sheet defined beside it. */
  const RETIRED = [
    "soul-1",
    "soul-2",
    "soul-cinema",
    "cinema-studio-4",
    "genjutsu-motion-transfer",
    "genjutsu-lite-motion-transfer",
    "genjutsu-object-swap",
    "genjutsu-lite-object-swap",
    "genjutsu-restyle",
    "marketing-studio-image",
    "ads-studio",
    "ai-influencer",
  ];

  it("covers every retired model, none of which is in the catalog any more", () => {
    expect(Object.keys(REPLACED_BY).sort()).toEqual([...RETIRED].sort());
    for (const id of RETIRED) expect(getModel(id), id).toBeUndefined();
  });

  it("points each at a model that exists and isn't retired; an Original runs on both engines", () => {
    for (const [id, r] of Object.entries(REPLACED_BY)) {
      const m = getModel(r.id);
      expect(m, `${id} → ${r.id}`).toBeDefined();
      expect(replacedBy(r.id), r.id).toBeUndefined();
      if (r.original) expect(enginesOf(m!).sort(), r.id).toEqual(["cloud", "open"]);
      else expect(enginesOf(m!), r.id).toContain("cloud");
      expect(r.note.length, id).toBeGreaterThan(10);
    }
    expect(currentModelId("soul-2")).toBe("fuobe-soul");
    expect(currentModelId("nano-banana-pro")).toBe("nano-banana-pro");
  });

  it("points the old Soul ID targets at a trainer Fuobe has", () => {
    for (const [id, r] of Object.entries(TRAINING_REPLACED_BY)) {
      expect(TRAINING_TARGETS.some((t) => t.id === id), id).toBe(false);
      expect(TRAINING_TARGETS.some((t) => t.id === r.id), r.id).toBe(true);
    }
  });

  it("moves a stored request to its replacement: a Soul style becomes its look, the retired API's settings go", () => {
    const style = Object.entries(SOUL_LEGACY_IDS).find(([, look]) => look === "v2-general")![0];
    const old = { feature: "image", modelId: "soul-2", prompt: "a rooftop party", params: { aspectRatio: "3:4", extra: { style_id: style, custom_reference_id: "ref-1", custom_reference_strength: 0.8, seed: 7 } } };
    const { request, note } = migrateRequest(old);
    // No engine: the install runs the Original where its engine mode (else the first engine connected) says.
    expect(request).toEqual({ feature: "image", modelId: "fuobe-soul", presetId: "v2-general", prompt: "a rooftop party", params: { aspectRatio: "3:4", extra: { seed: 7 } } });
    expect(note).toMatch(/Fuobe Soul/);
    // An engine asked for stays.
    expect(migrateRequest({ ...old, engine: "open" as const }).request.engine).toBe("open");
    // Marketing Studio Image runs on its Original (build plan O10), wherever the install runs Originals.
    expect(migrateRequest({ modelId: "marketing-studio-image", params: { extra: { template_id: "t" } } }).request).toEqual({ modelId: "fuobe-marketing-image", params: {} });
    expect(migrateRequest({ modelId: "ads-studio", op: "edit" as const }).request).toEqual({ modelId: "fuobe-marketing-image", op: "edit" });
    expect(migrateRequest({ modelId: "ai-influencer", prompt: "a surfer" }).request).toEqual({ modelId: "fuobe-soul", prompt: "a surfer" });
    // A current model's request comes back as it was.
    const current = { modelId: "nano-banana-pro", params: { extra: { style_id: "x" } } };
    expect(migrateRequest(current)).toEqual({ request: current });
  });
});

describe("operations the replacements do elsewhere", () => {
  /** What each retired model did (the deleted catalog's routes), and the partner ops only the retired provider ran. */
  const RETIRED_OPS: Record<string, string[]> = {
    "soul-1": ["t2i"],
    "soul-2": ["t2i", "edit"],
    "soul-cinema": ["t2i"],
    "cinema-studio-4": ["t2v", "ref2v"],
    "genjutsu-motion-transfer": ["motion-transfer"],
    "genjutsu-lite-motion-transfer": ["motion-transfer"],
    "genjutsu-object-swap": ["v2v", "video-swap"],
    "genjutsu-lite-object-swap": ["video-swap"],
    "genjutsu-restyle": ["v2v"],
    "marketing-studio-image": ["t2i", "edit"],
    "ads-studio": ["t2i", "edit"],
    "ai-influencer": ["t2i", "edit"],
    "seedance-2-5": ["v2v"],
    "ltx-2-5": ["flf2v"],
  };

  it("sends every operation a retired model (or a partner's retired route) ran to a model that does it", () => {
    for (const [id, ops] of Object.entries(RETIRED_OPS)) {
      for (const op of ops) {
        const to = replacementOf(id, op as never);
        const target = to?.id ?? id;
        const m = getModel(target);
        expect(m, `${id} ${op} → ${target}`).toBeDefined();
        expect(routesFor(m!, (to?.op ?? op) as never).length, `${id} ${op} → ${target} ${to?.op ?? op}`).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(OPS_REPLACED_BY).sort()).toEqual(["ltx-2-5", "seedance-2-5"]);
  });

  it("moves a stored request's operation with it, and reads Cinema Studio's references as references", () => {
    expect(migrateRequest({ modelId: "genjutsu-object-swap", op: "v2v" as const }).request).toMatchObject({ modelId: "fuobe-genjutsu-swap", op: "video-swap" });
    expect(migrateRequest({ modelId: "seedance-2-5", op: "v2v" as const }).request).toEqual({ modelId: "kling-o3", op: "v2v" });
    expect(migrateRequest({ modelId: "ltx-2-5", op: "flf2v" as const }).request).toEqual({ modelId: "fuobe-cinema", op: "flf2v" });
    // A partner model's own operations are untouched.
    const seedance = { modelId: "seedance-2-5", op: "t2v" as const };
    expect(migrateRequest(seedance).request).toBe(seedance);
    // Cinema Studio had no start-frame route: its images were references, which Fuobe Cinema doesn't take yet.
    const refs = migrateRequest({ modelId: "cinema-studio-4", prompt: "x", inputs: { images: ["/api/files/a.png"] } });
    expect(refs.request).toMatchObject({ modelId: "seedance-2-5", op: "ref2v" });
    expect(refs.note).toMatch(/Seedance 2\.5/);
    expect(migrateRequest({ modelId: "cinema-studio-4", prompt: "x" }).request).toEqual({ modelId: "fuobe-cinema", prompt: "x" });
  });

  it("writes Cinema Studio's Director fields into the prompt on the server, and drops them in the browser", () => {
    const extra = { genre: "noir", era: "1980s", camera_model: "35mm-film", camera_lens: "anamorphic", camera_aperture: "f14-wide-open", light: "silhouette", pacing: "calm", camera_movement: "dolly-in", color_palette: "neon-rain-at-midnight", seed: 3 };
    expect(Object.keys(extra).filter((k) => k !== "seed").sort()).toEqual([...DIRECTOR_FIELDS].sort());
    const old = { modelId: "cinema-studio-4", prompt: "A chase through the market.", params: { duration: 8, extra } };
    const server = currentRequest(old as never).request;
    expect(server.modelId).toBe("fuobe-cinema");
    expect(server.params).toEqual({ duration: 8, extra: { seed: 3 } });
    expect(server.prompt).toMatch(/^A chase through the market\. /);
    for (const words of [/noir/i, /1980s/i, /35mm/i, /anamorphic/i, /silhouette/i, /calm/i, /dolly/i, /neon/i]) expect(server.prompt).toMatch(words);
    expect(directorFieldWords({ genre: "not-a-genre" })).toBe("");
    expect(currentRequest(old as never).note).toBe("Cinema Studio's clips now run on Fuobe Cinema, with the Director settings written into the prompt");
    // The browser has no Director words to write: the fields go, the prompt stays the user's, and the note says so.
    const browser = migrateRequest(old);
    expect(browser.request).toEqual({ modelId: "fuobe-cinema", prompt: "A chase through the market.", params: { duration: 8, extra: { seed: 3 } } });
    expect(browser.note).toMatch(/Director settings .* were left out/);
    expect(migrateRequest({ modelId: "cinema-studio-4", prompt: "x" }).note).toBe("Cinema Studio's clips now run on Fuobe Cinema");
    // And the cloud half's payload carries none of them.
    const p = previewGeneration({ feature: "video", ...old } as never);
    expect(p.model.id).toBe("fuobe-cinema");
    expect(p.prompt).toMatch(/noir/i);
  });
});

describe("stored ids resolve where they are read", () => {
  it("runs a retired Original's request on the install's engine: open source only takes it to the GPU", async () => {
    const preview = async (modelId: string) =>
      (await (
        await generationsRoute.POST(
          new Request("http://x/api/generations?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId, prompt: "a fox" }) }),
        )
      ).json()) as { modelId: string; engine: string; notes?: string[]; error?: string };
    setSetting("engineMode", "open");
    try {
      const old = await preview("soul-2");
      expect(old.error).toBeUndefined();
      expect(old).toMatchObject({ modelId: "fuobe-soul", engine: "open" });
      expect(old.notes?.[0]).toMatch(/Fuobe Soul/);
    } finally {
      setSetting("engineMode", "cloud");
    }
    try {
      expect(await preview("soul-2")).toMatchObject({ modelId: "fuobe-soul", engine: "cloud" });
    } finally {
      setSetting("engineMode", "both");
    }
    // Both on: the same engine the Original itself gets.
    const [old, now] = [await preview("soul-2"), await preview("fuobe-soul")];
    expect(old.engine).toBe(now.engine);
  });

  it("runs a generation asked for on a retired model on its replacement, and says so (Reuse, CLI, MCP)", async () => {
    const res = await generationsRoute.POST(
      new Request("http://x/api/generations?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "soul-2", prompt: "a fox" }) }),
    );
    const body = (await res.json()) as { modelId: string; engine: string; notes?: string[]; error?: string };
    expect(body.error).toBeUndefined();
    expect(body).toMatchObject({ modelId: "fuobe-soul" });
    expect(body.notes?.[0]).toMatch(/Fuobe Soul/);
    // Made, the run is stored on its replacement and its notes say so.
    const made = await generationsRoute.POST(
      new Request("http://x/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "cinema-studio-4", prompt: "a fox", params: { extra: { genre: "noir" } } }) }),
    );
    const created = (await made.json()) as { items: { id: string; modelId: string; request: { modelId: string; prompt: string } }[]; notes?: string[] };
    expect(created.items[0]).toMatchObject({ modelId: "fuobe-cinema", request: { modelId: "fuobe-cinema" } });
    expect(created.items[0].request.prompt).toMatch(/noir/i);
    expect(created.notes?.[0]).toMatch(/Fuobe Cinema/);
  });

  it("retries a Character Sheet or AI Influencer photo made on a retired model, on its replacement", () => {
    const sheet = storedRow({
      feature: "character-sheet",
      model: "soul-2",
      provider: OLD_PROVIDER,
      op: "t2i",
      status: "failed",
      request: { feature: "character-sheet", modelId: "soul-2", op: "t2i", prompt: "a sheet", params: { aspectRatio: "16:9", extra: { style_id: "x" } } },
    });
    const [again] = retryPhoto(sheet);
    expect(again).toMatchObject({ modelId: "fuobe-soul", feature: "character-sheet", request: { modelId: "fuobe-soul" } });
    const app = storedRow({ feature: "app:app-ai-influencer", model: "ai-influencer", provider: OLD_PROVIDER, op: "t2i", status: "canceled", request: { feature: "app:app-ai-influencer", modelId: "ai-influencer", op: "t2i", prompt: "a character" } });
    expect(retryPhoto(app)[0]).toMatchObject({ modelId: "fuobe-soul" });
  });

  it("fails a job still running on a retired model with the way forward, not 'no longer exists'", async () => {
    const running = { feature: "image", op: "t2i", status: "running", externalId: "job-1", request: { feature: "image", modelId: "x", prompt: "an old run" } };
    const soul = storedRow({ ...running, model: "soul-2", provider: OLD_PROVIDER });
    const partner = storedRow({ ...running, model: "nano-banana-pro", provider: OLD_PROVIDER });
    const gone = storedRow({ ...running, model: "old-model", provider: "fal" });
    await runUntil(() => [soul, partner, gone].every((id) => getGeneration(id)?.status === "failed"));
    expect(getGeneration(soul)).toMatchObject({ status: "failed", error: RETIRED_PROVIDER_ERROR });
    expect(getGeneration(partner)).toMatchObject({ status: "failed", error: RETIRED_PROVIDER_ERROR });
    expect(getGeneration(gone)).toMatchObject({ status: "failed", error: "This model isn't available any more. Pick another." });
  });

  it("starts a step that was waiting on a retired model on its replacement", async () => {
    const still = saveFile({ data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_000, 7)]), contentType: "image/png", name: "still.png", source: "upload" }).url;
    const first = storedRow({ feature: "image", model: "nano-banana-pro", provider: "mock", op: "t2i", status: "succeeded", externalId: "done", outputs: [{ url: still, kind: "image" }], request: { feature: "image", modelId: "nano-banana-pro", prompt: "a still" } });
    const step = storedRow({ feature: "image", model: "soul-2", provider: OLD_PROVIDER, op: "edit", status: "queued", dependsOn: first, request: { feature: "image", modelId: "soul-2", op: "edit", prompt: "restyle it", chainFrom: "first" } });
    await runUntil(() => getGeneration(step)?.status !== "queued");
    const g = getGeneration(step)!;
    expect(g.error ?? null).toBeNull();
    expect(g).toMatchObject({ modelId: "fuobe-soul", request: { modelId: "fuobe-soul" } });
  });

  it("casts a Soul Cast sheet in the cloud only when Fuobe Soul's cloud half is on", () => {
    expect(castSheetModel("cloud", planCaps())).toBe("fuobe-soul");
    expect(castSheetModel("cloud", { has: (id, engine) => !(id === "fuobe-soul" && engine === "cloud") })).toBe("nano-banana-pro");
    expect(castSheetModel("open", { has: (id, engine) => !(id === "fuobe-soul" && engine === "cloud") })).toBe("oss-zimage-soul-cast");
  });


  it("keeps a past run on a retired model in the Library, named as it ran, with its outputs", async () => {
    const res = await generationsRoute.POST(
      new Request("http://x/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "fuobe-soul", prompt: "an old portrait" }) }),
    );
    const { items } = (await res.json()) as { items: { id: string }[] };
    const id = items[0].id;
    // As a row stored before the switch reads: the retired model and provider, a finished output.
    db()
      .prepare("UPDATE generations SET model_id = 'soul-2', provider = ?, status = 'succeeded', outputs_json = ? WHERE id = ?")
      .run(OLD_PROVIDER, JSON.stringify([{ url: "/api/files/old.png", kind: "image" }]), id);
    const g = getGeneration(id)!;
    expect(g).toMatchObject({ modelId: "soul-2", modelName: REPLACED_BY["soul-2"].was, status: "succeeded" });
    expect(g.outputs).toHaveLength(1);
    expect(listGenerations({ feature: "image" }).map((x) => x.id)).toContain(id);
  });

  it("moves a saved Canvas node on a retired model to its replacement, in the cloud", () => {
    const graph = {
      nodes: [
        { id: "a", type: "model" as const, position: { x: 0, y: 0 }, data: { modelId: "cinema-studio-4", mediaKind: "video" as const, params: { aspectRatio: "16:9", extra: { color_palette: "static-noon" } } } },
        { id: "b", type: "model" as const, position: { x: 0, y: 0 }, data: { modelId: "nano-banana-pro", mediaKind: "image" as const } },
      ],
      edges: [],
    };
    const moved = withCurrentModels(graph);
    expect(moved.nodes[0].data).toMatchObject({ modelId: "fuobe-cinema", engine: "cloud", params: { aspectRatio: "16:9" } });
    expect(moved.nodes[0].data.params?.extra).toBeUndefined();
    expect(moved.nodes[1]).toBe(graph.nodes[1]);
    // A board with nothing retired comes back as it was.
    expect(withCurrentModels(moved)).toBe(moved);
  });

  it("moves a saved Canvas node's operation too: Cinema Studio's connected images were references", () => {
    const node = (id: string, modelId: string, op?: "v2v") => ({ id, type: "model" as const, position: { x: 0, y: 0 }, data: { modelId, mediaKind: "video" as const, ...(op && { op }) } });
    const image = { id: "img", type: "image" as const, position: { x: 0, y: 0 }, data: { url: "/api/files/a.png" } };
    const graph = {
      nodes: [node("refs", "cinema-studio-4"), node("plain", "cinema-studio-4"), node("swap", "genjutsu-object-swap", "v2v"), node("edit", "seedance-2-5", "v2v"), node("own", "seedance-2-5"), image],
      edges: [{ id: "e1", source: "img", target: "refs", targetHandle: "images" }],
    } as Parameters<typeof withCurrentModels>[0];
    const by = Object.fromEntries(withCurrentModels(graph).nodes.map((n) => [n.id, n.data]));
    expect(by.refs).toMatchObject({ modelId: "seedance-2-5", op: "ref2v" });
    expect(by.plain).toMatchObject({ modelId: "fuobe-cinema" });
    expect(by.plain.op).toBeUndefined();
    expect(by.swap).toMatchObject({ modelId: "fuobe-genjutsu-swap", op: "video-swap" });
    expect(by.edit).toMatchObject({ modelId: "kling-o3", op: "v2v" });
    expect(by.own).toEqual(graph.nodes[4].data);
  });

  it("plans an Assist or MCP job on a retired model or operation where it runs now", () => {
    const video = "/api/files/ad.mp4";
    const plan = assistTools.planFor(
      "generate",
      {
        summary: "Old saved calls",
        jobs: [
          { model_id: "soul-2", prompt: "a fox" },
          { model_id: "seedance-2-5", op: "v2v", prompt: "Make it snow", video },
          { model_id: "genjutsu-object-swap", op: "v2v", prompt: "Swap the mug", video, images: ["/api/files/mug.png"] },
        ],
      },
      { engine: "cloud" },
    );
    expect(plan.jobs.map((j) => [j.modelId, j.op, j.error])).toEqual([
      ["fuobe-soul", "t2i", undefined],
      ["kling-o3", "v2v", undefined],
      ["fuobe-genjutsu-swap", "video-swap", undefined],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The one migration

describe("the O7 migration", () => {
  it("deletes the retired key, resets the provider choice and marks the ads drawn whole as baked", () => {
    const d = db();
    // The O7 migration by its content (later migrations follow it, and some of them can't run twice).
    const last = MIGRATIONS.findIndex((m) => m.includes("UPDATE ad_batches SET route = 'baked'"));
    expect(last).toBeGreaterThan(0);
    // The provider id as the migration reads it: the one it names, or, where it lists what stays valid instead, any id
    // Fuobe doesn't have.
    const old = /key = '([a-z0-9-]+)\.key'/.exec(MIGRATIONS[last])?.[1] ?? OLD_PROVIDER;
    const meta1 = JSON.stringify({ engine: "cloud", modelId: "ads-studio", route: old, ratio: "9:16" });
    // An install from before: rows the migration rewrites, then the migration runs again on the next open.
    d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, 'id:secret'), ('cloud.provider', ?), ('fal.key', 'fal-live')").run(`${old}.key`, old);
    d.prepare("INSERT INTO ad_batches (id, brand_id, engine, route, model_id, created_at) VALUES ('b1', 'br', 'cloud', ?, 'ads-studio', 1), ('b2', 'br', 'cloud', 'fuobe', 'nano-banana-pro', 2)").run(old);
    d.prepare(
      `INSERT INTO ad_creatives (id, batch_id, brand_id, position, status, meta_json, created_at, updated_at) VALUES
       ('c1', 'b1', 'br', 0, 'queued', ?, 1, 1),
       ('c2', 'b2', 'br', 0, 'queued', '{"engine":"cloud","modelId":"nano-banana-pro","route":"fuobe"}', 2, 2),
       ('c3', 'b2', 'br', 1, 'failed', 'not json', 3, 3)`,
    ).run(meta1);
    d.prepare("DELETE FROM _migrations WHERE id = ?").run(last);
    d.close();
    globalThis.__fuobeDb = undefined;

    const again = db();
    expect(again.prepare("SELECT value FROM settings WHERE key = ?").get(`${old}.key`)).toBeUndefined();
    // A key Fuobe still reads stays.
    expect(again.prepare("SELECT value FROM settings WHERE key = 'fal.key'").get()).toEqual({ value: "fal-live" });
    expect(again.prepare("SELECT value FROM settings WHERE key = 'cloud.provider'").get()).toEqual({ value: "auto" });
    expect(getSetting("cloudProvider")).toBe("auto");
    expect(again.prepare("SELECT route FROM ad_batches ORDER BY id").all()).toEqual([{ route: "baked" }, { route: "fuobe" }]);
    const meta = (id: string) => (again.prepare("SELECT meta_json FROM ad_creatives WHERE id = ?").get(id) as { meta_json: string }).meta_json;
    expect(JSON.parse(meta("c1"))).toEqual({ engine: "cloud", modelId: "ads-studio", route: "baked", ratio: "9:16" });
    expect(JSON.parse(meta("c2")).route).toBe("fuobe");
    expect(meta("c3")).toBe("not json");
  });
});
