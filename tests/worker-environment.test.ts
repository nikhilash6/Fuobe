import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comfyArgs } from "../bin/lib/worker/comfy.mjs";
import { nodePacks, packFolders } from "../bin/lib/worker/inventory.mjs";
import { minVramBytesFor, needsOf, VRAM_TOLERANCE } from "@/lib/lanes";
import type { RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

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
