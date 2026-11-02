import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unzip } from "@/server/assist/unzip";

/**
 * The fuobe CLI as a child process against a stub of Fuobe's REST API: upload → generate → wait →
 * download, the MCP bridge, skills add, login, and the messages for a missing token or server.
 */

const TOKEN = "fuobe_test-token";
const CLI = path.join(process.cwd(), "bin/fuobe.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-cli-run-"));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

interface Seen {
  method: string;
  path: string;
  auth: string | null;
  json?: unknown;
  file?: { name: string; type: string; data: Buffer };
}

let server: http.Server;
let base = "";
let requireAuth = true;
let seen: Seen[] = [];
let polls = 0;

const generation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "gen1",
  status,
  progress: status === "running" ? 0.5 : status === "succeeded" ? 1 : null,
  modelId: "nano-banana-pro",
  modelName: "Nano Banana Pro",
  provider: "fal",
  kind: "image",
  op: "edit",
  prompt: "a red fox",
  outputs: [],
  error: null,
  createdAt: 1_000,
  completedAt: null,
  ...extra,
});

const PROMO = {
  name: "weekly-promo",
  title: "Weekly promo",
  engines: ["cloud"],
  ready: [],
  recipe: {
    params: [
      { id: "product", label: "Product photo", type: "image", required: true },
      { id: "name", label: "Product name", type: "text", required: true, max: 200, example: "Lumen desk lamp" },
      { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16"], default: "1:1" },
    ],
  },
};
const job = { tool: "skill", modelId: "nano-banana-pro", modelName: "Nano Banana Pro", kind: "image", op: "edit", note: "Edit", prompt: "", count: 1, costUsd: 0.62, demo: false };

async function body(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const raw = await body(req);
    const s: Seen = { method: req.method ?? "GET", path: url.pathname + url.search, auth: req.headers.authorization ?? null };
    if (/json/.test(req.headers["content-type"] ?? "")) s.json = JSON.parse(raw.toString());
    if (/multipart/.test(req.headers["content-type"] ?? "")) {
      const form = await new Request("http://stub", { method: "POST", headers: { "content-type": req.headers["content-type"]! }, body: new Uint8Array(raw) }).formData();
      const f = form.get("file") as File;
      s.file = { name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) };
    }
    seen.push(s);
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (requireAuth && s.auth !== `Bearer ${TOKEN}`) return send(401, { error: "Sign in, or send an API token as Authorization: Bearer fuobe_…" });
    const route = `${s.method} ${url.pathname}`;
    if (route === "POST /api/uploads") return send(201, { id: "up1", url: "/api/files/uploads/2026-10-22/up1.png" });
    if (route === "GET /api/models")
      return send(200, {
        engineMode: "both",
        defaults: {
          image: { cloud: "nano-banana-pro", open: "oss-z-image-turbo" },
          edit: { cloud: "nano-banana-pro", open: "oss-qwen-edit" },
          audio: { cloud: "elevenlabs-v4", open: "oss-chatterbox" },
          clone: { cloud: "chatterbox-cloud", open: "oss-chatterbox" },
          cloneDialogue: { open: "oss-chatterbox-dialogue" },
        },
        items: [
          { id: "nano-banana-pro", name: "Nano Banana Pro" },
          { id: "elevenlabs-v4", name: "ElevenLabs v4", opIds: ["tts"] },
          { id: "chatterbox-cloud", name: "Chatterbox", opIds: ["tts"], voiceClone: true },
        ],
      });
    if (route === "POST /api/generations" && (s.json as { modelId?: string }).modelId === "kling-3") return send(422, { error: "Add a start frame" });
    if (route === "POST /api/generations" && url.searchParams.get("preview") === "1")
      return send(200, { modelId: "nano-banana-pro", modelName: "Nano Banana Pro", engine: "cloud", kind: "image", op: "edit", opLabel: "Edit", jobs: 1, outputs: 1, demo: false, providerId: "fal", costUsd: 0.15 });
    if (route === "POST /api/generations") return send(201, { items: [generation("queued")] });
    if (route === "GET /api/generations/gen1") {
      polls++;
      return send(200, polls < 2 ? generation("running") : generation("succeeded", { outputs: [{ url: "/api/files/outputs/2026-10-22/out1.png", kind: "image" }], completedAt: 5_000 }));
    }
    // A server that names its output after a path, and a job that never finishes.
    if (route === "GET /api/generations/evil") return send(200, generation("succeeded", { id: "../escaped", outputs: [{ url: "/api/files/outputs/2026-10-22/out1.png", kind: "image" }] }));
    if (route === "GET /api/generations/slow") return send(200, generation("running", { id: "slow" }));
    if (route === "GET /api/generations") return send(200, { items: [generation("succeeded")] });
    if (route === "GET /api/files/outputs/2026-10-22/out1.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (route === "POST /api/mcp") {
      const rpc = s.json as { id: number; params: { name: string; arguments: Record<string, unknown> } };
      return send(200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ echo: rpc.params }) }], isError: false } });
    }
    if (route === "POST /api/assist/skills/upload") {
      const entries = unzip(s.file!.data);
      const md = entries.find((e) => e.name.endsWith("/SKILL.md"))!.data.toString();
      const name = /name:\s*(\S+)/.exec(md)![1];
      return send(201, { skill: { name, title: name }, skipped: [], replaced: false });
    }
    // A skill that runs by itself: its recipe, a price per row, a run per row, and its zip.
    const skill = /^\/api\/assist\/skills\/weekly-promo\/(recipe|verify|estimate|run|download)$/.exec(url.pathname)?.[1];
    if (skill === "recipe") return send(200, PROMO);
    if (skill === "verify") return send(200, { ok: true, engines: [{ engine: "cloud", plan: { ok: true, errors: [] } }] });
    if (skill === "estimate" || skill === "run") {
      const b = s.json as { values?: Record<string, string>; csv?: string; engine?: string };
      // The CSV the CLI sent, read as the server would: header first, one run per line.
      const rows = b.csv ? b.csv.trim().split("\n").slice(1).map((l, i) => ({ line: i + 2, name: l.split(",")[1] ?? "" })) : [{ line: 1, name: b.values?.name ?? "" }];
      if (skill === "run") {
        // A real file can fail a check its stand-in passed: the server names the row by its line in the table sent.
        const long = rows.filter((r) => r.name === "toolong");
        if (long.length) return send(422, { error: `Fix the recipe first: ${long.map((r) => `Row ${r.line}: The clip is longer than 10 s`).join("; ")}`, problems: [] });
        // A tool row that couldn't start while the others run.
        return send(201, { engine: b.engine ?? "cloud", demo: false, runs: rows.map((r, i) => (r.name === "nope" ? { ids: [], error: "The tool couldn't start" } : { batchId: `b${i}`, ids: i ? [`gen${i + 1}`] : ["gen1"], href: "/library" })) });
      }
      // A clip is priced by its length once it's uploaded: more than its stand-in.
      const real = JSON.stringify(b).includes("/api/files/uploads/2026-10-22/up1.png");
      const runs = rows.map((r) => ({ line: r.line, jobs: [job], total: r.name === "bad" ? null : real && r.name === "Long clip" ? 1.5 : 0.62, errors: r.name === "bad" ? ["Product name: at most 200 characters"] : [] }));
      const ok = runs.every((r) => !r.errors.length);
      return send(200, { engine: b.engine ?? "cloud", runs, jobs: [job], total: ok ? Math.round(runs.reduce((a, r) => a + (r.total ?? 0), 0) * 100) / 100 : null, demo: false, runnable: ok, errors: [] });
    }
    if (skill === "download") {
      res.writeHead(200, { "content-type": "application/zip" });
      return res.end(Buffer.from(`zip${url.search}`));
    }
    send(404, { error: "Not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  seen = [];
  polls = 0;
  requireAuth = true;
});

function run(
  args: string[],
  env: Record<string, string | undefined> = {},
  started?: (child: ReturnType<typeof spawn>) => void,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: tmp,
      // Undefined values are left out of the child's environment.
      env: { PATH: process.env.PATH, HOME: tmp, FUOBE_CONFIG: path.join(tmp, "config.json"), FUOBE_URL: base, FUOBE_TOKEN: TOKEN, ...env } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    started?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("fuobe CLI against a Fuobe server", () => {
  it("uploads a local image, generates, waits and downloads the result", async () => {
    fs.writeFileSync(path.join(tmp, "me.png"), PNG);
    const r = await run(["generate", "a red fox", "--image", "me.png", "--aspect", "1:1", "--out", "renders", "--interval", "0.2"]);
    expect(r.stderr).toContain("Using Nano Banana Pro (nano-banana-pro)");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Saved renders\/gen1\.png \(1 KB\)$/m);
    expect(fs.readFileSync(path.join(tmp, "renders/gen1.png")).equals(PNG)).toBe(true);
    // Every request carried the token.
    expect(seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
    const upload = seen.find((s) => s.path === "/api/uploads")!;
    expect(upload.file).toMatchObject({ name: "me.png", type: "image/png" });
    expect(upload.file!.data.equals(PNG)).toBe(true);
    // The default came from the edit studio (an image is attached); the request uses the uploaded URL.
    expect(seen.find((s) => s.path.startsWith("/api/models"))!.path).toBe("/api/models?kind=image");
    expect(seen.find((s) => s.path === "/api/generations" && s.method === "POST")!.json).toEqual({
      feature: "cli",
      modelId: "nano-banana-pro",
      prompt: "a red fox",
      inputs: { images: ["/api/files/uploads/2026-10-22/up1.png"] },
      params: { aspectRatio: "1:1" },
    });
    expect(seen.filter((s) => s.path === "/api/generations/gen1").length).toBe(2);
  });

  it("prints JSON for scripts: generate without waiting, then wait", async () => {
    const started = await run(["generate", "a red fox", "--model", "nano-banana-pro", "--json"]);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout).items[0]).toMatchObject({ id: "gen1", status: "queued" });
    const waited = await run(["wait", "gen1", "--json", "--interval", "0.2"]);
    expect(waited.code).toBe(0);
    const out = JSON.parse(waited.stdout);
    expect(out.items[0]).toMatchObject({ id: "gen1", status: "succeeded" });
    expect(waited.stderr).toBe("");
  });

  it("prices a run without uploading anything, and refuses a model of the other engine", async () => {
    fs.writeFileSync(path.join(tmp, "big.png"), PNG);
    const r = await run(["estimate", "a red fox", "-m", "nano-banana-pro", "-i", "big.png"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("Nano Banana Pro (cloud) · Edit · 1 image · about $0.15");
    expect(seen.some((s) => s.path === "/api/uploads")).toBe(false);
    expect((seen.find((s) => s.path === "/api/generations?preview=1")!.json as { inputs: { images: string[] } }).inputs.images[0]).toMatch(/^\/api\/files\/uploads\/estimate\/big\.png$/);
    const wrong = await run(["generate", "a red fox", "-m", "nano-banana-pro", "--engine", "open"]);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toMatch(/Nano Banana Pro is a cloud model, but you asked for --engine open/);
    expect(seen.some((s) => s.path === "/api/generations")).toBe(false);
  });

  it("runs MCP tools with JSON or key=value arguments", async () => {
    const r = await run(["tool", "search_models", "--arg", "kind=video", "--arg", "query=kling"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ echo: { name: "search_models", arguments: { kind: "video", query: "kling" } } });
    const j = await run(["tool", "estimate_job", '{"tool":"katana","arguments":{"reference":"/api/files/a.mp4"}}', "--json"]);
    expect(JSON.parse(j.stdout).echo.arguments).toEqual({ tool: "katana", arguments: { reference: "/api/files/a.mp4" } });
  });

  it("adds skills from a folder as zips the server unpacks", async () => {
    const dir = path.join(tmp, "my-skills");
    for (const n of ["launch-video", "promo-card"]) {
      fs.mkdirSync(path.join(dir, "skills", n), { recursive: true });
      fs.writeFileSync(path.join(dir, "skills", n, "SKILL.md"), `---\nname: ${n}\ndescription: Does ${n}.\n---\n\n# ${n}\n`);
    }
    const r = await run(["skills", "add", "my-skills"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Added /launch-video");
    expect(r.stdout).toContain("Added /promo-card");
    const uploads = seen.filter((s) => s.path.startsWith("/api/assist/skills/upload"));
    expect(uploads.map((u) => u.file!.name)).toEqual(["launch-video.zip", "promo-card.zip"]);
    const only = await run(["skills", "add", "my-skills", "--skill", "promo-card", "--replace", "--json"]);
    expect(JSON.parse(only.stdout).items).toEqual([{ ok: true, name: "promo-card", title: "promo-card", replaced: false, skipped: [] }]);
    expect(seen.at(-1)!.path).toBe("/api/assist/skills/upload?replace=1");
  });

  it("logs in: checks the token and saves it readable by you only", async () => {
    const r = await run(["login", "--url", base, "--token", TOKEN], { FUOBE_TOKEN: undefined, FUOBE_URL: undefined });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Signed in to ${base} with an API token.`);
    const file = path.join(tmp, "config.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ url: base, token: TOKEN });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // Later commands use the saved address and token.
    const list = await run(["list", "--json"], { FUOBE_TOKEN: undefined, FUOBE_URL: undefined });
    expect(list.code).toBe(0);
    expect(seen.at(-1)).toMatchObject({ path: "/api/generations?limit=20", auth: `Bearer ${TOKEN}` });
    const bad = await run(["login", "--url", base, "--token", "fuobe_wrong"], { FUOBE_TOKEN: undefined, FUOBE_URL: undefined });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/refused the API token/);
    fs.rmSync(file);
  });

  it("explains a missing token and a server that isn't running", async () => {
    const noToken = await run(["list"], { FUOBE_TOKEN: undefined });
    expect(noToken.code).toBe(1);
    expect(noToken.stderr).toMatch(/has a password, so the CLI needs an API token\. Create one in Settings → Security → API tokens/);
    const json = await run(["models", "--json"], { FUOBE_TOKEN: undefined });
    expect(JSON.parse(json.stderr)).toMatchObject({ status: 401 });
    // A port nothing listens on.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const down = await run(["status"], { FUOBE_URL: `http://127.0.0.1:${port}` });
    expect(down.code).toBe(1);
    expect(down.stderr).toMatch(/Can't reach Fuobe at http:\/\/127\.0\.0\.1:\d+ \(connection refused\)\. Is the server running\?/);
  });

  it("names the options a refused request needs, and an unknown id in words", async () => {
    fs.writeFileSync(path.join(tmp, "clip.mp4"), "not really a clip");
    const refused = await run(["generate", "she smiles", "-m", "kling-3", "--video", "clip.mp4"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr.trim()).toBe("Add a start frame (use --image <file|url>)");
    // The request was checked before the clip was uploaded.
    expect(seen.some((s) => s.path === "/api/uploads")).toBe(false);
    const unknown = await run(["status", "nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/There's no generation nope on http:\/\/127\.0\.0\.1:\d+ \(it may be in the Trash\)\. fuobe list shows recent ones\./);
    const cancel = await run(["cancel", "nope", "--json"]);
    expect(JSON.parse(cancel.stderr)).toMatchObject({ status: 404 });
    expect(seen.some((s) => s.path.endsWith("/cancel"))).toBe(false);
  });

  it("never sends the saved token to another server, nor prints it for one", async () => {
    const file = path.join(tmp, "config.json");
    fs.writeFileSync(file, JSON.stringify({ url: "https://studio.example.com", token: "fuobe_secret-for-studio" }));
    const signedOut = { FUOBE_TOKEN: undefined, FUOBE_URL: undefined };
    try {
      const list = await run(["list", "--url", base], signedOut);
      expect(list.code).toBe(1);
      expect(list.stderr).toMatch(/The token "fuobe login" saved is for https:\/\/studio\.example\.com, so it isn't sent here/);
      const viaEnv = await run(["list"], { FUOBE_TOKEN: undefined, FUOBE_URL: base });
      expect(viaEnv.code).toBe(1);
      expect(seen.length).toBeGreaterThan(1);
      expect(seen.every((s) => s.auth === null)).toBe(true);
      const mcp = await run(["mcp", "--url", base], signedOut);
      expect(mcp.stdout.trim()).toBe(`claude mcp add --transport http fuobe ${base}/api/mcp`);
      expect(mcp.stdout + mcp.stderr).not.toContain("fuobe_secret-for-studio");
      expect(mcp.stderr).toMatch(/No token in these lines: the one "fuobe login" saved is for https:\/\/studio\.example\.com/);
      const status = await run(["status", "--url", base, "--json"], signedOut);
      expect(JSON.parse(status.stderr)).toMatchObject({ status: 401 });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("logs in and out over a broken config file (the commands its message names)", async () => {
    const file = path.join(tmp, "config.json");
    const signedOut = { FUOBE_TOKEN: undefined, FUOBE_URL: undefined };
    fs.writeFileSync(file, "{broken");
    try {
      const list = await run(["list"], signedOut);
      expect(list.code).toBe(1);
      expect(list.stderr).toMatch(/isn't valid JSON\. Run "fuobe login" again, or delete the file\./);
      const login = await run(["login", "--url", base, "--token", TOKEN], signedOut);
      expect(login.code).toBe(0);
      expect(login.stderr).toMatch(/isn't valid JSON; signing in replaces it/);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ url: base, token: TOKEN });
      fs.writeFileSync(file, "{broken");
      const logout = await run(["logout"], signedOut);
      expect(logout.code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("saves a download inside --out whatever id the server sends", async () => {
    const r = await run(["download", "evil", "--out", "safe"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Saved safe\/___escaped\.png \(1 KB\)$/m);
    expect(fs.existsSync(path.join(tmp, "escaped.png"))).toBe(false);
    expect(fs.readdirSync(path.join(tmp, "safe"))).toEqual(["___escaped.png"]);
  });

  it("stops waiting at once on Ctrl+C, not after the next --interval", async () => {
    const t0 = Date.now();
    let child: ReturnType<typeof spawn> | undefined;
    const done = run(["wait", "slow", "--interval", "30"], {}, (c) => (child = c));
    // Interrupt once the first check has reached the server (the CLI is then asleep for 30 s).
    while (!seen.some((s) => s.path === "/api/generations/slow")) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 150));
    child!.kill("SIGINT");
    const r = await done;
    expect(r.code).toBe(130);
    expect(r.stderr).toMatch(/Stopped waiting\. It keeps running on the server: fuobe wait slow/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("finds every local file before uploading any", async () => {
    fs.writeFileSync(path.join(tmp, "me.png"), PNG);
    const r = await run(["generate", "x", "-m", "nano-banana-pro", "--image", "me.png", "--image", "missin.png"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^Can't find missin\.png\./);
    expect(seen).toHaveLength(0);
    const up = await run(["upload", "me.png", "missin.png"]);
    expect(up.code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("clones a voice sample with a model that takes one, and refuses one that would ignore it", async () => {
    fs.writeFileSync(path.join(tmp, "me.wav"), "RIFF");
    const r = await run(["generate", "Hello", "--kind", "audio", "--voice-audio", "me.wav", "--json"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Using Chatterbox (chatterbox-cloud)");
    expect(seen.find((s) => s.path === "/api/generations" && s.method === "POST")!.json).toMatchObject({ modelId: "chatterbox-cloud", inputs: { voiceAudio: "/api/files/uploads/2026-10-22/up1.png" } });
    seen = [];
    const two = await run(["generate", "Hi", "--kind", "audio", "--voice-audio", "me.wav", "--voice-audio", "me.wav"]);
    expect(two.code).toBe(2);
    expect(two.stderr).toMatch(/no default cloud dialogue model that clones two voice samples\. Add --engine open \(oss-chatterbox-dialogue\)/);
    seen = [];
    const named = await run(["generate", "Hello", "-m", "elevenlabs-v4", "--voice-audio", "me.wav"]);
    expect(named.code).toBe(2);
    expect(named.stderr).toMatch(/^elevenlabs-v4 speaks in premade voices .* \(--model chatterbox-cloud or --model oss-chatterbox\)\./);
    expect(seen.find((s) => s.path.startsWith("/api/models?"))!.path).toBe("/api/models?q=elevenlabs-v4&hidden=1");
    expect(seen.some((s) => s.path.startsWith("/api/uploads") || s.path.startsWith("/api/generations"))).toBe(false);
  });

  it("answers usage mistakes with exit code 2 and help with 0", async () => {
    const typo = await run(["generat", "x"]);
    expect(typo.code).toBe(2);
    expect(typo.stderr).toMatch(/Did you mean fuobe generate\?/);
    const help = await run(["generate", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/^Usage: fuobe generate/m);
    const mcp = await run(["mcp"], { FUOBE_TOKEN: undefined });
    expect(mcp.stdout.trim()).toBe(`claude mcp add --transport http fuobe ${base}/api/mcp`);
    expect(seen).toHaveLength(0);
  });
});

describe("fuobe skills: a skill that runs by itself", () => {
  const posts = (what: string) => seen.filter((s) => s.method === "POST" && s.path === `/api/assist/skills/weekly-promo/${what}`);

  it("params lists the inputs; estimate prices with stand-ins and uploads nothing", async () => {
    const p = await run(["skills", "params", "weekly-promo"]);
    expect(p.code).toBe(0);
    expect(p.stdout).toMatch(/^Weekly promo \(\/weekly-promo\) · runs on the cloud$/m);
    expect(p.stdout).toMatch(/^product\s+image\s+needed\s+Product photo · a file, an https:\/\/ link or a \/api\/files\/… URL$/m);
    expect(p.stdout).toMatch(/^name\s+text\s+needed\s+Product name · up to 200 characters · e\.g\. Lumen desk lamp$/m);
    expect(p.stdout).toMatch(/^aspect\s+choice\s+default 1:1\s+Shape · 1:1 \| 9:16$/m);
    expect(p.stderr).toContain("Run it: fuobe skills run weekly-promo -p product=photo.png -p name=\"…\"");
    fs.writeFileSync(path.join(tmp, "my lamp.png"), PNG);
    const e = await run(["skills", "estimate", "weekly-promo", "-p", "product=my lamp.png", "-p", "name=Lumen=Desk"]);
    expect(e.code).toBe(0);
    expect(e.stdout).toBe("Weekly promo on the cloud: 1 step\n  1. Nano Banana Pro · Edit · $0.62\nabout $0.62\n");
    expect(seen.some((s) => s.path === "/api/uploads")).toBe(false);
    // A value keeps everything after the first "=", and a file is a stand-in with a name the server takes.
    expect(posts("estimate")[0].json).toEqual({ values: { product: "/api/files/uploads/estimate/my_lamp.png", name: "Lumen=Desk" }, engine: "cloud" });
    const bad = await run(["skills", "estimate", "weekly-promo", "-p", "colour=red"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/^\/weekly-promo has no input “colour”\. It takes product, name, aspect \(fuobe skills params weekly-promo\)\./);
    const engine = await run(["skills", "estimate", "weekly-promo", "--engine", "open"]);
    expect(engine.code).toBe(2);
    expect(engine.stderr).toMatch(/^\/weekly-promo runs on the cloud only: leave out --engine/);
  });

  it("run won't spend without a yes; with --yes it checks the skill, uploads the file, runs, waits and saves", async () => {
    fs.writeFileSync(path.join(tmp, "lamp.png"), PNG);
    const asked = await run(["skills", "run", "weekly-promo", "-p", "product=lamp.png", "-p", "name=Lumen"]);
    expect(asked.code).toBe(2);
    expect(asked.stderr.trim()).toBe("Running it costs $0.62: add --yes to run without asking");
    expect(seen.some((s) => s.path === "/api/uploads" || s.path.endsWith("/run") || s.path.endsWith("/verify"))).toBe(false);
    seen = [];
    const r = await run(["skills", "run", "weekly-promo", "-p", "product=lamp.png", "-p", "name=Lumen", "--yes", "--out", "promo", "--interval", "0.2"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Checking /weekly-promo on the cloud first (free: it prices each step, nothing runs)…");
    expect(r.stdout).toMatch(/^Saved promo\/gen1\.png \(1 KB\)$/m);
    // Priced with a stand-in, checked, then the file went up once and the run used its URL.
    expect(seen.filter((s) => s.method === "POST").map((s) => s.path)).toEqual([
      "/api/assist/skills/weekly-promo/estimate",
      "/api/assist/skills/weekly-promo/verify",
      "/api/uploads",
      "/api/assist/skills/weekly-promo/run",
    ]);
    expect(posts("verify")[0].json).toEqual({ level: "plan", engine: "cloud" });
    expect(posts("run")[0].json).toEqual({ values: { product: "/api/files/uploads/2026-10-22/up1.png", name: "Lumen" }, engine: "cloud" });
  });

  it("--rows: one run per row, -p fills the empty cells, files beside the table go up once, and --json --yes skips the question", async () => {
    const dir = path.join(tmp, "products");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lamp.png"), PNG);
    fs.writeFileSync(path.join(dir, "rows.csv"), "﻿Product photo,Product name,Notes\nlamp.png,\"Lumen, desk\",first\n\nlamp.png,,second\n");
    // --json alone never starts a run that costs money.
    const unasked = await run(["skills", "run", "weekly-promo", "--rows", "products/rows.csv", "-p", "name=Halo", "--json"]);
    expect(unasked.code).toBe(2);
    expect(unasked.stderr).toMatch(/add --yes to run without asking/);
    expect(posts("run")).toHaveLength(0);
    seen = [];
    const r = await run(["skills", "run", "weekly-promo", "--rows", "products/rows.csv", "-p", "name=Halo", "--json", "--yes"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).runs).toHaveLength(2);
    expect(r.stderr).toContain("“Notes” isn't an input of /weekly-promo, so that column is left out.");
    expect(seen.filter((s) => s.path === "/api/uploads")).toHaveLength(1);
    const up = "/api/files/uploads/2026-10-22/up1.png";
    expect(posts("estimate")[0].json).toEqual({ csv: 'Product photo,Product name,Notes\n/api/files/uploads/estimate/lamp.png,"Lumen, desk",first\n/api/files/uploads/estimate/lamp.png,Halo,second\n', engine: "cloud" });
    expect(posts("run")[0].json).toEqual({ csv: `Product photo,Product name,Notes\n${up},"Lumen, desk",first\n${up},Halo,second\n`, engine: "cloud" });
  });

  it("a row that doesn't fit is named by its line in the file, and nothing starts", async () => {
    fs.writeFileSync(path.join(tmp, "bad.csv"), "product,name\nhttps://cdn.test/a.png,Lumen\n\nhttps://cdn.test/b.png,bad\n");
    const est = await run(["skills", "estimate", "weekly-promo", "--rows", "bad.csv"]);
    expect(est.code).toBe(1);
    expect(est.stdout).toContain("Row 4: Product name: at most 200 characters");
    const r = await run(["skills", "run", "weekly-promo", "--rows", "bad.csv", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe("Row 4: Product name: at most 200 characters");
    expect(seen.some((s) => s.path.endsWith("/run") || s.path === "/api/uploads")).toBe(false);
  });

  /** A terminal that answers each question in turn. */
  function terminal(answers: string[]) {
    const out: string[] = [];
    const questions: string[] = [];
    const io = {
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: (t: string) => out.push(t) },
      env: { FUOBE_URL: base, FUOBE_TOKEN: TOKEN, FUOBE_CONFIG: path.join(tmp, "config.json") },
      cwd: tmp,
      home: tmp,
      fetch: globalThis.fetch,
      columns: 100,
      stdinIsTTY: true,
      stderrIsTTY: false,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      onInterrupt: () => () => {},
      ask: async (q: string) => (questions.push(q), answers.shift() ?? "n"),
      readStdin: async () => "",
    };
    return { io, out, questions };
  }

  it("with the files uploaded it prices again, and asks again when that's more", async () => {
    const { main } = await import("../bin/lib/cli.mjs");
    fs.writeFileSync(path.join(tmp, "clip.png"), PNG);
    const no = terminal(["y", "n"]);
    expect(await main(["skills", "run", "weekly-promo", "-p", "product=clip.png", "-p", "name=Long clip"], no.io)).toBe(1);
    expect(no.questions).toEqual(["Run 1 for $0.62? [y/N] ", "With your files it costs $1.50, not $0.62. Run 1 for $1.50? [y/N] "]);
    expect(no.out.join("")).toContain("Nothing was started.");
    expect(seen.filter((s) => s.method === "POST").map((s) => s.path)).toEqual([
      "/api/assist/skills/weekly-promo/estimate",
      "/api/assist/skills/weekly-promo/verify",
      "/api/uploads",
      "/api/assist/skills/weekly-promo/estimate",
    ]);
    expect(posts("estimate")[1].json).toEqual({ values: { product: "/api/files/uploads/2026-10-22/up1.png", name: "Long clip" }, engine: "cloud" });
    seen = [];
    const yes = terminal(["y", "y"]);
    expect(await main(["skills", "run", "weekly-promo", "-p", "product=clip.png", "-p", "name=Long clip"], yes.io)).toBe(0);
    expect(posts("run")).toHaveLength(1);
    // The same price with the real file: one question.
    seen = [];
    const same = terminal(["y"]);
    expect(await main(["skills", "run", "weekly-promo", "-p", "product=clip.png", "-p", "name=Lumen"], same.io)).toBe(0);
    expect(same.questions).toEqual(["Run 1 for $0.62? [y/N] "]);
    expect(posts("estimate")).toHaveLength(2);
    expect(posts("run")).toHaveLength(1);
  });

  it("--wait exits 1 and --json lists each run's error when a row didn't start", async () => {
    fs.writeFileSync(path.join(tmp, "some.csv"), "product,name\nhttps://cdn.test/a.png,Lumen\n\nhttps://cdn.test/b.png,nope\n");
    const r = await run(["skills", "run", "weekly-promo", "--rows", "some.csv", "--yes", "--wait", "--json", "--interval", "0.2"]);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.items.map((g: { id: string }) => g.id)).toEqual(["gen1"]);
    expect(out.runs).toEqual([
      { batchId: "b0", ids: ["gen1"], href: "/library", line: 2 },
      { ids: [], error: "The tool couldn't start", line: 4 },
    ]);
    const words = await run(["skills", "run", "weekly-promo", "--rows", "some.csv", "--yes", "--wait", "--interval", "0.2"]);
    expect(words.code).toBe(1);
    expect(words.stderr).toContain("Row 4 didn't start: The tool couldn't start");
    expect(words.stderr).toContain("Started Weekly promo (1 didn't start).");
  });

  it("a row the run refuses is named by its line in the file", async () => {
    fs.writeFileSync(path.join(tmp, "long.csv"), "product,name\nhttps://cdn.test/a.png,Lumen\n\nhttps://cdn.test/b.png,toolong\n");
    const r = await run(["skills", "run", "weekly-promo", "--rows", "long.csv", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split("\n").at(-1)).toBe("Fix the recipe first: Row 4: The clip is longer than 10 s");
    expect(posts("run")).toHaveLength(1);
  });

  it("asks on a terminal: no starts nothing, yes runs", async () => {
    const { main } = await import("../bin/lib/cli.mjs");
    const out: string[] = [];
    const questions: string[] = [];
    let answer = "n";
    const io = {
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: (t: string) => out.push(t) },
      env: { FUOBE_URL: base, FUOBE_TOKEN: TOKEN, FUOBE_CONFIG: path.join(tmp, "config.json") },
      cwd: tmp,
      home: tmp,
      fetch: globalThis.fetch,
      columns: 100,
      stdinIsTTY: true,
      stderrIsTTY: false,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      onInterrupt: () => () => {},
      ask: async (q: string) => (questions.push(q), answer),
      readStdin: async () => "",
    };
    fs.writeFileSync(path.join(tmp, "two.csv"), "product,name\nhttps://cdn.test/a.png,Lumen\nhttps://cdn.test/b.png,Halo\n");
    expect(await main(["skills", "run", "weekly-promo", "--rows", "two.csv"], io)).toBe(1);
    expect(questions).toEqual(["Run 2 for $1.24? [y/N] "]);
    expect(out.join("")).toContain("Nothing was started.");
    expect(seen.some((s) => s.path.endsWith("/run"))).toBe(false);
    answer = "y";
    expect(await main(["skills", "run", "weekly-promo", "--rows", "two.csv"], io)).toBe(0);
    expect(out.join("")).toContain("Started 2 runs of Weekly promo on the cloud: gen1 gen2");
    expect(out.join("")).toContain("Wait for them: fuobe wait gen1 gen2");
  });

  it("export saves the skill as a zip, with its examples when asked", async () => {
    const r = await run(["skills", "export", "weekly-promo", "--examples"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Saved weekly-promo\.zip \(1 KB\): SKILL\.md and its files, with the values it was made with\.$/m);
    expect(fs.readFileSync(path.join(tmp, "weekly-promo.zip"), "utf8")).toBe("zip?format=zip&examples=1");
    fs.mkdirSync(path.join(tmp, "exports"), { recursive: true });
    const into = await run(["skills", "export", "weekly-promo", "--out", "exports", "--json"]);
    expect(JSON.parse(into.stdout)).toMatchObject({ name: "weekly-promo", path: path.join(tmp, "exports", "weekly-promo.zip"), examples: false });
    expect(fs.readFileSync(path.join(tmp, "exports", "weekly-promo.zip"), "utf8")).toBe("zip?format=zip");
  });
});
