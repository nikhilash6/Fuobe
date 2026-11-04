import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every setting that hosted runs, the worker queue and the optional services read from the environment is in
 * docs/SELF-HOSTING.md's table, so an install that opens hosted runs sees all of them (the kinds of input file the
 * workers take among them).
 */

const root = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("the self-hosting settings table", () => {
  it("lists every hosted-run, worker-token and service variable the app reads", () => {
    const read = new Set<string>();
    for (const file of sources(path.join(root, "src"))) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/process\.env\.(FUOBE_(?:HOSTED|POOL|BILLING|MODERATION|WORKER_TOKEN)[A-Z_]*)/g)) read.add(m[1]);
    }
    expect(read).toContain("FUOBE_POOL_MEDIA_INPUTS");
    const doc = fs.readFileSync(path.join(root, "docs", "SELF-HOSTING.md"), "utf8");
    const rows = doc.split(/\r?\n/).filter((l) => l.startsWith("| `"));
    const missing = [...read].filter((v) => !rows.some((r) => new RegExp("`" + v + "[`=]").test(r)));
    expect(missing).toEqual([]);
  });
});
