import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nodePack } from "@/lib/licences";

// ComfyUI-RE-USE lives in this repository and other people's ComfyUIs install it at its pin (a sparse checkout of
// comfy-nodes/ComfyUI-RE-USE at that commit): the pin must be a commit of this branch with the pack exactly as it is
// here. When the pack changes, a later commit moves the pin (and a rebase that rewrites the pack's commit re-pins it).
const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const pin = JSON.parse(read("workflows/comfyui/packs.json"))["ComfyUI-RE-USE"].commit as string;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const inGit = (() => {
  try {
    return git("rev-parse", "--is-inside-work-tree").trim() === "true";
  } catch {
    return false;
  }
})();
const shallow = inGit && git("rev-parse", "--is-shallow-repository").trim() === "true";

describe("the ComfyUI-RE-USE pin", () => {
  it("is the same commit everywhere it is written", () => {
    expect(pin).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.parse(read("workflows/comfyui/requirements.json")).packs["ComfyUI-RE-USE"].commit).toBe(pin);
    expect(read("scripts/comfy/library.spec.mjs")).toContain(`/tree/${pin}/comfy-nodes/ComfyUI-RE-USE`);
    expect(nodePack("ComfyUI-RE-USE")?.repo).toContain(`/tree/${pin}/`);
  });

  it.skipIf(!inGit || shallow)("is an ancestor of HEAD, and the pack there is the pack here", () => {
    expect(() => git("merge-base", "--is-ancestor", pin, "HEAD")).not.toThrow();
    expect(() => git("diff", "--quiet", pin, "HEAD", "--", "comfy-nodes/ComfyUI-RE-USE")).not.toThrow();
  });
});
