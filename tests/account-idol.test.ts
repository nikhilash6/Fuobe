import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * Idol 3D under public sign-up: 3D models are closed to accounts, so an account's Idol run answers 403
 * own-gpu-tool on both engines — on its own linked ComfyUI (oss-idol) and with its own fal.ai key (idol-3d) — and
 * nothing reaches its GPU or fal.
 */

const dir = tempDir("fuobe-account-idol-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
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
const { getModel } = await import("@/lib/catalog");
const { model3dRequest } = await import("@/lib/av/model3d");

let fake: FakeComfy;
let cookie = "";
let account = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  account = auth.createAccount("idol-a@example.com", "long enough").id;
  auth.setAccountGpu(account, { url: fake.url });
  keys.saveAccountKey(account, "fal", "acct-fal-idol");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
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

describe("Idol 3D stays closed to accounts", () => {
  it.each([
    ["open", "oss-idol"],
    ["cloud", "idol-3d"],
  ] as const)("on the %s engine (%s): 403 own-gpu-tool, nothing sent", async (engine, modelId) => {
    expect(getModel(modelId)?.engine).toBe(engine);
    const photo = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: account }).url;
    const req = model3dRequest({ engine, mode: "splat", modelId, photo, quality: "quick", photoCrop: true });
    expect(req.modelId).toBe(modelId);
    fake.log.length = 0;
    fetched.length = 0;
    const r = await post(req);
    expect(r.status, await r.clone().text()).toBe(403);
    expect((await r.json()).code).toBe("own-gpu-tool");
    expect(fake.log.filter((e) => e.path === "/prompt" || e.path === "/upload/image")).toHaveLength(0);
    expect(fetched.filter((u) => /fal\.(run|ai|media)/.test(u))).toHaveLength(0);
  });
});
