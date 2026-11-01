import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeLlm, type FakeLlm } from "./helpers/fake-llm";

/*
 * The hosted providers' keys are the owner's secrets: they never appear in a response (settings, Assist's
 * picker, the LLM status), only the owner reaches the routes that use them, an account's or a guest's work
 * never reaches them, a key typed into Save & test goes only to that provider's official host, and region and
 * workspace settings can't turn into an address of someone else's choosing.
 */

vi.setConfig({ testTimeout: 60_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-security-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
for (const k of Object.keys(process.env)) if (/_API_KEY$|HF_TOKEN$|^FUOBE_LLM_/.test(k)) delete process.env[k];

const { setSetting } = await import("@/server/settings");
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const { ownerOnly } = await import("@/lib/guest-access");
const { runAsTenant } = await import("@/server/tenant");
const hosted = await import("@/server/llm/hosted");
const agent = await import("@/server/assist/agent");
const settingsRoute = await import("@/app/api/settings/route");
const llmRoute = await import("@/app/api/llm/route");
const assistRoute = await import("@/app/api/assist/route");
const testRoute = await import("@/app/api/providers/test/route");

const KEYS: Record<string, string> = {
  openrouterKey: "sk-or-v1-SECRETopenrouter0123456789",
  deepseekKey: "sk-SECRETdeepseek0123456789abcd",
  googleKey: "AIzaSECRETgoogle0123456789abcdefgh",
  xaiKey: "xai-SECRETxai0123456789abcdefgh",
  huggingfaceToken: "hf_SECREThuggingface0123456789",
  qwenKey: "sk-SECRETqwen0123456789abcdefgh",
};

let ds: FakeLlm;
beforeAll(async () => {
  ds = fakeLlm("deepseek", KEYS.deepseekKey);
  await ds.start();
  ds.models = ["deepseek-v4-pro", "deepseek-flash"];
  // OpenRouter's key check goes to an address nothing answers: no test reaches a real provider.
  process.env.FUOBE_LLM_TEST_BASE = `deepseek=${ds.url},openrouter=http://127.0.0.1:9/api/v1`;
  for (const [k, v] of Object.entries(KEYS)) setSetting(k as Parameters<typeof setSetting>[0], v);
  setSetting("llmProvider", "custom");
  setSetting("llmUrl", "http://127.0.0.1:9/v1");
  auth.setPassword("install password");
});
afterAll(async () => {
  await ds.close();
  delete process.env.FUOBE_LLM_TEST_BASE;
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** No key, and no long piece of one, anywhere in a body. */
function noKeys(body: string, where: string) {
  for (const key of Object.values(KEYS)) {
    for (let i = 0; i + 12 <= key.length; i++) expect(body.includes(key.slice(i, i + 12)), `${where} shows part of ${key.slice(0, 6)}…`).toBe(false);
  }
}

describe("keys never leave the server", () => {
  it("in Settings, Assist's picker, the LLM status and the connection test", async () => {
    noKeys(await (await settingsRoute.GET()).text(), "GET /api/settings");
    const llm = await (await llmRoute.GET(new Request("http://localhost/api/llm"))).text();
    noKeys(llm, "GET /api/llm");
    expect(JSON.parse(llm).hosted.providers.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["deepseek", "openrouter", "google", "xai"]));
    const assist = await (await assistRoute.GET(new Request("http://localhost/api/assist"))).text();
    noKeys(assist, "GET /api/assist");
    expect(JSON.parse(assist).availability.smart.plan).toBeTruthy();
    noKeys(JSON.stringify(await agent.availability()), "availability()");
    // A wrong key's error comes back without it.
    const r = await testRoute.POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify({ provider: "llm", field: "deepseekKey", values: { deepseekKey: "sk-WRONGwrongwrong0123456789" } }) }));
    const text = await r.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, detail: expect.stringMatching(/DeepSeek rejected the key/) });
    expect(text).not.toContain("WRONGwrongwr");
  });

  it("Save & test sends a typed key to the provider's official host only, and the saved key stays put", async () => {
    const before = ds.seen.length;
    const ok = await (await testRoute.POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify({ provider: "llm", field: "deepseekKey", values: { deepseekKey: KEYS.deepseekKey } }) }))).json();
    expect(ok).toMatchObject({ ok: true, detail: "Key works · 2 models listed" });
    expect(ds.seen.slice(before).every((s) => s.auth === `Bearer ${KEYS.deepseekKey}`)).toBe(true);
    // A region that isn't one of the provider's own hosts is refused before anything is sent.
    const bad = await testRoute.POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify({ provider: "llm", field: "xaiRegion", values: { xaiRegion: "evil.example.com" } }) }));
    expect(bad.status).toBe(400);
  });
});

describe("addresses come from the registry only", () => {
  it("refuses a region or workspace that isn't one, and a Smart override that isn't provider|model", async () => {
    for (const body of [{ openaiRegion: "https://evil.example.com" }, { qwenWorkspace: "evil.example.com/x" }, { qwenWorkspace: "a@b" }, { smartPlan: "openai|gpt;rm -rf" }, { googleFreeTier: "yes" }]) {
      const res = await settingsRoute.PUT(new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body) }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    setSetting("qwenWorkspace", "ws-1234");
    expect(hosted.endpointFor("qwen")!.baseUrl).toBe("https://ws-1234.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
    for (const p of hosted.HOSTED_PROVIDERS) for (const u of [...(p.regions?.map((r) => r.baseUrl) ?? []), ...(p.baseUrl ? [p.baseUrl] : [])]) expect(u.startsWith("https://"), u).toBe(true);
  });
});

describe("only the owner", () => {
  const req = (url: string, method = "GET", cookie?: string) =>
    new NextRequest(`http://localhost:3000${url}`, { method, headers: cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}, ...(method !== "GET" && { body: "{}" }) });

  it("reaches the routes that read or use the keys", () => {
    for (const [m, p] of [
      ["POST", "/api/llm"],
      ["PUT", "/api/settings"],
      ["POST", "/api/providers/test"],
    ]) expect(ownerOnly(m, p), `${m} ${p}`).toBe(true);
    const a = auth.createAccount("curious@example.com", "long enough");
    const account = auth.createSession(a.id).value;
    for (const [m, p] of [
      ["GET", "/api/llm"],
      ["POST", "/api/llm"],
      ["GET", "/api/settings"],
      ["PUT", "/api/settings"],
      ["POST", "/api/providers/test"],
      ["POST", "/api/assist"],
    ]) {
      expect(proxy(req(p, m, account)).status, `account ${m} ${p}`).toBe(403);
      // A guest is offered to sign up (401), but not for Assist: an account can't use it either (403, as an account's).
      expect(proxy(req(p, m)).status, `guest ${m} ${p}`).toBe(p === "/api/assist" ? 403 : 401);
    }
    const owner = auth.createSession().value;
    expect(proxy(req("/api/llm", "GET", owner)).headers.get("x-middleware-next")).toBe("1");
  });

  it("an account's or a guest's work never reaches a key, even past the routes", async () => {
    for (const t of [{ kind: "account" as const, id: "a1" }, { kind: "guest" as const }]) {
      expect(runAsTenant(t, () => hosted.connectedHosted())).toEqual([]);
      expect(() => runAsTenant(t, () => hosted.endpointFor("deepseek"))).toThrow(/studio's own LLM keys/);
      expect(await runAsTenant(t, () => hosted.testHosted("deepseek"))).toMatchObject({ ok: false });
    }
    const ep = hosted.endpointFor("deepseek")!;
    const before = ds.seen.length;
    await expect(runAsTenant({ kind: "account", id: "a1" }, () => hosted.chatHosted(ep, ep.provider.models[0], { messages: [{ role: "user", content: "hi" }] }))).rejects.toThrow(/studio's own LLM keys/);
    expect(ds.seen.length).toBe(before);
  });
});
