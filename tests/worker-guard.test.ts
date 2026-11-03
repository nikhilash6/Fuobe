/**
 * The guard of a worker's own ComfyUI (bin/lib/worker/comfy_guard.py and comfy.mjs): every start takes a free port at
 * random and a new key; a request with another Host or without the key is refused; the process on the port proves it
 * is the one the worker started before the worker sends the key; a ComfyUI that a stopped worker left running is
 * stopped at the next start; its log turns over.
 *
 * The Python guard runs for real in front of a stand-in ComfyUI main.py (an aiohttp server made the way ComfyUI's
 * server.py makes its own). That needs a Python with aiohttp (FUOBE_TEST_PYTHON, else python3 or python when they have
 * aiohttp); without one, those checks are skipped. Never a real ComfyUI, never a GPU.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { comfyArgs, GUARD, GuardMissing, OwnComfy, partnerFlag, pickPort, PortBusy, restartDelayMs, RotatingLog } from "../bin/lib/worker/comfy.mjs";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");

function pythonWithAiohttp(): string | null {
  for (const exe of [process.env.FUOBE_TEST_PYTHON, "python3", "python"].filter(Boolean) as string[]) {
    const r = spawnSync(exe, ["-I", "-c", "import aiohttp"], { encoding: "utf8", timeout: 20_000 });
    if (r.status === 0) return exe;
  }
  return null;
}
const python = pythonWithAiohttp();

/** A raw request, with any Host (fetch can't send another one). */
function raw(port: number, p: string, headers: Record<string, string>): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** A stand-in for ComfyUI's main.py: its server made as server.py makes it, with its own middleware and a sub-app. */
const STAND_IN_MAIN = String.raw`
import argparse, os
from aiohttp import web

p = argparse.ArgumentParser()
p.add_argument("--listen")
p.add_argument("--port", type=int)
args, _ = p.parse_known_args()

@web.middleware
async def own(request, handler):
    response = await handler(request)
    response.headers["X-Own-Middleware"] = "1"
    return response

async def stats(request):
    return web.json_response({"system": {"comfyui_version": "stand-in", "os": "nt"}, "devices": []})

async def env(request):
    return web.json_response({"keyInEnv": "FUOBE_WORKER_GUARD_KEY" in os.environ, "cwd": os.getcwd()})

async def files(request):
    return web.json_response(["a"])

async def ws(request):
    s = web.WebSocketResponse()
    await s.prepare(request)
    await s.send_str("hello")
    await s.close()
    return s

if __name__ == "__main__":
    internal = web.Application()
    internal.router.add_get("/files", files)
    app = web.Application(client_max_size=1024, middlewares=[own])
    app.router.add_get("/system_stats", stats)
    app.router.add_get("/env", env)
    app.router.add_get("/ws", ws)
    app.add_subapp("/internal", internal)
    web.run_app(app, host=args.listen, port=args.port, print=None)
`;

const started: OwnComfy[] = [];
afterEach(async () => {
  for (const c of started.splice(0)) await c.stop().catch(() => {});
});

function wsOpens(url: string, headers: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    const done = (ok: boolean) => {
      try {
        ws.close();
      } catch {}
      resolve(ok);
    };
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
    setTimeout(() => done(false), 10_000);
  });
}

describe.skipIf(!python)("the guard in front of a stand-in ComfyUI (Python)", () => {
  it("refuses another Host and a missing key, proves itself before the key is sent, and lets the worker's own requests through", async () => {
    const comfyDir = tempDir("fuobe-guard-comfy-");
    const workDir = tempDir("fuobe-guard-work-");
    fs.writeFileSync(path.join(comfyDir, "main.py"), STAND_IN_MAIN);
    const c = new OwnComfy({ comfyDir, workDir, python, modelDirs: [] });
    started.push(c);
    await c.start();
    expect(c.ready).toBe(true);
    const port = c.port!;
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).not.toBe(8188);
    // ComfyUI started from the guard, written into the worker folder, with the worker folder as its working folder.
    expect(fs.existsSync(path.join(workDir, "guard", "comfy_guard.py"))).toBe(true);
    const host = `127.0.0.1:${port}`;
    const key = { [GUARD.key]: c.headers()[GUARD.key] };
    // The worker's own requests: through, ComfyUI's own middleware still runs, its sub-app answers too.
    const ok = await c.fetch(`${c.base}/system_stats`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-own-middleware")).toBe("1");
    expect((await c.fetch(`${c.base}/internal/files`)).status).toBe(200);
    const env = (await (await c.fetch(`${c.base}/env`)).json()) as { keyInEnv: boolean; cwd: string };
    expect(env.keyInEnv).toBe(false);
    expect(fs.realpathSync(env.cwd)).toBe(fs.realpathSync(workDir));
    // No key, a wrong key, another Host (a rebinding page's name, localhost): refused.
    expect((await raw(port, "/system_stats", { Host: host })).status).toBe(403);
    expect((await raw(port, "/system_stats", { Host: host, [GUARD.key]: "0".repeat(64) })).status).toBe(403);
    expect((await raw(port, "/system_stats", { Host: `evil.example:${port}`, ...key })).status).toBe(403);
    expect((await raw(port, "/system_stats", { Host: `localhost:${port}`, ...key })).status).toBe(403);
    expect((await raw(port, "/internal/files", { Host: host })).status).toBe(403);
    expect((await raw(port, "/system_stats", { Host: host, ...key })).status).toBe(200);
    // The proof: the challenge signed with the key, and the process the worker started. Never without the right Host.
    const challenge = crypto.randomBytes(16).toString("hex");
    const hello = await raw(port, GUARD.hello, { Host: host, [GUARD.challenge]: challenge });
    expect(hello.status).toBe(200);
    const proof = JSON.parse(hello.body) as { proof: string; pid: number };
    expect(proof.proof).toBe(crypto.createHmac("sha256", key[GUARD.key]).update(challenge).digest("hex"));
    expect(proof.pid).toBe(c.pid);
    expect((await raw(port, GUARD.hello, { Host: host })).status).toBe(403);
    expect((await raw(port, GUARD.hello, { Host: `evil.example:${port}`, [GUARD.challenge]: challenge })).status).toBe(403);
    // The live socket: only with the key.
    expect(await wsOpens(`ws://${host}/ws`, key)).toBe(true);
    expect(await wsOpens(`ws://${host}/ws`, {})).toBe(false);
    // The next start: another key (and, most likely, another port); the old key opens nothing.
    const oldKey = key[GUARD.key];
    await c.stop();
    await c.start();
    expect(c.headers()[GUARD.key]).not.toBe(oldKey);
    expect((await raw(c.port!, "/system_stats", { Host: `127.0.0.1:${c.port}`, [GUARD.key]: oldKey })).status).toBe(403);
  });
});

describe("the guard as the worker checks it", () => {
  const fakeCommand = (more: string[] = []) => [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--worker-guard", "1", ...more];

  it("takes a random free port at each start (never 8188), and refuses a request with another Host or without the key", async () => {
    const workDir = tempDir("fuobe-guard-fake-");
    const c = new OwnComfy({ workDir, comfyDir: workDir, comfyCommand: fakeCommand(), comfyGuard: true });
    started.push(c);
    await c.start();
    const port = c.port!;
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(60_000);
    expect(JSON.parse(fs.readFileSync(path.join(workDir, "comfyui.pid"), "utf8"))).toMatchObject({ pid: c.pid, port });
    expect((await c.fetch(`http://127.0.0.1:1/system_stats`)).status).toBe(200);
    expect((await fetch(`${c.base}/system_stats`)).status).toBe(403);
    expect((await raw(port, "/system_stats", { Host: `rebound.example:${port}`, ...c.headers() })).status).toBe(403);
    await c.stop();
    expect(fs.existsSync(path.join(workDir, "comfyui.pid"))).toBe(false);
    expect(await pickPort(null, (() => {
      const tries = [8188, port];
      return () => tries.shift() ?? 30_000;
    })())).toBe(port);
    await expect(pickPort(8188)).rejects.toBeInstanceOf(PortBusy);
    expect(await pickPort(40_123)).toBe(40_123);
  });

  it("never sends the key to a program that can't prove it has it, and won't use a ComfyUI without the guard", async () => {
    const dir = tempDir("fuobe-guard-impostor-");
    const seen = path.join(dir, "seen.txt");
    // Answers the challenge wrongly, and writes down every key it is sent.
    fs.writeFileSync(
      path.join(dir, "impostor.mjs"),
      `import http from "node:http"; import fs from "node:fs";
http.createServer((q, s) => { if (q.headers["${GUARD.key.toLowerCase()}"]) fs.appendFileSync(${JSON.stringify(seen)}, "key\\n");
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ proof: "0".repeat(64), pid: process.pid })); }).listen(Number(process.argv[2]), "127.0.0.1");`,
    );
    const impostor = new OwnComfy({ workDir: dir, comfyDir: dir, comfyCommand: [process.execPath, path.join(dir, "impostor.mjs"), "{port}"], comfyGuard: true });
    await expect(impostor.start()).rejects.toBeInstanceOf(PortBusy);
    expect(impostor.alive()).toBe(false);
    expect(fs.existsSync(seen)).toBe(false);
    // Proves itself, but answers without the key: the guard isn't there.
    fs.writeFileSync(
      path.join(dir, "open.mjs"),
      `import http from "node:http"; import crypto from "node:crypto"; const key = process.env.${GUARD.env};
http.createServer((q, s) => { s.writeHead(200, { "content-type": "application/json" });
  s.end(JSON.stringify(q.url.startsWith("${GUARD.hello}") ? { proof: crypto.createHmac("sha256", key).update(String(q.headers["${GUARD.challenge.toLowerCase()}"])).digest("hex"), pid: process.pid } : {})); }).listen(Number(process.argv[2]), "127.0.0.1");`,
    );
    const open = new OwnComfy({ workDir: dir, comfyDir: dir, comfyCommand: [process.execPath, path.join(dir, "open.mjs"), "{port}"], comfyGuard: true });
    await expect(open.start()).rejects.toBeInstanceOf(GuardMissing);
    expect(open.alive()).toBe(false);
  });

  it("stops a ComfyUI that a stopped worker left running, and nothing else", async () => {
    const workDir = tempDir("fuobe-guard-leftover-");
    const first = new OwnComfy({ workDir, comfyDir: workDir, comfyCommand: fakeCommand(), comfyGuard: true });
    await first.start();
    const pid = first.pid!;
    // The worker stops without stopping its ComfyUI (a crash): the next one finds the pid file.
    const second = new OwnComfy({ workDir, comfyDir: workDir, comfyCommand: fakeCommand(), comfyGuard: true });
    started.push(second, first);
    expect(await second.stopLeftover()).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(() => process.kill(pid, 0)).toThrow();
    // A pid file naming a process that isn't one this worker started (a reused pid): left alone.
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      fs.writeFileSync(path.join(workDir, "comfyui.pid"), JSON.stringify({ pid: other.pid, port: 1, marker: FAKE }));
      expect(await second.stopLeftover()).toBe(false);
      expect(() => process.kill(other.pid!, 0)).not.toThrow();
      expect(fs.existsSync(path.join(workDir, "comfyui.pid"))).toBe(false);
    } finally {
      other.kill();
    }
  });
});

describe("its start, its restarts and its log", () => {
  it("leaves out partner nodes where this ComfyUI can", () => {
    const comfyDir = tempDir("fuobe-guard-args-");
    expect(partnerFlag(comfyDir)).toBe(false);
    fs.mkdirSync(path.join(comfyDir, "comfy"));
    fs.writeFileSync(path.join(comfyDir, "comfy", "cli_args.py"), 'parser.add_argument("--disable-partner-nodes", action="store_true")\n');
    expect(partnerFlag(comfyDir)).toBe(true);
    expect(comfyArgs({ workDir: "/w" }, [], { port: 41_000, partnerFlag: true })).toEqual(expect.arrayContaining(["--port", "41000", "--disable-partner-nodes"]));
    expect(comfyArgs({ workDir: "/w" }, [], { port: 41_000 })).not.toContain("--disable-partner-nodes");
  });

  it("starts again after a short wait that grows, and pauses only for stops with no job running", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(restartDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    const c = new OwnComfy({ workDir: "/w" });
    const t = 10_000_000;
    c.crashes = [1, 2, 3, 4].map((i) => ({ at: t - i * 1000, task: "AAAAAAAAAAAAAAAA" }));
    expect(c.crashedTooOften(t)).toBe(false);
    c.crashes.push(...[1, 2, 3, 4].map((i) => ({ at: t - i * 1000, task: null })));
    expect(c.crashedTooOften(t)).toBe(true);
    expect(c.crashedTooOften(t + 3_600_000)).toBe(false);
  });

  it("turns its log over at each start and when it grows too big, keeping the two before", () => {
    const dir = tempDir("fuobe-guard-log-");
    const file = path.join(dir, "comfyui.log");
    for (const n of [1, 2, 3]) {
      const log = new RotatingLog(file, { maxBytes: 10 });
      log.write(Buffer.from(`start ${n}`));
      log.close();
    }
    expect(fs.readdirSync(dir).sort()).toEqual(["comfyui.1.log", "comfyui.2.log", "comfyui.log"]);
    expect(fs.readFileSync(file, "utf8")).toBe("start 3");
    expect(fs.readFileSync(path.join(dir, "comfyui.2.log"), "utf8")).toBe("start 1");
    const log = new RotatingLog(file, { maxBytes: 10 });
    log.write(Buffer.from("0123456789"));
    log.write(Buffer.from("next"));
    log.close();
    expect(fs.readFileSync(file, "utf8")).toBe("next");
    expect(fs.readFileSync(path.join(dir, "comfyui.1.log"), "utf8")).toBe("0123456789");
  });
});
