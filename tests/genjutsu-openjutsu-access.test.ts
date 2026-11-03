import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 60_000 });

/**
 * Genjutsu's Openjutsu modes under the owner's public sign-up rules: until a feature has passed its GPU test, a guest's or
 * an account's price check for it is refused in words (the tab isn't shown to them either); runs and From picture's
 * describer stay the owner's on this server, as every Genjutsu run.
 */
const dir = tempDir("fuobe-genjutsu-oj-access-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
delete process.env.FUOBE_ALLOWED_ORIGINS;

const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const access = await import("@/lib/guest-access");
const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const estimateRoute = await import("@/app/api/genjutsu/estimate/route");
const sceneRoute = await import("@/app/api/genjutsu/scene/route");
const { estimateGenjutsu, NOT_HERE } = await import("@/server/genjutsu");
const generationsRoute = await import("@/app/api/generations/route");
const { directRunFeatures } = await import("@/lib/catalog/genjutsu");

const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const req = (url: string, init: { method?: string; cookie?: string } = {}) => {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method, headers, ...(method !== "GET" && { body: "{}" }) });
};
const call = (url: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) }, body: JSON.stringify(body) });

let clip = "";
let n = 0;
beforeAll(() => {
  auth.setPassword("install password");
  setSetting("demoMode", "on");
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "duo.mp4" }).url;
});
afterEach(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

const src = { duration: 12, fps: 16, width: 72, height: 128, hasAudio: true };
const bodies = () => [
  { engine: "open", mode: "finish", finish: { tool: "colours" }, source: { url: clip, ...src }, range: { start: 0, end: 12 } },
  { engine: "open", mode: "picture", picture: { stage: "frame" }, references: [clip], source: { url: clip, ...src }, range: { start: 0, end: 6 } },
  { engine: "open", mode: "swap", target: "type", object: { action: "remove", target: "the handbag" }, source: { url: clip, ...src }, range: { start: 0, end: 6 } },
  { engine: "open", mode: "character", modelId: "oss-h3-group-swap", references: [clip, clip], source: { url: clip, ...src }, range: { start: 0, end: 6 } },
];

describe("Genjutsu's Openjutsu features before they open", () => {
  it("a guest's and an account's price check is refused in words; the owner's goes through", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(auth.createAccount(`oj${++n}@example.com`, "long enough").id).value;
    for (const b of bodies()) {
      expect(passed(proxy(req("/api/genjutsu/estimate", { method: "POST" }))), b.mode).toBe(true);
      for (const who of [undefined, cookie]) {
        const r = await estimateRoute.POST(call("/api/genjutsu/estimate", b, who));
        expect(r.status, `${b.mode} ${who ? "account" : "guest"}`).toBe(422);
        expect((await r.json()).error).toBe(NOT_HERE);
      }
      await expect(estimateGenjutsu(b as never, { owner: false })).rejects.toThrow(NOT_HERE);
      // The owner sees and prices every feature.
      const owner = await estimateGenjutsu(b as never, { owner: true }).catch((e: Error) => e);
      expect(owner instanceof Error ? owner.message : "", b.mode).not.toBe(NOT_HERE);
    }
  });

  it("a visitor's existing Genjutsu modes are as before", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const r = await estimateRoute.POST(call("/api/genjutsu/estimate", { engine: "open", mode: "motion", references: [clip], source: { url: clip, ...src }, range: { start: 0, end: 6 } }));
    expect((await r.json()).error ?? "").not.toBe(NOT_HERE);
  });

  it("the new makers' models sent straight to /api/generations run for the owner only", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(auth.createAccount(`oj${++n}@example.com`, "long enough").id).value;
    const owner = auth.createSession().value;
    const runs = [
      { feature: "genjutsu", modelId: "oss-h3-group-swap", op: "group-swap", inputs: { video: clip, images: [clip] } },
      { feature: "genjutsu", modelId: "oss-h3-scene-edit", op: "scene-edit", inputs: { video: clip }, params: { extra: { openjutsu: { action: "remove" } } } },
      { feature: "genjutsu", modelId: "oss-from-picture-frame", op: "picture-frame", inputs: { video: clip, images: [clip] } },
      { feature: "genjutsu", modelId: "oss-scene-describe", op: "describe-video", inputs: { video: clip } },
      { feature: "genjutsu", modelId: "oss-from-picture", op: "picture-video", inputs: { video: clip, images: [clip] } },
      { feature: "genjutsu", modelId: "oss-h3-fix-faces", op: "face-fix-video", inputs: { video: clip, images: [clip] } },
      { feature: "genjutsu", modelId: "oss-fix-colours", op: "tone-video", inputs: { video: clip } },
    ];
    const send = (body: unknown, who?: string, preview = false) =>
      generationsRoute.POST(
        new Request(`http://localhost:3000/api/generations${preview ? "?preview=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", host: "localhost:3000", ...(who && { cookie: `${auth.SESSION_COOKIE}=${who}` }) },
          body: JSON.stringify(body),
        }),
      );
    for (const b of runs) {
      for (const [who, preview] of [[cookie, false], [cookie, true], [undefined, true]] as const) {
        const r = await send(b, who, preview);
        expect(r.status, `${b.modelId} ${who ? "account" : "guest"}${preview ? " price check" : ""}`).toBe(403);
        const j = await r.json();
        expect(j.code).toBe("own-gpu-tool");
        expect(j.error).toBe(access.OWN_GPU_TOOL_MESSAGE);
      }
      // The owner's request isn't refused by the gate (it may still fail later: no ComfyUI here).
      const r = await send(b, owner, true);
      expect(((await r.json()) as { code?: string }).code ?? "", b.modelId).not.toBe("own-gpu-tool");
    }
  });

  it("a direct run needs every feature it uses", () => {
    expect(directRunFeatures("oss-h3-group-swap", { onePerPerson: true })).toEqual(["group-swap", "group-swap-one-by-one"]);
    expect(directRunFeatures("oss-h3-scene-edit", { action: "background" })).toEqual(["object-background"]);
    expect(directRunFeatures("oss-h3-scene-edit", {})).toEqual(["object-change"]);
    expect(directRunFeatures("oss-from-picture-frame", { light: "Soft window light", ownPerson: true })).toEqual(["picture", "picture-light", "picture-own-person"]);
    expect(directRunFeatures("oss-from-picture", { renderer: "h3" })).toEqual(["picture", "picture-h3-renderer"]);
    expect(directRunFeatures("minimax-h3-i2v")).toBeNull();
  });

  it("an approved first frame is found however many frames came after it", async () => {
    const { db } = await import("@/server/db");
    const { describeScene } = await import("@/server/genjutsu");
    const add = db().prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'genjutsu-step', 'oss-from-picture-frame', 'open', 'comfyui', 'picture-frame', 'image', 'succeeded', '{}', ?, ?, ?)",
    );
    const t = Date.now() - 86_400_000;
    db().transaction(() => {
      add.run("old-frame", JSON.stringify([{ url: "/api/files/old-frame.png", kind: "image" }]), t, t);
      for (let i = 0; i < 520; i++) add.run(`frame-${i}`, JSON.stringify([{ url: `/api/files/frame-${i}.png`, kind: "image" }]), t + 1000 + i, t + 1000 + i);
    })();
    const say = (frame: string) => {
      try {
        describeScene({ engine: "open", source: { url: clip }, range: { start: 0, end: 6 }, frame } as never);
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(say("/api/files/old-frame.png")).not.toBe("Make and pick the first frame first");
    expect(say("/api/files/never-made.png")).toBe("Make and pick the first frame first");
  });

  it("From picture's describer is the owner's, like every Genjutsu run", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(auth.createAccount(`oj${++n}@example.com`, "long enough").id).value;
    for (const who of [undefined, cookie]) {
      for (const p of ["/api/genjutsu", "/api/genjutsu/scene"]) {
        const r = proxy(req(p, { method: "POST", cookie: who }));
        expect(r.status, `${p} ${who ? "account" : "guest"}`).toBe(403);
        expect((await r.json()).code).toBe("own-gpu-tool");
      }
    }
    expect(access.isPriceCheck("POST", "/api/genjutsu/scene", "")).toBe(false);
    // Behind the proxy the route refuses a visitor too.
    const r = await sceneRoute.POST(call("/api/genjutsu/scene", { engine: "open", source: { url: clip }, range: { start: 0, end: 6 }, ownPerson: true }));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe(NOT_HERE);
  });
});
