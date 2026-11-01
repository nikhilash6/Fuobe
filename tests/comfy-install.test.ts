import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/comfy";
import { installScript, nodeInstall, workflowSource } from "@/lib/comfy-install";

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const workflow = (id: string) => manifest.workflows.find((w) => w.id === id)!;
/** The install script read on an install with nothing yet (every model missing). */
const script = (id: string) => installScript({ ...workflow(id), models: workflow(id).models.map((m) => ({ ...m, present: false })) });
const H3_TOOL = "0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b";
const H3_RELAY = "e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220";

describe("Workflows → Copy install commands", () => {
  it("never hands git a GitHub page address (…/tree/<commit>/…): git can't clone those", () => {
    for (const wf of manifest.workflows) {
      const lines = script(wf.id).split("\n");
      for (const l of lines.filter((x) => /\bgit\b.*\bclone\b/.test(x))) expect(l, `${wf.id}: ${l}`).not.toMatch(/\/tree\//);
    }
  });

  it("H3 Relay: clones the repo (unless it's there), then fetches and checks out the pinned commit", () => {
    const s = script("video-character-swap-h3-relay");
    expect(s).toContain('{ [ -d "$COMFYUI/custom_nodes/h3-relay/.git" ] || git clone https://github.com/akatz-ai/h3-relay "$COMFYUI/custom_nodes/h3-relay"; }');
    expect(s).toContain(`git -C "$COMFYUI/custom_nodes/h3-relay" fetch -q --depth 1 origin ${H3_RELAY} 2>/dev/null || true; } && git -C "$COMFYUI/custom_nodes/h3-relay" checkout -q ${H3_RELAY}`);
  });

  it("h3_character_swap: the pack's folder copied out of the tool at the pinned commit (sparse), as install-comfyui.sh does", () => {
    const s = script("video-character-swap-h3");
    expect(s).toContain("git clone -q --filter=blob:none --no-checkout https://github.com/akatz-labs/h3-character-swap-tool");
    expect(s).toContain("sparse-checkout set --no-cone /worker_nodes/h3_character_swap/");
    expect(s).toContain(`checkout -q ${H3_TOOL}`);
    expect(s).toContain('[ -d "$COMFYUI/custom_nodes/h3_character_swap" ] || { tmp="$(mktemp -d)"');
    expect(s).toContain('cp -r "$tmp/worker_nodes/h3_character_swap" "$COMFYUI/custom_nodes/h3_character_swap"; rm -rf "$tmp"; }');
    // The same pin and folder as the install script.
    const sh = fs.readFileSync(path.join(__dirname, "../scripts/comfy/install-comfyui.sh"), "utf8");
    expect(sh).toContain(`H3_TOOL_REF="\${H3_TOOL_REF:-${H3_TOOL}}"`);
    expect(sh).toContain(`H3_RELAY_REF="\${H3_RELAY_REF:-${H3_RELAY}}"`);
    expect(sh).toContain("sparse-checkout set --no-cone /worker_nodes/h3_character_swap/");
  });

  it("a plain repo address is cloned as before, and models still follow the packs", () => {
    const wf = manifest.workflows.find((w) => w.customNodes.some((n) => !n.repo.includes("/tree/")) && w.models.some((m) => m.url && !m.optional))!;
    const s = script(wf.id).split("\n");
    expect(s[0]).toBe("COMFYUI=${COMFYUI:-$HOME/ComfyUI}");
    const plain = wf.customNodes.find((n) => !n.repo.includes("/tree/"))!;
    expect(s).toContain(`git -C "$COMFYUI/custom_nodes" clone ${plain.repo}`);
    expect(s.findIndex((l) => l.startsWith("mkdir -p"))).toBeGreaterThan(s.findIndex((l) => l.includes(plain.repo)));
  });

  it("a gated download (LTX-2.5) says to accept its licence first, and sends the Hugging Face token", () => {
    const s = script("ltx25-t2v").split("\n");
    const gated = workflow("ltx25-t2v").models.filter((m) => m.gated);
    expect(gated.length).toBeGreaterThan(0);
    expect(s.filter((l) => l.startsWith("#"))).toEqual(["# Gated: accept the licence at https://huggingface.co/Lightricks/LTX-2.5, then export HF_TOKEN=<your Hugging Face token>"]);
    for (const m of gated) expect(s.find((l) => l.includes(m.url!)), m.file).toContain(`wget -c --header="Authorization: Bearer $HF_TOKEN" -O`);
    // The comment comes before the downloads; an ungated download sends no token.
    expect(s.findIndex((l) => l.startsWith("#"))).toBeLessThan(s.findIndex((l) => l.startsWith("mkdir -p")));
    expect(script("flux1-dev-t2i")).not.toMatch(/HF_TOKEN|^#/m);
  });

  it("links each workflow's graph in the repo: the file to download and its GitHub page", () => {
    expect(workflowSource("flux1-dev-t2i.json")).toEqual({
      raw: "https://raw.githubusercontent.com/workingprototype/fuobe/main/workflows/comfyui/flux1-dev-t2i.json",
      page: "https://github.com/workingprototype/fuobe/blob/main/workflows/comfyui/flux1-dev-t2i.json",
    });
    for (const wf of manifest.workflows) expect(fs.existsSync(path.join(__dirname, "../workflows/comfyui", wf.file)), wf.file).toBe(true);
  });

  it("the commands run, and run again, as install-comfyui.sh does: a pinned clone moves to its pin, a copied pack isn't copied twice", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-install-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();
    /** A stand-in remote with two commits; the first is the pin. */
    const remote = (name: string, file: string) => {
      const d = path.join(tmp, "remotes", name);
      fs.mkdirSync(path.join(d, path.dirname(file)), { recursive: true });
      git(tmp, "init", "-q", d);
      fs.writeFileSync(path.join(d, file), "pinned\n");
      git(d, "add", "-A");
      git(d, "commit", "-q", "-m", "pinned");
      const pin = git(d, "rev-parse", "HEAD");
      fs.writeFileSync(path.join(d, file), "newer\n");
      git(d, "commit", "-q", "-am", "newer");
      return { dir: d, pin, head: git(d, "rev-parse", "HEAD") };
    };
    try {
      const relay = remote("relay", "__init__.py");
      const tool = remote("tool", "worker_nodes/h3_character_swap/__init__.py");
      const comfy = path.join(tmp, "ComfyUI");
      fs.mkdirSync(path.join(comfy, "custom_nodes"), { recursive: true });
      const commands = [
        nodeInstall({ name: "h3-relay", repo: `https://github.com/akatz-ai/h3-relay/tree/${relay.pin}` }).replaceAll("https://github.com/akatz-ai/h3-relay", relay.dir),
        nodeInstall({ name: "h3_character_swap", repo: `https://github.com/akatz-labs/h3-character-swap-tool/tree/${tool.pin}/worker_nodes/h3_character_swap` }).replaceAll(
          "https://github.com/akatz-labs/h3-character-swap-tool",
          tool.dir,
        ),
      ].join("\n");
      const run = () => execFileSync("bash", ["-c", commands], { env: { ...process.env, COMFYUI: comfy }, stdio: "pipe" });
      const pack = path.join(comfy, "custom_nodes", "h3_character_swap");
      const clone = path.join(comfy, "custom_nodes", "h3-relay");
      run();
      expect(git(clone, "rev-parse", "HEAD")).toBe(relay.pin);
      expect(fs.readFileSync(path.join(pack, "__init__.py"), "utf8")).toBe("pinned\n");
      // An older checkout (here: the newer commit) moves to the pin; the copied pack stays as it is, not nested in itself.
      git(clone, "checkout", "-q", relay.head);
      run();
      expect(git(clone, "rev-parse", "HEAD")).toBe(relay.pin);
      expect(fs.readdirSync(pack)).toEqual(["__init__.py"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
