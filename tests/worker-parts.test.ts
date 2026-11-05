/**
 * The worker program's smaller parts: its one retry policy for calls to the studio (bin/lib/worker/retry.mjs), keeping
 * the PC awake while it works (awake.mjs), how it makes clips and sound again (media.mjs), and the studio's address.
 * It also covers the stop signals the command line ends on (bin/lib/signals.mjs).
 */
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helperCommand, StayAwake } from "../bin/lib/worker/awake.mjs";
import { encodeArgs, FIT, INPUT_FORMATS, MEDIA_LIMITS, mediaKind, outputCap, PREVIEW_QUALITIES, previewArgs, previewJpeg, reencode } from "../bin/lib/worker/media.mjs";
import { RETRY, retrying } from "../bin/lib/worker/retry.mjs";
import { ffmpegOf } from "../bin/lib/worker/config.mjs";
import { takeLock, workerLives, WorkerRunning } from "../bin/lib/worker/lock.mjs";
import { privateHost, siteProblem, withoutOldPort } from "../bin/lib/worker/run.mjs";
import { onSignals, STOP_SIGNALS } from "../bin/lib/signals.mjs";
import { tempDir } from "./helpers/temp-dir";

const hasFfmpeg = spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0;
/** A check that starts the real ffmpeg (several times, for a preview): time for a busy machine running other tests too. */
const FFMPEG_MS = 60_000;

/** A clock that moves only when the policy sleeps. */
function clock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept };
}

/** A studio that answers each call with the next of `list` (the last one again and again). */
const answers = (list: (() => Response | Error)[]) => {
  const calls: string[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    const next = (list.length > 1 ? list.shift()! : list[0])();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, calls };
};
const netError = (code: string) => () => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const page = (status: number) => () => new Response("<html>challenge</html>", { status, headers: { "content-type": "text/html" } });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => Response.json(body, { status, headers });
const text = (body: string, status = 200, headers: Record<string, string> = {}) => () => new Response(body, { status, headers });

describe("one retry policy for calls to the studio", () => {
  it("waits out a studio that is restarting, with a pause that grows, and gets the answer", async () => {
    const c = clock();
    const a = answers([page(502), page(503), json({ ok: true })]);
    const res = await retrying(a.fetchFn, c)("https://studio.test/api/gpu/computer/claim", { method: "POST" });
    expect(res.status).toBe(200);
    expect(c.slept).toEqual([1000, 2000]);
  });

  it("gives up on a call after 2 minutes, and on a part of a result after an hour", async () => {
    const c = clock();
    const call = await retrying(answers([page(503)]).fetchFn, c)("https://studio.test/api/gpu/computer/tasks/x/report", { method: "POST" });
    expect(call.status).toBe(503);
    expect(c.slept.reduce((a, b) => a + b, 0)).toBe(RETRY.callMs);
    expect(Math.max(...c.slept)).toBeLessThanOrEqual(RETRY.maxPauseMs);
    const c2 = clock();
    const part = await retrying(answers([page(503)]).fetchFn, c2)("https://studio.test/api/gpu/computer/tasks/x/outputs/0?offset=0&total=9", { method: "PUT", body: "x" });
    expect(part.status).toBe(503);
    expect(c2.slept.reduce((a, b) => a + b, 0)).toBe(RETRY.uploadMs);
  });

  it("never waits out a beat: the next one comes soon", async () => {
    const c = clock();
    const a = answers([page(503), json({})]);
    expect((await retrying(a.fetchFn, c)("https://studio.test/api/gpu/computer/beat", { method: "POST" })).status).toBe(503);
    expect(a.calls).toHaveLength(1);
  });

  it("a proxy's page in place of the studio's answer (403 without JSON) is no answer, never a stop", async () => {
    const c = clock();
    const res = await retrying(answers([page(403)]).fetchFn, c)("https://studio.test/api/gpu/computer/beat", { method: "POST" });
    expect(res.status).toBe(503);
    // The studio's own 403 (JSON) is its answer.
    const own = await retrying(answers([json({ error: "no" }, 403)]).fetchFn, clock())("https://studio.test/api/gpu/computer/claim", { method: "POST" });
    expect(own.status).toBe(403);
  });

  it("sends a call again only when that is safe: a read, a part of a result, or a call that never left", async () => {
    // A read: any network failure.
    const read = answers([netError("ECONNRESET"), text("data")]);
    expect((await retrying(read.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/inputs/0")).status).toBe(200);
    // A report that may have arrived: not sent twice.
    const sent = answers([netError("ECONNRESET"), json({ ok: true })]);
    await expect(retrying(sent.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/report", { method: "POST" })).rejects.toThrow();
    expect(sent.calls).toHaveLength(1);
    // A report that never left: sent again.
    const refused = answers([netError("ECONNREFUSED"), json({ ok: true })]);
    expect((await retrying(refused.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/report", { method: "POST" })).status).toBe(200);
    // A slow answer (504) to a report: it may have arrived, so not again; to a read, again.
    const slow = answers([page(504), json({ ok: true })]);
    expect((await retrying(slow.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/report", { method: "POST" })).status).toBe(504);
    const slowRead = answers([page(504), text("data")]);
    expect((await retrying(slowRead.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/inputs/0")).status).toBe(200);
  });

  it("a busy studio is waited out as long as it says; a 429 that says nothing (a file sent enough times) is the answer", async () => {
    const c = clock();
    const busy = answers([text("busy", 429, { "Retry-After": "7" }), json({ ok: true })]);
    expect((await retrying(busy.fetchFn, c)("https://studio.test/api/gpu/computer/claim", { method: "POST" })).status).toBe(200);
    expect(c.slept).toEqual([7000]);
    const spent = answers([json({ error: "That file was sent enough times." }, 429), text("data")]);
    expect((await retrying(spent.fetchFn, clock())("https://studio.test/api/gpu/computer/tasks/x/inputs/0")).status).toBe(429);
    expect(spent.calls).toHaveLength(1);
  });

  it("stops waiting once the worker is stopping", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const a = answers([page(503), json({})]);
    expect((await retrying(a.fetchFn, { ...clock(), signal: ctrl.signal })("https://studio.test/api/gpu/computer/claim", { method: "POST" })).status).toBe(503);
    expect(a.calls).toHaveLength(1);
  });
});

describe("keeping the PC awake while it works", () => {
  class FakeChild extends EventEmitter {
    stdin = { ended: false, end: () => void (this.stdin.ended = true), on: () => {} };
    killed = false;
    kill() {
      this.killed = true;
    }
  }

  it("starts one helper while it works and stops it after; one that stops by itself is tried again only after a while", () => {
    const spawned: FakeChild[] = [];
    let t = 0;
    const a = new StayAwake({ platform: "win32", now: () => t, spawn: (() => (spawned.push(new FakeChild()), spawned.at(-1))) as never });
    a.set(true);
    a.set(true);
    expect(spawned).toHaveLength(1);
    expect(a.on).toBe(true);
    a.set(false);
    expect(spawned[0].stdin.ended).toBe(true);
    expect(spawned[0].killed).toBe(true);
    expect(a.on).toBe(false);
    a.set(true);
    spawned[1].emit("exit", 1);
    expect(a.on).toBe(false);
    t += 60_000;
    a.set(true);
    expect(spawned).toHaveLength(2);
    t += 10 * 60_000;
    a.set(true);
    expect(spawned).toHaveLength(3);
  });

  it("asks each system its own way: SetThreadExecutionState on Windows, caffeinate on macOS, systemd-inhibit on Linux", () => {
    const [cmd, args] = helperCommand("win32")!;
    expect(cmd).toBe("powershell");
    const script = Buffer.from(String(args.at(-1)), "base64").toString("utf16le");
    expect(script).toContain("SetThreadExecutionState([uint32]2147483649)");
    expect(script).toContain("[Console]::In.ReadLine()");
    expect(helperCommand("darwin", 42)).toEqual(["caffeinate", ["-i", "-w", "42"]]);
    expect(helperCommand("linux")![0]).toBe("systemd-inhibit");
    expect(helperCommand("aix")).toBeNull();
  });
});

describe("clips and sound, made again", () => {
  it("knows a clip or a sound by its type, its name, or the loader that reads it", () => {
    const graph = { "1": { class_type: "LoadVideo", inputs: { file: "fuobe_aaaaaaaaaaaa.bin" } }, "2": { class_type: "LoadAudio", inputs: { audio: "fuobe_bbbbbbbbbbbb.bin [input]" } } };
    expect(mediaKind({ name: "fuobe_x1234567.png", contentType: "image/png" }, graph)).toBeNull();
    expect(mediaKind({ name: "fuobe_x1234567.mp4", contentType: "application/octet-stream" }, {})).toBe("video");
    expect(mediaKind({ name: "fuobe_x1234567.bin", contentType: "audio/wav" }, {})).toBe("audio");
    // Labelled a picture, but a clip loader reads it: made again as a clip.
    expect(mediaKind({ name: "fuobe_aaaaaaaaaaaa.bin", contentType: "image/png" }, graph)).toBe("video");
    expect(mediaKind({ name: "fuobe_bbbbbbbbbbbb.bin", contentType: "image/png" }, graph)).toBe("audio");
  });

  it("reads the file only as a local file in a plain container format, and writes at most an hour, 4096 pixels and a size cap", () => {
    for (const args of [encodeArgs("video", "fuobe_a.mp4", "in", "out", 1234), encodeArgs("video", "fuobe_a.gif", "in", "out", 1234), encodeArgs("audio", "fuobe_a.wav", "in", "out", 1234)]) {
      const at = (flag: string) => args[args.indexOf(flag) + 1];
      // Before the input, so they apply to it: only the file protocol, only these readers.
      expect(args.indexOf("-protocol_whitelist")).toBeLessThan(args.indexOf("-i"));
      expect(args.indexOf("-format_whitelist")).toBeLessThan(args.indexOf("-i"));
      expect(at("-protocol_whitelist")).toBe("file");
      expect(at("-format_whitelist").split(",")).toEqual(INPUT_FORMATS);
      expect(at("-i")).toBe("file:in");
      expect(args.at(-1)).toBe("file:out");
      expect(at("-t")).toBe(String(MEDIA_LIMITS.maxSeconds));
      expect(at("-fs")).toBe("1234");
    }
    // No playlist, list, reference or image-sequence reader.
    for (const reader of ["hls", "concat", "image2", "tee", "subfile", "data", "lavfi", "rtsp", "http"]) expect(INPUT_FORMATS).not.toContain(reader);
    // Pictures bigger than 4096 on the long side are made smaller, keeping the shape.
    expect(encodeArgs("video", "fuobe_a.mp4", "in", "out")).toContain(FIT);
    expect(encodeArgs("video", "fuobe_a.gif", "in", "out").find((a) => a.includes("palettegen"))).toContain(FIT);
    expect(FIT).toContain("4096");
    // The size cap grows with the input, within its bounds.
    expect(outputCap(1)).toBe(MEDIA_LIMITS.minBytes);
    expect(outputCap(100 * 2 ** 20)).toBe(800 * 2 ** 20);
    expect(outputCap(1e12)).toBe(MEDIA_LIMITS.maxBytes);
  });

  it("refuses what ffmpeg made at or over the size cap (ffmpeg stops writing there, so the file is cut short)", async () => {
    const dir = tempDir("fuobe-worker-media-");
    const spawnFn = (_bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { pid: number; kill: () => void };
      child.pid = 0;
      child.kill = () => {};
      const out = args.at(-1)!.replace(/^file:/, "");
      const size = Number(args[args.indexOf("-fs") + 1]);
      setTimeout(() => {
        fs.writeFileSync(out, Buffer.alloc(out.endsWith("big.part") ? size + 10 : 10));
        child.emit("exit", 0);
      }, 5);
      return child;
    };
    const src = path.join(dir, "in.mp4");
    fs.writeFileSync(src, Buffer.alloc(100));
    expect(await reencode({ ffmpeg: "ffmpeg", kind: "video", name: "a.mp4", src, dst: path.join(dir, "ok.part"), capBytes: 1000, spawnFn: spawnFn as never })).toBe(true);
    expect(await reencode({ ffmpeg: "ffmpeg", kind: "video", name: "a.mp4", src, dst: path.join(dir, "big.part"), capBytes: 1000, spawnFn: spawnFn as never })).toBe(false);
  });

  it("a preview picture is made a JPEG from ffmpeg's standard input only, at the best quality that fits", async () => {
    const args = previewArgs("image/png", 4)!;
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "pipe", "-f", "png_pipe", "-i", "pipe:0", "-c:v", "mjpeg", "pipe:1"]));
    expect(args).not.toContain("file");
    expect(previewArgs("image/jpeg", 4)).toContain("jpeg_pipe");
    expect(previewArgs("text/html", 4)).toBeNull();
    // Each try writes a JPEG of the size its quality gives; the first that fits is kept.
    const sizes: Record<string, number> = { "4": 90_000, "8": 70_000, "14": 40_000, "24": 20_000 };
    const tried: string[] = [];
    const spawnFn = (_bin: string, a: string[]) => {
      const q = a[a.indexOf("-q:v") + 1];
      tried.push(q);
      const child = new EventEmitter() as EventEmitter & { pid: number; kill: () => void; stdout: EventEmitter; stdin: EventEmitter & { end: () => void } };
      child.pid = 0;
      child.kill = () => {};
      child.stdout = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end: () => {} });
      setTimeout(() => {
        child.stdout.emit("data", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(sizes[q] - 4, 1)]));
        child.emit("close", 0);
      }, 2);
      return child;
    };
    const out = await previewJpeg({ ffmpeg: "ffmpeg", data: new Uint8Array(8), type: "image/png", spawnFn: spawnFn as never });
    expect(tried).toEqual(["4", "8", "14"]);
    expect(out?.length).toBe(40_000);
    // Nothing fits, or ffmpeg can't read it: none.
    tried.length = 0;
    expect(await previewJpeg({ ffmpeg: "ffmpeg", data: new Uint8Array(8), type: "image/png", maxBytes: 1000, spawnFn: spawnFn as never })).toBeNull();
    expect(tried).toEqual(PREVIEW_QUALITIES.map(String));
    const failing = () => Object.assign(new EventEmitter(), { pid: 0, kill: () => {}, stdout: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end() {} }) });
    const broken = () => {
      const c = failing();
      setTimeout(() => c.emit("close", 1), 2);
      return c;
    };
    expect(await previewJpeg({ ffmpeg: "ffmpeg", data: new Uint8Array(8), type: "image/png", spawnFn: broken as never })).toBeNull();
  });

  it.runIf(hasFfmpeg)("ffmpeg makes ComfyUI's PNG preview a JPEG of at most 64 KB", async () => {
    const dir = tempDir("fuobe-worker-preview-");
    const png = path.join(dir, "preview.png");
    const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=768x512", "-frames:v", "1", png]);
    expect(made.status).toBe(0);
    const out = await previewJpeg({ ffmpeg: "ffmpeg", data: new Uint8Array(fs.readFileSync(png)), type: "image/png" });
    expect(out).not.toBeNull();
    expect([...out!.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(out!.length).toBeLessThanOrEqual(64 * 1024);
  }, FFMPEG_MS);

  it.runIf(hasFfmpeg)("ffmpeg refuses a playlist that names another file on this PC, and makes a plain clip again", async () => {
    const dir = tempDir("fuobe-worker-playlist-");
    const clip = path.join(dir, "clip.mp4");
    const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    expect(made.status).toBe(0);
    // A "clip" that is a playlist naming that file (or any file this PC's user can read): without the rules, ffmpeg
    // would open it and copy what it holds into the clip made again.
    const playlist = path.join(dir, "fuobe_aaaaaaaaaaaa.m3u8");
    fs.writeFileSync(playlist, `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:${clip}\n#EXT-X-ENDLIST\n`);
    expect(await reencode({ ffmpeg: "ffmpeg", kind: "video", name: "fuobe_aaaaaaaaaaaa.mp4", src: playlist, dst: path.join(dir, "out1.part") })).toBe(false);
    expect(await reencode({ ffmpeg: "ffmpeg", kind: "video", name: "fuobe_aaaaaaaaaaaa.mp4", src: clip, dst: path.join(dir, "out2.part") })).toBe(true);
    expect(fs.readFileSync(path.join(dir, "out2.part")).subarray(4, 8).toString("latin1")).toBe("ftyp");
  }, FFMPEG_MS);

  it.runIf(hasFfmpeg)("ffmpeg refuses a DASH, HLS or ffconcat list that names another file, even under a clip's name", async () => {
    const dir = tempDir("fuobe-worker-lists-");
    const clip = path.join(dir, "elsewhere.mp4");
    const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    expect(made.status).toBe(0);
    const url = `file:${clip.replaceAll("\\", "/")}`;
    const lists = {
      dash: `<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="100000" codecs="avc1.42c00a" width="64" height="48"><BaseURL>${url}</BaseURL></Representation></AdaptationSet></Period></MPD>\n`,
      hls: `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n${url}\n#EXT-X-ENDLIST\n`,
      ffconcat: `ffconcat version 1.0\nfile '${clip.replaceAll("\\", "/")}'\n`,
    };
    for (const [kind, text] of Object.entries(lists)) {
      // Under the name a clip has in the worker's cache (it reads the file by its contents, not its name).
      const src = path.join(dir, `${kind}.mp4`);
      fs.writeFileSync(src, text);
      const dst = path.join(dir, `${kind}-out.part`);
      expect(await reencode({ ffmpeg: "ffmpeg", kind: "video", name: "fuobe_aaaaaaaaaaaa.mp4", src, dst }), kind).toBe(false);
    }
  }, FFMPEG_MS);

  it("keeps one picture and one sound stream and nothing else of the file, in the format its name says", () => {
    const mp4 = encodeArgs("video", "fuobe_a.mp4", "in", "out");
    expect(mp4.slice(0, 5)).toEqual(["-hide_banner", "-nostdin", "-loglevel", "error", "-y"]);
    expect(mp4).toEqual(expect.arrayContaining(["-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn", "-map", "0:v:0", "0:a:0?", "libx264", "aac", "mp4"]));
    expect(mp4.at(-1)).toBe("file:out");
    expect(encodeArgs("video", "fuobe_a.webm", "in", "out")).toEqual(expect.arrayContaining(["libvpx-vp9", "libopus", "webm"]));
    expect(encodeArgs("video", "fuobe_a.xyz", "in", "out")).toEqual(expect.arrayContaining(["libx264", "mp4"]));
    const wav = encodeArgs("audio", "fuobe_a.wav", "in", "out");
    expect(wav).toEqual(expect.arrayContaining(["-vn", "-map", "0:a:0", "pcm_s24le", "wav"]));
    expect(wav).not.toContain("0:v:0");
    expect(encodeArgs("audio", "fuobe_a.mp3", "in", "out")).toEqual(expect.arrayContaining(["libmp3lame", "mp3"]));
  });
});

describe("an older setup's port", () => {
  it("8190, which an older setup saved for every worker, is no pin: its ComfyUI takes a free port at each start", () => {
    const old = { site: "https://studio.example", port: 8190 };
    expect(withoutOldPort(old)).toEqual({ site: "https://studio.example", port: null });
    const pinned = { site: "https://studio.example", port: 41_000 };
    expect(withoutOldPort(pinned)).toBe(pinned);
    const none = { site: "https://studio.example", port: null };
    expect(withoutOldPort(none)).toBe(none);
  });
});

describe("the studio's address", () => {
  it("is https, or this PC itself", () => {
    expect(siteProblem("https://studio.example")).toBeNull();
    expect(siteProblem("http://127.0.0.1:3361")).toBeNull();
    expect(siteProblem("http://localhost:3000")).toBeNull();
    expect(siteProblem("http://studio.example")).toMatch(/https/);
    expect(siteProblem("http://192.168.1.5:3000")).toMatch(/https/);
    expect(siteProblem("ftp://studio.example")).toMatch(/https/);
    expect(siteProblem("studio")).toMatch(/web address/);
  });

  it("may be http on a private network only when worker.json allows it, and never a public one", () => {
    const allow = { allowHttpSite: true };
    for (const site of ["http://192.168.1.10:3000", "http://10.0.0.2", "http://172.20.1.1:8080", "http://[fd12:3456::1]:3000"]) {
      expect(siteProblem(site), site).toMatch(/allowHttpSite/);
      expect(siteProblem(site, allow), site).toBeNull();
    }
    for (const site of ["http://studio.example", "http://8.8.8.8", "http://172.32.0.1", "http://192.169.0.1", "http://studio.lan"]) expect(siteProblem(site, allow), site).toMatch(/https/);
    expect(privateHost("192.168.300.1")).toBe(false);
    expect(siteProblem("https://studio.example", allow)).toBeNull();
  });
});

describe("ffmpeg", () => {
  it("is worker.json's, else the PATH's when worker.json names none; null or - means pictures only", () => {
    expect(ffmpegOf({})).toBe("ffmpeg");
    expect(ffmpegOf({ ffmpeg: "C:\\ffmpeg\\bin\\ffmpeg.exe" })).toBe("C:\\ffmpeg\\bin\\ffmpeg.exe");
    expect(ffmpegOf({ ffmpeg: null })).toBeNull();
    expect(ffmpegOf({ ffmpeg: "-" })).toBeNull();
    expect(ffmpegOf({ ffmpeg: "" })).toBeNull();
  });
});

describe("one worker at a time on a worker folder", () => {
  const lockFile = (dir: string) => path.join(dir, "worker.lock");
  const exitedPid = () => {
    const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    return Number(r.stdout);
  };

  it("a second lock on the same folder is refused while the first is held, and taken once it is let go", async () => {
    const dir = tempDir("fuobe-worker-lock-");
    const first = await takeLock(dir);
    expect(JSON.parse(fs.readFileSync(lockFile(dir), "utf8"))).toMatchObject({ pid: process.pid, id: first.owner.id });
    await expect(takeLock(dir)).rejects.toBeInstanceOf(WorkerRunning);
    await expect(takeLock(dir)).rejects.toThrow(/Another worker is running on this worker folder/);
    first.release();
    expect(fs.existsSync(lockFile(dir))).toBe(false);
    const second = await takeLock(dir);
    // A late release of the first lock never lets go of the second.
    first.release();
    expect(JSON.parse(fs.readFileSync(lockFile(dir), "utf8")).id).toBe(second.owner.id);
    second.release();
  });

  it("takes over a lock whose worker has stopped, or whose process id now belongs to another program", async () => {
    const dir = tempDir("fuobe-worker-lock-");
    // Its process is gone.
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: exitedPid(), id: "gone", script: "/x/bin/fuobe.mjs" }));
    (await takeLock(dir)).release();
    // Half written (and not just now).
    fs.writeFileSync(lockFile(dir), "{");
    fs.utimesSync(lockFile(dir), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    (await takeLock(dir)).release();
    // Another process runs under that id.
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: other.pid, id: "x", script: "/x/bin/fuobe.mjs" }));
      (await takeLock(dir, { commandLineOf: async () => "notepad.exe C:\\notes.txt" })).release();
      // A worker runs under that id (by its command line, or the script it named): refused.
      for (const line of ['"C:\\Program Files\\nodejs\\node.exe" "C:\\fuobe\\bin\\fuobe.mjs" worker run', "node /x/bin/fuobe.mjs worker run", "node /x/bin/fuobe.mjs"]) {
        fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: other.pid, id: "x", script: "/x/bin/fuobe.mjs" }));
        await expect(takeLock(dir, { commandLineOf: async () => line }), line).rejects.toBeInstanceOf(WorkerRunning);
      }
      // Its command line can't be read (another user's process): it may be a worker, so refused.
      await expect(takeLock(dir, { commandLineOf: async () => null })).rejects.toBeInstanceOf(WorkerRunning);
      expect(await workerLives({ pid: other.pid, id: "x", script: "" }, { commandLineOf: async () => "node other.js" })).toBe(false);
    } finally {
      other.kill();
    }
  });
});

describe("stop signals", () => {
  it("a long-running command ends its own way on Ctrl+C and on a stop from the system; a wait only on Ctrl+C", () => {
    const proc = new EventEmitter();
    const seen: string[] = [];
    const off = onSignals(() => seen.push("stop"), STOP_SIGNALS, proc as unknown as NodeJS.Process);
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    expect(seen).toEqual(["stop", "stop"]);
    off();
    proc.emit("SIGTERM");
    expect(seen).toHaveLength(2);
    expect(proc.listenerCount("SIGINT") + proc.listenerCount("SIGTERM")).toBe(0);
    const offWait = onSignals(() => seen.push("wait"), undefined, proc as unknown as NodeJS.Process);
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    expect(seen.slice(2)).toEqual(["wait"]);
    offWait();
  });
});
