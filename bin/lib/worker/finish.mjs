// Finishing jobs on the worker's CPU slot (docs/gpu-workers.md, "The CPU slot"; src/lib/finish-ticket.ts). Each one runs
// in processes of its own at low priority, in an emptied folder of its own, with a short environment (never the worker's
// token or this PC's other settings), and is stopped when its run limit ends:
//
// - "model3d": scripts/model3d/finish-glb.mjs checks the GLB first: only a self-contained binary glTF (every buffer and
//   picture inside the file) is finished; any other is refused ("unsafe-model") and never read further. It writes the web
//   GLB; then scripts/model3d/render-turntable.mjs renders the turntable and its poster (CPU only). With no browser or
//   ffmpeg for the turntable here, the model goes back without one ("skipped").
// - "path": path-child.mjs draws the camera path through the still and its depth picture, and ffmpeg encodes it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");

/** Exit code 3 of the 3D scripts: the GLB isn't self-contained (finish-glb.mjs), or no browser or ffmpeg (render-turntable.mjs). */
const REFUSED = 3;

/** The variables the scripts read (and what Node, a browser and ffmpeg need to start): nothing else of this PC's. */
const PASS = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "LANG", "CHROMIUM_PATH", "FUOBE_CHROMIUM", "PLAYWRIGHT_BROWSERS_PATH"];

export function scriptEnv(env = process.env, ffmpeg = null) {
  const out = {};
  for (const k of PASS) if (env[k] !== undefined) out[k] = env[k];
  if (ffmpeg) out.FFMPEG_PATH = ffmpeg;
  out.FUOBE_PARENT_PIPE = "1";
  return out;
}

/** Run a script with Node in `cwd`: its exit code and its output's end. Stopped (with all it started) on `signal`. */
export function runScript(script, args, { cwd, signal, env, onLine, timeoutMs = 20 * 60_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    let stdout = "";
    let stderr = "";
    let partial = "";
    child.stdout.on("data", (d) => {
      stdout = (stdout + d).slice(-20_000);
      if (!onLine) return;
      const lines = (partial + d).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const kill = () => {
      if (child.exitCode !== null || !child.pid) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      else child.kill("SIGKILL");
    };
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.once("error", () => (clearTimeout(timer), resolve({ code: -1, stdout, stderr })));
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The last line of a script's output that parses as JSON. */
export function lastJson(stdout) {
  for (const line of String(stdout).trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

const tail = (s) => String(s).trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 160) ?? "";

/** Can this checkout's Node load a package (the 3D finish needs the glTF tools and sharp)? */
function hasPackage(name) {
  try {
    import.meta.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * The finishing jobs this worker runs, and the function its CPU slot calls for one (computer-runner.ts RunnerDeps.finish).
 * `o`: { workDir (its CPU slot's folder), ffmpeg (null: none), env, root, distDir, scripts }. `scripts` names other
 * scripts for the GLB finish and the turntable ({ finishGlb, turntable }: a test's stand-ins).
 */
export function finishers(o) {
  const root = o.root ?? ROOT;
  const finishGlb = o.scripts?.finishGlb ?? path.join(root, "scripts/model3d/finish-glb.mjs");
  const turntableScript = o.scripts?.turntable ?? path.join(root, "scripts/model3d/render-turntable.mjs");
  const dist = o.distDir ?? path.join(here, "dist");
  const env = scriptEnv(o.env ?? process.env, o.ffmpeg);
  const kinds = [];
  if (hasPackage("@gltf-transform/core") && hasPackage("sharp")) kinds.push("model3d");
  if (o.ffmpeg && ["camera-path.mjs", "path-splat.mjs", "scene3d.mjs"].every((f) => fs.existsSync(path.join(dist, f))) && hasPackage("sharp")) kinds.push("path");

  async function finish(t, inputs, { signal, progress }) {
    const kind = t.finish?.kind;
    if (!kinds.includes(kind)) return { refused: "finish-failed" };
    // Its own emptied folder: nothing of another job is beside it, and nothing of it stays.
    const dir = path.join(o.workDir, "finish", String(t.id).replace(/[^A-Za-z0-9_-]/g, "_"));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const put = (name, data) => {
      fs.writeFileSync(path.join(dir, name), Buffer.from(data), { mode: 0o600 });
      return path.join(dir, name);
    };
    try {
      if (kind === "model3d") {
        const raw = put("raw.glb", inputs.model);
        const web = path.join(dir, "web.glb");
        const r = await runScript(finishGlb, ["--in", raw, "--out", web, "--material", String(t.finish.settings.material ?? "auto"), "--limits", "account"], { cwd: dir, signal, env, timeoutMs: 5 * 60_000 });
        if (r.code === REFUSED) return { refused: "unsafe-model" };
        const stats = r.code === 0 && fs.existsSync(web) ? lastJson(r.stdout) : null;
        if (!stats) return { refused: "finish-failed" };
        progress(0.3);
        const files = [{ role: "web", name: "web.glb", data: fs.readFileSync(web), contentType: "model/gltf-binary" }];
        let turntable;
        if (t.finish.settings.turntable === true) {
          const clip = path.join(dir, "turntable.mp4");
          const poster = path.join(dir, "poster.webp");
          const tt = await runScript(turntableScript, ["--glb", web, "--out", clip, "--poster", poster, "--material", stats.material ?? "auto"], {
            cwd: dir,
            signal,
            env,
            timeoutMs: 10 * 60_000,
            onLine: (line) => {
              const m = /^frame (\d+)\/(\d+)$/.exec(line.trim());
              if (m) progress(0.3 + 0.7 * (Number(m[1]) / Number(m[2])));
            },
          });
          if (tt.code === 0 && fs.existsSync(clip)) {
            files.push({ role: "turntable", name: "turntable.mp4", data: fs.readFileSync(clip), contentType: "video/mp4" });
            if (fs.existsSync(poster)) files.push({ role: "poster", name: "poster.webp", data: fs.readFileSync(poster), contentType: "image/webp" });
          } else turntable = tt.code === REFUSED ? `skipped: ${tail(tt.stderr) || "no turntable here"}` : `failed: ${tail(tt.stderr) || `exit ${tt.code}`}`;
        }
        const stat = { material: stats.material, triangles: stats.triangles, bytesIn: stats.bytesIn, bytesOut: stats.bytesOut };
        return { files, stats: stat, ...(turntable && { turntable }) };
      }
      // "path"
      const photo = put("photo.png", inputs.photo);
      const depth = put("depth.png", inputs.depth);
      const out = path.join(dir, "path.mp4");
      const settings = path.join(dir, "settings.json");
      fs.writeFileSync(settings, JSON.stringify(t.finish.settings));
      const r = await runScript(path.join(here, "path-child.mjs"), [photo, depth, settings, out, o.ffmpeg, dist], {
        cwd: dir,
        signal,
        env,
        timeoutMs: 10 * 60_000,
        onLine: (line) => {
          const m = /^frame (\d+)\/(\d+)$/.exec(line.trim());
          if (m) progress(Number(m[1]) / Number(m[2]));
        },
      });
      if (r.code !== 0 || !fs.existsSync(out)) return { refused: "finish-failed" };
      return { files: [{ role: "path", name: "path.mp4", data: fs.readFileSync(out), contentType: "video/mp4" }] };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  return { kinds, finish };
}
