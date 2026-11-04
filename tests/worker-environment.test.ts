import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inputRules } from "../bin/lib/worker/checks.mjs";
import { comfyArgs, comfyEnv, defaultPathsFlag, modelPathsYaml, OFFLINE_ENV, OwnComfy } from "../bin/lib/worker/comfy.mjs";
import { modelFiles, nodePacks, packFolders, yamlModelDirs } from "../bin/lib/worker/inventory.mjs";
import { minVramBytesFor, needsOf, VRAM_TOLERANCE } from "@/lib/lanes";
import type { RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

const sha = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

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

describe("the worker's model files", () => {
  it("reports a file only when its SHA-256 matches the pinned one, whatever its size says", async () => {
    const models = tempDir("fuobe-worker-models-");
    fs.mkdirSync(path.join(models, "loras"));
    fs.mkdirSync(path.join(models, "vae"));
    fs.writeFileSync(path.join(models, "loras", "good.safetensors"), "hello");
    fs.writeFileSync(path.join(models, "loras", "swapped.safetensors"), "jello");
    fs.writeFileSync(path.join(models, "loras", "unpinned.safetensors"), "hello");
    fs.writeFileSync(path.join(models, "vae", "net.pth"), "weights");
    const index = {
      files: {
        a: { folder: "loras", file: "good.safetensors", sizeBytes: 5 },
        b: { folder: "loras", file: "swapped.safetensors", sizeBytes: 5 },
        c: { folder: "loras", file: "unpinned.safetensors", sizeBytes: 5 },
        d: { folder: "vae", file: "net.pth", sizeBytes: 7, sha256: sha("weights") },
      },
    };
    const pins = { "loras/good.safetensors": sha("hello"), "loras/swapped.safetensors": sha("hello") };
    const cache = path.join(models, "hash-cache.json");
    const found = await modelFiles([models], index, cache, pins);
    expect(found).toEqual([
      { folder: "loras", name: "good.safetensors", size: 5, sha256: sha("hello") },
      { folder: "vae", name: "net.pth", size: 7, sha256: sha("weights") },
    ]);
    // The hashes are kept, so the next start reads nothing again.
    expect(Object.keys(JSON.parse(fs.readFileSync(cache, "utf8")))).toHaveLength(3);
  });

  it("counts only the copy ComfyUI finds first: a wrong copy in an earlier folder isn't made up for by a good one later", async () => {
    const a = tempDir("fuobe-worker-models-a-");
    const b = tempDir("fuobe-worker-models-b-");
    for (const d of [a, b]) fs.mkdirSync(path.join(d, "loras"));
    // The same name and size in both: the first folder's copy is another file.
    fs.writeFileSync(path.join(a, "loras", "x.safetensors"), "EVIL!");
    fs.writeFileSync(path.join(b, "loras", "x.safetensors"), "GOOD!");
    // A folder (not a file) under the name doesn't count as a copy, as for ComfyUI: the next folder's file is the one.
    fs.mkdirSync(path.join(a, "loras", "y.safetensors"));
    fs.writeFileSync(path.join(b, "loras", "y.safetensors"), "GOOD!");
    const index = { files: { x: { folder: "loras", file: "x.safetensors", sizeBytes: 5 }, y: { folder: "loras", file: "y.safetensors", sizeBytes: 5 } } };
    const pins = { "loras/x.safetensors": sha("GOOD!"), "loras/y.safetensors": sha("GOOD!") };
    const cache = path.join(tempDir("fuobe-worker-cache-"), "hash-cache.json");
    expect(await modelFiles([a, b], index, cache, pins)).toEqual([{ folder: "loras", name: "y.safetensors", size: 5, sha256: sha("GOOD!") }]);
    // The good copy first: reported.
    expect((await modelFiles([b, a], index, cache, pins)).map((f) => f.name).sort()).toEqual(["x.safetensors", "y.safetensors"]);
  });

  it("refuses a file that ComfyUI's own models folder or its own extra_model_paths.yaml has with other content", async () => {
    const models = tempDir("fuobe-worker-models-");
    const comfyDir = tempDir("fuobe-worker-comfy-");
    const extra = tempDir("fuobe-worker-extra-");
    fs.mkdirSync(path.join(models, "loras"));
    fs.mkdirSync(path.join(models, "diffusion_models"));
    for (const f of ["a", "b", "c", "d"]) fs.writeFileSync(path.join(models, "loras", `${f}.safetensors`), "GOOD!");
    fs.writeFileSync(path.join(models, "diffusion_models", "u.safetensors"), "GOOD!");
    // ComfyUI's own models folder: another a, and the same b; its older name for diffusion_models (unet) holds another u.
    fs.mkdirSync(path.join(comfyDir, "models", "loras"), { recursive: true });
    fs.mkdirSync(path.join(comfyDir, "models", "unet"), { recursive: true });
    fs.writeFileSync(path.join(comfyDir, "models", "loras", "a.safetensors"), "EVIL!");
    fs.writeFileSync(path.join(comfyDir, "models", "loras", "b.safetensors"), "GOOD!");
    fs.writeFileSync(path.join(comfyDir, "models", "unet", "u.safetensors"), "EVIL!");
    // Its own extra_model_paths.yaml adds a folder with another c (another size, too).
    fs.mkdirSync(path.join(extra, "my-loras"));
    fs.writeFileSync(path.join(extra, "my-loras", "c.safetensors"), "EVIL!!!");
    fs.writeFileSync(path.join(comfyDir, "extra_model_paths.yaml"), `other:\n    base_path: ${extra}\n    loras: my-loras/\n`);
    type F = { folder: string; file: string; sizeBytes: number };
    const entries: [string, F][] = [..."abcd"].map((f) => [f, { folder: "loras", file: `${f}.safetensors`, sizeBytes: 5 }]);
    const index: { files: Record<string, F> } = { files: Object.fromEntries([...entries, ["u", { folder: "diffusion_models", file: "u.safetensors", sizeBytes: 5 }]]) };
    const pins = Object.fromEntries(Object.values(index.files).map((f) => [`${f.folder}/${f.file}`, sha("GOOD!")]));
    const found = await modelFiles([models], index, path.join(models, "hash-cache.json"), pins, { comfyDir });
    expect(found.map((f) => f.name).sort()).toEqual(["b.safetensors", "d.safetensors"]);
    // The worker's model folder is ComfyUI's own models folder (setup's default): the same files, all reported.
    const same = await modelFiles([path.join(comfyDir, "models")], { files: { b: index.files.b } }, path.join(models, "hash-cache.json"), pins, { comfyDir });
    expect(same.map((f) => f.name)).toEqual(["b.safetensors"]);
  });

  it("reads the folders an extra_model_paths.yaml adds as ComfyUI does", () => {
    const dir = path.resolve("/comfy");
    const text = [
      "# ComfyUI's own example shape",
      "a111:",
      "    base_path: ~/sd # a comment",
      "    is_default: true",
      "    checkpoints: models/Stable-diffusion",
      "    unet: models/unet",
      "    loras: |",
      "         models/Lora",
      "         models/LyCORIS",
      "    clip: \"models/clip\"",
      "rel:",
      "    base_path: ../shared",
      "    vae: vae",
      "noBase:",
      "    upscale_models: up",
      "nothing:",
    ].join("\n");
    const d = yamlModelDirs(text, dir, {}, path.resolve("/home/me"));
    expect(d.checkpoints).toEqual([path.normalize(path.resolve("/home/me/sd/models/Stable-diffusion"))]);
    expect(d.diffusion_models).toEqual([path.normalize(path.resolve("/home/me/sd/models/unet"))]);
    expect(d.loras).toEqual([path.resolve("/home/me/sd/models/Lora"), path.resolve("/home/me/sd/models/LyCORIS")].map((p) => path.normalize(p)));
    expect(d.text_encoders).toEqual([path.normalize(path.resolve("/home/me/sd/models/clip"))]);
    expect(d.vae).toEqual([path.resolve("/shared/vae")]);
    expect(d.upscale_models).toEqual([path.resolve("/comfy/up")]);
    expect(d.is_default).toBeUndefined();
  });

  it("puts its model folders first in ComfyUI's search, in their order, when its ComfyUI knows is_default", () => {
    const first = modelPathsYaml(["D:/a", "E:/b"], ["loras"], { first: true });
    expect(first).toBe(['fuobe_worker_1:', '  base_path: "E:/b"', "  is_default: true", "  loras: loras", 'fuobe_worker_0:', '  base_path: "D:/a"', "  is_default: true", "  loras: loras", ""].join("\n"));
    // ComfyUI (folder_paths.add_model_folder_path) puts each is_default folder at the front, in the order it reads them.
    const search = ["<its own models>/loras"];
    for (const m of first.matchAll(/base_path: "(.+)"/g)) search.unshift(`${m[1]}/loras`);
    expect(search).toEqual(["D:/a/loras", "E:/b/loras", "<its own models>/loras"]);
    // An older ComfyUI stops on is_default: none, in the order given.
    expect(modelPathsYaml(["D:/a", "E:/b"], ["loras"])).toBe(['fuobe_worker_0:', '  base_path: "D:/a"', "  loras: loras", 'fuobe_worker_1:', '  base_path: "E:/b"', "  loras: loras", ""].join("\n"));
    const comfyDir = tempDir("fuobe-worker-comfy-");
    expect(defaultPathsFlag(comfyDir)).toBe(false);
    fs.mkdirSync(path.join(comfyDir, "utils"));
    fs.writeFileSync(path.join(comfyDir, "utils", "extra_config.py"), 'is_default = False\nif "is_default" in conf:\n    is_default = conf.pop("is_default")\n');
    expect(defaultPathsFlag(comfyDir)).toBe(true);
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

describe("the worker's built rules", () => {
  it("must be there: a worker never runs without them", () => {
    expect(() => inputRules(path.join(tempDir("fuobe-worker-norules-"), "input-rules.json"))).toThrow();
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
