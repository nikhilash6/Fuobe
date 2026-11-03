import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// Every starter runs as it comes, on a fresh install in demo mode: the owner's tap makes the Cinema project or the
// element, Assist's starters plan and run on the offline planner, Storyboard's price and run, and Cinema's shot 1
// renders from the project the starter made.

vi.setConfig({ testTimeout: 120_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const dir = tempDir("fuobe-starters-run-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const { getElement, listElements } = await import("@/server/elements");
const { absolutePath, filesRel, listAssets } = await import("@/server/storage");
const { sampleFile } = await import("@/server/canvas-samples");
const agent = await import("@/server/assist/agent");
const { STARTERS } = await import("@/lib/starters/catalog");
const startersRoute = await import("@/app/api/starters/[id]/route");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const boardsRoute = await import("@/app/api/storyboards/route");
const estimateRoute = await import("@/app/api/storyboards/estimate/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const post = (url: string, body?: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const make = async (id: string) => startersRoute.POST(post(`/api/starters/${id}`), params({ id }));

async function settle(id: string, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const of = <K extends string>(kind: K) => STARTERS.filter((s) => s.seed.kind === kind);

describe("Cinema starters", () => {
  it("make the project with its look, its brief and the Director's three shots, and shot 1 renders in demo mode", async () => {
    for (const s of of("cinema")) {
      if (s.seed.kind !== "cinema") continue;
      const res = await make(s.id);
      expect(res.status, s.id).toBe(201);
      const made = (await res.json()) as { href: string; id: string };
      expect(made.href).toBe(`/cinema/${made.id}?shot=1`);
      const p = cinema.getProject(made.id)!;
      expect(p.name).toBe(s.seed.project.name);
      expect(p.director).toMatchObject(s.seed.director);
      expect(p.brief.body).toContain(s.seed.shots[2].prompt);
      const proposed = cinema.getChat(p.id).findLast((m) => m.shots?.length);
      expect(proposed?.shots?.map((x) => x.prompt)).toEqual(s.seed.shots.map((x) => x.prompt));
      // Shot 1 as the prompt bar sends it, with the project's look.
      const shot = s.seed.shots[0];
      for (const engine of ["cloud", "open"] as const) {
        const r = await generateRoute.POST(
          post("/x", { input: { engine, mode: "video", action: "generate", prompt: shot.prompt, moves: shot.moves, duration: shot.duration, aspectRatio: "16:9", batch: 1, settings: p.director } }),
          params({ id: p.id }),
        );
        expect(r.status, `${s.id} ${engine}`).toBe(201);
        const { items } = (await r.json()) as { items: { id: string }[] };
        expect(items.length).toBeGreaterThan(0);
        const g = await settle(items[0].id);
        expect(g.status, `${s.id} ${engine}: ${g.message}`).toBe("succeeded");
      }
      expect(cinema.listItems(p.id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("open the project made before while nothing has been made in it, and make a new one after", async () => {
    const id = "cinema.desert-couture";
    const count = () => cinema.listProjects().filter((p) => p.name === "Desert couture").length;
    const before = count();
    const a = (await (await make(id)).json()) as { id: string; href: string };
    const b = (await (await make(id)).json()) as { id: string; href: string };
    expect(b).toEqual(a);
    expect(count()).toBe(before + 1);
    // A take in it: the next tap starts a fresh project.
    const shot = STARTERS.find((s) => s.id === id)!.seed;
    if (shot.kind !== "cinema") throw new Error(id);
    const r = await generateRoute.POST(
      post("/x", { input: { engine: "cloud", mode: "video", action: "generate", prompt: shot.shots[0].prompt, duration: 5, aspectRatio: "16:9", batch: 1, settings: shot.director } }),
      params({ id: a.id }),
    );
    expect(r.status).toBe(201);
    const c = (await (await make(id)).json()) as { id: string };
    expect(c.id).not.toBe(a.id);
  });
});

describe("Element starters", () => {
  it("save the element from stored copies of its own files, once each, out of the Library", async () => {
    for (const s of of("element")) {
      if (s.seed.kind !== "element") continue;
      const res = await make(s.id);
      expect(res.status, s.id).toBe(201);
      const { id, href } = (await res.json()) as { href: string; id: string };
      expect(href).toBe("/elements");
      const el = getElement(id)!;
      expect(el).toMatchObject({ name: s.seed.element.name, kind: s.seed.element.kind, description: s.seed.element.description, status: "ready" });
      expect(el.references).toHaveLength(s.samples!.length);
      el.references.forEach((url, i) => {
        expect(url).toMatch(/^\/api\/files\//);
        expect(fs.readFileSync(absolutePath(filesRel(url)!)).equals(fs.readFileSync(sampleFile(s.samples![i].src)!)), s.id).toBe(true);
      });
    }
    // A second tap opens the one saved before (no "Amara_2"), and says how to use it.
    const first = (await (await make("elements.amara")).json()) as { id: string; note: string };
    const again = (await (await make("elements.amara")).json()) as { id: string; note: string };
    expect(again.id).toBe(first.id);
    expect(getElement(again.id)!.handle).toBe("Amara");
    expect(again.note).toBe("Amara is saved. Type @Amara in any image or video prompt.");
    expect(listElements().filter((e) => e.name === "Amara")).toHaveLength(1);
    // The stored copies are files the Library lists don't show.
    expect(listAssets({}).filter((x) => x.name?.startsWith("starter-"))).toEqual([]);
  });
});

describe("The starters route", () => {
  it("answers an unknown starter, and one that only fills a studio, without making anything", async () => {
    expect((await make("cinema.nope")).status).toBe(404);
    const fill = await make("assist.jewel-campaign");
    expect(fill.status).toBe(400);
    expect(((await fill.json()) as { error: string }).error).toMatch(/opens in its studio/);
    expect((await make("storyboard.heist")).status).toBe(400);
  });
});

describe("Storyboard starters", () => {
  it("price on both engines, and run in demo mode", async () => {
    for (const s of of("storyboard")) {
      if (s.seed.kind !== "storyboard") continue;
      const { story, frames, aspectRatio, look } = s.seed;
      for (const engine of ["cloud", "open"] as const) {
        const est = await estimateRoute.POST(post("/api/storyboards/estimate", { engine, story, frames, aspectRatio, ...(look && { look, lookStrength: 1 }) }));
        expect(est.status, `${s.id} ${engine}`).toBe(200);
        expect(((await est.json()) as { frames: number }).frames).toBe(frames);
      }
      const res = await boardsRoute.POST(post("/api/storyboards", { engine: "cloud", story, frames, aspectRatio, ...(look && { look, lookStrength: 1 }) }));
      expect(res.status, s.id).toBe(201);
      const body = (await res.json()) as { scenes: string[]; batchId?: string };
      expect(body.scenes).toHaveLength(frames);
    }
  });
});

describe("Assist starters", () => {
  it("plan on the offline planner and run in demo mode, on both engines", async () => {
    for (const s of of("assist")) {
      if (s.seed.kind !== "assist") continue;
      for (const engine of ["cloud", "open"] as const) {
        const t = agent.createThread({ agent: "offline", engine, autoApprove: true });
        agent.addMessage(t.id, s.seed.skill ? `/${s.seed.skill} ${s.seed.prompt}` : s.seed.prompt);
        await agent.run(t.id, agent.offline);
        const v = agent.getThread(t.id)!;
        const said = v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text);
        const errors = v.thread.items.filter((i) => i.role === "notice" && i.tone === "error");
        expect(errors, `${s.id} ${engine}: ${said.join(" | ")}`).toEqual([]);
        expect(v.generations.length, `${s.id} ${engine}: ${said.join(" | ")}`).toBeGreaterThan(0);
        for (const g of v.generations) expect(g.status, `${s.id} ${engine} ${g.message}`).not.toBe("failed");
      }
    }
  });
});
