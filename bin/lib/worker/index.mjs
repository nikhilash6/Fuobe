// `fuobe worker <setup | run | pause | resume | status | bench | baseline | install>` (docs/gpu-workers.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, parseFor, readControl, readStatus, saveConfig, savedConfig, syncedFolder, workerHome, writeControl } from "./config.mjs";
import { installScript } from "./install.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const WORKER_USAGE = "fuobe worker <setup | run | pause [--now] [--for 2h] [--choose] | resume | status | bench | baseline | install [--yes]>";

const flag = (args, name) => args.includes(`--${name}`);
const value = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The pause shortcut's question. Returns "1h", "2h", "4h", "" (until you resume) or null (not paused). */
export async function choosePause(io) {
  if (!io.ask) return "";
  const answer = String((await io.ask("Pause the worker and have the GPU to yourself. For 1, 2 or 4 hours, or 0 until you resume? [1]: ")) ?? "").trim().toLowerCase();
  if (answer === "" || answer === "1") return "1h";
  if (answer === "2" || answer === "4") return `${answer}h`;
  if (answer === "0") return "";
  return null;
}

/** The worker command. Returns the exit code. */
export async function worker(args, io) {
  const [sub = "status", ...rest] = args;
  const home = workerHome(io.env, io.home);
  const say = (line) => io.stdout.write(`${line}\n`);
  switch (sub) {
    case "setup":
      return setup(home, io, say);
    case "run": {
      // From the command line: the worker runs as a child that starts again at once on new code (supervise.mjs).
      if (io.superviseWorker && !io.env?.FUOBE_WORKER_CHILD) return (await import("./supervise.mjs")).superviseWorker(rest, io);
      const cfg = loadConfig(home, io.env);
      if (!cfg.site || !cfg.token || !cfg.workDir) {
        io.stderr.write("This worker isn't set up yet. Run: fuobe worker setup\n");
        return 2;
      }
      const dist = io.distDir ?? path.join(here, "dist");
      if (!["computer-runner.mjs", "allowed-nodes.json", "input-rules.json", "file-pins.json", "catalog-version.json", "compose/lib/ticket-compose.mjs"].every((f) => fs.existsSync(path.join(dist, f)))) {
        io.stderr.write("The worker's shared parts aren't built. Run: node scripts/build-worker.mjs\n");
        return 2;
      }
      // Parts built from other files than this checkout (an update whose build didn't run) are never used.
      const { distProblem } = await import("./stamp.mjs");
      if (distProblem(io.rootDir ?? path.resolve(here, "../../.."), dist)) {
        io.stderr.write("The worker's shared parts were built from other files than this checkout. Run: node scripts/build-worker.mjs\n");
        return 2;
      }
      const { runWorker, siteProblem, withoutOldPort } = await import("./run.mjs");
      const problem = siteProblem(cfg.site, cfg);
      if (problem) {
        io.stderr.write(`${problem} Run: fuobe worker setup\n`);
        return 2;
      }
      const ctrl = new AbortController();
      // Ctrl+C, or a stop from the system: the worker stops its ComfyUI and cleans up before it exits (finished results
      // stay for its next start).
      const off = (io.onStop ?? io.onInterrupt)?.(() => ctrl.abort());
      const port = withoutOldPort(cfg).port;
      say(`Fuobe worker for ${cfg.site}. ${port ? `Its own ComfyUI uses port ${port}` : "Its own ComfyUI takes a free local port at each start"}. Ctrl+C stops it.`);
      let why;
      try {
        why = await runWorker(cfg, { home, signal: ctrl.signal });
      } catch (e) {
        // Another worker runs on this worker folder: this one leaves it alone. Not 0, so a scheduled start tries again later.
        const { WorkerRunning } = await import("./lock.mjs");
        if (!(e instanceof WorkerRunning)) throw e;
        io.stderr.write(`${e.message}\n`);
        return 4;
      } finally {
        off?.();
      }
      // Stopped by hand: done. Stopped by the studio: not 0, so the sign-in task starts it again a minute later. Ended for
      // new code on disk (update.mjs): UPDATE_EXIT, so whatever started it may start it again at once.
      if (why === "update") return (await import("./update.mjs")).UPDATE_EXIT;
      return why === "aborted" ? 0 : why === "signed-out" ? 3 : 1;
    }
    case "pause": {
      let forText = value(rest, "for");
      let now = flag(rest, "now");
      // The shortcut asks how long. The GPU is yours at once: its job goes back in line, keeping its place.
      if (flag(rest, "choose")) {
        const pick = await choosePause(io);
        if (pick === null) {
          say("Not paused.");
          return 0;
        }
        forText = pick || undefined;
        now = true;
      }
      const forMs = forText ? parseFor(forText) : null;
      if (forText && !forMs) {
        io.stderr.write("Say how long, like --for 2h or --for 30m.\n");
        return 2;
      }
      const at = (io.now ?? Date.now)();
      writeControl(home, { paused: true, now, until: forMs ? at + forMs : null });
      say(now ? "Paused now: its job goes back in line, and its ComfyUI stops." : "Paused: it finishes its job, then stops its ComfyUI.");
      if (forMs) say(`It resumes by itself at ${new Date(at + forMs).toLocaleTimeString()}.`);
      return 0;
    }
    case "resume":
      writeControl(home, { paused: false, resumedAt: Date.now() });
      say("Resumed on this PC. (A pause on the website stays until it's resumed there.)");
      return 0;
    case "status": {
      const s = readStatus(home);
      const c = readControl(home);
      say(s ? `${s.state}${Date.now() - s.at > 30_000 ? " (the worker isn't running)" : ""}` : "The worker hasn't run yet.");
      if (c.paused) say(c.until ? `Paused here until ${new Date(c.until).toLocaleTimeString()}.` : "Paused here.");
      return 0;
    }
    case "bench": {
      const cfg = loadConfig(home, io.env);
      const res = await io.fetch(`${cfg.site.replace(/\/+$/, "")}/api/gpu/computer/bench`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        io.stderr.write(`${body.error ?? `The studio answered HTTP ${res.status}`}\n`);
        return 1;
      }
      say(body.tasks ? `${body.tasks} bench jobs are waiting for this worker. Keep it running.` : "No bench jobs for its lanes yet. Its times come from the jobs it runs.");
      return 0;
    }
    case "baseline": {
      // The desktop's usual share of the GPU, for studio jobs first. Local ComfyUI work may stay open; it isn't counted.
      // The worker's own ComfyUI isn't counted either, so the worker may keep running.
      const { BASELINE_CAP_MB, measureBaseline } = await import("./local-work.mjs");
      const m = await measureBaseline(loadConfig(home, io.env), io.gpu ?? {});
      if (m === null) {
        io.stderr.write("Couldn't read the GPU counters or the port table on this PC, so nothing changed.\n");
        return 1;
      }
      saveConfig(home, { ...savedConfig(home), desktopBaselineMb: m.mb });
      say(`The GPU's memory in use: ${m.usedMb} MB. Not counted: the worker's own ComfyUI (${m.ownMb} MB) and local ComfyUI work (${m.workMb} MB).`);
      if (m.top.length) say(`Counted: ${m.measuredMb} MB, mostly ${m.top.map((p) => `${p.name} (process ${p.pid}, ${p.mb} MB)`).join(", ")}.`);
      if (m.capped) {
        say(`That is more than a desktop uses: another GPU program was open. Saved ${BASELINE_CAP_MB} MB as desktopBaselineMb in worker.json, the most it saves.`);
        say("Close the programs above and measure again.");
      } else {
        say(`The desktop uses about ${m.mb} MB of the GPU's memory. Saved as desktopBaselineMb in worker.json.`);
        say("Measure again with no game or other GPU program open if that number looks too high.");
      }
      return 0;
    }
    case "install": {
      const script = installScript({ node: process.execPath, bin: path.resolve(here, "../../fuobe.mjs"), home });
      if (!flag(rest, "yes")) {
        say("This adds a task that starts the worker when you sign in (and again if it stops), and two desktop shortcuts:");
        say('"Pause Fuobe worker" (Ctrl+Alt+P: it asks for 1, 2 or 4 hours) and "Resume Fuobe worker". To do it, run: fuobe worker install --yes');
        say("");
        say(script.text);
        return 0;
      }
      if (process.platform !== "win32") {
        io.stderr.write("worker install is for Windows. Elsewhere, run `fuobe worker run` from systemd or a login item.\n");
        return 2;
      }
      fs.mkdirSync(home, { recursive: true });
      const file = path.join(home, "install.ps1");
      fs.writeFileSync(file, script.text);
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { stdio: "inherit" });
      return r.status ?? 1;
    }
    default:
      io.stderr.write(`Unknown worker command "${sub}". Usage: ${WORKER_USAGE}\n`);
      return 2;
  }
}

async function setup(home, io, say) {
  const old = loadConfig(home, io.env);
  const ask = async (q, def, o = {}) => ((await io.ask(`${q}${def ? ` [${def}]` : ""}: `, o)) || def || "").trim();
  say("Set up this PC as a Fuobe worker. It takes the studio's jobs over HTTPS and runs them on its own ComfyUI.");
  const site = await ask("The studio's address", old.site ?? "https://");
  const { OLD_SETUP_PORT, siteProblem } = await import("./run.mjs");
  const bad = siteProblem(site, old);
  if (bad) {
    io.stderr.write(`${bad}\n`);
    return 2;
  }
  const token = await ask("The worker's token (Settings → Workers → Add a worker)", "", { hidden: true });
  if (!/^fuobe_wkr_/.test(token) && !old.token) {
    io.stderr.write("That isn't a worker token (they start with fuobe_wkr_).\n");
    return 2;
  }
  const comfyDir = await ask("ComfyUI's folder (where its main.py is)", old.comfyDir);
  if (!fs.existsSync(path.join(comfyDir, "main.py"))) {
    io.stderr.write("There's no main.py in that folder.\n");
    return 2;
  }
  const modelDirs = (await ask("Model folders, separated by ; (each holds checkpoints, loras…)", (old.modelDirs ?? [path.join(comfyDir, "models")]).join(";")))
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const workDir = await ask("A worker folder for jobs' files", old.workDir ?? (process.platform === "win32" ? "D:\\FuobeWorker" : path.join(io.home, "fuobe-worker")));
  if (syncedFolder(workDir)) {
    io.stderr.write("That folder is synced to a cloud drive. Pick one outside OneDrive, Dropbox and the like: people's files must stay on this PC.\n");
    return 2;
  }
  // ffmpeg makes every clip and sound again before its ComfyUI reads them. Without it, the worker takes pictures only.
  const { ffmpegVersion } = await import("./media.mjs");
  const ffmpegAnswer = await ask("ffmpeg's path, for clips and sound (- for pictures only)", old.ffmpeg ?? ((await ffmpegVersion("ffmpeg")) ? "ffmpeg" : "-"));
  const ffmpeg = ffmpegAnswer && ffmpegAnswer !== "-" ? ffmpegAnswer : null;
  if (ffmpeg && !(await ffmpegVersion(ffmpeg))) {
    io.stderr.write(`There's no working ffmpeg at ${ffmpeg}. Give its full path, or - for pictures only.\n`);
    return 2;
  }
  const autoResume = /^y/i.test(await ask("Resume by itself when the GPU has been free for 10 minutes? (y/N)", old.autoResume ? "y" : "n"));
  // The PC's ceiling: the most it ever runs. The studio and its panel can only narrow inside it. Run setup again to change it.
  const { ceilingFrom, ceilingWords, workerCatalog } = await import("./tickets.mjs");
  const was = old.ceiling ?? {};
  const num = (v) => (typeof v === "number" && v > 0 ? String(v) : "0");
  let catalog = null;
  try {
    catalog = workerCatalog(io.catalogDir ?? path.resolve(here, "../../../workflows/comfyui"));
  } catch {}
  const limits = ceilingFrom(
    {
      work: await ask("Which lanes or workflows may this PC run? all, or their names separated by commas", was.lanes || was.workflows ? [...(was.lanes ?? []), ...(was.workflows ?? [])].join(",") : "all"),
      megapixels: await ask("The largest picture it makes, in megapixels (0 for no limit)", num(was.maxMegapixels)),
      seconds: await ask("The longest clip it makes, in seconds (0 for no limit)", num(was.maxSeconds)),
      outputs: await ask("The most results one run may ask for (0 for no limit)", num(was.maxOutputs)),
    },
    (id) => !catalog || catalog.has(id) || (id.includes("{n}") && [1, 2, 3, 4].some((n) => catalog.has(id.replace("{n}", String(n))))),
  );
  if (limits.error) {
    io.stderr.write(`${limits.error}\n`);
    return 2;
  }
  // The owner's own jobs come as full graphs; answering no takes job tickets only.
  const acceptGraphs = !/^n/i.test(await ask("Also run the studio owner's own jobs, which come as whole graphs? (Y/n)", old.acceptGraphs === false ? "n" : "y"));
  // The CPU slot: light CPU work and finishing jobs beside the GPU's job (a second ComfyUI that runs on the CPU only).
  const cpuSlot = /^y/i.test(await ask("Also run light CPU work (joins, trims, filters) and finishing jobs (3D models, camera paths) beside the GPU's job? (y/N)", old.cpuSlot === true ? "y" : "n"));
  fs.mkdirSync(workDir, { recursive: true });
  if (process.platform === "win32") {
    // Not content indexed: jobs' files stay out of Windows Search.
    const { spawnSync } = await import("node:child_process");
    spawnSync("attrib", ["+I", workDir], { windowsHide: true });
  }
  // A port pinned by hand stays; the one every older setup saved (8190) goes, so its ComfyUI takes a free port at random
  // at each start. Only what was asked here changes: the rest of worker.json stays as it was, with no defaults written in.
  const saved = savedConfig(home);
  const port = Number(saved.port) === OLD_SETUP_PORT ? null : (saved.port ?? null);
  // A token given in FUOBE_WORKER_TOKEN stays out of the file.
  const { ceiling: _was, ...rest } = saved;
  void _was;
  saveConfig(home, { ...rest, port, site: site.replace(/\/+$/, ""), token: token || saved.token, comfyDir, modelDirs, workDir, ffmpeg, autoResume, ...(limits.ceiling && { ceiling: limits.ceiling }), acceptGraphs, cpuSlot });
  writeControl(home, { paused: true, now: false, until: null });
  say(`Saved in ${path.join(home, "worker.json")} (readable by you only). The worker starts paused here.`);
  say(`This PC runs ${ceilingWords(limits.ceiling)}. Run fuobe worker setup again to change it.`);
  say("Next: fuobe worker run. Resume it here with fuobe worker resume, and on the website in Settings → Workers.");
  return 0;
}
