// The text slot (worker.json `textSlot`): the studio's free text helper (src/server/text-helper.ts). It asks for one
// text job at a time, beside the GPU's job and the CPU slot's, and answers it with a llama.cpp server that it starts
// itself: 127.0.0.1 only, a random port, a new key at each start, the model checked against its SHA-256 first. The
// server starts at the first job and stops after `idleMin` minutes with none, on a pause, and when the worker ends. It
// runs on the GPU when there is room, else on the CPU (`cpu`), and changes only between jobs. Any GGUF chat model works;
// with `mmproj` (its vision projector) it also takes jobs with pictures.
import crypto from "node:crypto";
import { spawn as spawnChild } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { comfyEnv, killTree, pickPort, RotatingLog } from "./comfy.mjs";

export const TEXT_DEFAULTS = { context: 8192, idleMin: 10, gpuMinFreeMb: 8000, cpu: true, threads: 8, startMs: 180_000, answerMs: 120_000, claimWaitMs: 20_000 };

/** The graphics memory a GPU server is counted with before its log says (weights, cache and buffers of a small model). */
export const TEXT_GPU_GUESS_MB = 6500;

/**
 * How each model family is asked: its chat template's switches (thinking off where the template has one) and the
 * sampling its card gives. worker.json's `textSlot.chat` ({ kwargs, sampling }) overrides them.
 */
export const FAMILIES = [
  { match: /nemotron/i, kwargs: { enable_thinking: false }, sampling: { temperature: 1.0, top_p: 0.95 } },
  { match: /gemma/i, kwargs: { enable_thinking: false }, sampling: { temperature: 1.0, top_p: 0.95, top_k: 64 } },
  { match: /qwen3-?vl/i, kwargs: null, sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 } },
];
const PLAIN = { kwargs: null, sampling: { temperature: 0.7, top_p: 0.9 } };

/** The family settings for a model file (or textSlot.name), with worker.json's own. */
export function familyOf(slot) {
  const name = slot.name ?? path.basename(slot.model ?? "");
  const fam = FAMILIES.find((x) => x.match.test(name)) ?? PLAIN;
  const chat = slot.chat && typeof slot.chat === "object" ? slot.chat : {};
  return { kwargs: chat.kwargs === undefined ? fam.kwargs : chat.kwargs, sampling: { ...fam.sampling, ...(chat.sampling ?? {}) } };
}

/** The model name the studio hears with each claim: textSlot.name, else the file's name without .gguf. */
export const modelName = (slot) => String(slot.name ?? path.basename(slot.model ?? "").replace(/\.gguf$/i, "")).toLowerCase().slice(0, 120);

/** A picture a job may carry: a JPEG as base64, at most this long. */
const PICTURE_B64_MAX = 700_000;

const SHA = /^[0-9a-f]{64}$/i;

/**
 * The model a text slot runs when worker.json gives only `modelDir`: Gemma 4 E2B-it (Q6_K) with its vision projector, from
 * unsloth/gemma-4-E2B-it-GGUF at commit 0314792d7f1f7e229411f620751375812bb9faf2. Any field worker.json sets wins.
 */
export const TEXT_DEFAULT_MODEL = {
  model: "gemma-4-E2B-it-Q6_K.gguf",
  sha256: "f7b8980ecc1c115898fd8d9a3d421d90becbac984194a44b478669c26815843d",
  mmproj: "mmproj-F16.gguf",
  mmprojSha256: "140be8d7849741f88c50757d529b84373ee8e27052cc2236855b537f4a8215fa",
};

/** worker.json's `textSlot` with defaults, or { problem } when it can't be used, or null when it isn't set. */
export function textSlotOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const s = { ...TEXT_DEFAULTS, ...raw };
  if (typeof s.modelDir === "string" && s.modelDir) {
    const d = TEXT_DEFAULT_MODEL;
    if (s.model === undefined) Object.assign(s, { model: path.join(s.modelDir, d.model), sha256: s.sha256 ?? d.sha256 });
    if (s.mmproj === undefined) Object.assign(s, { mmproj: path.join(s.modelDir, d.mmproj), mmprojSha256: s.mmprojSha256 ?? d.mmprojSha256 });
  }
  if (typeof s.server !== "string" || !s.server) return { problem: "textSlot needs `server`, the path of llama-server" };
  if (typeof s.model !== "string" || !s.model) return { problem: "textSlot needs `model`, the path of the GGUF file" };
  if (typeof s.sha256 !== "string" || !SHA.test(s.sha256)) return { problem: "textSlot needs `sha256`, the model file's SHA-256" };
  if (s.serverSha256 !== undefined && (typeof s.serverSha256 !== "string" || !SHA.test(s.serverSha256))) return { problem: "textSlot's `serverSha256` isn't a SHA-256" };
  if (s.mmproj !== undefined && (typeof s.mmproj !== "string" || !s.mmproj || typeof s.mmprojSha256 !== "string" || !SHA.test(s.mmprojSha256))) {
    return { problem: "textSlot's `mmproj` needs `mmprojSha256`, the projector file's SHA-256" };
  }
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  return {
    ...s,
    context: num(s.context, 1024, 65_536, TEXT_DEFAULTS.context),
    idleMin: num(s.idleMin, 1, 24 * 60, TEXT_DEFAULTS.idleMin),
    gpuMinFreeMb: num(s.gpuMinFreeMb, 0, 1_000_000, TEXT_DEFAULTS.gpuMinFreeMb),
    threads: num(s.threads, 1, 256, TEXT_DEFAULTS.threads),
    claimWaitMs: num(s.claimWaitMs, 0, TEXT_DEFAULTS.claimWaitMs, TEXT_DEFAULTS.claimWaitMs),
    cpu: s.cpu !== false,
  };
}

/** A file's SHA-256, read in pieces. */
export function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

/**
 * Does the file have this SHA-256? Hashed once for each size and change time (kept in `cacheFile`), so a restart doesn't
 * read 6 GB again.
 */
export async function fileMatches(file, sha256, cacheFile, hash = fileSha256) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")) ?? {};
  } catch {}
  const key = path.resolve(file);
  const known = cache[key];
  let sum = known && known.size === st.size && known.mtimeMs === st.mtimeMs ? known.sha256 : null;
  if (!sum) {
    sum = await hash(file);
    cache[key] = { size: st.size, mtimeMs: st.mtimeMs, sha256: sum };
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache), { mode: 0o600 });
    } catch {}
  }
  return sum.toLowerCase() === sha256.toLowerCase();
}

/** llama-server's arguments for one start. */
export function serverArgs(slot, o) {
  return [
    "-m", slot.model,
    "--host", "127.0.0.1",
    "--port", String(o.port),
    "--api-key", o.key,
    "-c", String(slot.context),
    "-ngl", o.device === "gpu" ? "99" : "0",
    "-np", "1",
    "-t", String(slot.threads),
    "--jinja",
    "--no-webui",
    "--alias", modelName(slot),
    ...(slot.mmproj ? ["--mmproj", slot.mmproj] : []),
  ];
}

/** The graphics memory llama-server says it took (its CUDA buffers, in MB), from its log. */
export function cudaMbOf(logText) {
  let mb = 0;
  for (const m of String(logText).matchAll(/CUDA\d+ [\w ]*?buffer size\s*=\s*([\d.]+) MiB/g)) mb += Number(m[1]);
  return Math.round(mb);
}

/** A text job as the studio sends it, checked; null when it isn't one. */
export function jobOf(body) {
  const j = body?.job;
  if (!j || typeof j !== "object") return null;
  const str = (v, max) => typeof v === "string" && v.length <= max;
  if (!str(j.id, 80) || !j.id || !str(j.lease, 80) || !j.lease || !str(j.system, 16_000) || !str(j.user, 16_000) || !j.user) return null;
  const maxTokens = Number(j.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) return null;
  let images = [];
  if (j.images !== undefined) {
    if (!Array.isArray(j.images) || j.images.length > 4) return null;
    for (const b of j.images) {
      // A JPEG as base64 only, never an address: llama-server would fetch a URL or read a file.
      if (typeof b !== "string" || b.length > PICTURE_B64_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(b) || !b.startsWith("/9j/")) return null;
    }
    images = j.images;
  }
  return { id: j.id, lease: j.lease, system: j.system, user: j.user, maxTokens, json: j.json === true, images };
}

/** The request body for one job: the family's template switches and sampling, the pictures before the words. */
export function chatBody(job, slot = {}) {
  const fam = familyOf(slot);
  const pictures = job.images ?? [];
  const content = pictures.length ? [...pictures.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b}` } })), { type: "text", text: job.user }] : job.user;
  return {
    model: modelName(slot),
    messages: [...(job.system ? [{ role: "system", content: job.system }] : []), { role: "user", content }],
    max_tokens: job.maxTokens,
    ...fam.sampling,
    stream: false,
    ...(fam.kwargs && { chat_template_kwargs: fam.kwargs }),
    ...(job.json && { response_format: { type: "json_object" } }),
  };
}

export class TextSlot {
  /**
   * @param {object} slot textSlotOf's answer
   * @param {object} deps { call (the studio, with the worker's token), log, workDir, home, now, sleep, spawn, fetch, env }
   */
  constructor(slot, deps) {
    this.slot = slot;
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.dir = path.join(deps.workDir, "text");
    this.ok = null;
    this.checking = null;
    this.server = null;
    this.busy = false;
    this.job = Promise.resolve();
    this.lastJobAt = 0;
    this.missedAt = -Infinity;
    // Ends a claim that waits for a job when the worker stops.
    this.ending = new AbortController();
  }

  /** The model (and the server, when worker.json gives its SHA-256) checked once, in the background. */
  check() {
    if (this.ok !== null || this.checking) return;
    const cache = path.join(this.d.home ?? this.d.workDir, "text-checks.json");
    const hash = this.d.hash;
    this.checking = (async () => {
      const model = await fileMatches(this.slot.model, this.slot.sha256, cache, hash);
      const server = fs.existsSync(this.slot.server) && (!this.slot.serverSha256 || (await fileMatches(this.slot.server, this.slot.serverSha256, cache, hash)));
      const mmproj = !this.slot.mmproj || (await fileMatches(this.slot.mmproj, this.slot.mmprojSha256, cache, hash));
      this.ok = model && server && mmproj;
      const why = !model ? "the model file is missing or its SHA-256 doesn't match" : !mmproj ? "the mmproj file is missing or its SHA-256 doesn't match" : "llama-server is missing or its SHA-256 doesn't match";
      this.log(this.ok ? `Its text slot is ready (${modelName(this.slot)}${this.slot.mmproj ? ", with pictures" : ""}): the SHA-256 matches.` : `Its text slot is off: ${why}.`);
    })()
      .catch((e) => {
        this.ok = false;
        this.log(`Its text slot is off: ${e.message}`);
      })
      .finally(() => (this.checking = null));
  }

  /** The processes and graphics memory that are the worker's own (the GPU's watch never counts them as another program). */
  own() {
    const s = this.server;
    // Until its log says what it took, a fair guess for this model on the GPU.
    return s?.device === "gpu" ? { pids: s.pid ? [s.pid] : [], mb: s.vramMb || TEXT_GPU_GUESS_MB } : { pids: [], mb: 0 };
  }

  /**
   * Once a second from the worker's loop. `may`: the worker may take text jobs (not paused by hand or on the website,
   * inside its hours). `room`: "gpu", "cpu" or null, where a new start may run now.
   */
  tick(t, { may, room }) {
    if (!may) {
      if (this.server && !this.busy) void this.stop("paused");
      return;
    }
    this.check();
    if (!this.ok || this.busy) return;
    if (this.server && t - this.lastJobAt >= this.slot.idleMin * 60_000) {
      void this.stop("idle");
      return;
    }
    // A running server keeps its device; a new start goes where there is room (the CPU only when worker.json allows it).
    const device = this.server?.device ?? (room === "gpu" ? "gpu" : this.slot.cpu ? "cpu" : null);
    if (!device) return;
    // The device it would start on now differs: it stops after this job, and starts there for the next one.
    if (this.server && room && room !== this.server.device && !(room === "cpu" && !this.slot.cpu)) {
      void this.stop("device");
      return;
    }
    if (t - this.missedAt < 3000) return;
    this.busy = true;
    this.job = this.claimAndRun(device)
      .then((had) => (this.missedAt = had ? -Infinity : this.now()))
      .catch((e) => {
        this.missedAt = this.now();
        if (!this.ending.signal.aborted) this.log(`A text job stopped: ${e.message}`);
      })
      .finally(() => (this.busy = false));
  }

  async claimAndRun(device) {
    const res = await this.d.call("/api/gpu/computer/text/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: modelName(this.slot), device, vision: !!this.slot.mmproj, wait: this.slot.claimWaitMs }), signal: this.ending.signal });
    if (res.status === 204 || !res.ok) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const job = jobOf(await res.json().catch(() => null));
    if (!job) return false;
    let answer;
    try {
      if (job.images.length && !this.slot.mmproj) throw new Error("this slot's model doesn't take pictures");
      await this.ensure(device);
      answer = { text: await this.complete(job) };
    } catch (e) {
      answer = { error: String(e.message ?? e).slice(0, 200) };
      this.log(`Text job ${job.id} has no answer: ${answer.error}`);
    }
    this.lastJobAt = this.now();
    const sent = await this.d.call(`/api/gpu/computer/text/${encodeURIComponent(job.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lease: job.lease, ...answer }) });
    await sent.body?.cancel().catch(() => {});
    return true;
  }

  /** The answer's words from its server. */
  async complete(job) {
    const s = this.server;
    if (!s) throw new Error("llama-server isn't running");
    const f = this.d.fetch ?? fetch;
    const r = await f(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.key}` },
      body: JSON.stringify(chatBody(job, this.slot)),
      signal: AbortSignal.timeout(this.slot.answerMs),
    });
    if (!r.ok) throw new Error(`llama-server answered ${r.status}`);
    const body = await r.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("llama-server gave no text");
    return text;
  }

  /** Its server on this device, started now when it isn't (another device's is stopped first). */
  async ensure(device) {
    if (this.server?.device === device && this.server.alive) return;
    if (this.server) await this.stop("device");
    fs.mkdirSync(this.dir, { recursive: true });
    const port = await pickPort(null);
    const key = crypto.randomBytes(24).toString("base64url");
    const env = { ...comfyEnv(this.d.env ?? process.env), ...(device === "cpu" && { CUDA_VISIBLE_DEVICES: "-1" }) };
    const logFile = path.join(this.dir, "llama-server.log");
    const out = new RotatingLog(logFile, { maxBytes: 5 * 2 ** 20 });
    let head = "";
    const spawn = this.d.spawn ?? spawnChild;
    const child = spawn(this.slot.server, serverArgs(this.slot, { port, key, device }), { cwd: this.dir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const s = { child, pid: child.pid, port, key, device, alive: true, vramMb: 0, log: out };
    const take = (b) => {
      out.write(b);
      if (head.length < 200_000) head += b.toString("utf8");
      if (device === "gpu") s.vramMb = cudaMbOf(head);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.once("exit", (code) => {
      s.alive = false;
      out.close();
      if (this.server === s) {
        this.server = null;
        if (!s.stopping) this.log(`llama-server stopped (exit ${code}).`);
      }
    });
    child.once("error", (e) => {
      s.alive = false;
      if (this.server === s) this.server = null;
      this.log(`llama-server didn't start: ${e.message}`);
    });
    this.server = s;
    this.log(`Starting llama-server on the ${device === "gpu" ? "GPU" : "CPU"} for text jobs.`);
    const f = this.d.fetch ?? fetch;
    const sleep = this.d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const end = this.now() + this.slot.startMs;
    while (this.now() < end) {
      if (!s.alive) throw new Error("llama-server stopped while it started");
      const r = await f(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (r?.ok) {
        await r.body?.cancel().catch(() => {});
        return;
      }
      await r?.body?.cancel().catch(() => {});
      await sleep(500);
    }
    await this.stop("start");
    throw new Error("llama-server didn't get ready in time");
  }

  /** Stop its server (it frees its memory). */
  async stop(why = "stop") {
    const s = this.server;
    if (!s) return;
    this.server = null;
    s.stopping = true;
    if (why === "idle") this.log("No text job for a while: llama-server stops and frees its memory.");
    if (s.alive && s.pid) await (this.d.kill ?? killTree)(s.pid);
  }

  /** The worker ends: its job ends first (at most 10 s), then its server. */
  async end() {
    this.ending.abort();
    await Promise.race([this.job, new Promise((r) => setTimeout(r, 10_000).unref?.())]);
    await this.stop("end");
  }
}
