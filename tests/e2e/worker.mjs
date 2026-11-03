// Workers end to end: a studio on 3361 with a throwaway data folder, and `fuobe worker run` (bin/lib/worker) with its
// own stand-in ComfyUI on 3362 (tests/helpers/fake-local-comfy.ts, started and stopped by the worker itself) and a
// stand-in nvidia-smi. Nothing touches any other port, and no real GPU or ComfyUI is used.
//
//   pnpm build && node tests/e2e/worker.mjs
//   E2E_DEV=1 node tests/e2e/worker.mjs          (next dev instead of a build)
//
// Checks: the owner adds a worker, and it starts paused; resumed in both places with hours and a lane, it runs the
// owner's run to the end and cleans up its ComfyUI's history; another program on the GPU (per-process memory [N/A])
// pauses it and its ComfyUI is gone within 10 s; with the automatic resume off it stays paused, a resume by hand
// brings it back, and with it turned on from the website it comes back by itself after the cool-down;
// pause --now sends a running job back in line and stops its ComfyUI; a port another program holds is
// never used or connected to.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { root } from "./_browser.mjs";
import { tempDir, removeDir, stopProcess } from "./_temp.mjs";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3361);
const COMFY_PORT = Number(process.env.E2E_FAKE_PORT ?? 3362);
const SITE = `http://127.0.0.1:${APP_PORT}`;
const data = tempDir("fuobe-worker-e2e-");
const home = path.join(data, "worker-home");
const workDir = path.join(data, "worker-folder");
const smiState = path.join(data, "smi.json");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30_000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return null;
    await sleep(every);
  }
}
const smi = (s) => fs.writeFileSync(smiState, JSON.stringify(s));
const comfyUp = () => fetch(`http://127.0.0.1:${COMFY_PORT}/__fake/stats`).then((r) => r.ok, () => false);

const password = `e2e-${Math.random().toString(36).slice(2)}`;
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), process.env.E2E_DEV ? "dev" : "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, FUOBE_DATA_DIR: data, FUOBE_PASSWORD: password, COMFYUI_URL: "http://127.0.0.1:3399", ...(process.env.E2E_DEV ? {} : { NODE_ENV: "production" }) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let workerProc = null;
let workerLog = "";
function startWorker(steps = 4) {
  fs.mkdirSync(home, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8"));
  cfg.comfyCommand = [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(root, "tests/helpers/fake-local-comfy.ts"), "--port", "{port}", "--cors", "off", "--steps", String(steps), "--step-ms", "500", "--has", path.join(root, "workflows/comfyui/requirements.json")];
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(cfg));
  workerProc = spawn(process.execPath, [path.join(root, "bin/fuobe.mjs"), "worker", "run"], { env: { ...process.env, FUOBE_WORKER_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
  workerProc.stdout.on("data", (d) => (workerLog += d));
  workerProc.stderr.on("data", (d) => (workerLog += d));
}
async function stopWorker() {
  if (!workerProc) return;
  workerProc.kill();
  await until(() => workerProc.exitCode !== null || workerProc.signalCode, 10_000);
  workerProc = null;
  await until(async () => !(await comfyUp()), 15_000);
}
const cli = (...args) => new Promise((r) => spawn(process.execPath, [path.join(root, "bin/fuobe.mjs"), "worker", ...args], { env: { ...process.env, FUOBE_WORKER_HOME: home }, stdio: "ignore" }).once("exit", r));

async function finish() {
  await stopWorker().catch(() => {});
  await stopProcess(server);
  removeDir(data);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) console.log(`--- worker\n${workerLog.split("\n").slice(-40).join("\n")}\n--- studio\n${serverLog.split("\n").slice(-30).join("\n")}`);
  process.exit(failed.length ? 1 : 0);
}

try {
  if (!(await until(() => fetch(`${SITE}/api/auth/me`).then((r) => r.ok), 180_000, 500))) throw new Error(`the studio didn't start:\n${serverLog}`);
  const login = await fetch(`${SITE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const owner = async (url, init = {}) => {
    const r = await fetch(`${SITE}${url}`, { ...init, headers: { cookie, origin: SITE, "content-type": "application/json", ...(init.headers ?? {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // The owner adds a worker: paused, no hours, no lanes.
  const added = await owner("/api/admin/workers", { method: "POST", body: JSON.stringify({ name: "e2e-pc" }) });
  check("the owner adds a worker and sees its token once", added.status === 201 && added.body.token.startsWith("fuobe_wkr_"));
  const id = added.body.id;
  const view = async () => (await owner("/api/admin/workers")).body.workers.find((w) => w.id === id);
  check("a new worker starts paused on the website", (await view()).pausedServer === true);

  // This PC: set up (as `worker setup` writes it), paused here at first.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ site: SITE, token: added.body.token, comfyDir: workDir, workDir, modelDirs: [], port: COMFY_PORT, nvidiaSmi: [process.execPath, path.join(root, "tests/helpers/fake-nvidia-smi.mjs"), smiState], autoResume: false, resumeAfterMin: 0.1, busyVramMb: 1024 }));
  fs.writeFileSync(path.join(home, "control.json"), JSON.stringify({ paused: true }));
  smi({ usedMb: 300, tempC: 45, apps: [] });
  startWorker();
  const heard = await until(async () => (await view()).seenAt, 30_000);
  check("the worker beats, paused here, and doesn't start ComfyUI", !!heard && (await view()).words === "Paused here" && !(await comfyUp()), (await view()).words);

  // Resumed in both places, with hours and the "small" lane: its own ComfyUI starts.
  await owner(`/api/admin/workers/${id}`, { method: "PATCH", body: JSON.stringify({ paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } }) });
  await owner("/api/settings", { method: "PUT", body: JSON.stringify({ comfyWhere: "workers" }) });
  await cli("resume");
  check("resumed in both places, it starts its own ComfyUI", !!(await until(comfyUp, 30_000)));
  check("its state says Ready", !!(await until(async () => (await view()).words === "Ready", 30_000)), (await view()).words);
  check("it sent its files: the studio knows what it can run", !!(await until(async () => (await view()).lanes, 20_000)));

  // A run of the owner's goes to the worker.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "in.png");
  const up = await fetch(`${SITE}/api/uploads`, { method: "POST", headers: { cookie, origin: SITE }, body: form }).then((r) => r.json());
  const run = async (prompt) => {
    const r = await owner("/api/generations", { method: "POST", body: JSON.stringify({ feature: "selftest", modelId: "oss-selftest-image", op: "edit", prompt, inputs: { images: [up.url] } }) });
    return r.body?.items?.[0]?.id;
  };
  const gid = await run("worker run one");
  const done = await until(async () => {
    const g = (await owner(`/api/generations/${gid}`)).body;
    return ["succeeded", "failed", "canceled"].includes(g?.status) ? g : null;
  }, 90_000, 1000);
  check("the owner's run finishes on the worker", done?.status === "succeeded", done ? `${done.status} ${done.error ?? ""}` : `timed out; upload ${JSON.stringify(up).slice(0, 120)}`);
  const stats = await until(async () => {
    const s = await fetch(`http://127.0.0.1:${COMFY_PORT}/__fake/stats`).then((r) => r.json());
    return s.posts >= 1 && s.history === 0 ? s : null;
  }, 15_000);
  check("after the job, its history entry is gone from the worker's ComfyUI", !!stats, JSON.stringify(stats));
  check("the worker's input and output folders are empty", ["input", "output", "temp"].every((d) => !fs.existsSync(path.join(workDir, d)) || fs.readdirSync(path.join(workDir, d)).length === 0));

  // Another program takes the GPU ([N/A] per process, as on Windows): it pauses, and its ComfyUI is gone within 10 s.
  smi({ usedMb: 6000, tempC: 60, apps: [{ pid: 999999, name: "blender.exe", usedMb: null }] });
  const t0 = Date.now();
  const gone = await until(async () => !(await comfyUp()), 15_000);
  check("another program on the GPU: its ComfyUI is stopped within 10 s", !!gone && Date.now() - t0 <= 10_000 + 1000, `${Date.now() - t0} ms`);
  check("the website says why", !!(await until(async () => /busy/.test((await view()).words), 15_000)), (await view()).words);
  smi({ usedMb: 300, tempC: 45, apps: [] });
  await sleep(12_000);
  check("with the automatic resume off, it stays paused when the GPU is free again", !(await comfyUp()) && /busy/.test((await view()).words), (await view()).words);
  await cli("resume");
  check("a resume by hand brings it back", !!(await until(comfyUp, 30_000)));

  // The owner turns the automatic resume on in Settings → Workers (a 6 s cool-down in this worker.json): busy, then free,
  // and it comes back by itself.
  await owner(`/api/admin/workers/${id}`, { method: "PATCH", body: JSON.stringify({ autoResume: true }) });
  check("the website shows the automatic resume on", (await view()).autoResume === true);
  await sleep(7_000); // one beat carries it to the worker
  smi({ usedMb: 6000, tempC: 60, apps: [{ pid: 999999, name: "blender.exe", usedMb: null }] });
  check("with it on, a busy GPU still stops its ComfyUI", !!(await until(async () => !(await comfyUp()), 15_000)));
  smi({ usedMb: 300, tempC: 45, apps: [] });
  const t2 = Date.now();
  const back2 = await until(comfyUp, 45_000);
  check("after the cool-down it resumes by itself", !!back2 && Date.now() - t2 >= 6_000, `${Date.now() - t2} ms`);
  await owner(`/api/admin/workers/${id}`, { method: "PATCH", body: JSON.stringify({ autoResume: null }) });

  // pause --now: a running job goes back in line and its ComfyUI stops within 30 s.
  await stopWorker();
  startWorker(60);
  await until(comfyUp, 30_000);
  await until(async () => (await view()).words === "Ready", 30_000);
  const long = await run("worker run two");
  const running = await until(async () => (await view()).current, 30_000);
  check("a long run starts on the worker", !!running);
  await cli("pause", "--now");
  const t1 = Date.now();
  check("pause --now: its ComfyUI is gone within 30 s", !!(await until(async () => !(await comfyUp()), 30_000)) && Date.now() - t1 <= 30_000, `${Date.now() - t1} ms`);
  const back = await until(async () => {
    const q = (await owner("/api/admin/queue")).body;
    const g = (await owner(`/api/generations/${long}`)).body;
    return q?.lanes?.some((l) => l.waiting >= 1) && !["failed", "canceled"].includes(g?.status) ? q : null;
  }, 20_000);
  check("pause --now: the job is back in line, not failed", !!back, JSON.stringify(back)?.slice(0, 160));
  await owner(`/api/generations/${long}/cancel`, { method: "POST" }).catch(() => {});

  // Another program holds the worker's port: it never starts ComfyUI there, and never connects to it.
  await stopWorker();
  let connections = 0;
  const squatter = net.createServer((s) => {
    connections++;
    s.destroy();
  });
  await new Promise((r) => squatter.listen(COMFY_PORT, "127.0.0.1", r));
  await cli("resume");
  startWorker();
  const refused = await until(() => /won't start ComfyUI there/.test(workerLog), 30_000);
  await sleep(3000);
  check("a port another program holds: the worker refuses it and never connects to it", !!refused && connections === 0, `connections ${connections}`);
  check("the website says its port is taken", !!(await until(async () => /port/.test((await view()).words), 15_000)), (await view()).words);
  await stopWorker();
  squatter.close();
} catch (e) {
  check("the run", false, String(e?.stack ?? e));
}
await finish();
