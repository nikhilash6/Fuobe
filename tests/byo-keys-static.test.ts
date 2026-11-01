import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Your keys: only one place reads a fal.ai key or Replicate token (src/server/provider-keys.ts cloudKey), so inside an
 * account's work no other code path can reach the studio's keys. A scan of the source, so a change that adds another
 * way in fails here first.
 */
const SRC = path.resolve(__dirname, "../src");

function files(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? files(f) : /\.(ts|tsx)$/.test(e.name) ? [f] : [];
  });
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const sources = files().map((f) => ({ file: rel(f), text: fs.readFileSync(f, "utf8") }));
/** The source without its comments, so a comment that names a host or a variable doesn't count. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The files (outside `allowed`) whose code matches `re`. */
const offenders = (re: RegExp, allowed: string[]) => sources.filter((s) => !allowed.includes(s.file) && re.test(code(s.text))).map((s) => s.file);

describe("nothing else reads the studio's fal.ai or Replicate key", () => {
  it("reads the settings only in provider-keys.ts", () => {
    expect(offenders(/\b(getSetting|savedSetting)\(\s*["'`](falKey|replicateToken)["'`]/, ["server/provider-keys.ts"])).toEqual([]);
    expect(offenders(/\b(getSetting|savedSetting)\([^)]*["'`](falKey|replicateToken)["'`]/, ["server/provider-keys.ts"])).toEqual([]);
    // The one read there is the owner's branch of cloudKey.
    const pk = code(sources.find((s) => s.file === "server/provider-keys.ts")!.text);
    expect(pk.match(/getSetting\(/g)).toHaveLength(1);
  });

  it("names the environment's keys only in settings.ts", () => {
    expect(offenders(/\b(FAL_KEY|FAL_KEY_ID|FAL_KEY_SECRET|REPLICATE_API_TOKEN)\b/, ["server/settings.ts"])).toEqual([]);
  });

  it("makes the fal client only in fal.ts, always with a key, and never uses its default instance", () => {
    expect(offenders(/createFalClient\s*\(/, ["server/providers/fal.ts"])).toEqual([]);
    const fal = code(sources.find((s) => s.file === "server/providers/fal.ts")!.text);
    const calls = [...fal.matchAll(/createFalClient\s*\(\s*\{([^}]*)\}/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[1]).toMatch(/credentials:\s*k\b/);
    expect(offenders(/from\s+["']@fal-ai\/client["']/, ["server/providers/fal.ts"])).toEqual([]);
    expect(fal).not.toMatch(/import\s*\{[^}]*\bfal\b[^}]*\}\s*from\s*["']@fal-ai\/client["']/);
  });

  it("names fal.ai's and Replicate's API hosts only in their adapters", () => {
    expect(offenders(/queue\.fal\.run|rest\.fal\.ai|api\.replicate\.com/, ["server/providers/fal.ts", "server/providers/replicate.ts"])).toEqual([]);
    expect(offenders(/`Key \$\{/, ["server/providers/fal.ts"])).toEqual([]);
  });

  it("reads keys in the adapters only through cloudKey", () => {
    for (const f of ["server/providers/fal.ts", "server/providers/replicate.ts", "server/training.ts"]) {
      const text = code(sources.find((s) => s.file === f)!.text);
      expect(text, f).not.toMatch(/getSetting\(\s*["'`](falKey|replicateToken)/);
    }
    expect(code(sources.find((s) => s.file === "server/providers/fal.ts")!.text)).toMatch(/cloudKey\("fal"\)/);
    expect(code(sources.find((s) => s.file === "server/providers/replicate.ts")!.text)).toMatch(/cloudKey\("replicate"\)/);
  });

  it("sends a run to its provider only through adapterFor, which checks it runs as the run's own account", () => {
    const gen = code(sources.find((s) => s.file === "server/generations.ts")!.text);
    expect(gen).not.toMatch(/\bprovider\([^)]*\)\s*\.\s*(submit|poll|cancel|prepareFile)\b/);
    expect(gen).not.toMatch(/PROVIDERS\[[^\]]*\]\s*\.\s*(submit|poll|cancel|prepareFile)\b/);
    expect(gen.match(/adapterFor\(/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("calls the fal.ai and Replicate adapters directly only from training (the owner's)", () => {
    expect(offenders(/\b(falProvider|replicateProvider|falFetch)\b/, ["server/providers/fal.ts", "server/providers/replicate.ts", "server/providers/index.ts", "server/training.ts"])).toEqual([]);
  });
});
