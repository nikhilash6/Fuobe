// `fuobe worker run`: the worker's loop (docs/gpu-workers.md). It beats to the studio, keeps its own ComfyUI running
// only while it may work, takes one job at a time with the same runner the browser uses, checks each graph itself,
// cleans up after each job, and pauses itself when another program uses the GPU.
//
// It also keeps jobs going through trouble: finished results stay on its disk until the studio has them (hold.mjs), so a
// stop before the upload never runs a job twice; every call to the studio follows one retry policy (retry.mjs); a job
// that stalls or runs past its run limit goes back to the line and a stuck ComfyUI is started again; a ComfyUI that ran
// out of memory is freed and the job sent once more; a job its ComfyUI stopped on twice fails, not the worker; inputs are
// read from the studio once and every clip and sound is made again by ffmpeg (media.mjs); the PC stays awake while it
// holds a job or waits for one (awake.mjs); and it looks at its model folders again every 10 minutes.
//
// Studio jobs first (turns.mjs, local-work.mjs): with a turns folder set, local ComfyUI work on the PC is told apart
// from other programs. Another program still pauses the worker as before. Local ComfyUI work instead gets a request for
// a turn, and the worker waits for the answer with its jobs kept in their place.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StayAwake } from "./awake.mjs";
import { allowedNodes, cleanJob, emptyFolders, graphCheck, inputRules } from "./checks.mjs";
import { folders, GuardMissing, OwnComfy, PortBusy } from "./comfy.mjs";
import { ffmpegOf, PROTOCOL, readControl, writeControl, writeStatus } from "./config.mjs";
import { GpuWatch, othersOf, readGpu } from "./gpu.mjs";
import { Hold } from "./hold.mjs";
import { inventoryHash, modelFiles, packFolders } from "./inventory.mjs";
import { readCounters, readListeners, readLock, splitMemory, unknownHolder } from "./local-work.mjs";
import { takeLock, workerLives } from "./lock.mjs";
import { ffmpegVersion, fileSize, mediaKind, outputCap, reencode } from "./media.mjs";
import { retrying } from "./retry.mjs";
import { SiteTurns, writeSite } from "./turns.mjs";

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

const HOUR = 3_600_000;

/** The worker looks at its model folders again this often (a folder that comes back after a restart counts). */
export const RESCAN_MS = 10 * 60_000;

/** Kept results that the studio hasn't taken for this long are deleted (the studio drops its jobs after a day). */
export const HOLD_MAX_AGE_MS = 24 * HOUR;

/**
 * While it may not work, it asks for the job of its kept results at most this often after the studio said it has none
 * for it (the job may still come back to it once it may work again, so the results stay).
 */
export const HELD_RETRY_MS = 60_000;

/** The port an older setup saved for every worker; a worker.json that still pins it gets a free port at each start. */
export const OLD_SETUP_PORT = 8190;

/** The settings as the worker uses them: a port that an older setup saved (8190) is no pin (the same object otherwise). */
export const withoutOldPort = (cfg) => (Number(cfg?.port) === OLD_SETUP_PORT ? { ...cfg, port: null } : cfg);

/** An address on a private network: 10.x, 172.16.x to 172.31.x, 192.168.x, or IPv6 fc00::/7. */
export function privateHost(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return m.slice(1).every((x) => Number(x) <= 255) && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  return /^f[cd][0-9a-f]{0,2}:/i.test(h);
}

/** The studio's address uses http (allowed only on this PC, or on a private network with allowHttpSite). */
export const plainHttp = (site) => {
  try {
    return new URL(String(site)).protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * Why the studio's address won't do, or null: it must be https, so the token and people's files never cross the
 * network in the clear. This PC itself (127.0.0.1, localhost) may use http, for tests. An address on a private network
 * may use http only when worker.json says `allowHttpSite: true` (`o` is the settings).
 */
export function siteProblem(site, o = {}) {
  let u;
  try {
    u = new URL(String(site));
  } catch {
    return "That isn't a web address.";
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
  if (u.protocol === "http:" && privateHost(u.hostname)) {
    return o?.allowHttpSite === true ? null : "The studio's address must start with https://. For an http:// address on your own network, set allowHttpSite to true in worker.json.";
  }
  return "The studio's address must start with https://.";
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

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const arrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * What the beat says for studio jobs first: { claimable }, the beat's claimableNow (people's jobs this worker may take
 * now). It is null when the studio doesn't say, and then local ComfyUI work counts as another program, as before.
 */
export function siteOf(answer) {
  return { claimable: count(answer?.claimableNow) };
}

/**
 * Run until `signal` aborts or the studio stops it. Returns why it ended: "aborted" (Ctrl+C, the scheduled task's end),
 * "signed-out" (the studio doesn't know its token) or "disconnected". `deps`: { fetch, now, sleep, readGpu, log, home,
 * signal, requirements, ComputerRunner, rules, pins, allowed, ffmpegVersion, reencode, awake, rescanMs, comfy (OwnComfy's own
 * options), readCounters, readListeners, gpuEveryMs }.
 */
export async function runWorker(saved, deps) {
  // One worker at a time on a worker folder: a second one would stop the first one's ComfyUI, empty its folders and
  // take its job. It refuses to start instead (WorkerRunning), before it touches anything.
  fs.mkdirSync(saved.workDir, { recursive: true });
  const lock = await takeLock(saved.workDir, { commandLineOf: deps.comfy?.commandLineOf });
  try {
    return await work(saved, deps, lock.owner);
  } finally {
    lock.release();
  }
}

/** The worker's loop, with the worker folder's lock held (`owner`: { pid, id, script }, the lock's). */
async function work(saved, deps, owner) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`));
  const cfg = withoutOldPort(saved);
  if (cfg !== saved) log(`worker.json pins port ${OLD_SETUP_PORT}, from an older setup: its ComfyUI takes a free port at each start instead. Run fuobe worker setup again to save the new settings.`);
  const fetchFn = deps.fetch ?? fetch;
  const problem = siteProblem(cfg.site, cfg);
  if (problem) throw new Error(problem);
  if (cfg.allowHttpSite === true && plainHttp(cfg.site) && privateHost(new URL(cfg.site).hostname)) {
    log("The studio's address uses http:// (allowHttpSite): its token and people's files cross your network unencrypted.");
  }
  const index = deps.requirements ?? loadRequirements();
  const { ComputerRunner } = deps.ComputerRunner ? { ComputerRunner: deps.ComputerRunner } : await import("./dist/computer-runner.mjs");
  const site = cfg.site.replace(/\/+$/, "");
  const f = folders(cfg.workDir);
  fs.mkdirSync(cfg.workDir, { recursive: true });
  emptyFolders(f);
  // Inputs kept by their SHA-256 while their job runs here (a job sent again reads nothing from the studio twice).
  const cacheDir = path.join(cfg.workDir, "cache");
  const emptyCache = () => fs.rmSync(cacheDir, { recursive: true, force: true });
  emptyCache();
  const hold = new Hold(path.join(cfg.workDir, "hold"));
  const allowed = deps.allowed ?? allowedNodes(cfg.allowNodesFile);
  const rules = deps.rules ?? inputRules();
  const comfy = new OwnComfy(cfg, { now, fetch: fetchFn, folderNames: index.folders ?? [], log, owner, workerLives: (rec) => workerLives(rec, { commandLineOf: deps.comfy?.commandLineOf }), ...deps.comfy });
  // Only its own ComfyUI, and only while the process it started is up and ready: never whatever listens on that port.
  const own = (url, init) => (comfy.alive() && comfy.ready ? comfy.fetch(url, init) : Promise.reject(new Error("Its own ComfyUI isn't running")));
  // A ComfyUI that a stopped worker left running is stopped now, before anything else uses the GPU.
  await comfy.stopLeftover();
  // Studio jobs first: only with a turns folder set in worker.json. Without one, every program counts the same, as before.
  const turns = cfg.yieldFolder
    ? new SiteTurns({
        folder: cfg.yieldFolder,
        stateFile: path.join(deps.home ?? cfg.workDir, "turns.json"),
        maxHoursPerDay: cfg.yieldMaxHoursPerDay,
        interruptGapMin: cfg.interruptGapMin,
        neverInterrupt: !!cfg.neverInterrupt,
        graceMs: deps.turnGraceMs,
      })
    : null;
  if (turns && !turns.folderOk()) log(`The turns folder ${cfg.yieldFolder} isn't there: local ComfyUI work counts as another program until it is.`);
  const busyMb = cfg.busyVramMb ?? 1024;
  // Two busy readings in a row pause it when it tells programs apart (a reading can catch memory on its way).
  const gpu = new GpuWatch({ autoResume: !!cfg.autoResume, resumeAfterMs: (cfg.resumeAfterMin ?? 10) * 60_000, resumeBelowC: cfg.resumeBelowC ?? 75, busyReadings: turns ? 2 : 1 });
  const awake = deps.awake ?? new StayAwake({ now, log });
  // ffmpeg: worker.json's, or the PATH's when worker.json names none (an older setup's never did).
  const ffmpegBin = ffmpegOf(cfg);
  const ffmpeg = ffmpegBin ? await (deps.ffmpegVersion ?? ffmpegVersion)(ffmpegBin) : null;
  log(
    ffmpeg
      ? `ffmpeg is there${cfg.ffmpeg === undefined ? " (on the PATH)" : ""}: it takes clips and sound, and makes each one again first.`
      : ffmpegBin
        ? `No working ffmpeg at ${ffmpegBin}: it takes pictures only. Set ffmpeg in worker.json (its full path), or run fuobe worker setup again.`
        : "No ffmpeg (ffmpeg in worker.json): it takes pictures only.",
  );
  let comfyTrouble = null;
  let troubleAt = 0;
  let answer = null;
  let inv = { files: [], nodePacks: [], media: ffmpeg ? ["image", "video", "audio"] : ["image"] };
  let packs = [];
  let invHash = null;
  let gpuInfo = { otherApps: [], tempC: null };
  let lastGpuAt = 0;
  let pause = { paused: true, why: "here", until: null };
  let busyJob = false;
  let job = Promise.resolve();
  let lastTask = null;
  let heldRetryAt = 0;
  let holdCheckedAt = -Infinity;
  // Its ComfyUI's start, while it goes on (beats go on meanwhile), and the signal that ends a start when the worker stops.
  let starting = null;
  const stopStarts = new AbortController();
  deps.signal?.addEventListener("abort", () => stopStarts.abort(), { once: true });
  let guardMissingAt = -Infinity;
  // Studio jobs first: the last port table, the last split of the GPU's memory, and the last turn step.
  let listing = null;
  let listedAt = -Infinity;
  let split = null;
  let turn = { siteWaiting: 0, oldestWaitS: 0, interrupt: false, interruptAt: null, waitForYield: false, late: false, startsAt: null, ended: null };
  let siteWritten = "";
  let siteAt = 0;
  let siteFailed = false;
  const writeTurn = (t, body) => {
    const key = JSON.stringify([body.siteWaiting, body.interruptAt]);
    siteWritten = key;
    siteAt = t;
    try {
      writeSite(cfg.yieldFolder, { ...body, at: t });
      siteFailed = false;
    } catch (e) {
      if (!siteFailed) log(`Couldn't write to the turns folder: ${e.message}`);
      siteFailed = true;
    }
  };

  // How often its ComfyUI stopped while running each task (a task that stops it twice fails, not the worker).
  const crashFile = path.join(cfg.workDir, "crashes.json");
  const crashes = (() => {
    try {
      const c = JSON.parse(fs.readFileSync(crashFile, "utf8"));
      return c && typeof c === "object" ? c : {};
    } catch {
      return {};
    }
  })();
  const saveCrashes = () => {
    try {
      fs.writeFileSync(crashFile, JSON.stringify(crashes), { mode: 0o600 });
    } catch {}
  };
  comfy.onCrash = (code, task) => {
    log(`ComfyUI stopped (exit ${code}).`);
    if (!task) return;
    crashes[task] = (crashes[task] ?? 0) + 1;
    saveCrashes();
  };

  const api = retrying(fetchFn, { now, sleep, signal: deps.signal, log });
  const call = (p, init = {}) => api(`${site}${p}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${cfg.token}`, "User-Agent": `FuobeWorker/${VERSION}` } });

  async function scan() {
    packs = packFolders(cfg.comfyDir, index);
    inv = { files: await modelFiles(cfg.modelDirs ?? [], index, path.join(cfg.workDir, "hash-cache.json"), deps.pins, { comfyDir: cfg.comfyDir }), nodePacks: packs.map(({ name, commit }) => ({ name, commit })), media: inv.media };
    invHash = inventoryHash(inv);
  }
  // One look at a time; the next beat carries a changed hash, and the studio then asks for the list.
  let scanning = null;
  let scannedAt = now();
  const rescan = () =>
    (scanning ??= scan()
      .catch((e) => log(`Couldn't look at its model folders: ${e.message}`))
      .finally(() => {
        scanning = null;
        scannedAt = now();
      }));
  await scan();

  /** An input for its ComfyUI: read from the studio once, kept by its SHA-256, and a clip or sound made again. */
  async function takeInput(t, input, read) {
    if (!/^[0-9a-f]{64}$/.test(String(input.sha256))) return "input-changed";
    fs.mkdirSync(cacheDir, { recursive: true });
    const kept = path.join(cacheDir, input.sha256);
    let data = null;
    if (fs.existsSync(kept)) {
      const b = fs.readFileSync(kept);
      if (sha256(b) === input.sha256) data = b;
    }
    if (!data) {
      const got = await read();
      if (typeof got === "string") return got;
      data = Buffer.from(got);
      fs.writeFileSync(kept, data, { mode: 0o600 });
    }
    const kind = mediaKind(input, t.graph);
    if (!kind) return arrayBuffer(data);
    // Without ffmpeg it takes no clip or sound: another worker that can make them again runs the job.
    if (!ffmpeg) return "give-back";
    const made = path.join(cacheDir, `${input.sha256}.${kind}`);
    const cap = outputCap(data.length);
    if (!fs.existsSync(made)) {
      const part = `${made}.part`;
      if (!(await (deps.reencode ?? reencode)({ ffmpeg: ffmpegBin, kind, name: input.name, src: kept, dst: part, capBytes: cap }))) {
        fs.rmSync(part, { force: true });
        log(`Job ${t.id}: ffmpeg couldn't make one of its ${kind === "video" ? "clips" : "sounds"} again (unreadable, or over ${Math.round(cap / 2 ** 20)} MB).`);
        return "input-unreadable";
      }
      fs.renameSync(part, made);
    }
    // Never more than the cap into memory.
    if (fileSize(made) >= cap) {
      fs.rmSync(made, { force: true });
      return "input-unreadable";
    }
    return arrayBuffer(fs.readFileSync(made));
  }

  const runner = new ComputerRunner(
    {
      api: call,
      local: own,
      sha256: async (data) => sha256(Buffer.from(data)),
      origin: site,
      socket: typeof WebSocket === "function" ? (url) => (comfy.ready ? new WebSocket(comfy.rebase(url), { headers: comfy.headers() }) : null) : undefined,
      now,
      sleep,
      vet: async (t) => {
        const check = () => graphCheck(t.graph, allowed, inv.files, { rules, staged: (t.inputs ?? []).map((i) => i.name) });
        let problem = check();
        // A model file it doesn't have yet (a drive that came back after a restart): look again once before refusing.
        if (problem?.reason === "model-unverified") {
          log(`Job ${t.id} needs a model file it hasn't found: looking at its model folders again.`);
          await rescan();
          problem = check();
        }
        // Which node and input, for the PC's owner (never a value: those are someone's prompt or file).
        if (problem) log(`Refused job ${t.id}: ${problem.reason} at node ${problem.node}${problem.cls ? ` (${problem.cls}${problem.input ? `.${problem.input}` : ""})` : ""}.`);
        return problem?.reason ?? null;
      },
      ended: async (t, phase) => {
        log(`Job ${t.id} ${phase}.`);
        // Done: the studio has every result. Otherwise its kept results wait for the next claim to say whose job it is,
        // after a while (so a studio that won't take them now doesn't keep its ComfyUI from starting).
        if (phase === "done") hold.drop(t.id);
        else if (hold.has(t.id)) heldRetryAt = now() + HELD_RETRY_MS;
        delete crashes[t.id];
        saveCrashes();
        await cleanJob(f, comfy.base, own);
        emptyCache();
      },
      beatExtra: () => ({
        protocol: PROTOCOL,
        version: VERSION,
        local: pause,
        gpu: gpuInfo,
        inventoryHash: invHash,
        warmLane: null,
        // The jobs whose results it keeps: a pause doesn't send them back in line, so they go up instead of running again.
        held: hold.ids().slice(0, 16),
      }),
      onBeat: (a) => {
        // A studio that takes jobs only from a newer worker program: say so once (it sends this worker none).
        const min = Number(a?.worker?.minProtocol);
        if (min > PROTOCOL && answer?.worker?.minProtocol !== a.worker.minProtocol) log("The studio needs a newer worker program: it sends this one no jobs. Update the worker (docs/gpu-workers.md, \"Install and update\").");
        answer = a;
        // The owner's switch on the Workers page wins over worker.json; null leaves worker.json's.
        const s = a?.worker?.autoResume;
        gpu.o.autoResume = typeof s === "boolean" ? s : !!cfg.autoResume;
      },
      worker: {
        hold,
        input: takeInput,
        // The studio's stall limit comes with each job; a stallMin in worker.json wins over it on this PC.
        stallMs: 10 * 60_000,
        stallLocalMs: Number(cfg.stallMin) > 0 ? Number(cfg.stallMin) * 60_000 : null,
        free: () => comfy.free(),
        crashes: (t) => crashes[t.id] ?? 0,
        stuck: async () => {
          log("Its ComfyUI didn't let go of a job: starting it again.");
          await comfy.stop();
        },
        claimed: async (t, o = {}) => {
          if (!t) {
            // No job for it now. Its kept results stay (their job may come back to it); while it may not work it asks
            // again for them only after a while. Its copies of inputs go.
            if (o.onlyHeld) heldRetryAt = now() + HELD_RETRY_MS;
            emptyCache();
            return;
          }
          // Another job, given to a worker that may work: the kept results of any other job aren't this worker's any
          // more (one job at a time).
          if (!o.onlyHeld) hold.dropAllBut(t.id);
          else if (!hold.has(t.id)) heldRetryAt = now() + HELD_RETRY_MS;
          comfy.task = t.id;
          // Another job than the one its ComfyUI last had: nothing of that one stays, in its ComfyUI or in the inputs.
          if (t.id !== lastTask) {
            await cleanJob(f, comfy.base, own);
            emptyCache();
            lastTask = t.id;
          }
        },
      },
    },
    { device: "worker", port: cfg.port || 8190, clientId: crypto.randomBytes(8).toString("hex") },
  );

  const mayWork = () => !pause.paused && answer?.worker && !answer.worker.paused && answer.worker.insideHours && !answer.worker.drain;
  const state = () =>
    pause.paused
      ? `Paused here (${pause.why})`
      : !answer
        ? "Connecting"
        : answer.worker?.paused
          ? "Paused on the website"
          : !answer.worker?.insideHours
            ? "Outside its hours"
            : answer.worker?.drain
              ? "Finishing, then pausing"
              : turn.waitForYield
                ? "Waiting for local ComfyUI work to make room (its jobs keep their place)"
                : comfy.ready
                  ? "Ready"
                  : "Starting ComfyUI";
  // A job that runs on its ComfyUI (not only sending kept results, which needs no GPU).
  let jobUsesGpu = false;
  const take = (o) => {
    busyJob = true;
    jobUsesGpu = !o?.onlyHeld;
    job = runner
      .claimAndRun(o)
      .catch((e) => log(`A job stopped: ${e.message}`))
      .finally(() => {
        busyJob = false;
        jobUsesGpu = false;
        comfy.task = null;
      });
  };

  /** Turns work now: the folder is there, the studio said what this worker can take, and today's hours aren't used up. */
  const turnsReady = (t) => !!turns && turns.folderOk() && !!answer && siteOf(answer).claimable !== null && turns.capLeft(t);

  /** The GPU's memory split three ways, from the counters and the port table (looked at again every 30 s, or sooner when a new process holds memory). */
  async function splitNow(t, reading, own) {
    const counters = await (deps.readCounters ?? readCounters)(cfg.gpuCounters);
    if (counters && (t - listedAt >= 30_000 || (listing && unknownHolder(counters, listing, own.pid, busyMb)))) {
      listing = await (deps.readListeners ?? readListeners)(cfg.powershell);
      listedAt = t;
    }
    return splitMemory({
      usedMb: reading.usedMb,
      apps: reading.apps,
      counters,
      listing,
      own,
      ports: cfg.localComfyPorts,
      excludePorts: cfg.localComfyExcludePorts,
      excludePids: cfg.localComfyExcludePids,
      baselineMb: cfg.desktopBaselineMb,
      lock: readLock(cfg.gpuLockFile),
      lockOwners: cfg.gpuLockComfyOwners,
      gpu: cfg.gpuLuid,
    });
  }

  let beatAt = 0;
  let lastState = "";
  try {
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
      // The GPU, every 5 s: nvidia-smi's total, and with a turns folder the GPU counters and the port table too.
      if (t - lastGpuAt >= (deps.gpuEveryMs ?? 5000)) {
        lastGpuAt = t;
        const reading = await (deps.readGpu ?? readGpu)(cfg.nvidiaSmi);
        if (reading) {
          const own = { running: comfy.alive(), mb: await comfy.vramMb(), pid: comfy.pid, port: comfy.alive() ? comfy.port : null };
          let verdict;
          if (turns) {
            split = await splitNow(t, reading, own);
            // Local ComfyUI work is asked for a turn only while turns work (the folder, the studio's count, the caps);
            // otherwise it counts as another program, as before.
            const othersBusy = split.othersMb > busyMb;
            const workBusy = !turnsReady(t) && split.workMb > busyMb;
            verdict = { busy: othersBusy || workBusy, who: othersBusy ? split.who : `ComfyUI${split.work.port ? ` on port ${split.work.port}` : ""}`, othersMb: split.othersMb, cause: othersBusy ? null : "work" };
            // A pause that only local ComfyUI work caused ends once turns work again (the next day, the folder back).
            if (!verdict.busy && gpu.paused && gpu.cause === "work") {
              gpu.clear();
              log("Local ComfyUI work no longer keeps it paused: back to work.");
            }
          } else verdict = othersOf(reading, own, busyMb);
          const was = gpu.paused;
          gpu.update(verdict, reading.tempC, t);
          gpuInfo = { otherApps: reading.apps.filter((a) => a.pid !== comfy.pid).map((a) => ({ pid: a.pid, name: a.name, vramBytes: (a.usedMb ?? 0) * 2 ** 20 })), tempC: reading.tempC };
          if (!was && gpu.paused) log(`Another program is using the GPU (${gpu.who}): pausing.`);
          if (was && !gpu.paused) log("The GPU stayed free for the whole cool-down: resuming.");
        }
      }
      if (comfyTrouble === "comfy-crashes" && !comfy.crashedTooOften(t) && t - guardMissingAt >= HOUR) comfyTrouble = null;
      // A ComfyUI that stopped answering (hung) is stopped; the next turn starts it again. Every beat looks at it (its
      // /system_stats), so one that answers anything at all is never taken for hung.
      if (comfy.alive() && comfy.ready && t - comfy.answeredAt > (cfg.hungMin ?? 3) * 60_000) {
        log("Its ComfyUI stopped answering: starting it again.");
        await comfy.stop();
      }
      let next = localPause(control, gpu, comfyTrouble, t) ?? { paused: false, why: null, until: null };
      // Waiting for its turn is not a pause: its jobs keep their place in the line. The helper's estimate of the start
      // goes with it.
      if (!next.paused && turn.waitForYield) next = { paused: false, why: turn.late ? "waiting-for-yield:no-answer" : "waiting-for-yield", until: turn.startsAt };
      const changed = next.paused !== pause.paused || next.why !== pause.why || next.until !== pause.until;
      pause = next;
      // A new pause, or every 5 s while busy or in a turn and 10 s otherwise: beat.
      let beaten = false;
      if (changed || t - beatAt >= (busyJob || turn.siteWaiting > 0 ? 5000 : 10_000)) {
        beatAt = t;
        beaten = true;
        try {
          const a = await runner.beat();
          if (runner.view.stopped) {
            log(runner.view.stopped === "signed-out" ? "The studio doesn't know this worker's token. Run fuobe worker setup again." : "The studio stopped this worker.");
            break;
          }
          if (a?.worker?.sendInventory) {
            const r = await call("/api/gpu/computer/inventory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inv) });
            if (r.ok) {
              const body = await r.json();
              log(`Sent its files: it can run ${body.workflows?.length ?? 0} of the studio's workflows.`);
            }
          }
        } catch (e) {
          log(`Can't reach the studio: ${e.message}`);
        }
      }
      // Its model folders, again every 10 minutes (in the background: beats go on while it hashes a new file).
      if (t - scannedAt >= (deps.rescanMs ?? RESCAN_MS) && !scanning) void rescan();
      // Its own ComfyUI runs only while it may work; a pause (and a stop-now) frees the GPU.
      const stopNow = (pause.paused && (pause.why === "here-now" || pause.why?.startsWith("gpu-busy"))) || answer?.worker?.pauseNow;
      // Studio jobs first: the turn, from what the beat said and what holds the GPU; site.json on every beat, on a change,
      // and every 5 s (the helper counts a file older than 15 s as gone).
      let holdBack = false;
      if (turns) {
        const s = siteOf(answer);
        const workHolds = (split?.workMb ?? 0) > busyMb;
        const was = turn;
        turn = turns.step(t, {
          may: turnsReady(t) && !pause.paused && !!mayWork(),
          // A busy reading that may still turn into a pause begins no turn and ends none (no new job starts either).
          unsure: gpu.busyInARow > 0,
          claimable: s.claimable,
          busy: busyJob && jobUsesGpu && !stopNow,
          workHolds,
          workThere: !!split && (split.work.pids.length > 0 || !!split.work.lock),
          // The beat has no request to interrupt local work, and no wait of its own: the worker counts the wait itself.
          serverInterrupt: false,
        });
        if (turn.waitForYield && !was.waitForYield) log("Local ComfyUI work holds the GPU: asking it to make room for the studio's jobs.");
        if (turn.late && !was.late) log("Local ComfyUI work hasn't made room after 3 minutes: still waiting, with the jobs kept in line.");
        if (was.waitForYield && !turn.waitForYield && turn.siteWaiting > 0) log("Local ComfyUI work made room: starting.");
        if (turn.ended === "idle") {
          log("No studio job for a minute: its ComfyUI lets go of its memory for local work.");
          if (comfy.ready && !busyJob) await comfy.free();
        }
        if (turns.folderOk() && (beaten || JSON.stringify([turn.siteWaiting, turn.interruptAt]) !== siteWritten || t - siteAt >= 5000)) {
          writeTurn(t, { siteWaiting: turn.siteWaiting, oldestWaitS: turn.oldestWaitS, interrupt: turn.interrupt, interruptAt: turn.interruptAt });
        }
        // No new job while local ComfyUI work holds the GPU, unless a turn has begun and it made room.
        holdBack = turn.waitForYield || (turnsReady(t) && workHolds && turn.siteWaiting === 0) || gpu.busyInARow > 0;
      }
      // Kept results go up before its ComfyUI starts (they need none, and a start can take minutes), unless the studio
      // said a moment ago that their job isn't this worker's now.
      const heldFirst = hold.ids().length > 0 && t >= heldRetryAt && (!busyJob || !jobUsesGpu);
      if (mayWork()) {
        if (!comfy.alive() && !starting && !comfyTrouble && t >= comfy.restartAt && !heldFirst) {
          if (comfy.crashedTooOften(t)) {
            comfyTrouble = "comfy-crashes";
            log("ComfyUI keeps stopping: pausing for an hour.");
          } else {
            log("Starting its own ComfyUI.");
            // In the background: beats go on while it starts. The packs by their folder names on disk, which is what
            // ComfyUI matches (whatever the catalog's case).
            starting = comfy
              .start(
                packs.map((p) => p.folder),
                { signal: stopStarts.signal },
              )
              .catch((e) => {
                if (stopStarts.signal.aborted) return;
                if (e instanceof PortBusy) {
                  comfyTrouble = "port-busy";
                  troubleAt = now();
                  log(`${e.message}: it won't start ComfyUI there, and won't connect to it.`);
                } else if (e instanceof GuardMissing) {
                  // Not again for an hour: it would only start the same ComfyUI again.
                  comfyTrouble = "comfy-crashes";
                  guardMissingAt = now();
                  log(`${e.message}: it won't use it, and pauses for an hour.`);
                } else if (mayWork()) log(`ComfyUI didn't start: ${e.message}`);
              })
              .finally(() => (starting = null));
          }
        }
        if (comfy.ready && answer?.runner && !busyJob && !holdBack && !heldFirst) take();
      } else if (comfy.alive() && (stopNow || !busyJob)) {
        log("Stopping its own ComfyUI (paused).");
        await comfy.stop();
      }
      // Kept results the studio never took are deleted after a day.
      if (t - holdCheckedAt >= 60_000) {
        holdCheckedAt = t;
        for (const id of hold.expire(t, HOLD_MAX_AGE_MS)) log(`Deleted the kept results of job ${id}: the studio didn't take them for a day.`);
      }
      // Kept results go up first, and even while it may not work (or waits for its turn): they need no GPU and no ComfyUI.
      if (!busyJob && answer && heldFirst) take({ onlyHeld: true });
      // Awake while it holds a job, has results to send, or waits for work.
      awake.set(!!answer?.worker && (busyJob || hold.ids().length > 0 || !!mayWork()));
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
  } finally {
    // Every way out: the job in hand stops (its kept results stay for the next start), its ComfyUI stops, the PC may
    // sleep again, and no input, result or cached file stays in its folders.
    runner.stop();
    await Promise.race([job, new Promise((r) => setTimeout(r, 10_000).unref?.())]);
    awake.set(false);
    // No turn any more: local ComfyUI work may go on at once.
    if (turns?.folderOk()) writeTurn(now(), { siteWaiting: 0, oldestWaitS: 0, interrupt: false, interruptAt: null });
    // A start under way ends first (it stops at the signal), so no ComfyUI is left behind.
    stopStarts.abort();
    await comfy.stop();
    await starting;
    await comfy.stop();
    emptyFolders(f);
    emptyCache();
  }
  return deps.signal?.aborted ? "aborted" : (runner.view.stopped ?? "disconnected");
}
