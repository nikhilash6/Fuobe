import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GET /api/comfyui: the owner gets each graph's `validated` as it is; anyone else gets it on the graphs that passed.

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-workflow-marks-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("not reachable in this test", { status: 599 })) as typeof fetch;

const auth = await import("@/server/auth");
const comfyuiRoute = await import("@/app/api/comfyui/route");
const { loadManifest } = await import("@/server/providers/comfyui");

const HOST = "localhost:3000";
let owner = "";
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  account = `${auth.SESSION_COOKIE}=${auth.createSession(auth.createAccount("someone@example.com", "long enough").id).value}`;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

type Listed = { id: string; validated?: unknown };
const library = async (cookie?: string) =>
  (await (await comfyuiRoute.GET(new Request(`http://${HOST}/api/comfyui`, { headers: { host: HOST, ...(cookie && { cookie }) } }))).json()) as {
    reachable: boolean | null;
    workflows: Listed[];
  };

describe("GET /api/comfyui", () => {
  const manifest = loadManifest();
  const passed = new Map(manifest.workflows.map((w) => [w.id, w.validated]));

  it("gives the owner every graph's validated as the manifest has it", async () => {
    const body = await library(owner);
    expect(body.reachable).not.toBeNull();
    expect(body.workflows.map((w) => [w.id, w.validated])).toEqual(manifest.workflows.map((w) => [w.id, w.validated]));
  });

  it.each([
    ["a guest", undefined],
    ["an account", "account"],
  ])("gives %s validated on the graphs that passed, and on no other", async (_who, as) => {
    const body = await library(as ? account : undefined);
    expect(body.reachable).toBeNull();
    expect(body.workflows).toHaveLength(manifest.workflows.length);
    for (const w of body.workflows) {
      if (passed.get(w.id)) expect(w.validated, w.id).toBe(true);
      else expect("validated" in w, w.id).toBe(false);
      expect("validationError" in w, w.id).toBe(false);
    }
    expect(body.workflows.some((w) => w.validated === true)).toBe(true);
  });
});
