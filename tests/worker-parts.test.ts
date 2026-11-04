/**
 * The worker program's smaller parts: its one retry policy for calls to the studio (bin/lib/worker/retry.mjs), keeping
 * the PC awake while it works (awake.mjs), how it makes clips and sound again (media.mjs), and the studio's address.
 * It also covers the stop signals the command line ends on (bin/lib/signals.mjs).
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { helperCommand, StayAwake } from "../bin/lib/worker/awake.mjs";
import { encodeArgs, mediaKind } from "../bin/lib/worker/media.mjs";
import { RETRY, retrying } from "../bin/lib/worker/retry.mjs";
import { siteProblem } from "../bin/lib/worker/run.mjs";
import { onSignals, STOP_SIGNALS } from "../bin/lib/signals.mjs";

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

  it("keeps one picture and one sound stream and nothing else of the file, in the format its name says", () => {
    const mp4 = encodeArgs("video", "fuobe_a.mp4", "in", "out");
    expect(mp4.slice(0, 7)).toEqual(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", "in"]);
    expect(mp4).toEqual(expect.arrayContaining(["-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn", "-map", "0:v:0", "0:a:0?", "libx264", "aac", "mp4"]));
    expect(mp4.at(-1)).toBe("out");
    expect(encodeArgs("video", "fuobe_a.webm", "in", "out")).toEqual(expect.arrayContaining(["libvpx-vp9", "libopus", "webm"]));
    expect(encodeArgs("video", "fuobe_a.xyz", "in", "out")).toEqual(expect.arrayContaining(["libx264", "mp4"]));
    const wav = encodeArgs("audio", "fuobe_a.wav", "in", "out");
    expect(wav).toEqual(expect.arrayContaining(["-vn", "-map", "0:a:0", "pcm_s24le", "wav"]));
    expect(wav).not.toContain("0:v:0");
    expect(encodeArgs("audio", "fuobe_a.mp3", "in", "out")).toEqual(expect.arrayContaining(["libmp3lame", "mp3"]));
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
