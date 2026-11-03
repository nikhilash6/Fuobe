import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comfyArgs, comfyEnv, OFFLINE_ENV, OwnComfy } from "../bin/lib/worker/comfy.mjs";
import { nodePacks, packFolders } from "../bin/lib/worker/inventory.mjs";
import { minVramBytesFor, needsOf, VRAM_TOLERANCE } from "@/lib/lanes";
import type { RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

/** A port nothing listens on (the system picks it). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

describe("the worker's node packs", () => {
  it("are found whatever the case of their folder, and ComfyUI gets the folder's own name", () => {
    const comfyDir = tempDir("fuobe-worker-packs-");
    const nodes = path.join(comfyDir, "custom_nodes");
    for (const d of ["comfyui-rmbg", "ComfyUI-QwenASR", "comfyui-videohelpersuite", "something-else"]) fs.mkdirSync(path.join(nodes, d), { recursive: true });
    fs.mkdirSync(path.join(nodes, "comfyui-rmbg", ".git"));
    fs.writeFileSync(path.join(nodes, "comfyui-rmbg", ".git", "HEAD"), `${"a".repeat(40)}\n`);
    const index = { packs: { "ComfyUI-RMBG": { repo: "https://github.com/x/ComfyUI-RMBG.git" }, "ComfyUI-QwenASR": {}, "ComfyUI-VideoHelperSuite": { repo: "https://github.com/y/ComfyUI-VideoHelperSuite" } } };
    const found = packFolders(comfyDir, index).sort((a, b) => a.name.localeCompare(b.name));
    expect(found).toEqual([
      { name: "ComfyUI-QwenASR", folder: "ComfyUI-QwenASR", commit: null },
      { name: "ComfyUI-RMBG", folder: "comfyui-rmbg", commit: "a".repeat(40) },
      { name: "ComfyUI-VideoHelperSuite", folder: "comfyui-videohelpersuite", commit: null },
    ]);
    // The studio sees the catalog's names; ComfyUI's whitelist gets the folders.
    expect(nodePacks(comfyDir, index).map((p) => p.name).sort()).toEqual(["ComfyUI-QwenASR", "ComfyUI-RMBG", "ComfyUI-VideoHelperSuite"]);
    const args = comfyArgs({ port: 8190, workDir: "/w" }, found.map((p) => p.folder));
    expect(args.slice(args.indexOf("--whitelist-custom-nodes") + 1)).toEqual(["ComfyUI-QwenASR", "comfyui-rmbg", "comfyui-videohelpersuite"]);
  });
});

describe("its own ComfyUI's environment", () => {
  const pc = {
    SystemRoot: "C:\\Windows",
    Path: "C:\\Windows\\system32;C:\\ffmpeg\\bin",
    TEMP: "C:\\Temp",
    USERPROFILE: "C:\\Users\\me",
    CUDA_VISIBLE_DEVICES: "0",
    HF_HOME: "D:\\hf",
    HF_TOKEN: "hf_secret",
    OPENAI_API_KEY: "sk-secret",
    FUOBE_WORKER_TOKEN: "fuobe_wkr_secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    PYTHONPATH: "C:\\elsewhere",
    HF_HUB_OFFLINE: "0",
  };

  it("holds only what ComfyUI needs, with downloads and installs off", () => {
    const env = comfyEnv(pc);
    expect(env).toEqual({ SystemRoot: "C:\\Windows", Path: "C:\\Windows\\system32;C:\\ffmpeg\\bin", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\me", CUDA_VISIBLE_DEVICES: "0", HF_HOME: "D:\\hf", ...OFFLINE_ENV });
    expect(OFFLINE_ENV).toEqual({ HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", PIP_NO_INDEX: "1" });
  });

  it("adds the PC owner's own variables from worker.json, but never a worker setting, and never turns downloads on", () => {
    const env = comfyEnv(pc, { COMFY_FLAG: "x", FUOBE_WORKER_TOKEN: "t", PIP_NO_INDEX: "0", HF_HUB_OFFLINE: "0" });
    expect(env.COMFY_FLAG).toBe("x");
    expect(env.FUOBE_WORKER_TOKEN).toBeUndefined();
    expect(env.PIP_NO_INDEX).toBe("1");
    expect(env.HF_HUB_OFFLINE).toBe("1");
  });

  it("is what the process it starts gets", async () => {
    const dir = tempDir("fuobe-worker-env-");
    const port = await freePort();
    const out = path.join(dir, "env.json");
    const script = `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env)); require("http").createServer((q, s) => s.end("{}")).listen(${port}, "127.0.0.1");`;
    const c = new OwnComfy({ port, workDir: dir, comfyDir: dir, comfyEnv: { COMFY_FLAG: "x" }, comfyCommand: [process.execPath, "-e", script] }, { env: { ...process.env, OPENAI_API_KEY: "sk-secret", FUOBE_WORKER_TOKEN: "fuobe_wkr_secret" } });
    try {
      await c.start();
      const seen = JSON.parse(fs.readFileSync(out, "utf8")) as Record<string, string>;
      expect(seen.OPENAI_API_KEY).toBeUndefined();
      expect(seen.FUOBE_WORKER_TOKEN).toBeUndefined();
      expect(seen.COMFY_FLAG).toBe("x");
      expect(seen.HF_HUB_OFFLINE).toBe("1");
      expect(seen.TRANSFORMERS_OFFLINE).toBe("1");
      expect(seen.PIP_NO_INDEX).toBe("1");
      // Nothing else of this process's, but what Windows itself needs in every new process (Node adds these when missing).
      const windows = process.platform === "win32" ? ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"] : [];
      const allowed = new Set([...Object.keys(comfyEnv(process.env, { COMFY_FLAG: "x" })).map((k) => k.toUpperCase()), ...windows]);
      const extra = Object.keys(seen).filter((k) => !k.startsWith("=") && !allowed.has(k.toUpperCase()) && k in process.env);
      expect(extra).toEqual([]);
    } finally {
      await c.stop();
    }
  });
});

describe("VRAM: a card takes the lanes made for its size", () => {
  const index = {
    files: {},
    packs: {},
    workflows: { big: { core: [], packs: {}, files: [], optional: [], vramGb: 32, isolated: false, firstRun: [] }, mid: { core: [], packs: {}, files: [], optional: [], vramGb: 24, isolated: false, firstRun: [] } },
  } as unknown as RequirementIndex;
  const MiB = 2 ** 20;

  it("allows 3% under the whole GB", () => {
    expect(VRAM_TOLERANCE).toBe(0.03);
    expect(minVramBytesFor(32)).toBe(Math.round(32 * 2 ** 30 * 0.97));
    expect(minVramBytesFor(0)).toBe(0);
    const big = needsOf(index, "big")!.minVramBytes;
    // A 32 GB card reports about 31.8 GiB: it takes the 32 GB lanes. A 30 GiB card doesn't.
    expect(big <= 32_607 * MiB).toBe(true);
    expect(big <= 30 * 2 ** 30).toBe(false);
    // A 24 GB card that reports a few MB under 24 GiB takes the 24 GB lanes; a 22 GiB card doesn't.
    const mid = needsOf(index, "mid")!.minVramBytes;
    expect(mid <= 24_564 * MiB).toBe(true);
    expect(mid <= 22 * 2 ** 30).toBe(false);
  });
});
