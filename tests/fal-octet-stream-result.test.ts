import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * A result file fal.ai types as "application/octet-stream" is typed by its download or its name. fal's extract-audio
 * documents its answer that way (its OpenAPI output example: {"audio": {"url": "…_extracted.mp3", "content_type":
 * "application/octet-stream", "file_name": "extracted.mp3"}}), and Clean dialogue on a video with DeepFilterNet 3 chains that
 * soundtrack into the denoiser as audio. Kept as the type fal gave, it was stored as a .bin picture and the denoiser's
 * step failed with "An earlier step has no audio to use", after the extract was paid for. Stand-in fal.ai: no paid call.
 */
const dir = tempDir("fuobe-fal-octet-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { extractMedia, extractOutputs } = await import("@/lib/catalog/payload");
const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const route = await import("@/app/api/audio-tools/route");

const DOCUMENTED = {
  audio: { url: "https://v3b.fal.media/files/b/elephant/Ttx6ckshlpIFIDsP1_8YH_extracted.mp3", file_size: 123256, content_type: "application/octet-stream", file_name: "extracted.mp3" },
};

describe("fal's application/octet-stream on a result file", () => {
  it("is left out, so the file's own type is used; the kind comes from the field and the name", () => {
    const [stem] = extractOutputs(DOCUMENTED, "separate-audio");
    expect(stem).toMatchObject({ url: DOCUMENTED.audio.url, kind: "audio", meta: { stem: "audio" } });
    expect(stem.contentType).toBeUndefined();
    const [media] = extractMedia(DOCUMENTED);
    expect(media).toMatchObject({ url: DOCUMENTED.audio.url, kind: "audio" });
    expect(media.contentType).toBeUndefined();
    // A real type is kept as given.
    expect(extractMedia({ audio: { url: "https://v3b.fal.media/files/b/x/a", content_type: "audio/flac" } })[0].contentType).toBe("audio/flac");
  });
});

describe("Clean dialogue on a video with DeepFilterNet 3 (extract-audio's documented answer)", () => {
  let fal: FakeCloud;
  let files: http.Server;
  let base = "";
  const at = new Map<string, string>();
  let n = 0;
  const RESULTS: Record<string, () => unknown> = {
    "fal-ai/workflow-utilities/extract-audio": () => ({ audio: { url: `${base}/Ttx6_extracted.mp3`, file_size: 4, content_type: "application/octet-stream", file_name: "extracted.mp3" } }),
    "fal-ai/deepfilternet3": () => ({ audio_file: { url: `${base}/clean.flac`, content_type: "audio/flac", file_name: "clean.flac" }, timings: { preprocess: 0, inference: 0, postprocess: 0 } }),
    "fal-ai/ffmpeg-api/merge-audio-video": () => ({ video: { url: `${base}/merged.mp4`, content_type: "video/mp4", file_name: "merged.mp4" } }),
  };
  beforeAll(async () => {
    // fal's CDN: every file as application/octet-stream, the worst case.
    files = http.createServer((_q, s) => {
      s.writeHead(200, { "Content-Type": "application/octet-stream" });
      s.end(Buffer.from("FAKE"));
    });
    await new Promise<void>((r) => files.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(files.address() as { port: number }).port}`;
    fal = await startFakeFal();
    fal.pollsToFinish = 0;
    globalThis.__fuobeTestFalUrl = fal.url;
    fal.keys["owner-fal"] = "good";
    setSetting("falKey", "owner-fal");
    fal.script = (r) => {
      const p = r.path.split("?")[0];
      if (r.method === "POST" && RESULTS[p.slice(1)]) {
        const id = `octet-${++n}`;
        at.set(id, p.slice(1));
        const app = p.slice(1).split("/").slice(0, 2).join("/");
        const u = `${fal.url}/${app}/requests/${id}`;
        return { status: 200, body: { request_id: id, status_url: `${u}/status`, response_url: u, cancel_url: `${u}/cancel` } };
      }
      const m = /\/requests\/([^/]+)$/.exec(p);
      if (r.method === "GET" && m && at.has(m[1])) return { status: 200, body: RESULTS[at.get(m[1])!]() };
      return null;
    };
  });
  afterAll(async () => {
    globalThis.__fuobeTestFalUrl = undefined;
    globalThis.__fuobeTestDiskFree = undefined;
    await fal.close();
    await new Promise<void>((r) => files.close(() => r()));
  });

  it("keeps the soundtrack as audio, so the denoiser and the merge run", async () => {
    const media = saveFile({ data: Buffer.from("not a real mp4"), contentType: "video/mp4", name: "vlog.mp4", source: "upload" }).url;
    const res = await route.POST(new Request("http://x/api/audio-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "clean-dialogue", engine: "cloud", cleaner: "deepfilternet", media, kind: "video" }) }));
    expect(res.status, await res.clone().text()).toBe(201);
    const run = (await res.json()) as { items: { id: string }[] };
    const end = Date.now() + 30_000;
    let all = run.items.map((g) => gens.getGeneration(g.id)!);
    while (!all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status)) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 150));
      all = run.items.map((g) => gens.getGeneration(g.id)!);
    }
    expect(all.map((g) => [g.modelId, g.status, g.error ?? null])).toEqual([
      ["extract-soundtrack", "succeeded", null],
      ["deepfilternet3", "succeeded", null],
      ["merge-audio-video", "succeeded", null],
    ]);
    expect(all[0].outputs[0]).toMatchObject({ kind: "audio", contentType: "audio/mpeg" });
    const sent = fal.log.filter((r) => r.method === "POST" && r.path === "/fal-ai/deepfilternet3").map((r) => JSON.parse(r.body));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ audio_format: "flac" });
    expect(typeof sent[0].audio_url).toBe("string");
  }, 60_000);
});
