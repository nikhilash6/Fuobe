import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Hosted routes no live call has passed yet (src/lib/catalog/hosted-untested.ts) run for the owner only: an account's
 * run of one, even on its own fal.ai key, answers 403 own-gpu-tool before anything is sent, and its pickers leave the
 * model out. A Fuobe Original whose cloud half is untested keeps its open engine.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-hosted-untested-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (u: RequestInfo | URL) => {
  fetched.push(String(u));
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const generationsRoute = await import("@/app/api/generations/route");
const { saveFile } = await import("@/server/storage");
const { MODELS, getModel } = await import("@/lib/catalog");
const { HOSTED_UNTESTED_ENDPOINTS, HOSTED_UNTESTED_MODELS, hostedUntested, hostedUntestedSummary } = await import("@/lib/catalog/hosted-untested");
const { visitorStatus } = await import("@/server/account-gpu");
const { HUB_MODES } = await import("@/lib/hubs");

let cookie = "";
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  account = auth.createAccount("untested-a@example.com", "long enough").id;
  keys.saveAccountKey(account, "fal", "acct-fal-untested");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const post = (body: unknown) => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(
    new Request("http://localhost:3000/api/generations", {
      method: "POST",
      headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
      body: text,
    }) as never,
  );
};

describe("hosted routes without a live call", () => {
  it("lists only endpoints and models the catalog has", () => {
    const endpoints = new Set(MODELS.flatMap((m) => m.routes.map((r) => r.endpoint)));
    // The song tools' upload is a call inside a run, not a route of its own.
    for (const e of HOSTED_UNTESTED_ENDPOINTS) if (e !== "mureka/api/files/upload") expect(endpoints.has(e), e).toBe(true);
    for (const id of HOSTED_UNTESTED_MODELS) expect(getModel(id), id).toBeDefined();
    expect(hostedUntested("anything", { provider: "comfyui", endpoint: "minimax/h3-lite" })).toBe(false);
    expect(hostedUntested("fuobe-animation", { provider: "comfyui", endpoint: "wan22-inbetween-anisora" })).toBe(false);
  });

  it.each([
    ["mureka-stems", { feature: "song-tools" }],
    ["lyria-3-5", { feature: "audio" }],
    ["elevenlabs-music-2-5", { feature: "audio" }],
  ] as const)("refuses an account's %s run on its own key, sending nothing", async (modelId, extra) => {
    const song = saveFile({ data: Buffer.from("ID3song"), contentType: "audio/mpeg", source: "upload", accountId: account }).url;
    fetched.length = 0;
    const r = await post({ ...extra, modelId, engine: "cloud", prompt: "a slow jazz song", ...(modelId === "mureka-stems" && { inputs: { audio: song } }) });
    expect(r.status, await r.clone().text()).toBe(403);
    expect((await r.json()).code).toBe("own-gpu-tool");
    expect(fetched.filter((u) => /fal\.(run|ai|media)/.test(u))).toHaveLength(0);
  });

  it("still prices a hosted model that has had its live call, on the account's key", async () => {
    const r = await generationsRoute.POST(
      new Request("http://localhost:3000/api/generations?preview=1", {
        method: "POST",
        headers: { cookie, host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ feature: "audio", modelId: "sonilo-music", engine: "cloud", prompt: "a slow jazz song" }),
      }) as never,
    );
    expect(r.status, await r.clone().text()).toBe(200);
    const priced = await post({ feature: "audio", modelId: "lyria-3-5", engine: "cloud", prompt: "a slow jazz song" });
    expect(priced.status).toBe(403);
  });

  it("leaves them out of an account's pickers; an Original keeps its open engine", async () => {
    const summary = hostedUntestedSummary(MODELS, undefined);
    for (const id of ["mureka-extend", "mureka-remix", "mureka-stems", "lyria-3-5", "vidu-q4", "tripo-p2", "minimax-h3-max-turbo"]) expect(summary.off, id).toContain(id);
    expect(summary.off).not.toContain("fuobe-animation");
    expect(summary.engines?.["fuobe-animation"]).toEqual(["open"]);
    const status = await visitorStatus(auth.accountById(account)!);
    expect(status.access?.off).toContain("mureka-stems");
    expect(HUB_MODES.audio.find((m) => m.id === "song")?.ownerOnly).toBe(true);
  });
});
