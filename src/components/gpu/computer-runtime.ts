/**
 * "Use the ComfyUI on this computer", in the page: the one tab of this browser that runs the person's jobs (a Web Lock
 * picks it), its clock, and what every tab shows of those jobs. The tab that holds the lock beats to the server, takes
 * jobs and runs them on the ComfyUI on 127.0.0.1 (lib/computer-runner.ts); the other tabs hear its jobs on a
 * BroadcastChannel, so a run's tile shows its steps and live preview wherever it is open. No React here: the host
 * component (computer-runner.tsx) starts it and the tiles read its store.
 */
import { COMPUTER_KICK_EVENT } from "@/lib/api";
import { beatEvery, ComputerRunner, tileJob, type LocalJob, type RunnerView } from "@/lib/computer-runner";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { pickLook, portsToLook } from "@/lib/local-comfy";
import { lookOn } from "./use-local-comfy";

export { COMPUTER_KICK_EVENT };

const KEYS = {
  device: "fuobe.computer.device",
  client: "fuobe.computer.client",
  port: "fuobe.comfy.port",
  host: "fuobe.comfy.host",
  install: "fuobe.comfy.install",
  firstRun: "fuobe.computer.first-run",
  /** This browser has read the ComfyUI on this computer before (so reaching it asks nothing new). */
  reached: "fuobe.computer.reached",
} as const;

const memory = new Map<string, string>();
/** localStorage, which can throw (private windows, blocked site data): then this tab remembers on its own. */
export function stored(key: keyof typeof KEYS): string | null {
  try {
    return localStorage.getItem(KEYS[key]) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
export function store(key: keyof typeof KEYS, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], value);
  } catch {}
}

const randomId = (bytes = 18) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** This browser's id with the server: a routing label (which computer took a job), not a secret. */
function idFor(key: "device" | "client"): string {
  let id = stored(key);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId();
    store(key, id);
  }
  return id;
}

/** Where this browser's ComfyUI answered last (the finder remembers it). */
export function rememberedComfy(): { port: number; host: string } | null {
  const port = Number(stored("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = stored("host");
  return { port, host: host === "localhost" || host === "[::1]" ? host : "127.0.0.1" };
}
export function rememberComfy(port: number, host = "127.0.0.1"): void {
  store("port", String(port));
  store("host", host);
}

// ---------------------------------------------------------------------------
// What the tiles read

export interface ComputerState {
  /** Which tab runs the jobs: this one, another Fuobe tab of this browser, or none yet. */
  holder: "this" | "other" | "none";
  view: RunnerView | null;
}

let state: ComputerState = { holder: "none", view: null };
const listeners = new Set<() => void>();
export const computerState = () => state;
export function subscribeComputer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(next: ComputerState) {
  state = next;
  for (const fn of listeners) fn();
}

/**
 * The job this browser runs for a run (its phase, steps and latest preview), wherever its tile is open. A saved one
 * stays a few seconds, so the tile says it is saving until the run shows its result.
 */
export const jobFor = (s: ComputerState, generationId: string, now: number): LocalJob | undefined => (s.view ? tileJob(s.view.jobs, generationId, now) : undefined);

const active = (j: LocalJob) => j.phase !== "done" && j.phase !== "failed";

const RESTART_EVENT = "fuobe:computer-restart";
/** Start the runner again (ComfyUI moved to another port). */
export const restartComputerRunner = () => window.dispatchEvent(new Event(RESTART_EVENT));
export { RESTART_EVENT };

let takeover = false;
/** "Run them here instead": this computer takes the person's waiting jobs from the one that has them. */
export function takeOverHere(): void {
  takeover = true;
  window.dispatchEvent(new Event(COMPUTER_KICK_EVENT));
}

// ---------------------------------------------------------------------------
// The clock: a Worker's timer keeps ticking in a hidden tab (a page's own timers slow to once a minute there)

function workerClock(ms: number, tick: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = tick;
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }
}

const sha256 = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The jobs as another tab gets them (the previews go too: they're Blobs). */
type Heard = { holder: "this"; view: RunnerView } | { holder: "none" };

/** How the runner starts: the port the server last heard of (when this browser remembers none), and its access. */
export interface RunnerStart {
  port?: number;
  /** This browser may not reach apps on this computer yet ("ask"), or was told no ("blocked"): it only listens. */
  access?: "ask" | "blocked";
}

/**
 * Run this person's jobs from this browser while the page is open: this tab when it gets the lock, else it listens to
 * the tab that has it (and takes over when that one closes). Returns the stop.
 */
export function startComputerRunner(o: RunnerStart = {}): () => void {
  const stop = new AbortController();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("fuobe-computer") : null;
  channel?.addEventListener("message", (e: MessageEvent<Heard>) => {
    if (state.holder === "this") return;
    set(e.data.holder === "this" ? { holder: "other", view: e.data.view } : { holder: "none", view: null });
  });
  const run = () => hold(stop.signal, (view) => channel?.postMessage({ holder: "this", view } satisfies Heard), o).finally(() => channel?.postMessage({ holder: "none" } satisfies Heard));
  if (navigator.locks?.request) {
    navigator.locks.request("fuobe-runner", { signal: stop.signal }, run).catch(() => {});
  } else {
    void run();
  }
  return () => {
    stop.abort();
    channel?.close();
    set({ holder: "none", view: null });
  };
}

/** This tab runs the jobs until the signal (or the session ends, or the person disconnects). */
async function hold(signal: AbortSignal, publish: (v: RunnerView) => void, o: RunnerStart): Promise<void> {
  if (signal.aborted) return;
  // Where this browser found ComfyUI last; else where the person's computer said it was (another browser, cleared site
  // data); else ComfyUI's usual port. When it stops answering there, the runner looks on the other usual ports.
  const where = rememberedComfy() ?? { port: o.port ?? 8188, host: "127.0.0.1" };
  const runner = new ComputerRunner(
    {
      api: (path, init) => fetch(path, { ...init, credentials: "same-origin" }),
      local: loopbackFetch,
      socket: (url) => (typeof WebSocket === "function" ? (new WebSocket(url) as never) : null),
      sha256,
      origin: window.location.origin,
      find: async (except) => {
        const looks = await Promise.all(portsToLook().filter((p) => p !== except).map((p) => lookOn(p)));
        const best = pickLook(looks);
        return best.state === "none" ? null : { port: best.port, host: best.host };
      },
      moved: (port, host) => rememberComfy(port, host),
    },
    { device: idFor("device"), port: where.port, host: where.host, clientId: `fuobe-${idFor("client")}`, ...(o.access && { access: o.access }) },
  );
  let last = 0;
  const show = (v: RunnerView) => {
    set({ holder: "this", view: { ...v, jobs: [...v.jobs] } });
    if (v.facts && !stored("reached")) store("reached", "1");
    // Other tabs hear it a few times a second at most.
    const now = Date.now();
    if (now - last > 250 || !v.jobs.some(active)) {
      last = now;
      publish(v);
    }
  };
  const off = runner.onChange(show);
  show(runner.view);
  let kicked = true;
  let beating = false;
  let claiming = false;
  let nextBeat = 0;
  let nextClaim = 0;
  const kick = () => (kicked = true);
  const release = () => runner.releaseAll((path, body) => void fetch(path, { method: "POST", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body }));
  // Leaving while a file is moving would cut it: the browser asks first.
  const leaving = (e: BeforeUnloadEvent) => {
    if (runner.view.jobs.some((j) => j.phase === "sending" || j.phase === "saving")) e.preventDefault();
  };
  window.addEventListener(COMPUTER_KICK_EVENT, kick);
  window.addEventListener("pagehide", release);
  window.addEventListener("beforeunload", leaving);
  // ComfyUI here as the server last heard it: a change (closed, back, without the setting) is told at once.
  let told = runner.view.comfy;
  const tick = () => {
    const now = Date.now();
    if (!beating && (now >= nextBeat || takeover || runner.view.comfy !== told)) {
      beating = true;
      nextBeat = now + beatEvery(runner.view.jobs.some(active));
      told = runner.view.comfy;
      const take = takeover;
      takeover = false;
      runner
        .beat(take)
        .then((a) => {
          if (a && a.runner && a.waiting > 0) kicked = true;
        })
        .catch(() => {})
        .finally(() => (beating = false));
    }
    if (!claiming && (kicked || now >= nextClaim)) {
      claiming = true;
      kicked = false;
      nextClaim = now + 30_000;
      runner
        .claimAndRun()
        .then((had) => {
          // One job done: the next one at once.
          if (had) kicked = true;
        })
        .catch(() => {
          // The studio or the connection hiccupped mid-job: the job stays this computer's, and is picked up again soon.
          nextClaim = Date.now() + 5_000;
        })
        .finally(() => (claiming = false));
    }
  };
  const stopClock = workerClock(1000, tick);
  tick();
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve());
    runner.onChange((v) => v.stopped && resolve());
  });
  stopClock();
  off();
  release();
  runner.stop();
  window.removeEventListener(COMPUTER_KICK_EVENT, kick);
  window.removeEventListener("pagehide", release);
  window.removeEventListener("beforeunload", leaving);
  set({ holder: "none", view: runner.view.stopped ? runner.view : null });
}
