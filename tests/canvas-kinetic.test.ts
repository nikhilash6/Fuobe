import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CanvasGraph } from "@/lib/catalog/canvas";
import { tempDir } from "./helpers/temp-dir";

// The Canvas "Kinetic" node: its spec, palette entry and icon, the edges it takes and gives, and the owner-only route
// that keeps its browser-made run on the board.

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 30_000 });

const dir = tempDir("fuobe-canvas-kinetic-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_ACCOUNT_DISK_FREE_GB = "0.5";
delete process.env.FUOBE_PASSWORD;
const catalog = await import("@/lib/catalog/canvas");
const { PRESET_ICONS } = await import("@/components/preset-icons");
const { ICONS } = await import("@/components/canvas/node-icon");
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const access = await import("@/lib/guest-access");
const { createCanvas, getCanvas, parseGraph } = await import("@/server/canvas");
const { PUT } = await import("@/app/api/canvases/[id]/runs/[node]/route");
const local = await import("@/app/api/generations/local/route");
const { saveFile } = await import("@/server/storage");
const { recipe } = await import("./helpers/motion");
const { rowRecipe, feedsOf } = await import("@/components/canvas/kinetic-node");

const node = (id: string, type: string, data: Record<string, unknown> = {}, y = 0) => ({ id, type, position: { x: 0, y }, data }) as CanvasGraph["nodes"][number];
const edge = (source: string, target: string, targetHandle: string | null) => ({ id: `${source}-${target}`, source, target, sourceHandle: "out", targetHandle });
const big = recipe("marketing/big-number", { controls: { template: "ms-big-number" } });
const star = recipe("marketing/starburst", { controls: { template: "m2-retro-starburst" } });

describe("the Kinetic node", () => {
  it("has its spec, palette entry and icon, and is never run by the server", () => {
    expect(catalog.NODE_SPECS.kinetic).toMatchObject({ type: "kinetic", label: "Kinetic", group: "Generate", icon: "LetterText" });
    expect(catalog.PALETTE.find((p) => p.id === "kinetic")?.keywords).toBe("motion text title animation brand kinetic");
    expect(PRESET_ICONS.LetterText).toBeTruthy();
    expect(ICONS.LetterText).toBeTruthy();
    expect(catalog.GENERATOR_TYPES.has("kinetic")).toBe(false);
  });

  it("takes text, a picture and a clip, and feeds Output nodes only", () => {
    const g: CanvasGraph = { nodes: [node("t", "prompt", { text: "Hi" }), node("i", "image-input", { url: "/api/files/a.png" }), node("v", "video-input", { url: "/api/files/a.mp4" }), node("k", "kinetic", { kinetic: big }), node("s", "kinetic", { kinetic: star }), node("o", "output"), node("m", "model", { mediaKind: "video" })], edges: [] };
    expect(catalog.inputPorts(g.nodes[3]).map((p) => [p.id, p.type])).toEqual([
      ["prompt", "text"],
      ["images", "image"],
      ["video", "video"],
    ]);
    expect(catalog.outputType(g, g.nodes[3])).toBe("video");
    const c = (source: string, target: string, targetHandle: string | null) => catalog.connectionError(g, { source, target, sourceHandle: "out", targetHandle });
    expect(c("t", "k", "prompt")).toBeNull();
    expect(c("i", "k", "images")).toBeNull();
    expect(c("v", "k", "video")).toBeNull();
    expect(c("v", "s", "video")).toBe("This scene doesn't take a clip");
    expect(c("k", "o", "in")).toBeNull();
    expect(c("k", "m", "video")).toBe("Connect Kinetic to an Output node");
  });

  it("is kept with its recipe when the board is saved, and drops a recipe that isn't one", () => {
    const g = parseGraph({ nodes: [node("k", "kinetic", { kinetic: big }), node("x", "kinetic", { kinetic: { nope: 1 } })], edges: [] })!;
    expect(g.nodes[0].data.kinetic).toEqual(big);
    expect(g.nodes[1].data.kinetic).toBeUndefined();
  });

  it("fills field 1 from column 1, field 2 from column 2, with its picture and clip, per row", () => {
    const g: CanvasGraph = {
      nodes: [node("tb", "table", { columns: ["Number", "Caption"], rows: [["3×", "faster close"], ["98%", "on time"], ["", ""]] }), node("i", "image-input", { url: "/api/files/logo.png" }), node("v", "video-input", { url: "/api/files/c.mp4" }), node("k", "kinetic", { kinetic: big })],
      edges: [edge("tb", "k", "prompt"), edge("i", "k", "images"), edge("v", "k", "video")],
    };
    const f = feedsOf(g, "k", () => null);
    expect(f.rows).toEqual([
      ["3×", "faster close"],
      ["98%", "on time"],
    ]);
    const r = rowRecipe(big, f.rows[1], f.image, f.video);
    expect(r.fields).toMatchObject({ stat: "98%", caption: "on time" });
    expect(r.brand.logo).toBe("/api/files/logo.png");
    expect(r.layers?.video?.src).toBe("/api/files/c.mp4");
    // A scene without a clip never takes one.
    expect(rowRecipe(star, null, null, "/api/files/c.mp4").layers).toBeUndefined();
  });
});

describe("PUT /api/canvases/[id]/runs/[node]", () => {
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(200, 1)]);
  async function ownerClip(): Promise<string> {
    auth.setPassword("install password");
    const url = saveFile({ data: MP4, contentType: "video/mp4", name: "k.mp4", source: "upload" }).url;
    const res = await local.POST(
      new Request("http://localhost:3000/api/generations/local", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${auth.SESSION_COOKIE}=${auth.createSession().value}` },
        body: JSON.stringify({ feature: "kinetic-canvas", modelId: "local-motion", op: "motion", prompt: "3×", title: "Board · Kinetic · row 1", inputs: {}, params: { extra: { motion: big } }, output: { url, kind: "video", contentType: "video/mp4" } }),
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }
  const put = (id: string, nodeId: string, body: unknown) => PUT(new Request(`http://localhost/api/canvases/${id}/runs/${nodeId}`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id, node: nodeId }) } as never);

  it("keeps the owner's own finished Kinetic results on a Kinetic node", async () => {
    const c = createCanvas({ name: "Board", graph: { nodes: [node("k", "kinetic", { kinetic: big }), node("o", "output"), node("p", "prompt", { text: "x" })], edges: [edge("k", "o", "in")] } });
    const a = await ownerClip();
    const b = await ownerClip();
    const r = await put(c.id, "k", { sig: "s", ids: [a, b], rows: [a, b], rowSigs: ["1", "2"] });
    expect(r.status).toBe(200);
    expect(getCanvas(c.id)!.runs.k).toMatchObject({ sig: "s", ids: [a, b], rows: [a, b], rowSigs: ["1", "2"] });
    // Not a Kinetic node, an unknown result, or too many.
    expect((await put(c.id, "p", { sig: "s", ids: [a] })).status).toBe(400);
    expect((await put(c.id, "k", { sig: "s", ids: ["nope"] })).status).toBe(404);
    expect((await put(c.id, "k", { sig: "s", ids: Array.from({ length: 51 }, () => a) })).status).toBe(400);
    expect((await put("missing", "k", { sig: "s", ids: [a] })).status).toBe(404);
    // The rows and their signatures line up with the results, each result once.
    expect((await put(c.id, "k", { sig: "s", ids: [a, a] })).status).toBe(400);
    expect((await put(c.id, "k", { sig: "s", ids: [a, b], rows: [a], rowSigs: ["1", "2"] })).status).toBe(400);
    expect((await put(c.id, "k", { sig: "s", ids: [a, b], rows: [a, b], rowSigs: ["1"] })).status).toBe(400);
    expect((await put(c.id, "k", { sig: "s", ids: [a, b], rows: [b, "x"], rowSigs: ["1", "2"] })).status).toBe(400);
  });

  it("is the owner's: an account gets the library refusal and a guest the sign-up card", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    expect(access.isLibraryChange("PUT", "/api/canvases/abc/runs/k1")).toBe(true);
    const acct = auth.createAccount("kinetic-canvas@example.com", "long enough");
    const req = (cookie?: string) => new NextRequest("http://localhost:3000/api/canvases/abc/runs/k1", { method: "PUT", headers: { "content-type": "application/json", ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) }, body: "{}" });
    const a = proxy(req(auth.createSession(acct.id).value));
    expect(a.status).toBe(403);
    expect((await a.json()).code).toBe("library");
    const g = proxy(req());
    expect(g.status).toBe(401);
    delete process.env.FUOBE_PUBLIC_SIGNUP;
  });
});
