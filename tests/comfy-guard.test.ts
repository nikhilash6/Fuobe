/**
 * Fuobe's guard for ComfyUI (src/lib/comfy-guard.ts), run for real: the file is loaded the way ComfyUI loads a custom
 * node (its `server` and `comfy.cli_args` stood in for) into an aiohttp app that has ComfyUI's cross-site middleware,
 * and requests from other websites, from the site the setting names, from ComfyUI's own page and from a program are
 * sent at it. Needs a Python with aiohttp (FUOBE_TEST_PYTHON, e.g. ComfyUI's own python_embeded\python.exe; else
 * python3 or python when they have aiohttp): without one, it is skipped.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARD_FILE_NAME, GUARD_SOURCE, guardBase64, isGuard } from "@/lib/comfy-guard";

function pythonWithAiohttp(): string | null {
  for (const exe of [process.env.FUOBE_TEST_PYTHON, "python3", "python"].filter(Boolean) as string[]) {
    const r = spawnSync(exe, ["-I", "-c", "import aiohttp"], { encoding: "utf8", timeout: 20_000 });
    if (r.status === 0) return exe;
  }
  return null;
}

/** A free port in the range local test servers use (3360-3399). */
async function freePort(): Promise<number> {
  for (let p = 3360; p <= 3399; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (free) return p;
  }
  throw new Error("No free port in 3360-3399");
}

const HARNESS = String.raw`
import asyncio, importlib.util, json, sys, types
from aiohttp import ClientSession, WSServerHandshakeError, web

guard_path, port, allowed = sys.argv[1], int(sys.argv[2]), sys.argv[3]

def cors(origin):
    # ComfyUI's cors_middleware: headers only, no check of who asks.
    @web.middleware
    async def cors_middleware(request, handler):
        response = web.Response() if request.method == "OPTIONS" else await handler(request)
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response
    return cors_middleware

app = web.Application(middlewares=[cors(allowed)] if allowed else [])
routes = web.RouteTableDef()
server = types.ModuleType("server")
class PromptServer: pass
PromptServer.instance = PromptServer()
PromptServer.instance.app, PromptServer.instance.routes = app, routes
server.PromptServer = PromptServer
comfy, cli = types.ModuleType("comfy"), types.ModuleType("comfy.cli_args")
cli.args = types.SimpleNamespace(enable_cors_header=allowed or None)
comfy.cli_args = cli
sys.modules.update({"server": server, "comfy": comfy, "comfy.cli_args": cli})

def load(name):
    spec = importlib.util.spec_from_file_location(name, guard_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

guard = load("fuobe_guard")
load("fuobe_guard_copy")  # a second copy in custom_nodes: still one guard

queued = []
@routes.post("/prompt")
async def prompt(request):
    queued.append(await request.text())
    return web.json_response({"prompt_id": "x"})
@routes.get("/system_stats")
async def stats(request):
    return web.json_response({"system": {}})
@routes.get("/ws")
async def ws(request):
    s = web.WebSocketResponse()
    await s.prepare(request)
    await s.close()
    return s
app.add_routes(routes)

async def main():
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    base, own = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{port}"
    out = {}
    async with ClientSession(skip_auto_headers=["User-Agent"]) as s:
        async def ask(name, method, p, headers):
            async with s.request(method, base + p, headers=headers, data="{}" if method == "POST" else None) as r:
                out[name] = r.status
                if p == "/fuobe/guard" and r.status == 200:
                    out["guard_answer"] = await r.json()
        evil = {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain"}
        await ask("evil_prompt", "POST", "/prompt", evil)
        await ask("evil_preflight", "OPTIONS", "/prompt", {"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        await ask("evil_read", "GET", "/system_stats", {"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"})
        await ask("null_origin", "POST", "/prompt", {"Origin": "null", "Sec-Fetch-Site": "cross-site"})
        await ask("no_origin_cross_site", "GET", "/system_stats", {"Sec-Fetch-Site": "cross-site"})
        await ask("no_origin_same_site", "GET", "/system_stats", {"Sec-Fetch-Site": "same-site"})
        await ask("site_prompt", "POST", "/prompt", {"Origin": "https://fuobe.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json"})
        await ask("site_slash", "POST", "/prompt", {"Origin": "https://FUOBE.example/", "Sec-Fetch-Site": "cross-site"})
        await ask("site_preflight", "OPTIONS", "/prompt", {"Origin": "https://fuobe.example", "Access-Control-Request-Method": "POST"})
        await ask("site_guard", "GET", "/fuobe/guard", {"Origin": "https://fuobe.example", "Sec-Fetch-Site": "cross-site"})
        await ask("own_page", "POST", "/prompt", {"Origin": own, "Sec-Fetch-Site": "same-origin"})
        await ask("own_page_get", "GET", "/system_stats", {"Sec-Fetch-Site": "same-origin"})
        await ask("program", "POST", "/prompt", {})
        for name, origin in (("evil_ws", "https://evil.example"), ("site_ws", "https://fuobe.example")):
            try:
                async with s.ws_connect(base + "/ws?clientId=abcdefgh", headers={"Origin": origin}) as w:
                    out[name] = 101
            except WSServerHandshakeError as e:
                out[name] = e.status
    out["queued"] = len(queued)
    out["guards"] = sum(1 for m in app.middlewares if getattr(m, "__name__", "") == "fuobe_guard")
    print(json.dumps(out))
    await runner.cleanup()

asyncio.run(main())
`;

const python = pythonWithAiohttp();

describe("Fuobe's guard for ComfyUI", () => {
  it("is one plain-ASCII custom node file that adds no nodes and sends nothing", () => {
    expect(GUARD_FILE_NAME).toMatch(/^[a-z_]+\.py$/);
    expect(GUARD_SOURCE).toMatch(/^[\x00-\x7f]*$/);
    expect(Buffer.from(guardBase64(), "base64").toString("latin1")).toBe(GUARD_SOURCE);
    expect(GUARD_SOURCE).toContain("NODE_CLASS_MAPPINGS = {}");
    expect(GUARD_SOURCE).not.toMatch(/^\s*(import|from)\s+(requests|urllib\.request|subprocess|socket|http\.client|os)\b/m);
    expect(GUARD_SOURCE).not.toMatch(/\b(open|eval|exec|system|ClientSession)\(/);
    expect(isGuard({ guard: 1 })).toBe(true);
    expect(isGuard({ guard: 0 })).toBe(false);
    expect(isGuard(null)).toBe(false);
  });

  const run = async (allowed: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-guard-"));
    const guard = path.join(dir, GUARD_FILE_NAME);
    const harness = path.join(dir, "harness.py");
    fs.writeFileSync(guard, GUARD_SOURCE);
    fs.writeFileSync(harness, HARNESS);
    try {
      const r = spawnSync(python!, ["-I", harness, guard, String(await freePort()), allowed], { encoding: "utf8", timeout: 60_000 });
      if (r.status !== 0) throw new Error(r.stderr || r.stdout);
      return JSON.parse(r.stdout.trim().split("\n").pop()!) as Record<string, number> & { guard_answer?: unknown };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it.skipIf(!python)("with Fuobe's setting on: turns away every other website, lets the site, ComfyUI's own page and programs in", async () => {
    const out = await run("https://fuobe.example");
    expect(out).toMatchObject({
      evil_prompt: 403,
      evil_preflight: 403,
      evil_read: 403,
      null_origin: 403,
      no_origin_cross_site: 403,
      no_origin_same_site: 403,
      evil_ws: 403,
      site_prompt: 200,
      site_slash: 200,
      site_preflight: 200,
      site_guard: 200,
      site_ws: 101,
      own_page: 200,
      own_page_get: 200,
      program: 200,
      guards: 1,
    });
    expect(isGuard(out.guard_answer)).toBe(true);
    // Only the requests let in queued anything.
    expect(out.queued).toBe(4);
  }, 90_000);

  it.skipIf(!python)("with the setting off, it leaves ComfyUI as it was (ComfyUI's own check is on then)", async () => {
    const out = await run("");
    expect(out).toMatchObject({ evil_prompt: 200, own_page: 200, program: 200, site_guard: 200, guards: 1 });
  }, 90_000);
});
