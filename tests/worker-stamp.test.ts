/**
 * The build stamp of the worker's shared parts (bin/lib/worker/stamp.mjs): the worker starts only on parts built from
 * its own checkout. Parts from an older build (an update whose build didn't run) are refused, never used.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { worker } from "../bin/lib/worker/index.mjs";
import { buildStamp, distProblem, STAMP_FILE, stampFiles } from "../bin/lib/worker/stamp.mjs";
import { tempDir } from "./helpers/temp-dir";

/** A small checkout: a source of each folder, the build's code and a catalog. */
function checkout() {
  const root = tempDir("fuobe-worker-stamp-");
  const put = (f: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  };
  put("src/lib/relay.ts", "export const a = 1;\n");
  put("src/lib/catalog/x.tsx", "export const b = 2;\n");
  put("src/server/pool.ts", 'export const g = { class_type: "SaveImage" };\n');
  put("scripts/lib/worker-catalog.mjs", "export const r = 1;\n");
  put("bin/lib/worker/rules.mjs", "export const r = 2;\n");
  put("workflows/comfyui/manifest.json", '{"workflows":[]}\n');
  put("workflows/comfyui/wf.json", '{"1":{"class_type":"SaveImage","inputs":{}}}\n');
  put("workflows/comfyui/README.md", "not part of it\n");
  return { root, put };
}

/** A worker folder whose dist has every part, stamped with `stamp`. */
function dist(stamp: string | null) {
  const dir = tempDir("fuobe-worker-dist-");
  fs.mkdirSync(path.join(dir, "compose/lib"), { recursive: true });
  for (const f of ["computer-runner.mjs", "allowed-nodes.json", "input-rules.json", "file-pins.json", "catalog-version.json", "compose/lib/ticket-compose.mjs"]) fs.writeFileSync(path.join(dir, f), "{}");
  if (stamp !== null) fs.writeFileSync(path.join(dir, STAMP_FILE), JSON.stringify({ built: "scripts/build-worker.mjs", stamp }));
  return dir;
}

describe("the worker's build stamp", () => {
  it("covers the sources, the build's code and the catalog's .json files, by name", () => {
    const { root } = checkout();
    const names = (stampFiles(root) as [string, string][]).map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining(["src/lib/relay.ts", "src/lib/catalog/x.tsx", "src/server/pool.ts", "scripts/build-worker.mjs", "scripts/lib/worker-build.mjs", "scripts/lib/worker-catalog.mjs", "bin/lib/worker/rules.mjs", "workflows/comfyui/manifest.json", "workflows/comfyui/wf.json"]));
    expect(names).not.toContain("workflows/comfyui/README.md");
    expect(names).toEqual([...names].sort());
  });

  it("changes with any of them, and only with them", () => {
    const { root, put } = checkout();
    const first = buildStamp(root);
    expect(buildStamp(root)).toBe(first);
    put("workflows/comfyui/README.md", "changed\n");
    put("docs/x.md", "not part of it\n");
    expect(buildStamp(root)).toBe(first);
    for (const [f, text] of [
      ["workflows/comfyui/wf.json", '{"1":{"class_type":"SaveVideo","inputs":{}}}\n'],
      ["src/server/pool.ts", 'export const g = { class_type: "SaveVideo" };\n'],
      ["bin/lib/worker/rules.mjs", "export const r = 3;\n"],
      ["scripts/lib/catalog-checks.mjs", "export const c = 1;\n"],
      ["src/lib/new.ts", "export const n = 1;\n"],
      ["workflows/comfyui/new.json", "{}\n"],
    ]) {
      const before = buildStamp(root);
      put(f, text);
      expect(buildStamp(root), f).not.toBe(before);
    }
  });

  it("a copy of the catalog in another folder gives the same stamp", () => {
    const { root } = checkout();
    const copy = tempDir("fuobe-worker-stamp-catalog-");
    for (const f of fs.readdirSync(path.join(root, "workflows/comfyui"))) fs.copyFileSync(path.join(root, "workflows/comfyui", f), path.join(copy, f));
    expect(buildStamp(root, copy)).toBe(buildStamp(root));
  });

  it("parts with no stamp, or another checkout's, can't be used", () => {
    const { root, put } = checkout();
    expect(distProblem(root, dist(null))).toBe("unbuilt");
    const d = dist(buildStamp(root));
    expect(distProblem(root, d)).toBeNull();
    put("workflows/comfyui/wf.json", '{"1":{"class_type":"SaveVideo","inputs":{}}}\n');
    expect(distProblem(root, d)).toBe("stale");
    fs.writeFileSync(path.join(d, STAMP_FILE), "not json");
    expect(distProblem(root, d)).toBe("unbuilt");
    expect(distProblem(path.join(root, "gone"), dist("x"))).toBe("stale");
  });

  it("`fuobe worker run` stops, and says how to build, on parts built from other files", async () => {
    const { root, put } = checkout();
    const home = tempDir("fuobe-worker-stamp-home-");
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ site: "https://studio.example", token: "t", workDir: tempDir("fuobe-worker-stamp-work-") }));
    const old = dist(buildStamp(root));
    put("src/lib/relay.ts", "export const a = 2;\n");
    let err = "";
    let out = "";
    const io = { env: { FUOBE_WORKER_HOME: home }, home, stdout: { write: (s: string) => void (out += s) }, stderr: { write: (s: string) => void (err += s) }, distDir: old, rootDir: root };
    expect(await worker(["run"], io)).toBe(2);
    expect(err).toBe("The worker's shared parts were built from other files than this checkout. Run: node scripts/build-worker.mjs\n");
    expect(out).toBe("");
    err = "";
    expect(await worker(["run"], { ...io, distDir: dist(null) })).toBe(2);
    expect(err).toMatch(/built from other files than this checkout/);
  });
});
