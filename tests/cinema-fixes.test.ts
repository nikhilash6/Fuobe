import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// Round-3 review fixes: retry (batches, chains as a unit), stale folders, step previews, project-scoped
// deletes, spend that survives deletes, "My Generations" ownership.
const dir = tempDir("fuobe-cinema-fixes-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const gens = await import("@/server/generations");
const library = await import("@/server/library");
const cinema = await import("@/server/cinema");
const { generateInProject, swatchUrl } = await import("@/server/cinema-generate");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const itemsRoute = await import("@/app/api/cinema/projects/[id]/items/route");
const { PALETTES } = await import("@/lib/catalog/cinema");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const VIDEO = { engine: "cloud" as const, mode: "video" as const, action: "generate" as const, prompt: "A detective lights a match in the rain", duration: 5, aspectRatio: "16:9", batch: 1, settings: {} };
const CIRCUS = { palette: { kind: "preset" as const, slug: "the-circus" } };
const circusSwatch = () => swatchUrl(PALETTES.find((p) => p.slug === "the-circus")!.hex);

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const dependsOn = (id: string) => {
  const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
  return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
};
const count = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;

describe("Cinema retry", () => {
  it("retries one take of a batch of 4 as one job, in place of the failed one", async () => {
    const p = cinema.createProject({ name: "Batch" });
    const { items } = generateInProject(p.id, { ...VIDEO, batch: 4 });
    expect(items).toHaveLength(4);
    await gens.cancelGeneration(items[0].id);
    const again = cinema.retryItem(p.id, items[0].id);
    expect(again).toHaveLength(1);
    expect(again[0].request.params?.numOutputs).toBe(1);
    expect(again[0].batchId).toBe(items[0].batchId);
    // The canceled take moved to the Trash: the project still shows four takes.
    expect(gens.getGeneration(items[0].id)).toBeNull();
    expect(cinema.listItems(p.id).map((g) => g.id).sort()).toEqual([again[0].id, ...items.slice(1).map((g) => g.id)].sort());
    // A take that's still rendering isn't retried (the new one was just queued).
    expect(() => cinema.retryItem(p.id, again[0].id)).toThrow(/still rendering/);
  });

  it("retries a palette-locked take as a unit: the failed main step brings its palette step back", async () => {
    const p = cinema.createProject({ name: "Chain" });
    const { items } = generateInProject(p.id, { ...VIDEO, engine: "open", settings: CIRCUS });
    expect(items.map((g) => g.modelId)).toEqual(["fuobe-cinema", "oss-palette-video"]);
    await gens.cancelGeneration(items[0].id);
    expect((await settle(items[1].id)).status).toBe("failed");

    // Retrying the dependent finds the broken step it waits for; retrying the main finds its dependent.
    const again = cinema.retryItem(p.id, items[1].id);
    expect(again.map((g) => g.modelId)).toEqual(["fuobe-cinema", "oss-palette-video"]);
    expect(again[0].request.engine).toBe("open");
    expect(dependsOn(again[1].id)).toEqual([again[0].id]);
    // Its request is the unfilled one: the swatch only, the clip arrives through the chain.
    expect(again[1].request.inputs?.images).toEqual([circusSwatch()]);
    expect(again[1].request.chain).toEqual([{ slot: "video" }]);
    expect(cinema.listItems(p.id).map((g) => g.id).sort()).toEqual(again.map((g) => g.id).sort());
    const lock = await settle(again[1].id, 50_000);
    expect(lock.status).toBe("succeeded");
    expect(lock.request.inputs?.video).toBe(gens.getGeneration(again[0].id)!.outputs[0].url);
  }, 70_000);

  it("retries a failed dependent on its own when its inputs finished, rebuilding them from the dependency", async () => {
    const p = cinema.createProject({ name: "Still palette" });
    const { items } = generateInProject(p.id, { ...VIDEO, engine: "open", mode: "image", settings: { camera: "modern", lens: "clean-sharp", focal: "50mm", ...CIRCUS } });
    expect(items.map((g) => g.modelId)).toEqual([expect.any(String), "oss-palette-image"]);
    await settle(items[1].id, 50_000);
    const still = gens.getGeneration(items[0].id)!;
    expect(still.status).toBe("succeeded");
    // The palette step failed after it got its inputs (its stored request is the filled one).
    db().prepare("UPDATE generations SET status = 'failed', error = 'boom' WHERE id = ?").run(items[1].id);
    const again = cinema.retryItem(p.id, items[1].id);
    expect(again).toHaveLength(1);
    expect(dependsOn(again[0].id)).toEqual([items[0].id]);
    expect(again[0].request.inputs?.images).toEqual([circusSwatch()]);
    const done = await settle(again[0].id, 50_000);
    expect(done.status).toBe("succeeded");
    expect(done.request.inputs?.images).toEqual([still.outputs[0].url, circusSwatch()]);
  }, 90_000);

  it("retries a prequel chain from any step, wiring the new steps to each other", async () => {
    const p = cinema.createProject({ name: "Prequel retry" });
    const src = gens.createGenerations({ feature: "cinema", modelId: "seedance-2-5", prompt: "source take", params: { duration: 5 } })[0];
    const take = await settle(src.id);
    // A partner model's prequel (Fuobe Cinema's is one extend call).
    const { items } = generateInProject(p.id, { ...VIDEO, modelId: "seedance-2-5", action: "extend-backward", prompt: "he walks up to the door", source: { url: take.outputs[0].url, kind: "video" } });
    expect(items.map((g) => g.op)).toEqual(["frame", "edit", "flf2v"]);
    await gens.cancelGeneration(items[0].id);
    await settle(items[2].id);
    const again = cinema.retryItem(p.id, items[2].id);
    expect(again.map((g) => g.op)).toEqual(["frame", "edit", "flf2v"]);
    expect(dependsOn(again[1].id)).toEqual([again[0].id]);
    expect(dependsOn(again[2].id)).toEqual([again[1].id, again[0].id]);
    const film = await settle(again[2].id, 60_000);
    expect(film.status).toBe("succeeded");
    expect(film.request.inputs?.endImage).toBe(gens.getGeneration(again[0].id)!.outputs[0].url);
  }, 90_000);
});

describe("Cinema generate", () => {
  it("files the take at the project root when its scene was deleted", async () => {
    const p = cinema.createProject({ name: "Gone folder" });
    const f = cinema.createFolder(p.id, { name: "Scene" });
    cinema.deleteFolder(p.id, f.id);
    const res = await generateRoute.POST(json("POST", { input: VIDEO, folderId: f.id }), params({ id: p.id }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.folderId).toBeNull();
    expect(body.plan.notes[0]).toMatch(/scene was deleted/);
    expect(cinema.listItems(p.id, { folderId: null }).map((g) => g.id)).toEqual(body.items.map((g: { id: string }) => g.id));
  });

  it("checks every step before starting any, and answers 422 (not 500) for an engine-mode mismatch with a cap", async () => {
    const src = gens.createGenerations({ feature: "cinema", modelId: "seedance-2-5", prompt: "source", params: { duration: 5 } })[0];
    const take = await settle(src.id);
    setSetting("engineMode", "cloud");
    try {
      // Open prequel without a first frame: step 1 (fal extract-frame) is allowed, step 2 (open edit) isn't.
      const p = cinema.createProject({ name: "Mixed" });
      const before = count();
      expect(() => generateInProject(p.id, { ...VIDEO, engine: "open", action: "extend-backward", prompt: "", source: { url: take.outputs[0].url, kind: "video" } })).toThrow(/open-source model/);
      expect(count()).toBe(before);
    } finally {
      setSetting("engineMode", "both");
    }
    setSetting("engineMode", "open");
    try {
      const capped = cinema.createProject({ name: "Capped mode", costCapUsd: 5 });
      const res = await generateRoute.POST(json("POST", { input: VIDEO }), params({ id: capped.id }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/isn't available here/);
    } finally {
      setSetting("engineMode", "both");
    }
  }, 60_000);
});

describe("Cinema items", () => {
  it("deletes only the project's own takes, to the Trash, and Restore brings them back", async () => {
    const a = cinema.createProject({ name: "A" });
    const other = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "unrelated" })[0];
    const res = await itemsRoute.DELETE(json("DELETE", { ids: [other.id], deleteGenerations: true }), params({ id: a.id }));
    expect((await res.json()).removed).toBe(0);
    expect(gens.getGeneration(other.id)).not.toBeNull();

    const mine = gens.createGenerations({ feature: "cinema", modelId: "nano-banana-pro", prompt: "mine" })[0];
    cinema.addItems(a.id, [mine.id]);
    expect((await (await itemsRoute.DELETE(json("DELETE", { ids: [mine.id, other.id], deleteGenerations: true }), params({ id: a.id }))).json()).removed).toBe(1);
    expect(cinema.listItems(a.id)).toHaveLength(0);
    library.restoreGenerations([mine.id]);
    expect(cinema.listItems(a.id).map((g) => g.id)).toEqual([mine.id]);
  });

  it("keeps what was spent when takes are deleted, taken out or emptied from the Trash", async () => {
    const p = cinema.createProject({ name: "Spend", costCapUsd: 10 });
    const ids = [0, 1, 2].map(() => gens.createGenerations({ feature: "cinema", modelId: "nano-banana-pro", prompt: "paid" })[0].id);
    db().prepare(`UPDATE generations SET cost_usd = 0.5 WHERE id IN (${ids.map(() => "?").join(", ")})`).run(...ids);
    cinema.addItems(p.id, ids);
    expect(cinema.spentUsd(p.id)).toBe(1.5);
    cinema.removeItems(p.id, [ids[0]], { deleteGenerations: true });
    expect(cinema.spentUsd(p.id)).toBe(1.5);
    await library.deleteForever([ids[0]]);
    expect(gens.getGeneration(ids[0], { includeDeleted: true })).toBeNull();
    expect(cinema.spentUsd(p.id)).toBe(1.5);
    // Taken out of the project (not deleted): hidden, still counted, and back when re-added.
    expect(cinema.removeItems(p.id, [ids[1]])).toBe(1);
    expect(cinema.listItems(p.id).map((g) => g.id)).toEqual([ids[2]]);
    expect(cinema.spentUsd(p.id)).toBe(1.5);
    expect(cinema.listProjects().find((x) => x.id === p.id)?.stats).toMatchObject({ items: 1, spentUsd: 1.5 });
    cinema.addItems(p.id, [ids[1]]);
    expect(cinema.listItems(p.id).map((g) => g.id).sort()).toEqual([ids[1], ids[2]].sort());
    expect(cinema.spentUsd(p.id)).toBe(1.5);
  });

  it("names the owning project of every take in My Generations", async () => {
    const a = cinema.createProject({ name: "Studio A" });
    const b = cinema.createProject({ name: "Studio B" });
    const { items: ta } = generateInProject(a.id, VIDEO);
    const { items: tb } = generateInProject(b.id, VIDEO);
    const studio = cinema.listStudioGenerations();
    expect(studio.find((g) => g.id === ta[0].id)?.projectId).toBe(a.id);
    expect(studio.find((g) => g.id === tb[0].id)?.projectId).toBe(b.id);
    // Project-scoped likes and moves leave other projects' takes alone.
    const patch = await itemsRoute.PATCH(json("PATCH", { ids: [tb[0].id], favorite: true }), params({ id: a.id }));
    expect(patch.status).toBe(200);
    expect(gens.getGeneration(tb[0].id)?.favorite).toBe(false);
    expect(cinema.moveItems(a.id, [tb[0].id], null)).toBe(0);
  });
});
