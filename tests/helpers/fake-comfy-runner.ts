/**
 * A ComfyUI stand-in that runs jobs (an account's "Your GPU" in tests and the local smoke): it takes uploads and
 * prompts, answers the history with a finished output after a delay, and serves the output file. Every request is
 * logged, so a test can see what reached it (and that nothing else did).
 *
 *   node tests/helpers/fake-comfy-runner.ts --port 3341 [--loras none|a.safetensors,b.safetensors]
 *
 * Options for tests: `loras` (GET /models/loras), `delayMs` (until the history says done), `drip` (the history
 * answers one byte every 2 s, never finishing), `huge` (/view streams without end), `promptId` (the job id /prompt
 * answers), `missing` (a file /prompt answers "not in list" for), `output` ("video", "image" or "model3d": a one-triangle
 * GLB), `layers` (the
 * history lists that many Qwen-Image-Layered layers, node 60), `frames` (an EXR export: a preview clip, node 5, and
 * that many frames, node 3), `historyError` (/history answers HTTP 500 and then sends nothing), `uploadStatus` (the HTTP
 * status /upload/image answers, e.g. 500 to fail every upload), `refuseClass` (/prompt answers "not in list" for a graph with
 * a node of that class), `echo` (an image output is the last picture uploaded, so a result lines up with its photo).
 * This file runs under plain Node too: only erasable TypeScript.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export interface FakeComfyOptions {
  loras?: string[];
  delayMs?: number;
  drip?: boolean;
  huge?: boolean;
  promptId?: string;
  missing?: string;
  output?: "video" | "image" | "model3d";
  layers?: number;
  frames?: number;
  historyError?: boolean;
  uploadStatus?: number;
  /** /prompt answers "not in list" for a graph with a node of this class (a file that node loads isn't there). */
  refuseClass?: string;
  echo?: boolean;
}

export interface FakeLogEntry {
  method: string;
  path: string;
  at: number;
  /** /upload/image: the bytes of the file sent. */
  upload?: Buffer;
  /** /prompt: the graph sent. */
  prompt?: Record<string, unknown>;
}

export interface FakeComfy {
  port: number;
  url: string;
  log: FakeLogEntry[];
  opts: FakeComfyOptions;
  close: () => Promise<void>;
}

/** A tiny but real PNG (2 × 2, RGBA). */
export const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000001149444154789c63381150f11f8419600c005a940a3db632c1b20000000049454e44ae426082",
  "hex",
);

/** A one-triangle binary glTF 2 (a GLB the server's 3D finish can read). */
export const TINY_GLB: Buffer = (() => {
  const bin = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const doc = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let j = Buffer.from(JSON.stringify(doc));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(j.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, j, bh, bin]);
})();

/** The start of an MP4 (an ftyp box), enough for the studio to store it as one. */
export const TINY_MP4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);

/** The bytes of the "image" part of a multipart body. */
function uploadedBytes(body: Buffer, contentType: string): Buffer | undefined {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return undefined;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(marker);
  while (at >= 0) {
    const next = body.indexOf(marker, at + marker.length);
    if (next < 0) break;
    const part = body.subarray(at + marker.length, next);
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd >= 0 && /name="image"/.test(part.subarray(0, headEnd).toString("latin1"))) {
      return part.subarray(headEnd + 4, part.length - 2);
    }
    at = next;
  }
  return undefined;
}

export function startFakeComfy(opts: FakeComfyOptions = {}, port = 0): Promise<FakeComfy> {
  const log: FakeLogEntry[] = [];
  const jobs = new Map<string, number>();
  let lastUpload: Buffer | undefined;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://fake");
      const entry: FakeLogEntry = { method: req.method ?? "GET", path: url.pathname + url.search, at: Date.now() };
      log.push(entry);
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const p = url.pathname;
      if (p === "/system_stats") return json(200, { system: { comfyui_version: "0.3.fake", ram_total: 64 * 2 ** 30 }, devices: [{ name: "Fake GPU", vram_total: 24 * 2 ** 30 }] });
      if (p === "/models/loras") return json(200, opts.loras ?? []);
      if (p === "/object_info") return json(200, {});
      if (p === "/upload/image" && req.method === "POST") {
        entry.upload = uploadedBytes(body, req.headers["content-type"] ?? "");
        if (entry.upload?.length) lastUpload = entry.upload;
        if (opts.uploadStatus && opts.uploadStatus !== 200) return json(opts.uploadStatus, { error: "upload refused" });
        return json(200, { name: `fake_${log.length}.bin`, subfolder: "", type: "input" });
      }
      if (p === "/prompt" && req.method === "POST") {
        try {
          entry.prompt = (JSON.parse(body.toString("utf8")) as { prompt?: Record<string, unknown> }).prompt;
        } catch {}
        const refused = opts.refuseClass ? Object.entries(entry.prompt ?? {}).find(([, n]) => (n as { class_type?: string })?.class_type === opts.refuseClass) : undefined;
        if (refused) {
          return json(400, {
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
            node_errors: { [refused[0]]: { errors: [{ type: "value_not_in_list", message: "Value not in list", details: "not in list", extra_info: { input_name: "latent_file", received_value: "x" } }], class_type: opts.refuseClass } },
          });
        }
        if (opts.missing) {
          return json(400, {
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
            node_errors: { "1": { errors: [{ type: "value_not_in_list", message: "Value not in list", details: `lora_name: '${opts.missing}' not in []` }], class_type: "LoraLoaderModelOnly" } },
          });
        }
        const id = opts.promptId ?? randomUUID();
        jobs.set(id, Date.now());
        return json(200, { prompt_id: id, number: jobs.size, node_errors: {} });
      }
      if (p.startsWith("/history/")) {
        const id = decodeURIComponent(p.slice("/history/".length));
        if (opts.historyError) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.write("x");
          return;
        }
        if (opts.drip) {
          res.writeHead(200, { "content-type": "application/json" });
          const t = setInterval(() => res.write(" "), 2000);
          res.on("close", () => clearInterval(t));
          return;
        }
        const started = jobs.get(id);
        if (started === undefined || Date.now() - started < (opts.delayMs ?? 0)) return json(200, {});
        const done = { status: { completed: true, status_str: "success" } };
        const list = (n: number, ext: string) => Array.from({ length: n }, (_, i) => ({ filename: `fake_${String(i + 1).padStart(5, "0")}_.${ext}`, subfolder: "", type: "output" }));
        if (opts.layers) return json(200, { [id]: { ...done, outputs: { "60": { images: list(opts.layers, "png") } } } });
        if (opts.frames) return json(200, { [id]: { ...done, outputs: { "5": { gifs: list(1, "mp4") }, "3": { images: list(opts.frames, "exr") } } } });
        if (opts.output === "model3d") return json(200, { [id]: { ...done, outputs: { "900": { "3d": [{ filename: "fake_00001_.glb", subfolder: "3D", type: "output" }] } } } });
        const file = opts.output === "image" ? { filename: "fake_00001_.png", subfolder: "", type: "output" } : { filename: "fake_00001.mp4", subfolder: "", type: "output" };
        const key = opts.output === "image" ? "images" : "gifs";
        return json(200, { [id]: { status: { completed: true, status_str: "success" }, outputs: { "900": { [key]: [file] } } } });
      }
      if (p === "/queue") {
        if (req.method === "POST") return json(200, {});
        const running = [...jobs.keys()].map((id, i) => [i, id, {}, {}, []]);
        return json(200, { queue_running: running, queue_pending: [] });
      }
      if (p === "/interrupt") return json(200, {});
      if (p === "/view") {
        if (opts.huge) {
          res.writeHead(200, { "content-type": "video/mp4" });
          const block = Buffer.alloc(64 * 1024, 7);
          const pump = () => {
            while (res.write(block)) {
              /* fill until the socket pushes back */
            }
          };
          res.on("drain", pump);
          res.on("close", () => res.off("drain", pump));
          pump();
          return;
        }
        const name = url.searchParams.get("filename") ?? "";
        if (name.endsWith(".exr")) {
          res.writeHead(200, { "content-type": "image/x-exr" });
          return res.end(Buffer.from("762f3101", "hex"));
        }
        if (name.endsWith(".glb")) {
          res.writeHead(200, { "content-type": "application/octet-stream" });
          return res.end(TINY_GLB);
        }
        const png = name.endsWith(".png");
        if (png && opts.echo && lastUpload) {
          const jpeg = lastUpload[0] === 0xff && lastUpload[1] === 0xd8;
          res.writeHead(200, { "content-type": jpeg ? "image/jpeg" : "image/png" });
          return res.end(lastUpload);
        }
        res.writeHead(200, { "content-type": png ? "image/png" : "video/mp4" });
        return res.end(png ? TINY_PNG : TINY_MP4);
      }
      json(404, { error: "not found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const at = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: at,
        url: `http://127.0.0.1:${at}`,
        log,
        opts,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

// Run on its own: node tests/helpers/fake-comfy-runner.ts --port 3341 [--loras none|a,b] [--output image] [--echo]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(arg("port") ?? 3341);
  const loras = arg("loras");
  const fake = await startFakeComfy({ loras: !loras || loras === "none" ? [] : loras.split(","), delayMs: Number(arg("delay") ?? 1500), output: arg("output") === "image" ? "image" : "video", echo: process.argv.includes("--echo") }, port);
  console.log(`fake ComfyUI on ${fake.url}`);
  setInterval(() => {
    const last = fake.log.splice(0);
    for (const e of last) console.log(`${new Date(e.at).toISOString()} ${e.method} ${e.path}${e.upload ? ` (${e.upload.length} bytes)` : ""}`);
  }, 500);
}
