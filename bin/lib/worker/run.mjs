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
import { PROTOCOL, readControl, writeControl, writeStatus } from "./config.mjs";
import { GpuWatch, othersOf, readGpu } from "./gpu.mjs";
import { Hold } from "./hold.mjs";
import { inventoryHash, modelFiles, packFolders } from "./inventory.mjs";
import { readCounters, readListeners, readLock, splitMemory, unknownHolder } from "./local-work.mjs";
import { ffmpegVersion, mediaKind, reencode } from "./media.mjs";
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

/**
 * Why the studio's address won't do, or null: it must be https, so the token and people's files never cross the
 * network in the clear. This PC itself (127.0.0.1, localhost) may use http, for tests.
 */
export function siteProblem(site) {
  let u;
  try {
    u = new URL(String(site));
  } catch {
    return "That isn't a web address.";
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
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
 * What the beat says for studio jobs first: { claimable (the studio's jobs this worker may take now; null when the studio
 * doesn't say, and then local ComfyUI work counts as another program, as before), oldestWaitS, interrupt }.
 */
export function siteOf(answer) {
  const w = answer?.worker ?? {};
  return {
    claimable: count(answer?.claimableNow) ?? count(w.claimableNow),
    oldestWaitS: count(answer?.oldestWaitS) ?? count(w.oldestWaitS),
    interrupt: w.yieldInterrupt === true || answer?.yieldInterrupt === true,
  };
}

/**
 * Run until `signal` aborts or the studio stops it. Returns why it ended: "aborted" (Ctrl+C, the scheduled task's end),
 * "signed-out" (the studio doesn't know its token) or "disconnected". `deps`: { fetch, now, sleep, readGpu, log, home,
 * signal, requirements, ComputerRunner, rules, pins, allowed, ffmpegVersion, reencode, awake, rescanMs, comfy (OwnComfy's own
 * options), readCounters, readListeners, gpuEveryMs }.
 */
export async function runWorker(cfg, deps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`));
  const fetchFn = deps.fetch ?? fetch;
  const problem = siteProblem(cfg.site);
  if (problem) throw new Error(problem);
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
  const comfy = new OwnComfy(cfg, { now, fetch: fetchFn, folderNames: index.folders ?? [], log, ...deps.comfy });
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
  const ffmpeg = await (deps.ffmpegVersion ?? ffmpegVersion)(cfg.ffmpeg);
  log(ffmpeg ? "ffmpeg is there: it takes clips and sound, and makes each one again first." : "No ffmpeg set (ffmpeg in worker.json): it takes pictures only.");
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
  let guardMissingAt = -Infinity;
  // Studio jobs first: the last port table, the last split of the GPU's memory, and the last turn step.
  let listing = null;
  let listedAt = -Infinity;
  let split = null;
  let turn = { siteWaiting: 0, oldestWaitS: 0, interrupt: false, waitForYield: false, late: false, startsAt: null, ended: null };
  let siteWritten = "";
  let siteAt = 0;
  let siteFailed = false;
  const writeTurn = (t, body) => {
    const key = JSON.stringify([body.siteWaiting, body.interrupt]);
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
    inv = { files: await modelFiles(cfg.modelDirs ?? [], index, path.join(cfg.workDir, "hash-cache.json"), deps.pins), nodePacks: packs.map(({ name, commit }) => ({ name, commit })), media: inv.media };
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
    if (!fs.existsSync(made)) {
      const part = `${made}.part`;
      if (!(await (deps.reencode ?? reencode)({ ffmpeg: cfg.ffmpeg, kind, name: input.name, src: kept, dst: part }))) {
        fs.rmSync(part, { force: true });
        log(`Job ${t.id}: ffmpeg couldn't read one of its ${kind === "video" ? "clips" : "sounds"}.`);
        return "input-unreadable";
      }
      fs.renameSync(part, made);
    }
    return arrayBuffer(fs.readFileSync(made));
  }

  const runner = new ComputerRunner(
    {
      api: call,
      // Only its own ComfyUI, and only while the process it started is up: never whatever else listens on that port.
      local: (url, init) => (comfy.alive() && comfy.ready ? comfy.fetch(url, init) : Promise.reject(new Error("Its own ComfyUI isn't running"))),
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
        // Done: the studio has every result. Otherwise its kept results wait for the next claim to say whose job it is.
        if (phase === "done") hold.drop(t.id);
        delete crashes[t.id];
        saveCrashes();
        await cleanJob(f, comfy.base, (url, init) => comfy.fetch(url, init));
        emptyCache();
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
        const s = a?.worker?.autoResume;
        gpu.o.autoResume = typeof s === "boolean" ? s : !!cfg.autoResume;
      },
      worker: {
        hold,
        input: takeInput,
        stallMs: (cfg.stallMin ?? 10) * 60_000,
        free: () => comfy.free(),
        crashes: (t) => crashes[t.id] ?? 0,
        stuck: async () => {
          log("Its ComfyUI didn't let go of a job: starting it again.");
          await comfy.stop();
        },
        claimed: async (t) => {
          // Kept results of any other job aren't this worker's any more (one job at a time).
          hold.dropAllBut(t?.id ?? null);
          if (!t) return;
          comfy.task = t.id;
          // Another job than the one its ComfyUI last had: nothing of that one stays.
          if (t.id !== lastTask) {
            await cleanJob(f, comfy.base, (url, init) => comfy.fetch(url, init));
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
          // A busy reading that may still turn into a pause asks for nothing.
          may: turnsReady(t) && !pause.paused && !!mayWork() && gpu.busyInARow === 0,
          claimable: s.claimable,
          busy: busyJob && jobUsesGpu && !stopNow,
          workHolds,
          workThere: !!split && (split.work.pids.length > 0 || !!split.work.lock),
          serverInterrupt: s.interrupt,
          oldestWaitS: s.oldestWaitS,
        });
        if (turn.waitForYield && !was.waitForYield) log("Local ComfyUI work holds the GPU: asking it to make room for the studio's jobs.");
        if (turn.late && !was.late) log("Local ComfyUI work hasn't made room after 3 minutes: still waiting, with the jobs kept in line.");
        if (was.waitForYield && !turn.waitForYield && turn.siteWaiting > 0) log("Local ComfyUI work made room: starting.");
        if (turn.ended === "idle") {
          log("No studio job for a minute: its ComfyUI lets go of its memory for local work.");
          if (comfy.ready && !busyJob) await comfy.free();
        }
        if (turns.folderOk() && (beaten || JSON.stringify([turn.siteWaiting, turn.interrupt]) !== siteWritten || t - siteAt >= 5000)) {
          writeTurn(t, { siteWaiting: turn.siteWaiting, oldestWaitS: turn.oldestWaitS, interrupt: turn.interrupt });
        }
        // No new job while local ComfyUI work holds the GPU, unless a turn has begun and it made room.
        holdBack = turn.waitForYield || (turnsReady(t) && workHolds && turn.siteWaiting === 0) || gpu.busyInARow > 0;
      }
      if (mayWork()) {
        if (!comfy.alive() && !comfyTrouble && t >= comfy.restartAt) {
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
              } else if (e instanceof GuardMissing) {
                // Not again for an hour: it would only start the same ComfyUI again.
                comfyTrouble = "comfy-crashes";
                guardMissingAt = t;
                log(`${e.message}: it won't use it, and pauses for an hour.`);
              } else log(`ComfyUI didn't start: ${e.message}`);
            }
          }
        }
        if (comfy.ready && answer?.runner && !busyJob && !holdBack) take();
      } else if (comfy.alive() && (stopNow || !busyJob)) {
        log("Stopping its own ComfyUI (paused).");
        await comfy.stop();
      }
      // Kept results go up even while it may not work (or waits for its turn): they need no GPU and no ComfyUI.
      if (!busyJob && answer && hold.ids().length && !(mayWork() && comfy.ready && !holdBack)) take({ onlyHeld: true });
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
    if (turns?.folderOk()) writeTurn(now(), { siteWaiting: 0, oldestWaitS: 0, interrupt: false });
    await comfy.stop();
    emptyFolders(f);
    emptyCache();
  }
  return deps.signal?.aborted ? "aborted" : (runner.view.stopped ?? "disconnected");
}
