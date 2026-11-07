/**
 * New worker code on disk (bin/lib/worker/update.mjs): the worker notes its checkout's commit, its parts' stamp and the
 * update-ready file at its start, and ends to start again only once new code is installed and whole. `fuobe worker run`
 * then ends with its own exit code. The worker loop's side (no new job, the job in hand finishes first) is in
 * tests/worker-recovery.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { worker } from "../bin/lib/worker/index.mjs";
import { buildStamp, STAMP_FILE } from "../bin/lib/worker/stamp.mjs";
import { CodeWatch, codeOnDisk, headOf, restartDue, UPDATE_DEFER_MAX_MS, UPDATE_EXIT, UPDATE_READY_FILE } from "../bin/lib/worker/update.mjs";
import { tempDir } from "./helpers/temp-dir";

// `fuobe worker run` with a loop that ends for new code at once (the loop itself is tested elsewhere).
vi.mock("../bin/lib/worker/run.mjs", () => ({ runWorker: async () => "update", siteProblem: () => null, withoutOldPort: (c: unknown) => c }));

const A = "a".repeat(40);
const B = "b".repeat(40);

/** A checkout's git folder at `head` (a commit, or "ref: refs/heads/x"). */
function repo(head: string) {
  const root = tempDir("fuobe-worker-update-root-");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), `${head}\n`);
  return root;
}

/** Parts stamped with `stamp`. */
function parts(stamp: string) {
  const dist = tempDir("fuobe-worker-update-dist-");
  fs.writeFileSync(path.join(dist, STAMP_FILE), JSON.stringify({ built: "scripts/build-worker.mjs", stamp }));
  return dist;
}

describe("the commit a checkout is at", () => {
  it("reads a detached HEAD, a branch's file, packed-refs and a worktree's git file", () => {
    expect(headOf(repo(A))).toBe(A);
    const branch = repo("ref: refs/heads/main");
    expect(headOf(branch)).toBeNull();
    fs.writeFileSync(path.join(branch, ".git/packed-refs"), `# pack-refs with: peeled\n${B} refs/heads/main\n`);
    expect(headOf(branch)).toBe(B);
    fs.mkdirSync(path.join(branch, ".git/refs/heads"), { recursive: true });
    fs.writeFileSync(path.join(branch, ".git/refs/heads/main"), `${A}\n`);
    expect(headOf(branch)).toBe(A);
    // A worktree: .git is a file naming its own folder, which names the shared one.
    const wt = tempDir("fuobe-worker-update-wt-");
    const own = path.join(branch, ".git/worktrees/wt");
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(own, "commondir"), "../..\n");
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${own}\n`);
    expect(headOf(wt)).toBe(A);
    expect(headOf(tempDir("fuobe-worker-update-none-"))).toBeNull();
  });
});

describe("new code on disk", () => {
  it("restartDue: at once when no person's job waits (or the studio doesn't say); while one waits, only after the cap", () => {
    expect(restartDue(1000, 1000, 0)).toBe(true);
    expect(restartDue(1000, 1000, null)).toBe(true);
    expect(restartDue(1000, 1000, undefined)).toBe(true);
    expect(restartDue(1000, 1000, 2)).toBe(false);
    expect(restartDue(1000 + UPDATE_DEFER_MAX_MS - 1, 1000, 2)).toBe(false);
    expect(restartDue(1000 + UPDATE_DEFER_MAX_MS, 1000, 2)).toBe(true);
    expect(restartDue(5000, 1000, 1, 4000)).toBe(true);
    expect(UPDATE_DEFER_MAX_MS).toBe(30 * 60_000);
  });

  it("nothing changed: no restart", () => {
    const home = tempDir("fuobe-worker-update-home-");
    const w = new CodeWatch({ root: repo(A), dist: parts("s1"), home, everyMs: 0, problem: () => null });
    for (let t = 0; t < 5; t++) expect(w.check(t)).toBe(false);
  });

  it("the update-ready file, a new commit or a new stamp, with whole parts: restart, and it stays so", () => {
    for (const change of ["ready", "head", "stamp"]) {
      const root = repo(A);
      const dist = parts("s1");
      const home = tempDir("fuobe-worker-update-home-");
      // A file left by an earlier update counts as what it started with.
      fs.writeFileSync(path.join(home, UPDATE_READY_FILE), '{"commit":"old"}');
      const w = new CodeWatch({ root, dist, home, everyMs: 0, problem: () => null });
      expect(w.check(1), change).toBe(false);
      if (change === "ready") fs.writeFileSync(path.join(home, UPDATE_READY_FILE), '{"commit":"new"}');
      if (change === "head") fs.writeFileSync(path.join(root, ".git/HEAD"), `${B}\n`);
      if (change === "stamp") fs.writeFileSync(path.join(dist, STAMP_FILE), JSON.stringify({ stamp: "s2" }));
      expect(w.check(2), change).toBe(true);
      expect(w.check(3), change).toBe(true);
    }
  });

  it("a half-done update (parts not built from the checkout): no restart until they are, and the stamp is read at most once a minute", () => {
    const root = repo(A);
    const home = tempDir("fuobe-worker-update-home-");
    let problem: string | null = "stale";
    const problemOf = vi.fn(() => problem);
    const w = new CodeWatch({ root, dist: parts("s1"), home, everyMs: 15_000, wholeEveryMs: 60_000, problem: problemOf });
    fs.writeFileSync(path.join(root, ".git/HEAD"), `${B}\n`);
    // Looked at no more often than every 15 s.
    expect(w.check(0)).toBe(false);
    expect(problemOf).toHaveBeenCalledTimes(1);
    expect(w.check(10_000)).toBe(false);
    expect(w.check(30_000)).toBe(false);
    expect(problemOf).toHaveBeenCalledTimes(1);
    problem = null;
    expect(w.check(45_000)).toBe(false);
    expect(w.check(60_000)).toBe(true);
    expect(problemOf).toHaveBeenCalledTimes(2);
    // Another change on disk (the update-ready file, written last) is checked at once.
    problem = "stale";
    const w3 = new CodeWatch({ root, dist: parts("s1"), home, everyMs: 15_000, wholeEveryMs: 60_000, problem: () => problem });
    fs.writeFileSync(path.join(root, ".git/HEAD"), `${A}\n`);
    expect(w3.check(0)).toBe(false);
    problem = null;
    expect(w3.check(15_000)).toBe(false);
    fs.writeFileSync(path.join(home, UPDATE_READY_FILE), '{"commit":"new"}');
    expect(w3.check(30_000)).toBe(true);
    // A check that throws counts as not whole.
    const w2 = new CodeWatch({ root, dist: parts("s1"), home, everyMs: 0, problem: () => { throw new Error("unreadable"); } });
    fs.writeFileSync(path.join(home, UPDATE_READY_FILE), "{}");
    expect(w2.check(0)).toBe(false);
  });

  it("with the real stamp: a checkout whose parts match is whole", () => {
    const root = repo(A);
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/server"), { recursive: true });
    fs.mkdirSync(path.join(root, "workflows/comfyui"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/a.ts"), "export const a = 1;\n");
    const dist = parts(buildStamp(root));
    const home = tempDir("fuobe-worker-update-home-");
    const w = new CodeWatch({ root, dist, home, everyMs: 0, wholeEveryMs: 0 });
    expect(codeOnDisk({ root, dist, home })).toEqual({ head: A, stamp: buildStamp(root), ready: null });
    // A new commit whose build isn't there yet.
    fs.writeFileSync(path.join(root, ".git/HEAD"), `${B}\n`);
    fs.writeFileSync(path.join(root, "src/lib/a.ts"), "export const a = 2;\n");
    expect(w.check(1)).toBe(false);
    // Its build arrives.
    fs.writeFileSync(path.join(dist, STAMP_FILE), JSON.stringify({ stamp: buildStamp(root) }));
    expect(w.check(2)).toBe(true);
  });

  it("`fuobe worker run` ends with its own exit code after ending for new code", async () => {
    const root = tempDir("fuobe-worker-update-checkout-");
    for (const d of ["src/lib", "src/server", "workflows/comfyui"]) fs.mkdirSync(path.join(root, d), { recursive: true });
    const dist = tempDir("fuobe-worker-update-parts-");
    fs.mkdirSync(path.join(dist, "compose/lib"), { recursive: true });
    for (const f of ["computer-runner.mjs", "allowed-nodes.json", "input-rules.json", "file-pins.json", "catalog-version.json", "compose/lib/ticket-compose.mjs"]) fs.writeFileSync(path.join(dist, f), "{}");
    fs.writeFileSync(path.join(dist, STAMP_FILE), JSON.stringify({ stamp: buildStamp(root) }));
    const home = tempDir("fuobe-worker-update-home-");
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ site: "https://studio.example", token: "t", workDir: tempDir("fuobe-worker-update-work-") }));
    let err = "";
    const io = { env: { FUOBE_WORKER_HOME: home }, home, stdout: { write: () => {} }, stderr: { write: (s: string) => void (err += s) }, distDir: dist, rootDir: root };
    expect(await worker(["run"], io)).toBe(UPDATE_EXIT);
    expect(UPDATE_EXIT).not.toBe(0);
    expect([1, 2, 3, 4]).not.toContain(UPDATE_EXIT);
    expect(err).toBe("");
  });
});
