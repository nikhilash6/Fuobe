import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GenInput, ModelDef } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// Full songs on the open engine: MiniMax Music 3 and YuE2 (songs and covers) on core ComfyUI nodes, bound for real; and the
// fal provider's song tools (a song sent first through Mureka's files/upload, stems unpacked from Mureka's zip) against a
// stand-in fal.ai on this machine.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-music3-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://comfy.test:8188";

const { loadManifest, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { resolveWorkflowId } = await import("@/lib/comfy-variants");
const { buildLicenceList, licenceInfo, workflowLicence } = await import("@/lib/licences");
const { setSetting } = await import("@/server/settings");
const { falProvider, stemsFromZip } = await import("@/server/providers/fal");
const { zip } = await import("@/server/zip");
const { saveFile } = await import("@/server/storage");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { unzip } = await import("@/server/unzip");

const requirements = JSON.parse(fs.readFileSync("workflows/comfyui/requirements.json", "utf8")) as { workflows: Record<string, { files: string[]; vramGb?: number | string }> };
const SONGS = ["music-minimax-3", "music-yue2-song", "music-yue2-cover"];

const song: MediaInfo = { container: "mp3", hasVideo: false, hasAudio: true, duration: 95, channels: 2 } as MediaInfo;
async function prepare(id: string, input: Partial<GenInput>) {
  const uploads: string[] = [];
  const res = await prepareWorkflow(id, { prompt: "", ...input } as GenInput, {
    generationId: "gen1",
    op: "music",
    upload: async (_d, _t, name) => {
      uploads.push(name);
      return `up_${name}`;
    },
    media: (name) => (name === "song.mp3" ? song : undefined),
    serverRam: async () => undefined,
  });
  return { ...res, uploads };
}

describe("the song graphs", () => {
  it("are in the manifest, accepted by a live ComfyUI, with their licences, pinned files and a model that runs them", () => {
    const byId = new Map(loadManifest().workflows.map((w) => [w.id, w]));
    for (const id of SONGS) {
      const wf = byId.get(id)!;
      expect(wf, id).toBeTruthy();
      expect(wf.validated, id).toBe(true);
      expect(wf.capability).toBe("music");
      expect(wf.customNodes, id).toEqual([]);
      expect(requirements.workflows[id]?.files.length, id).toBeGreaterThan(0);
    }
    expect(byId.get("music-minimax-3")!.models.map((m) => [m.file, m.sizeGb])).toEqual([
      ["minimax_music3_dit_int8_convrot.safetensors", 2.5],
      ["minimax_music3_text_encoder_pruned_int8_convrot.safetensors", 9.2],
      ["minimax_music3_dav.safetensors", 0.22],
    ]);
    expect(byId.get("music-minimax-3")!.vramGb).toBe(24);
    expect(byId.get("music-yue2-cover")!.models.map((m) => m.file)).toEqual(["yue2_3b_int8_convrot.safetensors", "sheetsage2_bf16.safetensors"]);
    expect(getModel("oss-minimax-music-3")!.routes[0].endpoint).toBe("music-minimax-3");
    expect(getModel("oss-yue2")!.routes[0].endpoint).toBe("music-yue2-song");
  });

  it("show each licence as information: MiniMax-Music3's own (with its notice), YuE2's non-commercial", () => {
    const wfs = loadManifest().workflows;
    const mm = licenceInfo(workflowLicence(wfs.find((w) => w.id === "music-minimax-3")!));
    expect(mm).toMatchObject({ name: "MiniMax-Music3 Community License", class: "conditions", notices: ["MiniMax-Music3"] });
    expect(mm.url).toContain("MiniMaxAI/MiniMax-Music3/blob/1b525ccb");
    expect(licenceInfo(workflowLicence(wfs.find((w) => w.id === "music-yue2-song")!)).class).toBe("non-commercial");
    const rows = buildLicenceList([getModel("oss-yue2")!, getModel("oss-minimax-music-3")!] as ModelDef[], wfs).rows;
    expect(rows.find((r) => r.id === "oss-yue2")).toMatchObject({ workflows: ["music-yue2-song"], flags: ["non-commercial"] });
  });

  it("MiniMax Music 3: the style, the lyrics, the length, the seed; long songs decode in tiles", async () => {
    const { workflow: prompt } = await prepare("music-minimax-3", { prompt: "Acoustic pop, 96 BPM", duration: 180, seed: 5, extra: { lyrics: "[Verse]\nMorning light" } });
    expect(prompt["4"].inputs).toMatchObject({ caption: "Acoustic pop, 96 BPM", lyrics: "[Verse]\nMorning light", max_duration: 180, seed: 5 });
    expect(prompt["7"].inputs.seed).toBe(5);
    expect(prompt["10"].inputs.switch).toBe(true);
    const short = await prepare("music-minimax-3", { prompt: "Lo-fi", duration: 60 });
    expect(short.workflow["10"].inputs.switch).toBe(false);
    // No words: the graph's own instrumental.
    expect(short.workflow["4"].inputs.lyrics).toBe("[Instrumental]");
    await expect(prepare("music-minimax-3", { prompt: "x", duration: 330 })).rejects.toThrow("This model writes songs up to 5 minutes on your GPU: pick a shorter length");
  });

  it("ACE-Step: a song with no words is an instrumental, never the template's sample lyrics", async () => {
    const plain = await prepare("music-ace-step-15", { prompt: "lo-fi beat", extra: {} });
    expect(plain.workflow["94"].inputs.lyrics).toBe("[Instrumental]");
    const sung = await prepare("music-ace-step-15", { prompt: "lo-fi beat", extra: { lyrics: "[Verse]\nnew words" } });
    expect(sung.workflow["94"].inputs.lyrics).toBe("[Verse]\nnew words");
  });

  it("YuE2: the style and lyrics plan the song; a song added is covered from its melody", async () => {
    const { workflow: prompt } = await prepare("music-yue2-song", { prompt: "English, warm female vocal, pop", duration: 120, seed: 9, extra: { lyrics: "[Verse]\nla la" } });
    expect(prompt["2"].inputs).toMatchObject({ style: "English, warm female vocal, pop", lyrics: "[Verse]\nla la", seed: 9, mode: "full" });
    expect(prompt["3"].inputs).toMatchObject({ abc: ["2", 0], max_duration: 120, seed: 9 });
    const has = (id: string) => SONGS.includes(id);
    const base = { op: "music", clips: 0, images: 0, audio2: false, extra: {}, has };
    expect(resolveWorkflowId("music-yue2-song", base)).toBe("music-yue2-song");
    expect(resolveWorkflowId("music-yue2-song", { ...base, audio: true })).toBe("music-yue2-cover");
    expect(resolveWorkflowId("music-minimax-3", { ...base, audio: true })).toBe("music-minimax-3");
    const cover = await prepare("music-yue2-song", { prompt: "Jazz, male vocal", audio: "song.mp3", extra: { lyrics: "[Verse]\nnew words" } });
    expect(cover.workflow["9"].inputs.audio).toBe("song.mp3");
    expect(cover.workflow["11"].inputs).toMatchObject({ audio: ["9", 0], mode: "melody" });
    expect(cover.workflow["3"].inputs).toMatchObject({ style: "Jazz, male vocal", lyrics: "[Verse]\nnew words", abc: ["11", 0], mode: "melody" });
  });
});

describe("the fal provider's song tools", () => {
  let server: http.Server;
  let base = "";
  const log: { method: string; path: string; body: string }[] = [];
  const stems = zip([
    { name: "stems/vocals.mp3", data: Buffer.from("ID3vocals") },
    { name: "stems/drums.wav", data: Buffer.from("RIFFdrums") },
    { name: "__MACOSX/._vocals.mp3", data: Buffer.from("x") },
    { name: "readme.txt", data: Buffer.from("hi") },
  ]);
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const p = req.url ?? "/";
        log.push({ method: req.method ?? "GET", path: p, body: Buffer.concat(chunks).toString() });
        const json = (b: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(b));
        };
        if (p === "/mureka/api/files/upload") return json({ id: "upload_7", purpose: "audio" });
        if (p === "/stems.zip") {
          res.writeHead(200, { "Content-Type": "application/zip" });
          return res.end(stems);
        }
        if (p.startsWith("/requests/") && p.includes("/status")) return json({ status: "COMPLETED" });
        if (p.startsWith("/requests/")) return json({ zip_url: `${base}/stems.zip`, midi_zip_url: null });
        return json({ request_id: "r1", status_url: `${base}/requests/r1/status`, response_url: `${base}/requests/r1`, cancel_url: `${base}/requests/r1/cancel` });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    globalThis.__fuobeTestFalUrl = base;
    setSetting("falKey", "owner-fal-key");
  });
  afterAll(async () => {
    globalThis.__fuobeTestFalUrl = undefined;
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const model = (id: string) => getModel(id)!;
  it("sends a song Mureka didn't make through its files/upload first, then extends it by that id", async () => {
    const m = model("mureka-extend");
    const job = await falProvider.submit({ generationId: "g", model: m, route: m.routes[0], input: { prompt: "", audio: "https://files.test/song.mp3", startTime: 95, extra: { lyrics: "[Verse]\nmore" } } });
    expect(JSON.parse(log.find((l) => l.path === "/mureka/api/files/upload")!.body)).toEqual({ file_url: "https://files.test/song.mp3", purpose: "audio" });
    expect(job.payload).toEqual({ lyrics: "[Verse]\nmore", extend_at: 95000, upload_audio_id: "upload_7" });
    // One of Mureka's own: no upload.
    log.length = 0;
    const own = await falProvider.submit({ generationId: "g", model: m, route: m.routes[0], input: { prompt: "", audio: "https://files.test/song.mp3", startTime: 95, extra: { lyrics: "[Verse]\nmore", songId: "song_1" } } });
    expect(log.some((l) => l.path === "/mureka/api/files/upload")).toBe(false);
    expect(own.payload).toMatchObject({ song_id: "song_1" });
  });

  it("refuses a song Mureka's tools can't take before anything is sent or paid for", async () => {
    /** A WAV header of `seconds` at 8 kHz mono 8-bit, its samples silent. */
    const wav = (seconds: number) => {
      const h = Buffer.alloc(44);
      h.write("RIFF", 0);
      h.writeUInt32LE(36 + seconds * 8000, 4);
      h.write("WAVEfmt ", 8);
      h.writeUInt32LE(16, 16);
      h.writeUInt16LE(1, 20);
      h.writeUInt16LE(1, 22);
      h.writeUInt32LE(8000, 24);
      h.writeUInt32LE(8000, 28);
      h.writeUInt16LE(1, 32);
      h.writeUInt16LE(8, 34);
      h.write("data", 36);
      h.writeUInt32LE(seconds * 8000, 40);
      return Buffer.concat([h, Buffer.alloc(seconds * 8000, 128)]);
    };
    const file = (name: string, contentType: string, data: Buffer) => saveFile({ name, contentType, source: "upload", data }).url;
    const run = async (modelId: string, audio: string, extra: Record<string, unknown> = {}, prompt = "") => {
      const [g] = createGenerations({ feature: "song-tools", modelId, engine: "cloud", prompt, inputs: { audio }, params: { extra } });
      for (let i = 0; i < 200 && !["failed", "succeeded"].includes(getGeneration(g.id)!.status); i++) await new Promise((r) => setTimeout(r, 10));
      return getGeneration(g.id)!;
    };
    log.length = 0;
    const stems = await run("mureka-stems", file("bed.wav", "audio/wav", wav(3)));
    expect(stems.status).toBe("failed");
    expect(stems.error).toBe("Stems take an MP3 or M4A song: this one is a WAV file. Save it as an MP3 and add it again");
    const big = await run("mureka-stems", file("big.mp3", "audio/mpeg", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(10_500_000)])));
    expect(big.error).toBe("Stems take a song of up to 10 MB: this one is 10.6 MB. Save it as a smaller MP3 and add it again");
    const long = await run("mureka-remix", file("long.wav", "audio/wav", wav(400)), { lyrics: "[Verse]\nla" }, "jazz");
    expect(long.error).toBe("Remix takes a song of 0:10 to 5:50: this one is 6:40");
    const short = await run("mureka-remix", file("short.wav", "audio/wav", wav(5)), { lyrics: "[Verse]\nla" }, "jazz");
    expect(short.error).toBe("Remix takes a song of 0:10 to 5:50: this one is 0:05");
    // Nothing reached fal: no upload to Mureka, no run.
    expect(log).toEqual([]);
  });

  it("unpacks the stems' zip into one result per track, named by its file", async () => {
    const m = model("mureka-stems");
    const job = await falProvider.submit({ generationId: "g", model: m, route: m.routes[0], input: { prompt: "", audio: "https://files.test/song.mp3" } });
    expect(job.payload).toEqual({ audio_url: "https://files.test/song.mp3" });
    const r = await falProvider.poll({ externalId: job.externalId, meta: job.meta!, route: m.routes[0], model: m, createdAt: Date.now() });
    expect(r.state).toBe("succeeded");
    if (r.state !== "succeeded") return;
    expect(r.outputs.map((o) => [o.meta?.stem, o.contentType, o.kind])).toEqual([
      ["vocals", "audio/mpeg", "audio"],
      ["drums", "audio/wav", "audio"],
    ]);
    expect(Buffer.from(r.outputs[0].url.split(",")[1], "base64").toString()).toBe("ID3vocals");
  });

  it("reads an archive's files, and refuses a damaged or oversized one", async () => {
    expect((await unzip(stems)).map((f) => f.name)).toEqual(["stems/vocals.mp3", "stems/drums.wav", "readme.txt"]);
    await expect(unzip(Buffer.from("not a zip at all, just words"))).rejects.toThrow("Not a zip archive");
    await expect(unzip(stems, { maxFiles: 2 })).rejects.toThrow(/more than 2/);
    await expect(unzip(stems, { maxBytes: 4 })).rejects.toThrow(/more than Fuobe keeps/);
  });

  it("counts the bytes it unpacks, not the sizes a crafted archive declares", async () => {
    const MiB = 1024 * 1024;
    // One deflated entry (8 MiB of zeros in about 8 KB), listed `copies` times in the directory, each claiming `declared` bytes.
    const crafted = (copies: number, declared: number, opts: { offsets?: number[] } = {}) => {
      const data = zlib.deflateRawSync(Buffer.alloc(8 * MiB));
      const name = Buffer.from("stems/vocals.wav");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(declared, 22);
      local.writeUInt16LE(name.length, 26);
      const head = Buffer.concat([local, name, data]);
      const dir = Array.from({ length: copies }, (_, i) => {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(8, 10);
        c.writeUInt32LE(data.length, 20);
        c.writeUInt32LE(declared, 24);
        c.writeUInt16LE(name.length, 28);
        c.writeUInt32LE(opts.offsets?.[i] ?? 0, 42);
        return Buffer.concat([c, name]);
      });
      const cd = Buffer.concat(dir);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(copies, 8);
      end.writeUInt16LE(copies, 10);
      end.writeUInt32LE(cd.length, 12);
      end.writeUInt32LE(head.length, 16);
      return Buffer.concat([head, cd, end]);
    };
    // Twenty directory entries over one local entry: refused before a second inflate, not 160 MiB unpacked.
    await expect(unzip(crafted(20, 0))).rejects.toThrow("damaged");
    await expect(unzip(crafted(2, 8 * MiB, { offsets: [0, 4] }))).rejects.toThrow("damaged");
    // A size declared as 0 that unpacks to 8 MiB: refused, and never past what is left of the budget.
    await expect(unzip(crafted(1, 0))).rejects.toThrow("damaged");
    await expect(unzip(crafted(1, 0), { maxBytes: 2 * MiB })).rejects.toThrow(/more than Fuobe keeps/);
    // An honest entry still reads.
    expect((await unzip(crafted(1, 8 * MiB)))[0].data.length).toBe(8 * MiB);
  });

  it("stops a stems download past its byte limit, with or without a declared length, and past its time limit", async () => {
    const big = http.createServer((req, res) => {
      if (req.url === "/declared") {
        res.writeHead(200, { "Content-Length": String(4096) });
        return res.end(Buffer.alloc(4096));
      }
      if (req.url === "/streamed") {
        res.writeHead(200);
        res.write(Buffer.alloc(3000));
        res.write(Buffer.alloc(3000));
        return res.end();
      }
      res.writeHead(200);
      res.write(Buffer.alloc(10)); // then nothing more
    });
    await new Promise<void>((r) => big.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${(big.address() as { port: number }).port}`;
    try {
      await expect(stemsFromZip(`${at}/declared`, { maxBytes: 1024 })).rejects.toThrow(/larger than Fuobe keeps/);
      await expect(stemsFromZip(`${at}/streamed`, { maxBytes: 4000 })).rejects.toThrow(/larger than Fuobe keeps/);
      await expect(stemsFromZip(`${at}/stalls`, { waitMs: 300 })).rejects.toThrow(/took too long/);
    } finally {
      big.closeAllConnections();
      await new Promise<void>((r) => big.close(() => r()));
    }
  });
});
