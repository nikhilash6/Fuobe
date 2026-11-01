import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

/**
 * Restore & colourise (o/archive-restore) under the owner's public sign-up rules (docs/public-signup.md): its price
 * check is open to guests and accounts and priced for their own GPU, never a demo; its run and its prompt writer plan
 * with the studio's own AI helpers and chain on the server, so a guest or an account gets own-gpu-tool (with or
 * without a GPU); the owner's are unchanged. The GPU pre-flight board has its row, on graphs the requirement index knows.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-restore-signup-"));
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
const estimate = await import("@/app/api/restore/estimate/route");
const { PromptSchema } = await import("@/server/restore");
const { STUDIO_ROWS, studioTool, toolFor } = await import("@/server/gpu/tools");
const { loadIndex } = await import("@/server/gpu/index-file");
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

function req(url: string, init: { method?: string; cookie?: string } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method, headers, ...(method !== "GET" && method !== "HEAD" && { body: "{}" }) });
}

function call(url: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) },
    body: JSON.stringify(body),
  });
}

let n = 0;
const newAccount = () => auth.createAccount(`restore${++n}@example.com`, "long enough");
const RUNS = ["/api/restore", "/api/restore/prompt"];
const source = { url: "/api/files/uploads/old-film.mp4", name: "old-film.mp4", duration: 8, fps: 16, width: 640, height: 480 };

beforeAll(() => {
  auth.setPassword("install password");
  // The owner's own runs would be free demos: a visitor's price never is (src/server/visitor.ts).
  setSetting("demoMode", "on");
});
afterEach(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

describe("the proxy: Restore & colourise as main treats a tool", () => {
  it("knows the estimate for a price check, and the run and the prompt writer for runs", () => {
    expect(access.isPriceCheck("POST", "/api/restore/estimate", "")).toBe(true);
    for (const p of RUNS) expect(access.isPriceCheck("POST", p, ""), p).toBe(false);
    expect(access.isPriceCheck("POST", "/api/restore", "?preview=1")).toBe(false);
  });

  it("lets guests and accounts open the page", () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const cookie = auth.createSession(newAccount().id).value;
    expect(passed(proxy(req("/video-tools/restore")))).toBe(true);
    expect(passed(proxy(req("/video-tools/restore", { cookie })))).toBe(true);
  });

  it("opens the price check to guests and accounts; the run and the writer get own-gpu-tool, with or without a GPU", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const bare = auth.createSession(newAccount().id).value;
    const withGpu = newAccount();
    auth.setAccountGpu(withGpu.id, { url: "https://gpu.example" });
    const gpu = auth.createSession(withGpu.id).value;
    for (const cookie of [undefined, bare, gpu]) {
      expect(passed(proxy(req("/api/restore/estimate", { method: "POST", cookie }))), String(cookie)).toBe(true);
      for (const p of RUNS) {
        const r = proxy(req(p, { method: "POST", cookie }));
        expect(r.status, p).toBe(403);
        expect(r.headers.get(access.CONNECT_GPU_HEADER), p).toBeNull();
        expect(r.headers.get(access.GUEST_HEADER), p).toBeNull();
        expect(await r.json(), p).toEqual({ error: access.OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" });
      }
    }
  });

  it("keeps the owner's runs unchanged", () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const owner = auth.createSession().value;
    for (const p of [...RUNS, "/api/restore/estimate"]) expect(passed(proxy(req(p, { method: "POST", cookie: owner }))), p).toBe(true);
  });
});

describe("the estimate route: a visitor's price is its own GPU's", () => {
  it("prices a guest's and an account's restoration on their own GPU, never a demo; the owner's stays the install's", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const account = auth.createSession(newAccount().id).value;
    for (const [who, cookie] of [
      ["guest", undefined],
      ["account", account],
    ] as const) {
      const r = await estimate.POST(call("/api/restore/estimate", { engine: "open", source }, cookie));
      expect(r.status, who).toBe(200);
      expect(await r.json(), who).toMatchObject({ engine: "open", demo: false, costUsd: 0, pieces: 2, canvas: { width: 1440, height: 1088 } });
    }
    const owner = await estimate.POST(call("/api/restore/estimate", { engine: "open", source }, auth.createSession().value));
    expect(await owner.json()).toMatchObject({ demo: true, costUsd: 0 });
  });
});

describe("the prompt writer's body stays under the sign-in proxy's 4 MB", () => {
  it("takes four frames at the largest it allows, and refuses a bigger one", () => {
    const frame = (chars: number) => `data:image/jpeg;base64,${"A".repeat(chars - "data:image/jpeg;base64,".length)}`;
    const biggest = { engine: "open", hint: "x".repeat(600), frames: Array.from({ length: 4 }, () => frame(900_000)) };
    expect(PromptSchema.safeParse(biggest).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(biggest))).toBeLessThan(4 * 2 ** 20);
    expect(PromptSchema.safeParse({ ...biggest, frames: [frame(900_001)] }).success).toBe(false);
    expect(PromptSchema.safeParse({ ...biggest, frames: [...biggest.frames, frame(100)] }).success).toBe(false);
  });
});

describe("the GPU pre-flight board", () => {
  it("has a Restore & colourise row on the tiled graph, the joins and the gated Restore IC-LoRA", () => {
    const idx = loadIndex();
    const row = STUDIO_ROWS.find((r) => r.href === "/video-tools/restore")!;
    expect(row).toMatchObject({ label: "Restore & colourise", group: "Video tools" });
    const t = studioTool(row)!;
    expect(t.ref).toBe("studio:/video-tools/restore");
    expect(t.workflows).toContain("video-restore-ltx25-tiled");
    for (const wf of t.workflows) expect(idx.workflows[wf], wf).toBeDefined();
    expect(t.loras).toEqual([expect.objectContaining({ file: "ltx-2.5-22b-ic-lora-restore-1.0.safetensors", download: "hf-gated" })]);
    expect(toolFor("studio:/video-tools/restore")?.workflows).toEqual(t.workflows);
    // The graph's node pack is pinned, so the board can say what to install.
    expect(Object.keys(idx.workflows["video-restore-ltx25-tiled"].packs)).toContain("ComfyUI-LTXVideo");
    expect(idx.packs["ComfyUI-LTXVideo"]).toMatchObject({ commit: "220e1d45aa0469f518e982102fca4dca92a61862" });
  });
});
