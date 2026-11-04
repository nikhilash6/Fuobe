/**
 * The pause shortcut's choice (1, 2 or 4 hours, or until you resume) and `fuobe worker baseline`, with fake GPU readers.
 * Nothing here runs PowerShell, typeperf or nvidia-smi.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCounters } from "../bin/lib/worker/local-work.mjs";
import { choosePause, worker } from "../bin/lib/worker/index.mjs";
import { installScript } from "../bin/lib/worker/install.mjs";
import { tempDir } from "./helpers/temp-dir";

const MB = 2 ** 20;
const LISTING = { listeners: [{ port: 8188, pid: 4242 }], names: { "4242": "python", "77": "dwm" } };
const typeperf = (rows: [number, number][]) =>
  [
    `"(PDH-CSV 4.0)",${rows.map(([pid]) => `"\\\\PC\\GPU Process Memory(pid_${pid}_luid_0x00000000_0x0000D1B5_phys_0)\\Dedicated Usage"`).join(",")}`,
    `"11/04/2026 09:00:00.000",${rows.map(([, mb]) => `"${mb * MB}"`).join(",")}`,
  ].join("\r\n");

describe("me first", () => {
  const io = (answers: string[], home: string) => {
    const out: string[] = [];
    return {
      out,
      io: {
        env: { FUOBE_WORKER_HOME: home },
        home,
        now: () => 1_000_000,
        stdout: { write: (s: string) => void out.push(s) },
        stderr: { write: (s: string) => void out.push(s) },
        ask: async () => answers.shift() ?? "",
      },
    };
  };

  it("the shortcut asks for 1, 2 or 4 hours (or until you resume) and pauses now", async () => {
    expect(await choosePause({ ask: async () => "" })).toBe("1h");
    expect(await choosePause({ ask: async () => "4" })).toBe("4h");
    expect(await choosePause({ ask: async () => "0" })).toBe("");
    expect(await choosePause({ ask: async () => "nope" })).toBeNull();
    const home = tempDir("fuobe-worker-home-");
    const a = io(["2"], home);
    expect(await worker(["pause", "--choose"], a.io)).toBe(0);
    const control = JSON.parse(fs.readFileSync(path.join(home, "control.json"), "utf8"));
    expect(control).toMatchObject({ paused: true, now: true, until: 1_000_000 + 2 * 3_600_000 });
    const b = io(["x"], home);
    fs.rmSync(path.join(home, "control.json"));
    expect(await worker(["pause", "--choose"], b.io)).toBe(0);
    expect(fs.existsSync(path.join(home, "control.json"))).toBe(false);
    expect(b.out.join("")).toContain("Not paused.");
    // --for 1h, as before.
    expect(await worker(["pause", "--for", "1h"], io([], home).io)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "control.json"), "utf8"))).toMatchObject({ paused: true, now: false, until: 1_000_000 + 3_600_000 });
  });

  it("the Ctrl+Alt+P shortcut opens the question in a window", () => {
    const { text } = installScript({ node: "C:\\node\\node.exe", bin: "C:\\fuobe\\bin\\fuobe.mjs", home: "C:\\home" });
    expect(text).toContain('@("Pause Fuobe worker", "worker pause --choose", "CTRL+ALT+P", 1)');
    expect(text).toContain('@("Resume Fuobe worker", "worker resume", "", 7)');
  });

  it("baseline saves the desktop's share in worker.json and keeps the rest of it", async () => {
    const home = tempDir("fuobe-worker-home-");
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ site: "https://studio.example", workDir: "D:\\w" }));
    const a = io([], home);
    const gpu = { readGpu: async () => ({ usedMb: 9700, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[4242, 9000], [77, 650]])), readListeners: async () => LISTING };
    expect(await worker(["baseline"], { ...a.io, gpu })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8"))).toEqual({ site: "https://studio.example", workDir: "D:\\w", desktopBaselineMb: 700 });
    expect(a.out.join("")).toContain("Counted: 700 MB, mostly dwm (process 77, 650 MB)");
    expect(await worker(["baseline"], { ...a.io, gpu: { ...gpu, readCounters: async () => null } })).toBe(1);
  });

  it("baseline leaves out the running worker's own ComfyUI, and saves at most its cap with a warning", async () => {
    const home = tempDir("fuobe-worker-home-");
    const workDir = tempDir("fuobe-worker-work-");
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ site: "https://studio.example", workDir }));
    // The worker runs: its own ComfyUI (pid 5000 on port 31400) holds 18 GB.
    fs.writeFileSync(path.join(workDir, "comfyui.pid"), JSON.stringify({ pid: 5000, port: 31_400 }));
    const listing = { listeners: [...LISTING.listeners, { port: 31_400, pid: 5000 }], names: { ...LISTING.names, "5000": "python", "6000": "game" } };
    const a = io([], home);
    const gpu = { readGpu: async () => ({ usedMb: 18_650, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[5000, 18_000], [77, 650]])), readListeners: async () => listing };
    expect(await worker(["baseline"], { ...a.io, gpu })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8")).desktopBaselineMb).toBe(650);
    expect(a.out.join("")).toContain("Not counted: the worker's own ComfyUI (18000 MB)");
    // A game left open: the cap, and the game named.
    const b = io([], home);
    const game = { ...gpu, readGpu: async () => ({ usedMb: 30_650, tempC: 40, apps: [] }), readCounters: async () => parseCounters(typeperf([[5000, 18_000], [6000, 12_000], [77, 650]])) };
    expect(await worker(["baseline"], { ...b.io, gpu: game })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "worker.json"), "utf8")).desktopBaselineMb).toBe(4096);
    expect(b.out.join("")).toMatch(/game \(process 6000, 12000 MB\)/);
    expect(b.out.join("")).toMatch(/another GPU program was open/);
  });
});
