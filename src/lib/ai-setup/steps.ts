/**
 * The setup's steps, as the open Fuobe tab ticks them off and as the person's AI reads them from the status: one pure
 * function, so both see the same list. Every label and detail comes from the tables here; only fixed words, whole
 * numbers and the studio's own address go into them.
 */
import { FIRST_MODEL_NAME } from "./first-picture";
import type { InstallKind, SetupView } from "./facts";
import { RESTART_WAIT_MIN } from "./restart";

export type StepId = "comfyui" | "allowed" | "guard" | "connect" | "paired" | "address" | "connected" | "model" | "picture";
export type StepState = "done" | "todo" | "working" | "warn";

export interface Step {
  id: StepId;
  label: string;
  state: StepState;
  detail?: string;
}

export const INSTALL_LABEL: Record<InstallKind, string> = {
  desktop: "ComfyUI Desktop",
  portable: "Portable or Easy-Install",
  "stability-matrix": "Stability Matrix",
  terminal: "Started from a terminal",
};

export const STEP_LABEL: Record<StepId, string> = {
  comfyui: "ComfyUI is running",
  allowed: "ComfyUI lets Fuobe in",
  guard: "Other websites are kept out",
  connect: "Fuobe Connect is installed",
  paired: "ComfyUI is paired with your account",
  address: "Web address works",
  connected: "Fuobe is connected",
  model: "A picture model is ready",
  picture: "First picture made",
};

const hostOf = (site: string) => {
  try {
    return new URL(site).host;
  } catch {
    return site;
  }
};

const gb = (tenths: number) => `${(tenths / 10).toFixed(tenths >= 100 ? 0 : 1)} GB`;

/** A ComfyUI paired with Fuobe Connect answers, and the account's runs go to it. */
const pairedOnline = (v: SetupView): boolean => v.server.gpu === "computer" && v.server.paired === true;

/**
 * Fuobe Connect by pairing: on a phone, in a browser that can't reach this computer (Safari, a page on plain http) or
 * blocks it, or when a paired ComfyUI answers while this tab sees no ComfyUI here. The person approves the code that
 * ComfyUI shows, and the setup ends once that ComfyUI answers (Fuobe reads its models only from a tab on its computer).
 */
export function isPairing(v: SetupView): boolean {
  if (v.way !== "connect") return false;
  const t = v.tab;
  return v.phone || t?.browser === "unsupported" || t?.browser === "blocked" || (pairedOnline(v) && t?.comfy !== "found");
}

/** Runs go to this setup's ComfyUI now. */
export function isConnected(v: SetupView): boolean {
  const t = v.tab;
  if (v.way === "address") return v.server.gpu === "link" && v.server.online === true;
  if (isPairing(v)) return pairedOnline(v);
  return !!t?.connected || (v.server.gpu === "computer" && v.server.online === true && t?.comfy === "found");
}

/**
 * The setup is finished: the first picture is made, or (opened from a run) runs go to the GPU and that run starts, or a
 * paired ComfyUI answers.
 */
export const isDone = (v: SetupView): boolean => v.tab?.picture === "ok" || ((!!v.tab?.fromRun || isPairing(v)) && isConnected(v));

function step(id: StepId, state: StepState, detail?: string): Step {
  return { id, label: STEP_LABEL[id], state, ...(detail && { detail }) };
}

function modelStep(v: SetupView, connected: boolean): Step {
  const t = v.tab;
  if (t?.picture === "ok") return step("model", "done", t.modelId ? FIRST_MODEL_NAME[t.modelId] : undefined);
  if (!connected) return step("model", "todo");
  switch (t?.model) {
    case "ready":
      return step("model", "done", t.modelId && FIRST_MODEL_NAME[t.modelId]);
    case "download":
      return step("model", "todo", t.modelId && `${FIRST_MODEL_NAME[t.modelId]}: one download, ${gb(t.modelGbTenths ?? 0)}`);
    case "none":
      return step("model", "warn", t.cpu ? "ComfyUI runs on the processor" : t.modelWhy === "setup" ? "ComfyUI needs an update first" : "No small picture model fits this GPU");
    default:
      return step("model", "working", "Checking what ComfyUI has");
  }
}

function pictureStep(v: SetupView, connected: boolean): Step {
  const t = v.tab;
  if (t?.fromRun && connected) return step("picture", "done", "Your run starts");
  switch (t?.picture) {
    case "ok":
      return step("picture", "done", t.pictureSecs !== undefined ? `Made in ${t.pictureSecs} s` : undefined);
    case "running":
      return step("picture", "working", "Making it now");
    case "failed":
      return step("picture", "warn", t.pictureCause === "out-of-memory" ? "The GPU ran out of memory" : "It didn't finish");
    default:
      return step("picture", "todo");
  }
}

export function stepsOf(v: SetupView): Step[] {
  const t = v.tab;
  const connected = isConnected(v);
  const tail = (): Step[] => (t?.fromRun ? [pictureStep(v, connected)] : [modelStep(v, connected), pictureStep(v, connected)]);
  if (isPairing(v)) return [step("connect", connected ? "done" : "todo"), step("paired", connected ? "done" : "todo", connected ? "Runs go there with no Fuobe tab open" : undefined)];
  if (v.way === "address") {
    const linked = v.server.gpu === "link";
    const address =
      t?.address === "testing"
        ? step("address", "working", "Fuobe is testing it")
        : t?.address === "ok" || linked
          ? step("address", "done", "Fuobe tested it")
          : t?.address === "failed"
            ? step("address", "warn", "Fuobe couldn't use it")
            : step("address", "todo");
    const reach =
      linked && v.server.online === true
        ? step("connected", "done", "Fuobe reaches ComfyUI")
        : linked && v.server.online === false
          ? step("connected", "warn", "Fuobe can't reach it now")
          : linked
            ? step("connected", "working", "Checking")
            : step("connected", "todo");
    return [address, reach, ...tail()];
  }

  const running =
    t?.browser === "blocked"
      ? step("comfyui", "warn", "The browser blocks Fuobe")
      : t?.comfy === "found" || t?.comfy === "unreadable"
        ? step("comfyui", "done", t.port ? `${t.install ? `${INSTALL_LABEL[t.install]}, on` : "On"} port ${t.port}` : undefined)
        : t?.comfy === "waiting"
          ? step("comfyui", "working", t.quietMin ? `Starting again: ${t.quietMin} min so far` : "Restarting, or closed")
          : t?.comfy === "other"
            ? step("comfyui", "warn", t.port ? `Another app answers on port ${t.port}` : "Another app answers")
            : t?.comfy === "none" && (t.quietMin ?? 0) >= RESTART_WAIT_MIN
              ? step("comfyui", "warn", `Stopped ${t.quietMin} min ago`)
              : step("comfyui", "todo");

  if (v.way === "connect") {
    const installed =
      t?.guard === "connect"
        ? t.listen
          ? step("connect", "warn", "ComfyUI is open to the network")
          : step("connect", "done", "Other websites stay out")
        : t?.comfy === "unreadable" && t.restarted
          ? step("connect", "warn", "ComfyUI didn't load it")
          : step("connect", "todo");
    return [running, installed, ...tail()];
  }

  const found = t?.comfy === "found";
  const allowed =
    found && t.listen
      ? step("allowed", "warn", "ComfyUI is open to the network")
      : found && t.cors === "any"
        ? step("allowed", "warn", "Every website is let in")
        : found && t.cors === "exact"
          ? step("allowed", "done", `${hostOf(v.site)} only`)
          : found && !t.cors && t.guard === "connect"
            ? step("allowed", "done", `${hostOf(v.site)} only`)
            : t?.comfy === "unreadable" && t.restarted
              ? step("allowed", "warn", "The setting didn't take yet")
              : step("allowed", "todo");
  const guard =
    t?.guard === "guard" || t?.guard === "connect"
      ? step("guard", "done", "Fuobe's guard is on")
      : allowed.state === "done" && t?.guardSkipped
        ? step("guard", "warn", "Connected without the guard")
        : step("guard", "todo");
  return [running, allowed, guard, ...tail()];
}
