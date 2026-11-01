/**
 * A ComfyUI stand-in that runs jobs (an account's "Your GPU" in tests and the local smoke): it takes uploads and
 * prompts, answers the history with a finished output after a delay, and serves the output file. Every request is
 * logged, so a test can see what reached it (and that nothing else did).
 *
 *   node tests/helpers/fake-comfy-runner.ts --port 3341 [--loras none|a.safetensors,b.safetensors]
 *
 * Options for tests: `loras` (GET /models/loras), `delayMs` (until the history says done), `drip` (the history
 * answers one byte every 2 s, never finishing), `huge` (/view streams without end), `promptId` (the job id /prompt
 * answers), `missing` (a file /prompt answers "not in list" for), `output` ("video" or "image"), `layers` (the
 * history lists that many Qwen-Image-Layered layers, node 60), `frames` (an EXR export: a preview clip, node 5, and
 * that many frames, node 3), `historyError` (/history answers HTTP 500 and then sends nothing), `uploadStatus` (the HTTP
 * status /upload/image answers, e.g. 500 to fail every upload).
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
  output?: "video" | "image";
  layers?: number;
  frames?: number;
  historyError?: boolean;
  uploadStatus?: number;
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
        if (opts.uploadStatus && opts.uploadStatus !== 200) return json(opts.uploadStatus, { error: "upload refused" });
        return json(200, { name: `fake_${log.length}.bin`, subfolder: "", type: "input" });
      }
      if (p === "/prompt" && req.method === "POST") {
        try {
          entry.prompt = (JSON.parse(body.toString("utf8")) as { prompt?: Record<string, unknown> }).prompt;
        } catch {}
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
        const png = name.endsWith(".png");
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

// Run on its own: node tests/helpers/fake-comfy-runner.ts --port 3341 [--loras none|a,b]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(arg("port") ?? 3341);
  const loras = arg("loras");
  const fake = await startFakeComfy({ loras: !loras || loras === "none" ? [] : loras.split(","), delayMs: Number(arg("delay") ?? 1500), output: arg("output") === "image" ? "image" : "video" }, port);
  console.log(`fake ComfyUI on ${fake.url}`);
  setInterval(() => {
    const last = fake.log.splice(0);
    for (const e of last) console.log(`${new Date(e.at).toISOString()} ${e.method} ${e.path}${e.upload ? ` (${e.upload.length} bytes)` : ""}`);
  }, 500);
}
