import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Canvas } from "@/lib/catalog/canvas";
import { tempDir } from "./helpers/temp-dir";

// A ready board made by the owner starts with its sample files in place: each input node names a stored copy of the
// template's sample, the copy is made once and reused, the Library lists don't show it, and the board plans as it is.

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-starter-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { CANVAS_TEMPLATES, planCanvas } = await import("@/lib/catalog/canvas");
const { absolutePath, filesRel, listAssets } = await import("@/server/storage");
const { sampleFile } = await import("@/server/canvas-samples");
const list = await import("@/app/api/canvases/route");

const create = async (templateId: string, engine: "open" | "cloud") =>
  (await (await list.POST(new Request("http://localhost/api/canvases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, engine }) }))).json()) as Canvas;

const starters = CANVAS_TEMPLATES.filter((t) => t.starter !== false);

describe("A ready board's sample files", () => {
  it("every sample a template names is a file Fuobe ships", () => {
    for (const t of starters) for (const [node, s] of Object.entries(t.samples ?? {})) expect(sampleFile(s.src), `${t.id} ${node} ${s.src}`).toBeTruthy();
  });

  it("every board that takes a picture, a clip or a voice names a sample for each", () => {
    const MEDIA = new Set(["image-input", "video-input", "audio-input", "clone-voice"]);
    for (const t of starters) for (const n of t.build("open").nodes.filter((x) => MEDIA.has(x.type))) expect(t.samples?.[n.id], `${t.id} ${n.id}`).toBeTruthy();
  });

  it("a sample path that steps out of its folders names nothing", () => {
    for (const bad of ["/examples/../../package.json", "/previews/presets/%2e%2e/x.mp4", "/etc/passwd", "/samples/clean-voice/nope.m4a", "/examples/effect-pearl-earring/1/in-image.jpg?x=1"]) expect(sampleFile(bad), bad).toBeNull();
  });
});

describe("Making a ready board", () => {
  it("fills each input with a stored copy of its sample, and the board plans as it is", async () => {
    for (const t of starters)
      for (const engine of ["open", "cloud"] as const) {
        const c = await create(t.id, engine);
        const graph = c.pages[0].graph;
        for (const [node, s] of Object.entries(t.samples ?? {})) {
          const n = graph.nodes.find((x) => x.id === node)!;
          expect(n.data.url, `${t.id} ${node}`).toMatch(/^\/api\/files\//);
          expect(n.data.name).toBe(s.name);
          const stored = fs.readFileSync(absolutePath(filesRel(n.data.url!)!));
          expect(stored.equals(fs.readFileSync(sampleFile(s.src)!)), `${t.id} ${node}`).toBe(true);
        }
        expect(planCanvas(graph, { engineMode: engine }).errors, `${t.id} ${engine}`).toEqual([]);
      }
  });

  it("stores each sample once and keeps it out of the Library", async () => {
    const a = await create("effect-chain-pearl-earring", "open");
    const b = await create("effect-chain-pearl-earring", "open");
    const url = (c: Canvas) => c.pages[0].graph.nodes.find((n) => n.id === "photo")!.data.url;
    expect(url(a)).toBe(url(b));
    expect(listAssets({}).length).toBe(0);
  });
});
