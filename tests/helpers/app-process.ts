/**
 * Two app processes on one database, as a deploy runs them for a moment: this test process is one, and
 * startAppProcess() starts the other (tests/helpers/app-process-child.ts) on the same data folder. Both runners turn
 * only when a test says so: runnerByHand() stops this process's timers, and tick() turns it once and waits for every
 * run that turn polls.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface AppProcess {
  url: string;
  /** Its worker routes, for a worker driver's via(). */
  api: (p: string, init?: RequestInit) => Promise<Response>;
  /**
   * A run as GET /api/generations/<id> answers it there to a session (its cookie), through the sign-in proxy. An answer
   * that isn't OK throws, with its status.
   */
  generation: (id: string, cookie: string) => Promise<Record<string, unknown>>;
  /** One turn of its runner, and every run that turn polls. */
  tick: () => Promise<void>;
  /** One sweep of its billing reports. */
  sweepBilling: () => Promise<void>;
  /**
   * The next result it moves into the files folder waits in the middle of that move: `paused` resolves when it is
   * there, and release() lets it go on.
   */
  pauseNextSave: () => Promise<{ paused: Promise<void>; release: () => void }>;
  /** What it wrote to its error output. */
  errors: () => string;
  /** It exits as `next start` does when it is told to stop (its exit handlers run). */
  stop: () => Promise<void>;
  /** It is killed: it ends at once, with no word and none of its exit handlers. */
  kill: () => Promise<void>;
}

const realFetch = globalThis.fetch;

export async function startAppProcess(o: { dataDir: string; env?: Record<string, string | undefined>; allow?: string[] }): Promise<AppProcess> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries({ ...o.env, FUOBE_DATA_DIR: o.dataDir, FUOBE_TEST_ALLOW: (o.allow ?? []).join(",") })) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  delete env.NODE_OPTIONS;
  const child: ChildProcess = spawn(process.execPath, ["--no-warnings", "--import", pathToFileURL(path.join(ROOT, "tests/helpers/ts-register.mjs")).href, path.join(ROOT, "tests/helpers/app-process-child.ts")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr!.on("data", (d) => (err += d));
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`The second app process didn't start in 120 s:\n${err}`)), 120_000);
    child.stdout!.on("data", (d) => {
      out += d;
      const m = /READY (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The second app process ended (${code}):\n${err}`));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  const post = async (p: string, body?: unknown) => {
    const r = await realFetch(`${url}${p}`, { method: "POST", ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  };
  let n = 0;
  return {
    url,
    api: (p, init = {}) => realFetch(`${url}${p}`, init),
    generation: async (id, cookie) => {
      const r = await realFetch(`${url}/__app/generation/${encodeURIComponent(id)}`, { headers: { cookie } });
      if (!r.ok) throw new Error(`GET /api/generations/${id} answered ${r.status} in the other process`);
      return (await r.json()) as Record<string, unknown>;
    },
    tick: () => post("/__app/tick"),
    sweepBilling: () => post("/__app/billing"),
    pauseNextSave: async () => {
      const marker = path.join(o.dataDir, `.pause-${process.pid}-${++n}`);
      const release = `${marker}.go`;
      await post("/__app/pause", { marker, release });
      const paused = (async () => {
        for (let i = 0; i < 1500 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 10));
        if (!fs.existsSync(marker)) throw new Error("The second app process never reached the pause");
      })();
      return { paused, release: () => fs.writeFileSync(release, "") };
    },
    errors: () => err,
    stop: async () => {
      if (child.exitCode !== null) return;
      const ended = new Promise((r) => child.once("exit", r));
      await post("/__app/exit").catch(() => child.kill());
      await Promise.race([ended, new Promise((r) => setTimeout(r, 5000))]);
      if (child.exitCode === null) child.kill();
    },
    kill: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = new Promise((r) => child.once("exit", r));
      child.kill("SIGKILL");
      await ended;
    },
  };
}

/** This process's runner turns only when a test says so (its timers stop; reading a run starts none again). */
export function runnerByHand(): void {
  const s = globalThis.__fuobeRunner;
  if (!s) throw new Error("Start the runner first (getGeneration or ensureRunner)");
  clearInterval(s.timer);
  if (s.fastTimer) clearInterval(s.fastTimer);
}

/** One turn of this process's runner, and every run that turn polls (an account's runs are polled on their own). */
export async function tick(): Promise<void> {
  const s = globalThis.__fuobeRunner;
  if (!s) return;
  await s.tick();
  for (let i = 0; i < 2000 && s.polling?.size; i++) await new Promise((r) => setTimeout(r, 5));
}
