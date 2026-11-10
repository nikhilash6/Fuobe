/**
 * The extra options of a worker's own ComfyUI (bin/lib/worker/comfy.mjs comfyOptions): Comfy Kitchen attention by
 * default where that ComfyUI has the flag, worker.json's `comfyOptions` in its place (speed and memory options only),
 * none for the CPU slot, and one start again without Kitchen attention when ComfyUI can't load it.
 * Never a real ComfyUI, never a GPU.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { comfyArgs, comfyFlags, comfyOptions, GUARD, KITCHEN, KITCHEN_MISSING, OwnComfy } from "../bin/lib/worker/comfy.mjs";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 60_000 });

/** A ComfyUI folder whose comfy/cli_args.py names these flags. */
function comfyWith(flags: string[]): string {
  const dir = tempDir("fuobe-comfy-options-");
  fs.mkdirSync(path.join(dir, "comfy"));
  fs.writeFileSync(path.join(dir, "comfy", "cli_args.py"), flags.map((f) => `parser.add_argument("${f}", action="store_true")\n`).join(""));
  return dir;
}

const ALL = ["--use-ck-attention", "--use-sage-attention", "--use-flash-attention", "--use-pytorch-cross-attention", "--disable-dynamic-vram", "--vram-headroom", "--fast", "--listen", "--port", "--cpu"];

describe("its ComfyUI's extra options", () => {
  it("reads the flags this ComfyUI names, and none where it can't", () => {
    expect([...comfyFlags(comfyWith(["--use-ck-attention", "--fast"]))].sort()).toEqual(["--fast", "--use-ck-attention"]);
    expect(comfyFlags(tempDir("fuobe-comfy-none-")).size).toBe(0);
    expect(comfyFlags(undefined).size).toBe(0);
  });

  it("starts with Comfy Kitchen attention by default, where this ComfyUI has the flag", () => {
    const flags = comfyFlags(comfyWith(ALL));
    expect(comfyOptions({}, { flags })).toEqual({ options: [KITCHEN], dropped: [] });
    const args = comfyArgs({ workDir: "/w" }, [], { port: 41_000, flags });
    expect(args).toContain(KITCHEN);
    // An older ComfyUI without the flag starts as before.
    expect(comfyOptions({}, { flags: comfyFlags(comfyWith(["--use-sage-attention"])) })).toEqual({ options: [], dropped: [] });
    expect(comfyArgs({ workDir: "/w" }, [], { port: 41_000, flags: new Set() })).not.toContain(KITCHEN);
    expect(comfyArgs({ workDir: "/w" }, [], { port: 41_000 })).not.toContain(KITCHEN);
  });

  it("gives the CPU slot's ComfyUI no extra options", () => {
    const flags = comfyFlags(comfyWith(ALL));
    expect(comfyOptions({ cpuOnly: true }, { flags })).toEqual({ options: [], dropped: [] });
    expect(comfyOptions({ cpuOnly: true, comfyOptions: ["--use-sage-attention"] }, { flags })).toEqual({ options: [], dropped: [] });
    const args = comfyArgs({ workDir: "/w", cpuOnly: true }, [], { port: 41_000, flags });
    expect(args).toContain("--cpu");
    expect(args).not.toContain(KITCHEN);
  });

  it("takes worker.json's comfyOptions in place of the default, and [] for none", () => {
    const flags = comfyFlags(comfyWith(ALL));
    expect(comfyOptions({ comfyOptions: [] }, { flags })).toEqual({ options: [], dropped: [] });
    expect(comfyOptions({ comfyOptions: ["--use-sage-attention"] }, { flags }).options).toEqual(["--use-sage-attention"]);
    expect(comfyOptions({ comfyOptions: ["--use-ck-attention", "--disable-dynamic-vram", "--vram-headroom", "2.5"] }, { flags }).options).toEqual([
      "--use-ck-attention",
      "--disable-dynamic-vram",
      "--vram-headroom",
      "2.5",
    ]);
    expect(comfyOptions({ comfyOptions: ["--vram-headroom=3"] }, { flags }).options).toEqual(["--vram-headroom", "3"]);
    expect(comfyOptions({ comfyOptions: ["--vram-headroom", 1] }, { flags }).options).toEqual(["--vram-headroom", "1"]);
    expect(comfyOptions({ comfyOptions: ["--vram-headroom", "--use-ck-attention"] }, { flags })).toEqual({ options: ["--use-ck-attention"], dropped: ["--vram-headroom"] });
    expect(comfyOptions({ comfyOptions: ["--fast"] }, { flags }).options).toEqual(["--fast"]);
    expect(comfyOptions({ comfyOptions: ["--fast", "fp16_accumulation", "cublas_ops", "--use-flash-attention"] }, { flags }).options).toEqual([
      "--fast",
      "fp16_accumulation",
      "cublas_ops",
      "--use-flash-attention",
    ]);
    const args = comfyArgs({ workDir: "/w", comfyOptions: ["--use-pytorch-cross-attention"] }, [], { port: 41_000, flags });
    expect(args).toContain("--use-pytorch-cross-attention");
    expect(args).not.toContain(KITCHEN);
  });

  it("leaves out anything but speed and memory options, and options this ComfyUI doesn't know", () => {
    const flags = comfyFlags(comfyWith(ALL));
    const r = comfyOptions(
      {
        comfyOptions: [
          "--listen", "0.0.0.0", "--port", "8188", "--output-directory", "C:/elsewhere", "--enable-cors-header", "*",
          "--whitelist-custom-nodes", "evil", "--cpu", "--use-sage-attention", "--use-ck-attention", "--use-sage-attention",
          "--vram-headroom", "lots", "--fast", "everything", "--use-ck-attention=1", "--front-end-root",
        ],
      },
      { flags },
    );
    // One attention option at most (ComfyUI refuses two): the first one given.
    expect(r.options).toEqual(["--use-sage-attention"]);
    expect(r.dropped).toEqual([
      "--listen", "0.0.0.0", "--port", "8188", "--output-directory", "C:/elsewhere", "--enable-cors-header", "*",
      "--whitelist-custom-nodes", "evil", "--cpu", "--use-ck-attention", "--use-sage-attention",
      "--vram-headroom lots", "--fast everything", "--use-ck-attention=1", "--front-end-root",
    ]);
    // Flags this ComfyUI doesn't name would stop it at its start: left out too.
    expect(comfyOptions({ comfyOptions: ["--use-flash-attention", "--disable-dynamic-vram"] }, { flags: comfyFlags(comfyWith(["--disable-dynamic-vram"])) })).toEqual({
      options: ["--disable-dynamic-vram"],
      dropped: ["--use-flash-attention"],
    });
    // Not a list: the default.
    expect(comfyOptions({ comfyOptions: "--listen 0.0.0.0" }, { flags }).options).toEqual([KITCHEN]);
  });

  it("leaves Kitchen attention out once it couldn't load", () => {
    const flags = comfyFlags(comfyWith(ALL));
    expect(comfyOptions({}, { flags, noKitchen: true })).toEqual({ options: [], dropped: [] });
    expect(comfyOptions({ comfyOptions: [KITCHEN, "--disable-dynamic-vram"] }, { flags, noKitchen: true }).options).toEqual(["--disable-dynamic-vram"]);
    expect(comfyArgs({ workDir: "/w" }, [], { port: 41_000, flags, noKitchen: true })).not.toContain(KITCHEN);
  });
});

describe("a ComfyUI that can't load Comfy Kitchen attention", () => {
  const started: OwnComfy[] = [];
  afterEach(async () => {
    for (const c of started.splice(0)) await c.stop();
  });

  /**
   * A stand-in ComfyUI behind the worker's guard. Given Kitchen attention it says what ComfyUI says and exits (`kitchen`
   * "missing"), or exits with another message ("crash"); else it answers like a ComfyUI that started.
   */
  function standIn(dir: string, kitchen: "missing" | "crash") {
    const script = path.join(dir, "stand-in.mjs");
    fs.writeFileSync(
      script,
      `import http from "node:http"; import crypto from "node:crypto"; const key = process.env.${GUARD.env}; const port = Number(process.argv[2]);
if (process.argv.includes(${JSON.stringify(KITCHEN)})) {
  console.error(${JSON.stringify(kitchen === "missing" ? `${KITCHEN_MISSING}. Install a Comfy Kitchen build with attention support to use ${KITCHEN}.` : "Something else went wrong")});
  process.exit(255);
}
http.createServer((q, s) => {
  if (q.url.startsWith("${GUARD.hello}")) { s.writeHead(200, { "content-type": "application/json" });
    return s.end(JSON.stringify({ proof: crypto.createHmac("sha256", key).update(String(q.headers["${GUARD.challenge.toLowerCase()}"])).digest("hex"), pid: process.pid })); }
  if (q.headers["${GUARD.key.toLowerCase()}"] !== key) { s.writeHead(403); return s.end(); }
  s.writeHead(200, { "content-type": "application/json" }); s.end("{}");
}).listen(port, "127.0.0.1");`,
    );
    return [process.execPath, script, "{port}", "{options}"];
  }

  it("starts it again once without it, keeps it out for this run, says so, and counts no crash", async () => {
    const dir = comfyWith(ALL);
    const lines: string[] = [];
    const crashes: unknown[] = [];
    const c = new OwnComfy({ workDir: dir, comfyDir: dir, comfyCommand: standIn(dir, "missing"), comfyGuard: true }, { log: (l: string) => lines.push(l) });
    c.onCrash = (code: unknown) => crashes.push(code);
    started.push(c);
    await c.start();
    expect(c.ready).toBe(true);
    expect(c.noKitchen).toBe(true);
    expect(c.crashes).toEqual([]);
    expect(c.inARow).toBe(0);
    expect(lines.filter((l) => l.includes("Comfy Kitchen attention"))).toHaveLength(1);
    expect(lines.find((l) => l.includes("Comfy Kitchen attention"))).toMatch(/failed/);
    // The first try's output is in the log before this start's.
    expect(fs.readFileSync(path.join(dir, "comfyui.1.log"), "utf8")).toContain(KITCHEN_MISSING);
    // Its next start (after a stop) leaves it out too, with nothing said again.
    await c.stop();
    await c.start();
    expect(c.ready).toBe(true);
    expect(lines.filter((l) => l.includes("Comfy Kitchen attention"))).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "comfyui.log"), "utf8")).not.toContain(KITCHEN_MISSING);
  });

  it("starts nothing again for another stop at its start", async () => {
    const dir = comfyWith(ALL);
    const c = new OwnComfy({ workDir: dir, comfyDir: dir, comfyCommand: standIn(dir, "crash"), comfyGuard: true });
    started.push(c);
    await expect(c.start()).rejects.toThrow(/stopped while starting/);
    expect(c.noKitchen).toBe(false);
    expect(c.crashes).toHaveLength(1);
  });

  it("never starts it with Kitchen attention where worker.json's comfyOptions leaves it out", async () => {
    const dir = comfyWith(ALL);
    const c = new OwnComfy({ workDir: dir, comfyDir: dir, comfyCommand: standIn(dir, "crash"), comfyGuard: true, comfyOptions: [] });
    started.push(c);
    await c.start();
    expect(c.ready).toBe(true);
    expect(c.noKitchen).toBe(false);
  });
});
