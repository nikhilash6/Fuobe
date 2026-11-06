import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PNG_DATA_URI, startFakeFal, type CloudRequest, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * Vidu Q4's reference voices on fal: "up to 3 mp3 reference audio clips (3-12 seconds each, max 50 MB)" (fal's OpenAPI schema
 * for fal-ai/vidu/q4/reference-to-video, read 2026-11-06). A voice outside that is refused from its header before anything is
 * sent to fal, in Fuobe's words; one inside goes. Against the stand-in fal (tests/helpers/fake-cloud.ts): no key, no paid call.
 */
const dir = tempDir("fuobe-vidu-voices-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const gens = await import("@/server/generations");
const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");

let fal: FakeCloud;
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-fal"] = "good";
  setSetting("falKey", "owner-fal");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
});
beforeEach(() => {
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  fal.log.length = 0;
});

/** A constant-rate MP3 (MPEG-1 Layer III, 128 kbps, 44.1 kHz) `seconds` long, as a data URI: its header says the length. */
const mp3 = (seconds: number) => {
  const b = Buffer.alloc(Math.round((seconds * 128_000) / 8));
  Buffer.from([0xff, 0xfb, 0x90, 0x44]).copy(b, 0);
  return `data:audio/mpeg;base64,${b.toString("base64")}`;
};

async function settle(id: string, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (!["queued", "running"].includes(g.status) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}
const submits = (log: CloudRequest[]) => log.filter((r) => r.method === "POST" && r.path.split("?")[0] === "/fal-ai/vidu/q4/reference-to-video");

const run = (voices: string[]) =>
  gens.createGenerations({
    feature: "video",
    modelId: "vidu-q4",
    engine: "cloud",
    op: "ref2v",
    prompt: "[@reference_image_1] turns to the camera and speaks in the voice of [reference_audio_1]",
    inputs: { images: [PNG_DATA_URI], audios: voices },
  } as import("@/lib/catalog/types").GenerationRequest)[0];

// Skipped until the server side lands: src/server/generations.ts handOver reads each reference voice's header and checks referenceVoiceProblem before the job. It fails without that change.
describe.skip("Vidu Q4's reference voices", () => {
  it("refuses a voice shorter than 3 s or longer than 12 s before anything is sent to fal", async () => {
    for (const [voices, words] of [
      [[mp3(2)], "Vidu Q4 needs voice clips of at least 3 s, and Voice 1 is 2 s: use a longer one"],
      [[mp3(5), mp3(14)], "Vidu Q4 takes voice clips up to 12 s, and Voice 2 is 14 s: trim it first"],
    ] as const) {
      const g = await settle(run([...voices]).id);
      expect(g.status).toBe("failed");
      expect(g.error).toContain(words);
      expect(submits(fal.log)).toHaveLength(0);
    }
  });

  it("sends voices of 3 to 12 s", async () => {
    await settle(run([mp3(3), mp3(12)]).id);
    const sent = submits(fal.log);
    expect(sent).toHaveLength(1);
    expect((JSON.parse(sent[0].body) as { reference_audio_urls: string[] }).reference_audio_urls).toHaveLength(2);
  });
});
