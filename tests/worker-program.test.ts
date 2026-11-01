import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GpuWatch, othersOf, parseApps, parseGpu } from "../bin/lib/worker/gpu.mjs";
import { cleanJob, vetGraph } from "../bin/lib/worker/checks.mjs";
import { comfyArgs, OwnComfy, PortBusy, portFree } from "../bin/lib/worker/comfy.mjs";
import { parseFor, syncedFolder } from "../bin/lib/worker/config.mjs";
import { localPause } from "../bin/lib/worker/run.mjs";
import { inventoryHash as workerHash } from "../bin/lib/worker/inventory.mjs";

const MIN = 60_000;
const PORT = 3367;

describe("the GPU check (check 11)", () => {
  it("reads nvidia-smi, [N/A] included", () => {
    expect(parseGpu("6144, 61\n")).toEqual({ usedMb: 6144, tempC: 61 });
    expect(parseApps("1234, C:\\Program Files\\Blender\\blender.exe, [N/A]\n77, python.exe, 2048\n")).toEqual([
      { pid: 1234, name: "blender.exe", usedMb: null },
      { pid: 77, name: "python.exe", usedMb: 2048 },
    ]);
  });

  it("counts others' VRAM as the total minus its own ComfyUI's", () => {
    const own = { running: true, mb: 9000, pid: 77 };
    expect(othersOf({ usedMb: 9800, apps: [{ pid: 77, name: "python.exe", usedMb: null }] }, own, 1024).busy).toBe(false);
    expect(othersOf({ usedMb: 12000, apps: [{ pid: 77, name: "python.exe", usedMb: null }, { pid: 5, name: "blender.exe", usedMb: null }] }, own, 1024)).toMatchObject({ busy: true, who: "blender.exe" });
    // Stopped, it holds nothing: a ComfyUI on 8188 that keeps its models loaded keeps the worker paused.
    expect(othersOf({ usedMb: 4000, apps: [] }, { running: false }, 1024).busy).toBe(true);
    expect(othersOf({ usedMb: 300, apps: [{ pid: 9, name: "game.exe", usedMb: 2000 }] }, { running: false }, 1024)).toMatchObject({ busy: true, who: "game.exe" });
  });

  it("pauses at once; with the automatic resume off, never resumes by itself", () => {
    const g = new GpuWatch({ autoResume: false, resumeAfterMs: 10 * MIN, resumeBelowC: 75 });
    g.update({ busy: true, who: "blender.exe" }, 60, 0);
    expect(g.paused).toBe(true);
    g.update({ busy: false }, 40, 1);
    g.update({ busy: false }, 40, 120 * MIN);
    expect(g.paused).toBe(true);
    g.clear();
    expect(g.paused).toBe(false);
  });

  it("with it on, resumes only after the whole cool-down; one busy reading starts it again; a hot GPU waits", () => {
    const g = new GpuWatch({ autoResume: true, resumeAfterMs: 10 * MIN, resumeBelowC: 75 });
    g.update({ busy: true, who: "x" }, 60, 0);
    g.update({ busy: false }, 50, 1 * MIN);
    g.update({ busy: false }, 50, 10 * MIN);
    expect(g.paused).toBe(true);
    g.update({ busy: true, who: "x" }, 60, 10.5 * MIN);
    g.update({ busy: false }, 50, 11 * MIN);
    g.update({ busy: false }, 50, 20.9 * MIN);
    expect(g.paused).toBe(true);
    g.update({ busy: false }, 80, 21 * MIN);
    expect(g.paused).toBe(true);
    g.update({ busy: false }, 70, 21.1 * MIN);
    expect(g.paused).toBe(false);
  });

  it("a pause by hand always wins over the GPU and its automatic resume", () => {
    const free = { paused: false, who: null };
    expect(localPause({ paused: true }, free, null, 0)).toEqual({ paused: true, why: "here", until: null });
    expect(localPause({ paused: true }, { paused: true, who: "x" }, null, 0)?.why).toBe("here");
    expect(localPause({ paused: false }, { paused: true, who: "blender.exe" }, null, 0)?.why).toBe("gpu-busy:blender.exe");
    expect(localPause({ paused: true, now: true }, free, null, 0)?.why).toBe("here-now");
    expect(localPause({ paused: false }, free, "port-busy", 0)).toEqual({ paused: true, why: "port-busy", until: null });
  });

  it("--for 2h ends by itself after 2 hours (check 10)", () => {
    const until = 2 * 60 * MIN;
    expect(parseFor("2h")).toBe(until);
    expect(parseFor("2 days")).toBeNull();
    expect(localPause({ paused: true, until }, { paused: false }, null, until - 1)?.why).toBe(`here-until:${until}`);
    expect(localPause({ paused: true, until }, { paused: false }, null, until)).toBeNull();
  });
});

describe("graph checks (check 7)", () => {
  const allowed = new Set(["LoadImage", "SaveImage", "KSampler", "CheckpointLoaderSimple"]);
  const verified = new Set(["model.safetensors", "checkpoints/model.safetensors"]);
  it("refuses an unknown node, a path, an unverified model; passes the rest", () => {
    const ok = { "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "model.safetensors" } }, "2": { class_type: "SaveImage", inputs: { filename_prefix: "fuobe/x", text: "wait.. a fox" } } };
    expect(vetGraph(ok, allowed, verified)).toBeNull();
    expect(vetGraph({ "1": { class_type: "ExecuteAnything", inputs: {} } }, allowed, verified)).toBe("unknown-node");
    for (const p of ["C:\\Windows\\win.ini", "/etc/passwd", "../../secrets.txt", "\\\\server\\share\\x", "~/x"]) {
      expect(vetGraph({ "1": { class_type: "LoadImage", inputs: { image: p } } }, allowed, verified)).toBe("unsafe-path");
    }
    expect(vetGraph({ "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "other.safetensors" } } }, allowed, verified)).toBe("model-unverified");
  });
});

describe("its own ComfyUI (check 12)", () => {
  it("a port another program holds: refused, and nothing connects to it", async () => {
    let connections = 0;
    const squatter = net.createServer((s) => {
      connections++;
      s.destroy();
    });
    await new Promise<void>((r) => squatter.listen(PORT, "127.0.0.1", r));
    try {
      expect(await portFree(PORT)).toBe(false);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-worker-port-"));
      const c = new OwnComfy({ port: PORT, workDir: dir, comfyDir: dir, comfyCommand: [process.execPath, "-e", "setTimeout(()=>{},1e6)"] });
      await expect(c.start()).rejects.toBeInstanceOf(PortBusy);
      expect(c.alive()).toBe(false);
      expect(connections).toBe(0);
    } finally {
      await new Promise((r) => squatter.close(r));
    }
    expect(await portFree(PORT)).toBe(true);
  });

  it("starts with its own folders, localhost only, no metadata, no browser, only the packs it needs", () => {
    const a = comfyArgs({ port: 8190, workDir: "/w" }, ["ComfyUI-VideoHelperSuite"]);
    expect(a).toEqual(expect.arrayContaining(["--listen", "127.0.0.1", "--port", "8190", "--disable-auto-launch", "--disable-metadata", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "ComfyUI-VideoHelperSuite"]));
    expect(a[a.indexOf("--input-directory") + 1]).toBe(path.join("/w", "input"));
  });
});

describe("cleanup (check 13) and setup", () => {
  it("after a job, its files leave the worker folder and its history entry goes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-worker-clean-"));
    const f = { input: path.join(dir, "input"), output: path.join(dir, "output"), temp: path.join(dir, "temp") };
    for (const d of Object.values(f)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(f.input, "fuobe_abcdefgh12.png"), "x");
    fs.mkdirSync(path.join(f.output, "fuobe"));
    fs.writeFileSync(path.join(f.output, "fuobe", "out_00001_.png"), "x");
    fs.writeFileSync(path.join(f.temp, "preview.png"), "x");
    const calls: string[] = [];
    await cleanJob({ inputs: [{ name: "fuobe_abcdefgh12.png" }], promptId: "p-1" }, f, "http://127.0.0.1:1", (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url} ${init.body}`);
      return new Response("{}");
    }) as typeof fetch);
    expect(Object.values(f).flatMap((d) => fs.readdirSync(d))).toEqual([]);
    expect(calls).toEqual(['POST http://127.0.0.1:1/history {"delete":["p-1"]}']);
  });

  it("refuses a synced folder", () => {
    expect(syncedFolder("C:\\Users\\me\\OneDrive\\Worker")).toBe(true);
    expect(syncedFolder("D:\\FuobeWorker")).toBe(false);
  });

  it("hashes its inventory the way the studio does", async () => {
    const { inventoryHash } = await import("@/server/computer/pool");
    const inv = { files: [{ folder: "loras", name: "a.safetensors", size: 7, sha256: null }], nodePacks: [{ name: "P", commit: null }] };
    expect(workerHash(inv)).toBe(inventoryHash(inv));
  });
});
