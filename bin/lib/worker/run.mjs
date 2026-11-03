// `fuobe worker run`: the worker's loop (docs/gpu-workers.md). It beats to the studio, keeps its own ComfyUI running
// only while it may work, takes one job at a time with the same runner the browser uses, checks each graph itself,
// cleans up after each job, and pauses itself when another program uses the GPU.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedNodes, cleanJob, emptyFolders, graphCheck, inputRules } from "./checks.mjs";
import { folders, OwnComfy, PortBusy } from "./comfy.mjs";
import { PROTOCOL, readControl, writeControl, writeStatus } from "./config.mjs";
import { GpuWatch, othersOf, readGpu } from "./gpu.mjs";
import { inventoryHash, modelFiles, packFolders } from "./inventory.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");

export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** The studio's catalog, as this worker build has it. */
export function loadRequirements(file = path.join(ROOT, "workflows/comfyui/requirements.json")) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The worker's local pause, from its switch (`worker pause`), the GPU, and its ComfyUI: { paused, why, until }.
 * A pause by hand ("here", "here-until:<ms>", "here-now") always wins over the GPU's.
 */
export function localPause(control, gpu, comfyTrouble, now) {
  if (control.paused && control.until && now >= control.until) return null; // its --for ran out: the caller clears it
  if (control.paused) return { paused: true, why: control.now ? "here-now" : control.until ? `here-until:${control.until}` : "here", until: control.until ?? null };
  if (gpu.paused) return { paused: true, why: `gpu-busy:${gpu.who ?? "another program"}`, until: null };
  if (comfyTrouble) return { paused: true, why: comfyTrouble, until: null };
  return { paused: false, why: null, until: null };
}

/**
 * Run until `signal` aborts. `deps`: { fetch, now, sleep, readGpu, log, home, requirements, ComputerRunner, rules, pins }
 * (rules and pins: the built input rules and file hashes, read from dist/ when not given).
 */
export async function runWorker(cfg, deps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`));
  const fetchFn = deps.fetch ?? fetch;
  const index = deps.requirements ?? loadRequirements();
  const { ComputerRunner } = deps.ComputerRunner ? { ComputerRunner: deps.ComputerRunner } : await import("./dist/computer-runner.mjs");
  const site = cfg.site.replace(/\/+$/, "");
  const f = folders(cfg.workDir);
  fs.mkdirSync(cfg.workDir, { recursive: true });
  emptyFolders(f);
  const allowed = allowedNodes(cfg.allowNodesFile);
  const rules = deps.rules ?? inputRules();
  const comfy = new OwnComfy(cfg, { now, fetch: fetchFn, folderNames: index.folders ?? [] });
  const gpu = new GpuWatch({ autoResume: !!cfg.autoResume, resumeAfterMs: (cfg.resumeAfterMin ?? 10) * 60_000, resumeBelowC: cfg.resumeBelowC ?? 75 });
  let comfyTrouble = null;
  let troubleAt = 0;
  let answer = null;
  let inv = { files: [], nodePacks: [] };
  let packs = [];
  let invHash = null;
  let gpuInfo = { otherApps: [], tempC: null };
  let lastGpuAt = 0;
  let pause = { paused: true, why: "here", until: null };
  let busyJob = false;
  comfy.onCrash = (code) => log(`ComfyUI stopped (exit ${code}).`);

  const api = (p, init = {}) => fetchFn(`${site}${p}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${cfg.token}`, "User-Agent": `FuobeWorker/${VERSION}` } });

  async function scan() {
    packs = packFolders(cfg.comfyDir, index);
    inv = { files: await modelFiles(cfg.modelDirs ?? [], index, path.join(cfg.workDir, "hash-cache.json"), deps.pins), nodePacks: packs.map(({ name, commit }) => ({ name, commit })) };
    invHash = inventoryHash(inv);
  }
  await scan();

  const runner = new ComputerRunner(
    {
      api,
      // Only its own ComfyUI, and only while the process it started is up: never whatever else listens on that port.
      local: (url, init) => (comfy.alive() && comfy.ready ? fetchFn(url, init) : Promise.reject(new Error("Its own ComfyUI isn't running"))),
      sha256: async (data) => crypto.createHash("sha256").update(Buffer.from(data)).digest("hex"),
      origin: site,
      socket: typeof WebSocket === "function" ? (url) => new WebSocket(url) : undefined,
      now,
      sleep,
      vet: (t) => {
        const problem = graphCheck(t.graph, allowed, inv.files, { rules, staged: (t.inputs ?? []).map((i) => i.name) });
        // Which node and input, for the PC's owner (never a value: those are someone's prompt or file).
        if (problem) log(`Refused job ${t.id}: ${problem.reason} at node ${problem.node}${problem.cls ? ` (${problem.cls}${problem.input ? `.${problem.input}` : ""})` : ""}.`);
        return problem?.reason ?? null;
      },
      ended: (t, phase) => {
        log(`Job ${t.id} ${phase}.`);
        return cleanJob(t, f, comfy.base, fetchFn);
      },
      beatExtra: () => ({
        protocol: PROTOCOL,
        version: VERSION,
        local: pause,
        gpu: gpuInfo,
        inventoryHash: invHash,
        warmLane: null,
      }),
      onBeat: (a) => {
        answer = a;
        // The owner's switch on the Workers page wins over worker.json; null leaves worker.json's.
        const site = a?.worker?.autoResume;
        gpu.o.autoResume = typeof site === "boolean" ? site : !!cfg.autoResume;
      },
    },
    { device: "worker", port: cfg.port, clientId: crypto.randomBytes(8).toString("hex") },
  );

  const mayWork = () => !pause.paused && answer?.worker && !answer.worker.paused && answer.worker.insideHours && !answer.worker.drain;
  const state = () => (pause.paused ? `Paused here (${pause.why})` : !answer ? "Connecting" : answer.worker?.paused ? "Paused on the website" : !answer.worker?.insideHours ? "Outside its hours" : answer.worker?.drain ? "Finishing, then pausing" : comfy.ready ? "Ready" : "Starting ComfyUI");

  let beatAt = 0;
  let lastState = "";
  while (!deps.signal?.aborted) {
    const t = now();
    // Its own switch, and --for running out.
    let control = readControl(deps.home);
    if (control.paused && control.until && t >= control.until) {
      writeControl(deps.home, { paused: false });
      control = { paused: false };
      gpu.clear();
      log("The pause ran out: back to work.");
    }
    if (control.resumedAt && control.resumedAt > (gpu.clearedAt ?? 0)) {
      gpu.clear();
      gpu.clearedAt = control.resumedAt;
    }
    // The GPU, every 5 s, from nvidia-smi only.
    if (t - lastGpuAt >= 5000) {
      lastGpuAt = t;
      const reading = await (deps.readGpu ?? readGpu)(cfg.nvidiaSmi);
      if (reading) {
        const verdict = othersOf(reading, { running: comfy.alive(), mb: await comfy.vramMb(), pid: comfy.pid }, cfg.busyVramMb ?? 1024);
        const was = gpu.paused;
        gpu.update(verdict, reading.tempC, t);
        gpuInfo = { otherApps: reading.apps.filter((a) => a.pid !== comfy.pid).map((a) => ({ pid: a.pid, name: a.name, vramBytes: (a.usedMb ?? 0) * 2 ** 20 })), tempC: reading.tempC };
        if (!was && gpu.paused) log(`Another program is using the GPU (${gpu.who}): pausing.`);
        if (was && !gpu.paused) log("The GPU stayed free for the whole cool-down: resuming.");
      }
    }
    if (comfyTrouble === "comfy-crashes" && !comfy.crashedTooOften(t)) comfyTrouble = null;
    const next = localPause(control, gpu, comfyTrouble, t) ?? { paused: false, why: null, until: null };
    const changed = next.paused !== pause.paused || next.why !== pause.why;
    pause = next;
    // A new pause, or every 5 s while busy and 10 s otherwise: beat.
    if (changed || t - beatAt >= (busyJob ? 5000 : 10_000)) {
      beatAt = t;
      try {
        const a = await runner.beat();
        if (runner.view.stopped) {
          log(runner.view.stopped === "signed-out" ? "The studio doesn't know this worker's token. Run fuobe worker setup again." : "The studio stopped this worker.");
          break;
        }
        if (a?.worker?.sendInventory) {
          await scan();
          const r = await api("/api/gpu/computer/inventory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inv) });
          if (r.ok) {
            const body = await r.json();
            log(`Sent its files: it can run ${body.workflows?.length ?? 0} of the studio's workflows.`);
          }
        }
      } catch (e) {
        log(`Can't reach the studio: ${e.message}`);
      }
    }
    // Its own ComfyUI runs only while it may work; a pause (and a stop-now) frees the GPU.
    const stopNow = pause.paused && (pause.why === "here-now" || pause.why?.startsWith("gpu-busy")) || answer?.worker?.pauseNow;
    if (mayWork()) {
      if (!comfy.alive() && !comfyTrouble) {
        if (comfy.crashedTooOften(t)) {
          comfyTrouble = "comfy-crashes";
          log("ComfyUI keeps stopping: pausing for an hour.");
        } else {
          try {
            log("Starting its own ComfyUI.");
            // The packs by their folder names on disk, which is what ComfyUI matches (whatever the catalog's case).
            await comfy.start(packs.map((p) => p.folder));
          } catch (e) {
            if (e instanceof PortBusy) {
              comfyTrouble = "port-busy";
              troubleAt = t;
              log(`${e.message}: it won't start ComfyUI there, and won't connect to it.`);
            } else log(`ComfyUI didn't start: ${e.message}`);
          }
        }
      }
      if (comfy.ready && answer?.runner && !busyJob) {
        busyJob = true;
        void runner
          .claimAndRun()
          .catch((e) => log(`A job stopped: ${e.message}`))
          .finally(() => (busyJob = false));
      }
    } else if (comfy.alive() && (stopNow || !busyJob)) {
      log("Stopping its own ComfyUI (paused).");
      await comfy.stop();
    }
    // A taken port is tried again (a bind test, never a connection) once a minute.
    if (comfyTrouble === "port-busy" && t - troubleAt >= 60_000) comfyTrouble = null;
    const s = state();
    if (s !== lastState) {
      lastState = s;
      log(s);
    }
    writeStatus(deps.home, { state: s, pause, at: t, comfy: comfy.alive() ? comfy.pid : null, answer: answer?.worker ?? null });
    await sleep(1000);
  }
  runner.stop();
  await comfy.stop();
}
