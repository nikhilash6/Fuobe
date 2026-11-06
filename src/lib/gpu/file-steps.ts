import { formatBytes } from "./requirements";
import type { Badge, FixPlan, FixStep } from "./types";

/**
 * The files a tool needs on the viewer's GPU, in plain words: for the guided fix's file rows, the readiness line above a
 * preset's Render, and a failed run's tile. Pure (browser and tests): it reads a fix plan the server built and a badge.
 */

/** A file to put on the GPU: what it is, its exact name and size, its folder, and where it downloads from. */
export interface FileStep {
  id: string;
  /** "Orbit LoRA", "Video model", "Decoder". */
  title: string;
  file: string;
  size?: string;
  /** "models/loras", relative to the ComfyUI folder. */
  folder: string;
  /** That folder on the viewer's ComfyUI, when its check read a plain path. */
  path?: string;
  /** https only: the file itself, or its page (`page`) when it needs a sign-in, a licence or a key. */
  url?: string;
  page?: boolean;
  /** The one there isn't usable (cut short, or another file under its name): download it again. */
  again: boolean;
}

export function fileSteps(plan: Pick<FixPlan, "steps"> | null | undefined): FileStep[] {
  return (plan?.steps ?? []).flatMap((s: FixStep) =>
    s.download
      ? [
          {
            id: s.id,
            title: s.label,
            file: s.download.file,
            ...(s.sizeBytes ? { size: formatBytes(s.sizeBytes) } : {}),
            folder: s.download.folder,
            ...(s.download.path && { path: s.download.path }),
            ...(s.download.url && { url: s.download.url }),
            ...(s.download.page && { page: true }),
            again: s.kind === "model-replace",
          },
        ]
      : [],
  );
}

/** The button that opens a file's download: "Get it", or "Open its page" when the page comes first. */
export const getItLabel = (f: Pick<FileStep, "page">): string => (f.page ? "Open its page" : "Get it");

/** "Put it in models/loras" (or the folder on their ComfyUI). */
export const putItIn = (f: Pick<FileStep, "folder" | "path">): string => `Put it in ${f.path ?? `ComfyUI/${f.folder}`}`;

/** What the readiness line says. `files`: the files it names (one gets its own Get it). Null: no line. */
export interface ReadinessLine {
  state: "ready" | "files" | "setup" | "gpu" | "problem";
  words: string;
  files: FileStep[];
}

/**
 * The line above Render for a preset on the viewer's GPU, from its badge (cached) and, when files are missing, its plan:
 * "Ready on your GPU", "Needs 1 file on your GPU: Orbit LoRA", "Needs 2 things on your GPU". It never stops a run: Render
 * stays where it is.
 */
export function readinessLine(badge: Badge | null | undefined, plan: Pick<FixPlan, "steps" | "state"> | null | undefined): ReadinessLine | null {
  if (!badge) return null;
  const [s, steps] = badge;
  if (s === "r") return { state: "ready", words: "Ready on your GPU", files: [] };
  if (s === "g") return { state: "gpu", words: "Needs a bigger GPU than yours", files: [] };
  if (s === "u") return null;
  // The plan is the server's newer read: once it says ready, so does the line.
  if (plan?.state === "ready") return { state: "ready", words: "Ready on your GPU", files: [] };
  // A known problem of this ComfyUI on this system (known-problems.ts) comes first: nothing runs there until it is fixed.
  const known = plan?.steps.find((x) => x.problem);
  if (known) return { state: "problem", words: `Your ComfyUI needs an update: ${known.label.replace(/^Update ComfyUI to /, "")}`, files: [] };
  const files = fileSteps(plan);
  const others = (plan?.steps ?? []).filter((x) => !x.download && x.kind !== "restart" && x.kind !== "hf-licence" && x.kind !== "civitai-key").length;
  if (files.length && !others) {
    const again = files.every((f) => f.again);
    const names = files.map((f) => f.title).filter((t, i, a) => a.indexOf(t) === i);
    const n = files.length;
    return {
      state: "files",
      words: again ? `Download ${n === 1 ? "1 file" : `${n} files`} again on your GPU: ${names.join(", ")}` : `Needs ${n === 1 ? "1 file" : `${n} files`} on your GPU: ${names.join(", ")}`,
      files,
    };
  }
  const n = plan ? files.length + others || steps : steps;
  return { state: "setup", words: `Needs ${n === 1 ? "1 thing" : `${n || 1} things`} on your GPU`, files };
}
