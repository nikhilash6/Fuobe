/**
 * Studio jobs first (bin/lib/worker/local-work.mjs, turns.mjs): telling local ComfyUI work apart from other programs
 * from a fake port table, fake GPU counters and a fake lock file, the turn files, and the local caps. Nothing here runs
 * PowerShell, typeperf or nvidia-smi, and nothing connects to any ComfyUI.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GpuWatch } from "../bin/lib/worker/gpu.mjs";
import { BASELINE_CAP_MB, freeLocal, localIdle, measureBaseline, parseCounters, parseListeners, pickGpu, readLock, splitMemory, unknownHolder, workPids } from "../bin/lib/worker/local-work.mjs";
import { readYielded, SiteTurns, TURNS, writeSite } from "../bin/lib/worker/turns.mjs";
import { siteOf } from "../bin/lib/worker/run.mjs";
import { tempDir } from "./helpers/temp-dir";

const MB = 2 ** 20;
const head = (pid: number, luid = "0x00000000_0x0000D1B5") => `"\\\\PC\\GPU Process Memory(pid_${pid}_luid_${luid}_phys_0)\\Dedicated Usage"`;

/** typeperf's answer for these processes: [pid, MB, luid?]. */
function typeperf(rows: [number, number, string?][]): string {
  return [
    "",
    `"(PDH-CSV 4.0)",${rows.map(([pid, , luid]) => head(pid, luid)).join(",")}`,
    `"11/04/2026 09:00:00.000",${rows.map(([, mb]) => `"${(mb * MB).toFixed(6)}"`).join(",")}`,
    "Exiting, please wait...",
    "The command completed successfully.",
  ].join("\r\n");
}

/** The port table: local ComfyUI work on 8188 (pid 4242), a web server on 8195, the worker's own ComfyUI on 31337 (pid 900). */
const LISTING = {
  listeners: [
    { port: 8188, pid: 4242 },
    { port: 8195, pid: 4300 },
    { port: 8191, pid: 4400 },
    { port: 31337, pid: 900 },
    { port: 445, pid: 4 },
  ],
  names: { "4242": "python", "4300": "nginx", "4400": "python", "900": "python", "4": "System", "5555": "game", "77": "dwm" },
};

describe("the port table and the GPU counters", () => {
  it("reads the port table's JSON, one listener or many", () => {
    const one = parseListeners(JSON.stringify({ listeners: { port: 8188, pid: 4242 }, names: { "4242": "python" } }));
    expect(one).toEqual({ listeners: [{ port: 8188, pid: 4242 }], names: { "4242": "python" } });
    const many = parseListeners(JSON.stringify({ listeners: [{ port: 8188, pid: 4242 }, { port: "x", pid: 1 }, { port: 80, pid: 0 }], names: { "4242": "python", nope: "x" } }));
    expect(many?.listeners).toEqual([{ port: 8188, pid: 4242 }]);
    expect(many?.names).toEqual({ "4242": "python" });
    expect(parseListeners("Get-NetTCPConnection : Access is denied")).toBeNull();
  });

  it("reads typeperf's per-process dedicated memory, in MB, for each adapter", () => {
    const c = parseCounters(typeperf([[4242, 9000], [5555, 0], [77, 300, "0x00000000_0x0000AAAA"]]));
    expect(c).toEqual([
      { pid: 4242, gpu: "0x00000000_0x0000d1b5_0", mb: 9000 },
      { pid: 5555, gpu: "0x00000000_0x0000d1b5_0", mb: 0 },
      { pid: 77, gpu: "0x00000000_0x0000aaaa_0", mb: 300 },
    ]);
    expect(pickGpu(c!, null)).toBe("0x00000000_0x0000d1b5_0");
    expect(pickGpu(c!, "0x00000000_0x0000AAAA_0")).toBe("0x00000000_0x0000aaaa_0");
    expect(parseCounters("Error: No valid counters.")).toBeNull();
  });

  it("local ComfyUI work: python on a port in the range, never its own ComfyUI (by pid or port), never an excluded port", () => {
    const { own, work } = workPids(LISTING, { ports: [8188, 8199], ownPid: 900, ownPort: 31337 });
    expect([...work.keys()]).toEqual([4242, 4400]);
    expect(own.has(900)).toBe(true);
    // Its own ComfyUI started through a launcher: the process on its port is its own, whatever its pid.
    expect(workPids({ ...LISTING, listeners: [...LISTING.listeners, { port: 8190, pid: 901 }] }, { ports: [8188, 8199], ownPid: 900, ownPort: 8190 }).own.has(901)).toBe(true);
    expect([...workPids(LISTING, { ports: [8188, 8199], ownPid: 900, excludePorts: [8191] }).work.keys()]).toEqual([4242]);
    expect([...workPids(LISTING, { ports: [8188, 8199], ownPid: 900, excludePids: [4242] }).work.keys()]).toEqual([4400]);
    // A range that leaves 8191 out.
    expect([...workPids(LISTING, { ports: [8188, 8190], ownPid: 900 }).work.keys()]).toEqual([4242]);
  });

  it("only ComfyUI work holds memory: others stay under the busy line", () => {
    const counters = parseCounters(typeperf([[4242, 9000], [900, 2000], [77, 500]]));
    const s = splitMemory({ usedMb: 11_600, counters, listing: LISTING, own: { pid: 900, port: 31337, running: true, mb: 100 }, ports: [8188, 8199], baselineMb: 600 });
    expect(s.source).toBe("counters");
    expect(s.ownMb).toBe(2000);
    expect(s.workMb).toBe(9000);
    expect(s.othersMb).toBe(0);
    expect(s.work).toEqual({ pids: [4242, 4400], port: 8188, ports: [8188, 8191] });
  });

  it("asks local ComfyUI work only whether it runs anything, and to free its memory: idle means both its lists are empty", async () => {
    const calls: string[] = [];
    const queues: Record<number, unknown> = { 8188: { queue_running: [], queue_pending: [] }, 8191: { queue_running: [], queue_pending: [[2, "p", {}, {}, []]] } };
    const fetchFn = async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      calls.push(`${init.method ?? "GET"} ${u.host}${u.pathname}${init.body ? ` ${String(init.body)}` : ""}`);
      if (u.port === "8199") throw new Error("refused");
      return u.pathname === "/queue" ? Response.json(queues[Number(u.port)] ?? {}) : new Response(null, { status: 200 });
    };
    expect(await localIdle(fetchFn, [8188])).toBe(true);
    // One with a queued job, one that doesn't answer, one that answers something else: not idle.
    expect(await localIdle(fetchFn, [8188, 8191])).toBe(false);
    expect(await localIdle(fetchFn, [8199])).toBe(false);
    expect(await localIdle(fetchFn, [8190])).toBe(false);
    expect(await localIdle(fetchFn, [])).toBe(false);
    await freeLocal(fetchFn, [8188, 8199]);
    expect(calls).toEqual([
      "GET 127.0.0.1:8188/queue",
      "GET 127.0.0.1:8188/queue",
      "GET 127.0.0.1:8191/queue",
      "GET 127.0.0.1:8199/queue",
      "GET 127.0.0.1:8190/queue",
      'POST 127.0.0.1:8188/free {"unload_models":true,"free_memory":true}',
      'POST 127.0.0.1:8199/free {"unload_models":true,"free_memory":true}',
    ]);
  });

  it("a game holds memory: others above the busy line, and the game is named", () => {
    const counters = parseCounters(typeperf([[5555, 6000], [77, 500]]));
    const s = splitMemory({ usedMb: 6500, counters, listing: LISTING, own: { pid: null, port: null, running: false, mb: null }, ports: [8188, 8199], baselineMb: 600 });
    expect(s.workMb).toBe(0);
    expect(s.othersMb).toBe(5900);
    expect(s.who).toBe("game");
  });

  it("never names a desktop process as the cause: the biggest other one, else another program", () => {
    const names = { ...LISTING, names: { ...LISTING.names, "77": "dwm", "78": "msedge", "5555": "game" } };
    const desktopOnly = splitMemory({ usedMb: 9000, counters: parseCounters(typeperf([[77, 1500], [78, 900]])), listing: names, own: { pid: null, port: null, running: false, mb: null }, ports: [8188, 8199], baselineMb: 600 });
    expect(desktopOnly).toMatchObject({ othersMb: 8400, who: "another program" });
    expect(splitMemory({ usedMb: 9000, counters: parseCounters(typeperf([[77, 3000], [5555, 2000]])), listing: names, own: { pid: null, port: null, running: false, mb: null }, ports: [8188, 8199], baselineMb: 600 }).who).toBe("game");
    const apps = [{ pid: 12092, name: "ShellHost.exe", usedMb: null }, { pid: 5, name: "blender.exe", usedMb: null }];
    expect(splitMemory({ usedMb: 9000, counters: null, listing: null, apps, own: { pid: null, port: null, running: false, mb: null }, baselineMb: 600, lock: null }).who).toBe("blender.exe");
  });

  it("its own ComfyUI's share is sure only when read per process (the counters), not from torch alone", () => {
    const own = { pid: 900, port: 31337, running: true, mb: 1400 };
    expect(splitMemory({ usedMb: 23_000, counters: parseCounters(typeperf([[900, 21_000]])), listing: LISTING, own, ports: [8188, 8199], baselineMb: 600 })).toMatchObject({ ownMb: 21_000, ownSure: true, othersMb: 1400 });
    expect(splitMemory({ usedMb: 23_000, counters: null, listing: null, apps: [], own, baselineMb: 600, lock: null })).toMatchObject({ source: "total", ownSure: false });
    expect(splitMemory({ usedMb: 23_000, counters: null, listing: null, apps: [], own: { ...own, running: false }, baselineMb: 600, lock: null }).ownSure).toBe(true);
  });

  it("its own ComfyUI before the counters list it: torch's number, as before", () => {
    const s = splitMemory({ usedMb: 3000, counters: [], listing: LISTING, own: { pid: 900, port: 31337, running: true, mb: 1400 }, ports: [8188, 8199], baselineMb: 0 });
    expect(s.ownMb).toBe(2000);
    expect(s.othersMb).toBe(1000);
  });

  it("the counters fail: the lock decides; an owner named as ComfyUI work is work, anyone else another program", () => {
    const dir = tempDir("fuobe-worker-lock-");
    const lock = path.join(dir, "gpu.lock");
    fs.mkdirSync(lock);
    expect(readLock(lock)).toBe("");
    fs.writeFileSync(path.join(lock, "owner.txt"), "render-queue night-batch 2026-11-04T09:00:00Z pid 77\n");
    expect(readLock(lock)).toBe("render-queue");
    expect(readLock(path.join(lock, "owner.txt"))).toBe("render-queue");
    expect(readLock(path.join(dir, "none"))).toBeNull();
    const base = { usedMb: 9600, counters: null, listing: LISTING, own: { pid: null, port: null, running: false, mb: null }, ports: [8188, 8199], baselineMb: 600, lockOwners: ["render-queue"] };
    expect(splitMemory({ ...base, lock: "render-queue" })).toMatchObject({ source: "lock", workMb: 9000, othersMb: 0 });
    expect(splitMemory({ ...base, lock: "someone-else" })).toMatchObject({ source: "lock", workMb: 0, othersMb: 9000, who: "another program" });
    expect(splitMemory({ ...base, lock: "" })).toMatchObject({ source: "lock", othersMb: 9000 });
    // No lock and no counters: everything that isn't its own counts as another program (it fails safe).
    expect(splitMemory({ ...base, lock: null, apps: [{ pid: 5, name: "blender.exe", usedMb: null }] })).toMatchObject({ source: "total", workMb: 0, othersMb: 9000, who: "blender.exe" });
    // The port table failed while the counters worked: the lock decides too.
    expect(splitMemory({ ...base, counters: parseCounters(typeperf([[4242, 9000]])), listing: null, lock: "render-queue" }).source).toBe("lock");
  });

  it("looks at the port table again when a process it doesn't know holds memory", () => {
    const counters = parseCounters(typeperf([[4242, 9000]]))!;
    expect(unknownHolder(counters, LISTING, 900, 1024)).toBe(false);
    expect(unknownHolder(parseCounters(typeperf([[6000, 4000]]))!, LISTING, 900, 1024)).toBe(true);
    // A known program that listens nowhere (a game) needs no new look.
    expect(unknownHolder(parseCounters(typeperf([[5555, 4000]]))!, LISTING, 900, 1024)).toBe(false);
  });

  it("measures the desktop's share at setup, without local ComfyUI work", async () => {
    const m = await measureBaseline({ localComfyPorts: [8188, 8199] }, { readGpu: async () => ({ usedMb: 9700, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[4242, 9000], [77, 650]])), readListeners: async () => LISTING });
    expect(m).toMatchObject({ mb: 700, measuredMb: 700, capped: false, usedMb: 9700, ownMb: 0, workMb: 9000, top: [{ pid: 77, mb: 650, name: "dwm" }] });
    expect(await measureBaseline({}, { readGpu: async () => ({ usedMb: 1, tempC: 1, apps: [] }), readCounters: async () => null })).toBeNull();
  });

  it("leaves out the worker's own ComfyUI, by its pid file: its process and the one on its port (a venv's real Python)", async () => {
    const workDir = tempDir("fuobe-worker-baseline-");
    // The worker runs: its ComfyUI started as pid 900 (a venv's python.exe), whose own Python (pid 901) listens on 31400
    // and holds 18 GB of models.
    fs.writeFileSync(path.join(workDir, "comfyui.pid"), JSON.stringify({ pid: 900, port: 31_400, marker: "comfy_guard.py" }));
    const listing = { listeners: [...LISTING.listeners, { port: 31_400, pid: 901 }], names: { ...LISTING.names, "901": "python" } };
    const deps = { readGpu: async () => ({ usedMb: 18_600, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[900, 0], [901, 18_000], [77, 600]])), readListeners: async () => listing };
    expect(await measureBaseline({ workDir, localComfyPorts: [8188, 8199] }, deps)).toMatchObject({ mb: 600, ownMb: 18_000, capped: false });
    // Without the pid file (an older worker folder), it would count as the desktop's: capped, and said so.
    const blind = await measureBaseline({ workDir: tempDir("fuobe-worker-baseline-"), localComfyPorts: [8188, 8199] }, deps);
    expect(blind).toMatchObject({ mb: BASELINE_CAP_MB, measuredMb: 18_600, capped: true });
    expect(blind!.top[0]).toEqual({ pid: 901, mb: 18_000, name: "python" });
  });

  it("saves at most its cap: a game left open is named instead of hiding programs from then on", async () => {
    const m = await measureBaseline({ localComfyPorts: [8188, 8199] }, { readGpu: async () => ({ usedMb: 12_700, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[5555, 12_000], [77, 650]])), readListeners: async () => LISTING });
    expect(m).toMatchObject({ mb: BASELINE_CAP_MB, measuredMb: 12_700, capped: true, top: [{ pid: 5555, mb: 12_000, name: "game" }, { pid: 77, mb: 650, name: "dwm" }] });
  });
});

describe("the busy pause after two readings", () => {
  it("one busy reading doesn't pause; two in a row do; a free reading between starts the count again", () => {
    const g = new GpuWatch({ autoResume: false, resumeAfterMs: 0, resumeBelowC: 75, busyReadings: 2 });
    g.update({ busy: true, who: "game" }, 50, 0);
    expect(g.paused).toBe(false);
    g.update({ busy: false, who: null }, 50, 5000);
    g.update({ busy: true, who: "game" }, 50, 10_000);
    expect(g.paused).toBe(false);
    g.update({ busy: true, who: "game" }, 50, 15_000);
    expect(g.paused).toBe(true);
    expect(g.who).toBe("game");
    // Without the option: at once, as before.
    const once = new GpuWatch({ autoResume: false, resumeAfterMs: 0, resumeBelowC: 75 });
    once.update({ busy: true, who: "x" }, 50, 0);
    expect(once.paused).toBe(true);
  });
});

describe("turns", () => {
  const T0 = new Date(2026, 10, 4, 9, 0, 0).getTime();
  const setup = (o: Record<string, unknown> = {}) => {
    const dir = tempDir("fuobe-worker-turns-");
    const folder = path.join(dir, "turns");
    fs.mkdirSync(folder);
    return { folder, turns: new SiteTurns({ folder, stateFile: path.join(dir, "home", "turns.json"), ...o }), stateFile: path.join(dir, "home", "turns.json") };
  };
  const answer = (folder: string, body: unknown) => fs.writeFileSync(path.join(folder, "yielded.json"), JSON.stringify(body));
  const facts = { may: true, claimable: 2, busy: false, workHolds: true, workThere: true, serverInterrupt: false };

  it("asks while studio jobs wait and local work holds the GPU; starts on a fresh answer; ends a minute after the last job", () => {
    const { folder, turns } = setup();
    expect(turns.folderOk()).toBe(true);
    let s = turns.step(T0, facts);
    expect(s).toMatchObject({ siteWaiting: 2, waitForYield: true, interrupt: false, ended: null });
    // An answer from before this turn doesn't count once it is old.
    answer(folder, { state: "yielded", at: T0 - 60_000 });
    expect(turns.step(T0 + 1000, facts).waitForYield).toBe(true);
    // "yielding" carries the helper's estimate of the start.
    answer(folder, { state: "yielding", at: T0 + 1500, startsAt: T0 + 90_000 });
    expect(turns.step(T0 + 2000, facts)).toMatchObject({ waitForYield: true, startsAt: T0 + 90_000 });
    answer(folder, { state: "yielded", at: T0 + 2500 });
    s = turns.step(T0 + 3000, facts);
    expect(s.waitForYield).toBe(false);
    // Running a job: siteWaiting counts it too.
    expect(turns.step(T0 + 4000, { ...facts, claimable: 1, busy: true }).siteWaiting).toBe(2);
    // The line empties: still asking for a minute, so the next job starts at once.
    expect(turns.step(T0 + 5000, { ...facts, claimable: 0 })).toMatchObject({ siteWaiting: 1, ended: null });
    expect(turns.step(T0 + 4000 + TURNS.graceMs - 1, { ...facts, claimable: 0 }).siteWaiting).toBe(1);
    expect(turns.step(T0 + 4000 + TURNS.graceMs, { ...facts, claimable: 0 })).toMatchObject({ siteWaiting: 0, ended: "idle" });
  });

  it("a helper that keeps answering \"yielding\" is never 'no answer', however long local work's job runs; silence is", () => {
    const { folder, turns } = setup();
    expect(turns.step(T0, facts)).toMatchObject({ waitForYield: true, late: false });
    // Local work's job runs 10 minutes; the helper writes "yielding" with its estimate every 5 s all along.
    for (let t = T0 + 5000; t <= T0 + 10 * 60_000; t += 5000) {
      answer(folder, { state: "yielding", at: t - 1000, startsAt: T0 + 11 * 60_000 });
      expect(turns.step(t, facts)).toMatchObject({ waitForYield: true, late: false, startsAt: T0 + 11 * 60_000 });
    }
    // Then the helper goes quiet: its last answer stops counting after 15 s, and 3 minutes after it, "no answer".
    const last = T0 + 10 * 60_000;
    expect(turns.step(last + TURNS.lateMs - 1000, facts).late).toBe(false);
    expect(turns.step(last + TURNS.lateMs, facts).late).toBe(true);
    // An answer from before this turn, however fresh it was then, never counts: 3 minutes of silence is late.
    const other = setup();
    answer(other.folder, { state: "yielding", at: T0 - 2000, startsAt: T0 + 60_000 });
    other.turns.step(T0, facts);
    expect(other.turns.step(T0 + 10_000, facts).late).toBe(false);
    expect(other.turns.step(T0 + TURNS.lateMs, facts).late).toBe(true);
  });

  it("the GPU free of local work: no waiting, and siteWaiting still says the studio wants it", () => {
    const { turns } = setup();
    expect(turns.step(T0, { ...facts, workHolds: false, workThere: true })).toMatchObject({ siteWaiting: 2, waitForYield: false });
    // Local work loads models during the turn: from then on, a fresh answer first.
    expect(turns.step(T0 + 1000, { ...facts, workHolds: true }).waitForYield).toBe(true);
    // Its process closes: nothing left to wait for.
    expect(turns.step(T0 + 2000, { ...facts, workHolds: false, workThere: false }).waitForYield).toBe(false);
  });

  it("a pause by hand (me first), a busy GPU or the studio's pause end the turn at once; a job that finishes keeps it until it ends", () => {
    const { turns } = setup();
    turns.step(T0, facts);
    expect(turns.step(T0 + 1000, { ...facts, may: false, busy: true })).toMatchObject({ siteWaiting: 1, ended: null });
    expect(turns.step(T0 + 2000, { ...facts, may: false, busy: false })).toMatchObject({ siteWaiting: 0, ended: "stopped" });
    expect(turns.step(T0 + 3000, { ...facts, may: false })).toMatchObject({ siteWaiting: 0, waitForYield: false });
  });

  it("one reading that may still become a pause begins no turn and ends none", () => {
    const { folder, turns } = setup();
    // Not in a turn: an unsure reading asks for nothing.
    expect(turns.step(T0, { ...facts, unsure: true })).toMatchObject({ siteWaiting: 0, waitForYield: false });
    // In a turn, with the answer in: the reading leaves it as it is, and the answer still counts.
    expect(turns.step(T0 + 1000, facts)).toMatchObject({ siteWaiting: 2, waitForYield: true });
    answer(folder, { state: "yielded", at: T0 + 1500 });
    expect(turns.step(T0 + 20_000, { ...facts, unsure: true })).toMatchObject({ siteWaiting: 2, waitForYield: false, ended: null });
    expect(turns.step(T0 + 25_000, facts)).toMatchObject({ siteWaiting: 2, waitForYield: false, ended: null });
    // The second busy reading pauses the worker: the turn ends at once.
    expect(turns.step(T0 + 30_000, { ...facts, may: false, unsure: true })).toMatchObject({ siteWaiting: 0, ended: "stopped" });
  });

  it("allows one interrupt, named by the time it was allowed, until the helper answers after it", () => {
    const a = setup({ interruptGapMin: 30 });
    expect(a.turns.step(T0, { ...facts, serverInterrupt: true })).toMatchObject({ interrupt: true, interruptAt: T0 });
    // Still the same one interrupt while the helper hasn't answered: a helper stops one job per interruptAt.
    expect(a.turns.step(T0 + 1000, { ...facts, serverInterrupt: true })).toMatchObject({ interrupt: true, interruptAt: T0, waitForYield: true });
    // An answer from before it was allowed doesn't count.
    answer(a.folder, { state: "yielding", at: T0 - 5000 });
    expect(a.turns.step(T0 + 2000, { ...facts, serverInterrupt: true })).toMatchObject({ interrupt: true, interruptAt: T0 });
    // The helper is making room, after the interrupt was allowed: it has seen it, and the flag goes.
    answer(a.folder, { state: "yielding", at: T0 + 2500, startsAt: T0 + 60_000 });
    expect(a.turns.step(T0 + 3000, { ...facts, serverInterrupt: true })).toMatchObject({ interrupt: false, interruptAt: null, waitForYield: true });
    // Still inside the gap: no second interrupt in this turn.
    expect(a.turns.step(T0 + 4000, { ...facts, serverInterrupt: true })).toMatchObject({ interrupt: false, interruptAt: null });
  });

  it("asks for an interrupt only when the studio does, at most once per gap, and never when the PC says never", () => {
    const a = setup({ interruptGapMin: 30 });
    expect(a.turns.step(T0, { ...facts, serverInterrupt: true }).interrupt).toBe(true);
    // The answer came: no more interrupt.
    answer(a.folder, { state: "yielded", at: T0 + 500 });
    expect(a.turns.step(T0 + 1000, { ...facts, serverInterrupt: true }).interrupt).toBe(false);
    // The next turn, 10 minutes later: inside the gap, so it waits for the job to finish.
    a.turns.step(T0 + 2000, { ...facts, may: false });
    expect(a.turns.step(T0 + 10 * 60_000, { ...facts, serverInterrupt: true })).toMatchObject({ waitForYield: true, interrupt: false });
    a.turns.step(T0 + 10 * 60_000 + 1, { ...facts, may: false });
    // 31 minutes after the first: allowed again. A new worker start remembers the last one.
    const again = new SiteTurns({ folder: a.folder, stateFile: a.stateFile, interruptGapMin: 30 });
    expect(again.step(T0 + 20 * 60_000, { ...facts, serverInterrupt: true }).interrupt).toBe(false);
    again.step(T0 + 20 * 60_000 + 1, { ...facts, may: false });
    expect(again.step(T0 + 31 * 60_000, { ...facts, serverInterrupt: true }).interrupt).toBe(true);
    // The studio didn't ask: none.
    expect(setup().turns.step(T0, facts).interrupt).toBe(false);
    // Never interrupt wins.
    expect(setup({ neverInterrupt: true }).turns.step(T0, { ...facts, serverInterrupt: true }).interrupt).toBe(false);
  });

  it("stops asking once today's hours are used up, and starts again the next day", () => {
    const { turns, folder, stateFile } = setup({ maxHoursPerDay: 1 });
    let t = T0;
    for (; t <= T0 + 3_610_000; t += 10_000) turns.step(t, facts);
    expect(turns.capLeft(t)).toBe(false);
    expect(turns.step(t, facts)).toMatchObject({ siteWaiting: 0, waitForYield: false });
    // A restart doesn't reset the day.
    expect(new SiteTurns({ folder, stateFile, maxHoursPerDay: 1 }).capLeft(t + 1000)).toBe(false);
    const tomorrow = new Date(2026, 10, 5, 0, 0, 1).getTime();
    expect(turns.capLeft(tomorrow)).toBe(true);
    expect(turns.step(tomorrow, facts).siteWaiting).toBe(2);
    // 0 hours: no turns at all.
    expect(setup({ maxHoursPerDay: 0 }).turns.step(T0, facts).siteWaiting).toBe(0);
  });

  it("a PC that slept doesn't use up the day in one tick", () => {
    const { turns } = setup({ maxHoursPerDay: 1 });
    turns.step(T0, facts);
    turns.step(T0 + 5 * 3_600_000, facts);
    expect(turns.capLeft(T0 + 5 * 3_600_000)).toBe(true);
  });

  it("writes site.json whole, and reads only a real answer", () => {
    const { folder } = setup();
    writeSite(folder, { siteWaiting: 3, oldestWaitS: 12, interrupt: false, at: T0 });
    expect(JSON.parse(fs.readFileSync(path.join(folder, "site.json"), "utf8"))).toEqual({ siteWaiting: 3, oldestWaitS: 12, interrupt: false, at: T0 });
    expect(fs.readdirSync(folder)).toEqual(["site.json"]);
    answer(folder, { state: "run-this", at: T0 });
    expect(readYielded(folder)).toBeNull();
    answer(folder, { state: "yielded", at: "now" });
    expect(readYielded(folder)).toBeNull();
    fs.writeFileSync(path.join(folder, "yielded.json"), "x".repeat(5000));
    expect(readYielded(folder)).toBeNull();
    expect(readYielded(path.join(folder, "none"))).toBeNull();
  });

  it("a folder that isn't there: no turns (the worker never makes it)", () => {
    const t = new SiteTurns({ folder: path.join(tempDir("fuobe-worker-turns-"), "missing"), stateFile: path.join(tempDir("fuobe-worker-turns-"), "s.json") });
    expect(t.folderOk()).toBe(false);
  });

  it("reads only the beat's claimableNow (a count); absent, or anything else, means the studio doesn't say", () => {
    expect(siteOf({ claimableNow: 2 })).toEqual({ claimable: 2, owner: 0 });
    expect(siteOf({ claimableNow: 0 })).toEqual({ claimable: 0, owner: 0 });
    // Fields the protocol doesn't have are not read.
    expect(siteOf({ worker: { claimableNow: 1, yieldInterrupt: true }, oldestWaitS: 40 })).toEqual({ claimable: null, owner: 0 });
    expect(siteOf({ waiting: 9, claimableNow: -1, worker: {} })).toEqual({ claimable: null, owner: 0 });
    expect(siteOf(null).claimable).toBeNull();
  });

  it("reads the beat's ownerWaitingNow (a count) apart: 0 when the studio doesn't say", () => {
    expect(siteOf({ claimableNow: 0, ownerWaitingNow: 3 })).toEqual({ claimable: 0, owner: 3 });
    expect(siteOf({ claimableNow: 1, ownerWaitingNow: -2 })).toEqual({ claimable: 1, owner: 0 });
    expect(siteOf({ claimableNow: 1, ownerWaitingNow: "2" })).toEqual({ claimable: 1, owner: 0 });
    expect(siteOf({ waiting: 4 }).owner).toBe(0);
  });

  it("the oldest wait: how long this worker has seen people's jobs waiting for it", () => {
    const { turns } = setup();
    expect(turns.step(T0, { ...facts, workHolds: false }).oldestWaitS).toBe(0);
    expect(turns.step(T0 + 30_000, { ...facts, workHolds: false }).oldestWaitS).toBe(30);
    expect(turns.step(T0 + 31_000, { ...facts, workHolds: false, claimable: 0 }).oldestWaitS).toBe(0);
  });
});
