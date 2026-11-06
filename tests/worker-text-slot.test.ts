/**
 * The worker's text slot (bin/lib/worker/text.mjs): it takes the studio's text jobs only with a model whose SHA-256
 * matches, starts its own llama-server (a stand-in here) on 127.0.0.1 with a new key, on the GPU or the CPU, answers each
 * job with its lease, stops the server when idle or paused, and its graphics memory counts as the worker's own. No model,
 * no GPU, no llama.cpp.
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { othersOf } from "../bin/lib/worker/gpu.mjs";
import { parseCounters, splitMemory } from "../bin/lib/worker/local-work.mjs";
import { chatBody, cudaMbOf, fileMatches, jobOf, serverArgs, TEXT_MODEL, TextSlot, textSlotOf } from "../bin/lib/worker/text.mjs";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 30_000 });

const dir = tempDir("fuobe-text-slot-");
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const MODEL = Buffer.from("GGUF stand-in model bytes");
const modelFile = path.join(dir, "model.gguf");
fs.writeFileSync(modelFile, MODEL);

/** A stand-in llama-server: its buffers on stderr, /health and /v1/chat/completions behind its key, the request echoed back. */
const FAKE = `
import http from "node:http";
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const port = Number(arg("--port"));
const key = arg("--api-key");
const gpu = arg("-ngl") !== "0";
if (gpu) process.stderr.write("load_tensors:        CUDA0 model buffer size =  3577.50 MiB\\nllama_kv_cache:      CUDA0 KV buffer size =   120.00 MiB\\nload_tensors:   CUDA_Host model buffer size =  2400.00 MiB\\n");
http.createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) { res.writeHead(401); return res.end(); }
  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const b = JSON.parse(body);
    const content = JSON.stringify({ host: req.headers.host, ngl: arg("-ngl"), cuda: process.env.CUDA_VISIBLE_DEVICES ?? null, token: process.env.FUOBE_WORKER_TOKEN ?? null, thinking: b.chat_template_kwargs.enable_thinking, user: b.messages.at(-1).content, max: b.max_tokens });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(port, "127.0.0.1");
`;
const fakeFile = path.join(dir, "fake-llama.mjs");
fs.writeFileSync(fakeFile, FAKE);

const started: { args: string[]; pid?: number }[] = [];
/** Starts the stand-in where the slot would start llama-server. */
const fakeSpawn = (cmd: string, args: string[], o: Parameters<typeof spawn>[2]) => {
  expect(cmd).toBe(fakeFile);
  const child = spawn(process.execPath, [fakeFile, ...args], o);
  started.push({ args, pid: child.pid });
  return child;
};
const kill = async (pid: number) => {
  try {
    process.kill(pid);
  } catch {}
};

/** The studio, as the slot's calls reach it: one job at a time from `line`, answers kept in `answers`. */
function studio(line: { id: string; lease: string; user: string; maxTokens: number; system?: string; json?: boolean }[]) {
  const answers: { id: string; body: Record<string, unknown> }[] = [];
  const claims: Record<string, unknown>[] = [];
  const call = async (p: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    if (p === "/api/gpu/computer/text/claim") {
      claims.push(body);
      const job = line.shift();
      return job ? Response.json({ job: { system: "Be brief.", json: false, ...job } }) : new Response(null, { status: 204 });
    }
    const m = /^\/api\/gpu\/computer\/text\/([^/]+)$/.exec(p);
    if (m) {
      answers.push({ id: decodeURIComponent(m[1]), body });
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  };
  return { call, answers, claims };
}

const slots: InstanceType<typeof TextSlot>[] = [];
afterEach(async () => {
  for (const s of slots.splice(0)) await s.end();
});

function makeSlot(call: (p: string, init?: RequestInit) => Promise<Response>, o: { sha256?: string; clock?: { t: number } } = {}) {
  const slot = textSlotOf({ server: fakeFile, model: modelFile, sha256: o.sha256 ?? sha(MODEL), idleMin: 1 })!;
  const work = fs.mkdtempSync(path.join(dir, "work-"));
  const logs: string[] = [];
  const s = new TextSlot(slot, { call, log: (l: string) => logs.push(l), workDir: work, home: work, spawn: fakeSpawn, kill, env: { ...process.env, FUOBE_WORKER_TOKEN: "fuobe_wkr_secret" }, ...(o.clock && { now: () => o.clock!.t }) });
  slots.push(s);
  return { s, logs };
}

/** Tick until `done` says so (a second of the worker's loop is a few ms here). */
async function until(s: InstanceType<typeof TextSlot>, t: () => number, o: { may: boolean; room: "gpu" | "cpu" | null }, done: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out");
    s.tick(t(), o);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the text slot's parts", () => {
  it("reads worker.json's textSlot with defaults, and says what is missing", () => {
    expect(textSlotOf(undefined)).toBeNull();
    expect(textSlotOf({ model: "m", sha256: "a".repeat(64) })).toEqual({ problem: expect.stringContaining("server") });
    expect(textSlotOf({ server: "s", model: "m", sha256: "nope" })).toEqual({ problem: expect.stringContaining("sha256") });
    expect(textSlotOf({ server: "s", model: "m", sha256: "a".repeat(64), context: 999_999, threads: 0 })).toMatchObject({ context: 65_536, threads: 1, idleMin: 10, gpuMinFreeMb: 8000, cpu: true });
  });

  it("starts llama-server on 127.0.0.1 with its key, all layers on the GPU or none, never port 8188", () => {
    const slot = textSlotOf({ server: "s", model: "m.gguf", sha256: "a".repeat(64) })!;
    const gpu = serverArgs(slot, { port: 31000, key: "k", device: "gpu" });
    expect(gpu).toEqual(expect.arrayContaining(["--host", "127.0.0.1", "--port", "31000", "--api-key", "k", "--jinja", "--no-webui", "--alias", TEXT_MODEL]));
    expect(gpu[gpu.indexOf("-ngl") + 1]).toBe("99");
    const cpu = serverArgs(slot, { port: 31000, key: "k", device: "cpu" });
    expect(cpu[cpu.indexOf("-ngl") + 1]).toBe("0");
    expect(gpu.join(" ")).not.toContain("8188");
  });

  it("asks with thinking off and the card's sampling, JSON when the job asks; a job that isn't one is dropped", () => {
    const b = chatBody({ id: "j", lease: "l", system: "S", user: "U", maxTokens: 300, json: true });
    expect(b).toMatchObject({ max_tokens: 300, temperature: 1, top_p: 0.95, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_object" } });
    expect(b.messages).toEqual([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
    expect(jobOf({ job: { id: "j", lease: "l", system: "", user: "U", maxTokens: 10 } })).toMatchObject({ id: "j", json: false });
    expect(jobOf({ job: { id: "j", lease: "l", system: "", user: "U", maxTokens: 99_999 } })).toBeNull();
    expect(jobOf({ job: { id: "j", lease: "", system: "", user: "U", maxTokens: 10 } })).toBeNull();
    expect(jobOf(null)).toBeNull();
  });

  it("reads its CUDA buffers from its log (host memory doesn't count)", () => {
    expect(cudaMbOf("x CUDA0 model buffer size =  3577.50 MiB\ny CUDA0 KV buffer size = 120.00 MiB\nz CUDA_Host model buffer size = 2400.00 MiB\nw CUDA0 compute buffer size = 300.25 MiB")).toBe(3998);
    expect(cudaMbOf("nothing")).toBe(0);
  });

  it("hashes the model once for each size and change time", async () => {
    let reads = 0;
    const hash = async (f: string) => {
      reads++;
      return sha(fs.readFileSync(f));
    };
    const cache = path.join(dir, "checks.json");
    expect(await fileMatches(modelFile, sha(MODEL), cache, hash)).toBe(true);
    expect(await fileMatches(modelFile, sha(MODEL).toUpperCase(), cache, hash)).toBe(true);
    expect(reads).toBe(1);
    expect(await fileMatches(modelFile, "b".repeat(64), cache, hash)).toBe(false);
    expect(await fileMatches(path.join(dir, "missing.gguf"), sha(MODEL), cache, hash)).toBe(false);
  });

  it("its server's memory is the worker's own: no pause for another program", () => {
    const reading = { usedMb: 5200, tempC: 50, apps: [{ pid: 777, name: "llama-server.exe", usedMb: null }] };
    const own = { running: false, mb: 0, pid: null, port: null, job: false };
    expect(othersOf(reading, own, 1024).busy).toBe(true);
    expect(othersOf(reading, { ...own, extraPids: [777], extraMb: 4200 }, 1024)).toMatchObject({ busy: false, othersMb: 1000 });
    const MB = 2 ** 20;
    const counter = (pid: number, mb: number) => [`"\\\\PC\\GPU Process Memory(pid_${pid}_luid_0x00000000_0x0000D1B5_phys_0)\\Dedicated Usage"`, `"${(mb * MB).toFixed(6)}"`];
    const rows = [counter(777, 4300), counter(900, 2000)];
    const counters = parseCounters(["", `"(PDH-CSV 4.0)",${rows.map((r) => r[0]).join(",")}`, `"11/04/2026 09:00:00.000",${rows.map((r) => r[1]).join(",")}`, ""].join("\r\n"));
    const listing = { listeners: [{ port: 31337, pid: 900 }], names: { "900": "python", "777": "llama-server" } };
    const s = splitMemory({ usedMb: 7000, counters, listing, own: { pid: 900, port: 31337, running: true, mb: 100, extraPids: [777], extraMb: 4200 }, ports: [8188, 8199], baselineMb: 600 });
    expect(s).toMatchObject({ ownMb: 6300, othersMb: 100 });
  });
});

describe("the text slot", () => {
  it("answers a job on the GPU with its lease: thinking off, its own key, no worker token in its server's environment", async () => {
    const site = studio([{ id: "hlp_1", lease: "L1", user: "Write a chorus", maxTokens: 200 }]);
    const { s } = makeSlot(site.call);
    await until(s, Date.now, { may: true, room: "gpu" }, () => site.answers.length === 1);
    const a = site.answers[0];
    expect(a.id).toBe("hlp_1");
    expect(a.body.lease).toBe("L1");
    const said = JSON.parse(String(a.body.text));
    expect(said).toMatchObject({ ngl: "99", cuda: null, token: null, thinking: false, user: "Write a chorus", max: 200 });
    expect(said.host).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(site.claims[0]).toMatchObject({ model: TEXT_MODEL, device: "gpu" });
    expect(s.own().pids).toHaveLength(1);
    expect(s.own().mb).toBe(3698);
  });

  it("a GPU that isn't free: the next start runs on the CPU only, and an idle server stops", async () => {
    const clock = { t: Date.now() };
    const site = studio([
      { id: "hlp_a", lease: "La", user: "one", maxTokens: 50 },
      { id: "hlp_b", lease: "Lb", user: "two", maxTokens: 50 },
    ]);
    const { s, logs } = makeSlot(site.call, { clock });
    await until(s, () => clock.t, { may: true, room: "gpu" }, () => site.answers.length === 1);
    // The GPU is taken now: its server stops between jobs and starts again on the CPU.
    await until(s, () => clock.t, { may: true, room: "cpu" }, () => site.answers.length === 2);
    expect(JSON.parse(String(site.answers[1].body.text))).toMatchObject({ ngl: "0", cuda: "-1" });
    expect(s.own()).toEqual({ pids: [], mb: 0 });
    expect(started.slice(-2).map((x) => x.args[x.args.indexOf("-ngl") + 1])).toEqual(["99", "0"]);
    // Ten idle minutes: it stops.
    await until(s, () => clock.t, { may: true, room: "cpu" }, () => !s.busy);
    clock.t += 61_000;
    s.tick(clock.t, { may: true, room: "cpu" });
    expect(s.server).toBeNull();
    expect(logs.join("\n")).toContain("frees its memory");
  });

  it("paused: no claim, and its server stops; a model that doesn't match its SHA-256 keeps the slot off", async () => {
    const site = studio([{ id: "hlp_p", lease: "Lp", user: "x", maxTokens: 50 }]);
    const { s } = makeSlot(site.call);
    for (let i = 0; i < 5; i++) {
      s.tick(Date.now(), { may: false, room: "gpu" });
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(site.claims).toHaveLength(0);
    const bad = studio([{ id: "hlp_q", lease: "Lq", user: "x", maxTokens: 50 }]);
    const { s: off, logs } = makeSlot(bad.call, { sha256: "c".repeat(64) });
    for (let i = 0; i < 30 && off.ok === null; i++) {
      off.tick(Date.now(), { may: true, room: "gpu" });
      await new Promise((r) => setTimeout(r, 20));
    }
    off.tick(Date.now(), { may: true, room: "gpu" });
    expect(off.ok).toBe(false);
    expect(bad.claims).toHaveLength(0);
    expect(logs.join("\n")).toContain("SHA-256 doesn't match");
  });
});
