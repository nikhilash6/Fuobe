/**
 * A worker for the recovery tests: the runner the worker program uses (src/lib/computer-runner.ts), calling the
 * studio's real worker routes with a worker token (Authorization: Bearer), against a stand-in ComfyUI
 * (tests/helpers/standin-comfy.ts). A test can:
 *
 * - stop it right after any step (`stopAfter`): the studio has done that step, and the worker is gone before it reads
 *   the answer, as a worker whose process was killed. Nothing it had in flight comes back to it.
 * - make the studio answer some calls with an error (`answer`), as a deploy or a proxy does for a while.
 * - send its calls to another app process (`via`), as a deploy's second server.
 * - say it is paused here (`pause`), as a worker that stepped aside for another program does in its beats.
 *
 * Start a new driver with the same token to bring the worker back.
 *
 * Its beats speak the worker program's own protocol (bin/lib/worker/config.mjs) and say this checkout's catalog version,
 * and it composes an account's job ticket with the studio's own composer, so it is the worker the studio expects today.
 * A beat answer that says the studio needs a newer worker program throws: a driver the studio would never give a
 * job must fail loudly, never look like a feature that isn't built.
 */
import { ComputerRunner } from "@/lib/computer-runner";
import type { BeatAnswer } from "@/lib/relay";
import { catalogVersion } from "@/server/computer/catalog-version";
import { PROTOCOL } from "../../bin/lib/worker/config.mjs";
import { apiAs, sha256, type ComputerRoutes } from "./computer-tab";
import type { StandInComfy } from "./standin-comfy";
import { composeOnWorker } from "./ticket-worker";

/** The protocol the driver's beats speak: the worker program's. */
export const DRIVER_PROTOCOL: number = PROTOCOL;

/** The steps a worker's job goes through, by the call it makes to the studio. */
export type WorkerStep = "beat" | "claim" | "input" | "sent" | "queued" | "running" | "finished" | "passes" | "gone" | "failed" | "part" | "release" | "other";

export type StudioApi = (path: string, init?: RequestInit) => Promise<Response>;

export type StepHook = (step: WorkerStep, path: string, report: Record<string, unknown> | null) => void | Promise<void>;

export interface WorkerDriver {
  runner: ComputerRunner;
  /** Every call it made to the studio, as "<step> <path>". */
  calls: string[];
  /** The steps the studio answered, in order. */
  steps: WorkerStep[];
  /** Gone (stopped after a step, or stop() called). */
  readonly dead: boolean;
  beat: () => Promise<BeatAnswer | null>;
  /**
   * Take a job and run it: resolves true when one ran to its end, false when there was none, and "stopped" when the
   * worker stopped part way (its job stays where the studio last heard of it).
   */
  runOne: () => Promise<boolean | "stopped">;
  /** Stop right after the `n`th (default: first) answered call of this step from now on. */
  stopAfter: (step: WorkerStep, n?: number) => void;
  /** The studio answers the next `times` calls of this step with `status`, without seeing them. */
  answer: (step: WorkerStep, status: number, times: number) => void;
  /** Send its calls to another app process from now on (null: this one's routes). */
  via: (api: StudioApi | null) => void;
  /** Its beats say it paused here (`why` as the worker program says it: "gpu-busy:<program>", "here-now"), or not. */
  pause: (why: string | null) => void;
  /** Why its beats say it paused here (null: they don't). */
  readonly pausedHere: string | null;
  /**
   * Called after each answered step, before the worker reads the answer (a test acts at that moment: crash the ComfyUI,
   * restart the app, …). A report's event comes with it.
   */
  onStep: (fn: StepHook | null) => void;
  /**
   * Its "running" reports carry a preview picture (base64, as the worker program sends one), from `fn` at each report
   * (undefined: none with that report). Null: none.
   */
  previews: (fn: (() => string | undefined) | null) => void;
  stop: () => void;
}

const never = <T,>() => new Promise<T>(() => {});

/** The step a call to the studio is, by its path and (for a report) its event. */
export function stepOf(path: string, init: RequestInit = {}): WorkerStep {
  const p = path.split("?")[0];
  if (p.endsWith("/beat")) return "beat";
  if (p.endsWith("/claim")) return "claim";
  if (/\/inputs\/[^/]+$/.test(p)) return "input";
  if (/\/outputs\/[^/]+$/.test(p) && (init.method ?? "GET") === "PUT") return "part";
  if (p.endsWith("/release")) return "release";
  if (p.endsWith("/report")) {
    try {
      const e = (JSON.parse(String(init.body ?? "{}")) as { event?: string }).event;
      if (e === "sent" || e === "queued" || e === "running" || e === "finished" || e === "passes" || e === "gone" || e === "failed") return e;
    } catch {}
  }
  return "other";
}

export function workerDriver(o: {
  routes: ComputerRoutes;
  token: string;
  comfy: StandInComfy;
  clientId?: string;
  /** How long its waits are, at most (the runner's own waits are seconds; tests keep them short). */
  sleepCapMs?: number;
}): WorkerDriver {
  const local = apiAs(o.routes, null, { authorization: `Bearer ${o.token}` });
  let target: StudioApi | null = null;
  let dead = false;
  let stopAt: { step: WorkerStep; left: number } | null = null;
  const answers: { step: WorkerStep; status: number; left: number }[] = [];
  let paused: string | null = null;
  let hook: StepHook | null = null;
  let preview: (() => string | undefined) | null = null;
  let died: () => void = () => {};
  const diedP = new Promise<"stopped">((r) => (died = () => r("stopped")));
  const calls: string[] = [];
  const steps: WorkerStep[] = [];

  const die = () => {
    if (dead) return;
    dead = true;
    runner.stop();
    died();
  };

  const api: StudioApi = async (path, init = {}) => {
    if (dead) return never();
    const step = stepOf(path, init);
    if (step === "running" && preview && typeof init.body === "string") {
      const picture = preview();
      if (picture) {
        const body = JSON.stringify({ ...(JSON.parse(init.body) as Record<string, unknown>), preview: picture });
        init = { ...init, body, headers: { ...Object.fromEntries(new Headers(init.headers)), "content-length": String(Buffer.byteLength(body)) } };
      }
    }
    calls.push(`${step} ${path.split("?")[0]}`);
    const fake = answers.find((a) => a.step === step && a.left > 0);
    if (fake) {
      fake.left--;
      return new Response(JSON.stringify({ error: "busy" }), { status: fake.status, headers: { "content-type": "application/json" } });
    }
    const withToken = (init: RequestInit): RequestInit => ({ ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${o.token}` } });
    const res = await (target ? target(path, withToken(init)) : local(path, init));
    if (dead) return never();
    steps.push(step);
    if (hook) {
      let report: Record<string, unknown> | null = null;
      if (path.split("?")[0].endsWith("/report")) {
        try {
          report = JSON.parse(String(init.body)) as Record<string, unknown>;
        } catch {}
      }
      await hook(step, path, report);
    }
    if (stopAt && stopAt.step === step && --stopAt.left <= 0) {
      stopAt = null;
      die();
      return never();
    }
    return res;
  };

  const runner = new ComputerRunner(
    {
      api,
      local: (url, init) => (dead ? never() : fetch(url, init)),
      socket: (url) => (dead ? null : (new WebSocket(url) as never)),
      sha256,
      origin: "http://localhost:3000",
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, o.sleepCapMs ?? 50))),
      compose: (t) => composeOnWorker(t),
      beatExtra: () => ({ protocol: DRIVER_PROTOCOL, version: "test", local: { paused: !!paused, why: paused, until: null }, gpu: { otherApps: [], tempC: null }, inventoryHash: null, warmLane: null, catalogVersion: catalogVersion() }),
      // As the worker program does when a job ends here: its prompt leaves its ComfyUI's history (once its ComfyUI has
      // stopped it, when the job was taken back).
      ended: async (t) => {
        if (dead) return;
        for (let i = 0; i < 100; i++) {
          const q = (await fetch(`${o.comfy.url}/queue`)
            .then((r) => r.json())
            .catch(() => null)) as { queue_running?: unknown[][]; queue_pending?: unknown[][] } | null;
          if (!q || ![...(q.queue_running ?? []), ...(q.queue_pending ?? [])].some((r) => r[1] === t.promptId)) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        await fetch(`${o.comfy.url}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [t.promptId] }) }).catch(() => null);
      },
    },
    { device: "worker", port: o.comfy.port, clientId: o.clientId ?? `worker-${Math.random().toString(36).slice(2, 8)}` },
  );

  return {
    runner,
    calls,
    steps,
    get dead() {
      return dead;
    },
    beat: async () => {
      if (dead) return null;
      const a = await Promise.race([runner.beat(), diedP.then(() => null)]);
      const min = a?.worker?.minProtocol;
      if (typeof min === "number" && min > DRIVER_PROTOCOL) {
        throw new Error(`The studio takes jobs only from worker programs that speak protocol ${min}; this driver speaks ${DRIVER_PROTOCOL}`);
      }
      return a;
    },
    runOne: async () => {
      if (dead) return "stopped";
      const r = await Promise.race([runner.claimAndRun(), diedP]);
      return dead ? "stopped" : r;
    },
    stopAfter: (step, n = 1) => {
      stopAt = { step, left: n };
    },
    answer: (step, status, times) => {
      answers.push({ step, status, left: times });
    },
    via: (api) => {
      target = api;
    },
    pause: (why) => {
      paused = why;
    },
    get pausedHere() {
      return paused;
    },
    onStep: (fn) => {
      hook = fn;
    },
    previews: (fn) => {
      preview = fn;
    },
    stop: die,
  };
}
