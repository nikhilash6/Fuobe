import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComfyWorkflow, Manifest } from "@/lib/comfy";
import { H3_WORKFLOWS, SWAP_LORAS, TURBO_LORA } from "@/lib/catalog/character-swap";
import { nodePack } from "@/lib/licences";
import { getModel } from "@/lib/catalog";

// Genjutsu's Character swap in the ComfyUI library (docs/research/openjutsu-6.md): the two MiniMax H3 graphs, their
// pinned weights with sizes, their node packs pinned in install-comfyui.sh, the licence text the About page reads, and
// the core nodes checked against this server's /object_info (the packs are not installed here, so /prompt names one).
const dir = path.join(process.cwd(), "workflows/comfyui");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
const subset = JSON.parse(fs.readFileSync(path.join(dir, "object_info.subset.json"), "utf8")) as Record<string, unknown>;
const install = fs.readFileSync(path.join(process.cwd(), "scripts/comfy/install-comfyui.sh"), "utf8");
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const graph = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as ComfyWorkflow;
const [SWAP, RELAY] = H3_WORKFLOWS;
const IDS = [SWAP, RELAY];
const PACK = /^(H3CharacterSwap|H3Relay)/;

describe("Character swap's ComfyUI graphs", () => {
  it("are what the Original and the Relay model run", () => {
    expect(getModel("fuobe-character-swap")!.routes.find((r) => r.provider === "comfyui")!.endpoint).toBe(SWAP);
    expect(getModel("oss-h3-character-swap-relay")!.routes.find((r) => r.provider === "comfyui")!.endpoint).toBe(RELAY);
  });

  it("every weight is pinned to a revision, with its size; the V1 LoRA is optional", () => {
    for (const id of IDS) {
      const w = entry(id);
      expect(w.capability).toBe("video-character-swap");
      expect(w.vramGb).toBe(24);
      expect(w.limits).toMatchObject({ maxDurationSec: 30 });
      for (const m of w.models) {
        expect(m.url, m.file).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
        expect(m.sizeGb, m.file).toBeGreaterThan(0);
      }
      const files = w.models.map((m) => m.file);
      expect(files).toEqual(expect.arrayContaining([SWAP_LORAS["v1.5"].file, SWAP_LORAS.v1.file, TURBO_LORA.file, "minimax_h3_ref2va_pruned_int8_convrot.safetensors", "sam3.1_multiplex_fp16.safetensors"]));
      expect(w.models.find((m) => m.file === SWAP_LORAS.v1.file)!.optional).toBe(true);
      expect(w.models.find((m) => m.file === SWAP_LORAS["v1.5"].file)!.url).toBe(SWAP_LORAS["v1.5"].url);
      // About 46 GB of weights for the swap.
      expect(w.models.filter((m) => !m.optional).reduce((n, m) => n + (m.sizeGb ?? 0), 0)).toBeGreaterThan(46);
    }
  });

  it("say the licences as information: MiniMax H3's territory and notice, SAM, the GPL node packs", () => {
    for (const id of IDS) {
      const l = entry(id).license;
      expect(l).toMatch(/MiniMax H3 Community License/);
      expect(l).toMatch(/territory EXCLUDES the US, the EU, the UK and South Korea/);
      expect(l).toMatch(/show "MiniMax H3"/);
      expect(l).toMatch(/SAM License/);
      expect(l).toMatch(/GPL-3\.0/);
    }
    // Settings → Models & licences knows each pack a graph loads (and its licence).
    for (const id of IDS) for (const n of entry(id).customNodes) expect(nodePack(n.name)?.licence.name, n.name).toBe("GPL-3.0");
  });

  it("name their node packs, pinned the same in install-comfyui.sh", () => {
    expect(entry(SWAP).customNodes).toEqual([expect.objectContaining({ name: "h3_character_swap", repo: expect.stringContaining("0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b") })]);
    expect(entry(RELAY).customNodes).toEqual([expect.objectContaining({ name: "h3-relay", repo: "https://github.com/akatz-ai/h3-relay/tree/e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220" })]);
    expect(install).toContain('H3_TOOL_REF="${H3_TOOL_REF:-0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b}"');
    expect(install).toContain('H3_RELAY_REF="${H3_RELAY_REF:-e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220}"');
    // The Relay changes the server's routes when it loads: opt-in.
    expect(install).toMatch(/H3_RELAY:-0\}" = "1"/);
    // A failed fetch warns and the install goes on (set -e): each git step is inside an if.
    expect(install).toMatch(/if git clone -q --filter=blob:none --no-checkout https:\/\/github\.com\/akatz-labs\/h3-character-swap-tool/);
    expect(install).toMatch(/if \[ -d "\$dest\/\.git" \] \|\| git clone -q https:\/\/github\.com\/akatz-ai\/h3-relay "\$dest"; then/);
  });

  it("their core nodes are on this server; the pack's are not, so /prompt names one of them", () => {
    for (const id of IDS) {
      const classes = [...new Set(Object.values(graph(id)).map((n) => n.class_type))];
      for (const c of classes) {
        expect(Object.hasOwn(subset, c), c).toBe(true);
        // The subset was read from a server with H3 Relay (the person removal validates there); the swap tool's pack isn't on it.
        if (/^H3Relay/.test(c)) expect(subset[c], c).not.toBeNull();
        else if (PACK.test(c)) expect(subset[c], c).toBeNull();
        else expect(subset[c], c).not.toBeNull();
      }
      const w = entry(id);
      expect(w.validated).toBe(false);
      expect((w as typeof w & { validationError?: string }).validationError).toMatch(/missing_node_type/);
    }
  });

  it("every media loader is bound, and the anchor is image2 on the Original's graph only", () => {
    for (const id of IDS) {
      const w = entry(id);
      const loaders = Object.entries(graph(id)).filter(([, n]) => n.class_type === "LoadImage" || n.class_type === "LoadVideo").map(([k]) => k);
      const bound = new Set(Object.values(w.bindings).flatMap((b) => (b ?? []).map((x) => x.node)));
      for (const k of loaders) expect(bound.has(k), `${id} ${k}`).toBe(true);
    }
    expect(entry(SWAP).bindings.image2).toEqual([{ node: "anchor_image", input: "image" }]);
    expect(entry(RELAY).bindings.image2).toBeUndefined();
  });
});
