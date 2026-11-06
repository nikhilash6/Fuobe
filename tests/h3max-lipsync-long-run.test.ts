import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { TINY_PNG } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => ({ delete: () => {}, get: () => undefined }) }));

/**
 * fal's H3 Max lip sync renders a video as long as its voice, 5 s to 15 minutes, in windows ("timings: … summed over every window
 * this request generated"). A cancel of a job in progress only signals the runner, and "the request can still complete"
 * (fal's queue docs, Cancel a Request: 202 CANCELLATION_REQUESTED), so it is billed. A long voice's job gets time in proportion to
 * its length (meta.runLimitMs, set at hand-over) instead of the 45 minutes every other cloud job gets; a short one keeps 45.
 * Against the stand-in fal.ai: no real key, no paid call.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-lipsync-long-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");

let fal: FakeCloud;
let cookie = "";
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-fal"] = "good";
  fal.pollsToFinish = Infinity;
  setSetting("falKey", "owner-fal");
  auth.setPassword("install password");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
});

async function upload(data: Buffer, type: string, name: string) {
  const r = await uploadsRoute.POST(
    new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": type, "x-file-name": name, "content-length": String(data.length) }, body: new Uint8Array(data) }),
  );
  return ((await r.json()) as { url: string }).url;
}
type RowT = { status: string; error: string | null; external_id: string | null };
const row = (id: string) => db().prepare("SELECT status, error, external_id FROM generations WHERE id = ?").get(id) as RowT;

/** A lip sync whose voice the composer read as `seconds` long, handed over and running at the stand-in. */
async function lipsync(seconds: number) {
  const body = JSON.stringify({
    feature: "lipsync",
    modelId: "minimax-h3-max-lipsync",
    prompt: "",
    inputs: { images: [await upload(TINY_PNG, "image/png", "face.png")], audio: await upload(Buffer.from("ID3voice"), "audio/mpeg", "voice.mp3") },
    params: { resolution: "768P", sourceDuration: seconds },
  });
  const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body }));
  const id = ((await r.json()) as { items: { id: string }[] }).items[0].id;
  for (let i = 0; i < 300 && !row(id).external_id; i++) await new Promise((res) => setTimeout(res, 10));
  // Polled into IN_PROGRESS: the job has started at fal.
  for (let i = 0; i < 3; i++) await globalThis.__fuobeRunner?.tick();
  return id;
}

/** The job started `minutes` ago; one runner pass. */
async function after(id: string, minutes: number) {
  db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now() - minutes * 60_000, id);
  await globalThis.__fuobeRunner?.tick();
  return row(id);
}

describe("fal's H3 Max lip sync: a long voice's render isn't cut at 45 minutes", () => {
  it("a 10-minute voice still runs 46 minutes in, and nothing is cancelled at fal", async () => {
    const id = await lipsync(600);
    const r = await after(id, 46);
    expect(r.status).toBe("running");
    expect(fal.canceled).toEqual([]);
  });

  it("a 6-second voice keeps the 45 minutes", async () => {
    const id = await lipsync(6);
    const r = await after(id, 46);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Timed out after 45 minutes/);
  });
});
