import { compareVersions } from "./requirements";
import type { GpuInventory, Need } from "./types";

/**
 * Known problems of a ComfyUI version on a kind of system: runs there stop the same way every time, whatever the tool,
 * so Retry never helps. The GPU pre-flight reads them from the last check's facts (system_stats: OS, ComfyUI, Python,
 * launch flags; nothing here asks the GPU) and names the fix before Run, recommended first; a run that already stopped
 * with one gets the same words (diagnose.ts). Pure: browser and server.
 *
 * memfd (ComfyUI 0.43.0 to 0.43.2 on Linux): its dynamic VRAM keeps models in an anonymous file made with Python's
 * os.memfd_create (comfy/anonymous_file.py, ComfyUI commit 503d785f0, 2026-10-22). Pythons built against an old glibc
 * don't have that call (uv's and other standalone Python builds, made with Clang against an old glibc), so the first
 * model load stops with "module 'os' has no attribute 'memfd_create'" (KSampler, where models load). ComfyUI 0.44.0
 * calls libc itself (commit 54a4e56ad, 2026-10-28). Windows and macOS never reach that call.
 */

export type KnownProblemId = "comfy-043-memfd";

export interface KnownProblem {
  id: KnownProblemId;
  /** One plain sentence: what stops and why. */
  words: string;
  /** The fixes, recommended first, each with an example. */
  fixes: { label: string; example?: string }[];
  /** The ComfyUI version that fixes it. */
  fixedIn: string;
}

const MEMFD: Omit<KnownProblem, "words"> = {
  id: "comfy-043-memfd",
  fixedIn: "0.44.0",
  fixes: [
    { label: "Update ComfyUI to 0.44.0 or newer (recommended)", example: "git -C ComfyUI pull, then pip install -r ComfyUI/requirements.txt" },
    { label: "Or start ComfyUI with --disable-dynamic-vram", example: "python main.py --listen --disable-dynamic-vram" },
  ],
};

const memfdWords = (version?: string) =>
  `ComfyUI ${version ? `${version} ` : "0.43 "}stops at the first model on this Linux Python (it has no memfd_create). Update ComfyUI to 0.44.0 or newer, or start it with --disable-dynamic-vram.`;

/** A Python built the way uv's and other standalone builds are (Clang against an old glibc): system_stats' build part. */
const STANDALONE = /^Clang /;

/** The known problems this check's facts show, before any run. */
export function knownProblems(inv: Pick<GpuInventory, "reachable" | "comfy" | "devices">): KnownProblem[] {
  const c = inv.comfy;
  if (!inv.reachable || !c?.version) return [];
  const out: KnownProblem[] = [];
  const linux = c.os === "posix" && !inv.devices.some((d) => d.type === "mps");
  const v043 = compareVersions(c.version, "0.43.0") >= 0 && compareVersions(c.version, "0.44.0") < 0;
  // ComfyUI's dynamic VRAM is on unless a launch flag turns it off (comfy/cli_args.py enables_dynamic_vram).
  const dynamicOn = !c.flags?.dynamicVramOff && !c.flags?.cpuOnly;
  if (linux && v043 && dynamicOn && STANDALONE.test(c.pythonBuild ?? "")) out.push({ ...MEMFD, words: memfdWords(c.version) });
  return out;
}

/** A run's error that is one of these problems (a node's message, as ComfyUI sent it). */
export function knownProblemOf(message: string | undefined, version?: string): KnownProblem | null {
  const m = String(message ?? "").slice(0, 4096);
  if (/has no attribute ['"]?memfd_create/i.test(m)) return { ...MEMFD, words: memfdWords(version) };
  return null;
}

/** A known problem's fixes, recommended first (the guided fix lists them with their examples). */
export function knownFixes(id: string | undefined): KnownProblem["fixes"] {
  return id === MEMFD.id ? MEMFD.fixes : [];
}

/** The step a known problem adds to every tool's plan: updating ComfyUI (its commands come with the step). */
export function knownProblemNeed(p: KnownProblem): Need {
  return {
    key: `known:${p.id}`,
    kind: "comfy-update",
    label: `Update ComfyUI to ${p.fixedIn} or newer`,
    detail: p.words,
    problem: p.id,
  };
}
