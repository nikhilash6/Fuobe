import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clock, planJoin, planLoop } from "@/lib/av/audio-tools";
import { cloudLoopPasses } from "@/lib/av/crossfade";
import { getModel } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import type { Generation } from "@/lib/catalog/types";
import { HUB_MODES, modeHref } from "@/lib/hubs";
import { outputActions } from "@/lib/output-actions";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-audio-tools-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: the open models run on the demo provider.
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const route = await import("@/app/api/audio-tools/route");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A mono 16-bit WAV of a tone, saved as an upload. */
function upload(seconds: number, name = "clip.wav"): string {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000), 44 + i * 2);
  return saveFile({ data: buf, contentType: "audio/wav", name, source: "upload" }).url;
}
const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/audio-tools${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("Loop / extend and Join plans", () => {
  it("loops on the open engine in one job, crossfaded, to the exact length", () => {
    const p = planLoop({ engine: "open", audio: "/api/files/a.wav", name: "Bed", sourceDuration: 45, duration: 300, crossfade: 2 });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].request.step?.label).toMatch(/^\d+ seams · 2 s crossfades$/);
    expect(p.steps[0].request).toMatchObject({ feature: "audio-loop", modelId: "oss-audio-loop", op: "audio-loop", inputs: { audio: "/api/files/a.wav" }, params: { duration: 300, crossfade: 2, sourceDuration: 45 }, title: "Loop · Bed to 5:00" });
    expect(p.length).toBe(300);
    expect(p.summary).toBe("Loops it to 5:00 with 6 crossfaded seams (2 s each), then fades out over the last 2 s.");
    expect(p.notes).toEqual([]);
    expect(planLoop({ engine: "open", audio: "a", sourceDuration: 30, duration: 60, curve: "linear" }).steps[0].request.params?.extra).toEqual({ curve: "linear" });
  });

  it("loops on the cloud by whole plays, in a chain of calls when one call's five aren't enough", () => {
    const one = planLoop({ engine: "cloud", audio: "/api/files/a.wav", sourceDuration: 30, duration: 100 });
    expect(one.steps.map((s) => [s.key, s.request.modelId, s.request.params?.duration, s.request.params?.sourceDuration])).toEqual([["loop-1", "join-audio", 120, 30]]);
    expect(one.length).toBe(120);
    expect(one.notes[0]).toBe("The cloud repeats the whole clip, so this comes out 2:00, not 1:40.");
    expect(planLoop({ engine: "cloud", audio: "a", name: "Bed", sourceDuration: 30, duration: 100 }).steps[0].request.title).toBe("Loop · Bed to 2:00");
    const chain = planLoop({ engine: "cloud", audio: "/api/files/a.wav", sourceDuration: 10, duration: 600 });
    expect(chain.steps.map((s) => s.request.params?.duration)).toEqual([50, 200, 600]);
    expect(chain.steps.map((s) => s.request.params?.sourceDuration)).toEqual([10, 50, 200]);
    expect(chain.steps[1]).toMatchObject({ after: ["loop-1"], chain: [{ slot: "audio" }] });
    expect(chain.steps[0].request.inputs?.audio).toBe("/api/files/a.wav");
    expect(chain.steps[2].request.inputs).toBeUndefined();
    expect(chain.steps.map((s) => !!s.request.title)).toEqual([false, false, true]);
    expect(chain.summary).toBe("Plays it 60 times back to back (3 calls of up to 5): 10:00.");
    // Each tile says what its call does (not the pipeline's "Step 1 of 3").
    expect(chain.steps.map((s) => s.request.step?.label)).toEqual(["5 plays · call 1 of 3", "4 plays · call 2 of 3", "3 plays · call 3 of 3"]);
    expect(chain.notes).toEqual(["For smooth seams and an exact length, switch to Open source."]);
  });

  it("sends each cloud call exactly its planned plays, whatever the clip's length in milliseconds", () => {
    const route = getModel("join-audio")!.routes.find((r) => r.op === "audio-loop")!;
    for (const L of [10.0004, 7.3337, 3.3333, 11.1119, 0.9999]) {
      const plan = planLoop({ engine: "cloud", audio: "/api/files/a.wav", sourceDuration: L, duration: 600 });
      const plays = plan.steps.map((s) => (buildPayload(route.map!, { audio: "a.wav", duration: s.request.params?.duration, sourceDuration: s.request.params?.sourceDuration }).audio_urls as string[]).length);
      expect(plays).toEqual(cloudLoopPasses(L, 600));
      // Each call's clip is the last call's result.
      plan.steps.slice(1).forEach((s, k) => expect(s.request.params?.sourceDuration).toBe(plan.steps[k].request.params?.duration));
    }
  });

  it("says what's in the way of a loop", () => {
    expect(() => planLoop({ engine: "open", audio: "a", sourceDuration: 90, duration: 60 })).toThrow("The clip is already 1:30 long — pick a longer length");
    expect(() => planLoop({ engine: "open", audio: "a", sourceDuration: 30, duration: 900 })).toThrow("Loops run up to 10 minutes");
    expect(() => planLoop({ engine: "open", audio: "a", sourceDuration: 3, duration: 60, crossfade: 2 })).toThrow(/needs a clip longer than 4 s/);
    expect(() => planLoop({ engine: "open", audio: "a", sourceDuration: 0, duration: 60 })).toThrow(/length can't be read/);
  });

  it("joins up to 10 clips: one crossfaded job on the open engine, chained five-file calls on the cloud", () => {
    const clips = Array.from({ length: 7 }, (_, i) => ({ url: `/api/files/${i}.wav`, duration: 10 }));
    const open = planJoin({ engine: "open", clips, crossfade: 1.5 });
    expect(open.steps).toHaveLength(1);
    expect(open.steps[0].request).toMatchObject({ feature: "audio-join", modelId: "oss-audio-join", op: "audio-join", inputs: { audios: clips.map((c) => c.url) }, params: { crossfade: 1.5 }, title: "Join · 7 clips" });
    expect(open.length).toBe(61);
    expect(open.steps[0].request.step?.label).toBe("6 seams · 1.5 s crossfades");
    expect(open.summary).toBe("Joins 7 clips in this order with a 1.5 s crossfade at 6 seams.");
    const cloud = planJoin({ engine: "cloud", clips });
    expect(cloud.steps.map((s) => s.request.inputs?.audios?.length)).toEqual([5, 2]);
    expect(cloud.steps[1]).toMatchObject({ after: ["join-1"], chain: [{ slot: "audios", position: "first" }] });
    expect(cloud.length).toBe(70);
    expect(cloud.steps.map((s) => s.request.step?.label)).toEqual(["Hard cuts · call 1 of 2", "Hard cuts · call 2 of 2"]);
    expect(cloud.notes[0]).toMatch(/hard cut/);
    expect(() => planJoin({ engine: "open", clips: clips.slice(0, 1) })).toThrow("Add at least two clips to join");
    expect(() => planJoin({ engine: "open", clips: Array.from({ length: 11 }, () => clips[0]) })).toThrow("Join up to 10 clips at a time");
    expect(() => planJoin({ engine: "open", clips: [clips[0], { url: "b", duration: 2 }, clips[1]], crossfade: 1.5 })).toThrow(/^Clip 2 is 2 s, too short/);
    expect(planJoin({ engine: "open", clips: [{ url: "a" }, { url: "b" }] }).length).toBeNull();
  });

  it("are Audio hub modes with their own paths", () => {
    expect(HUB_MODES.audio.map((m) => m.id)).toEqual(expect.arrayContaining(["loop", "join"]));
    expect(modeHref("audio", "loop")).toBe("/audio/loop");
    // An audio result hands itself to Loop / extend.
    const g = { id: "a1", feature: "music", status: "succeeded", favorite: false, deletedAt: null, prompt: "", request: {}, outputs: [{ url: "/api/files/o/bed.flac", kind: "audio" }] } as unknown as Generation;
    expect(outputActions(g, 0).find((a) => a.id === "loop-audio")).toMatchObject({ label: "Loop / extend", placement: "menu", href: "/audio/loop?audio=%2Fapi%2Ffiles%2Fo%2Fbed.flac" });
    expect(clock(61.5)).toBe("1:01");
    expect(clock(7.5)).toBe("0:07.5");
    // Tenths round with the seconds: 7.968 s is 0:08, not 0:07.10.
    expect(clock(7.968)).toBe("0:08");
    expect(clock(3.99)).toBe("0:04");
    expect(clock(59.96)).toBe("1:00");
    expect(clock(7.44)).toBe("0:07.4");
  });
});

describe("POST /api/audio-tools (demo mode)", () => {
  it("prices a loop from the clip's own header, and runs it in the Library", async () => {
    const audio = upload(6);
    // The browser's figure is ignored when the header can be read.
    const preview = await (await post({ tool: "loop", engine: "open", audio, duration: 20, sourceDuration: 99, crossfade: 1 }, true)).json();
    expect(preview).toEqual({ summary: "Loops it to 0:20 with 3 crossfaded seams (1 s each), then fades out over the last 1 s.", notes: [], length: 20, steps: 1, costUsd: 0, demo: true });
    const cloud = await (await post({ tool: "loop", engine: "cloud", audio, duration: 20 }, true)).json();
    expect(cloud).toMatchObject({ length: 24, steps: 1, demo: true });
    // A length read once is kept for that file as it is; a file written again is read again.
    const { absolutePath } = await import("@/server/storage");
    const fileOf = (url: string) => absolutePath(decodeURIComponent(url.slice("/api/files/".length)));
    const other = upload(6, "other.wav");
    expect((await (await post({ tool: "loop", engine: "open", audio: other, duration: 20 }, true)).json()).length).toBe(20);
    fs.writeFileSync(fileOf(other), fs.readFileSync(fileOf(upload(25))));
    expect((await (await post({ tool: "loop", engine: "open", audio: other, duration: 20 }, true)).json()).error).toBe("The clip is already 0:25 long — pick a longer length");
    const res = await post({ tool: "loop", engine: "open", audio, duration: 20, crossfade: 1 });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.result).toMatchObject({ feature: "audio-loop", modelId: "oss-audio-loop", provider: "mock", op: "audio-loop" });
    const deadline = Date.now() + 15_000;
    let g = gens.getGeneration(run.result.id)!;
    while (g.status !== "succeeded" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      g = gens.getGeneration(run.result.id)!;
    }
    expect(g.status).toBe("succeeded");
    expect(g.outputs[0].kind).toBe("audio");
  });

  it("joins clips, and answers what's wrong in words", async () => {
    const clips = [upload(4, "a.wav"), upload(3, "b.wav"), upload(5, "c.wav")].map((url) => ({ url }));
    const preview = await (await post({ tool: "join", engine: "open", clips, crossfade: 0.5 }, true)).json();
    expect(preview).toMatchObject({ length: 11, steps: 1, costUsd: 0, demo: true });
    const run = await (await post({ tool: "join", engine: "cloud", clips })).json();
    expect(run.items).toHaveLength(1);
    expect(run.result.request.inputs.audios).toHaveLength(3);

    const short = await post({ tool: "join", engine: "open", clips: [clips[0], { url: upload(0.8, "tiny.wav") }, clips[2]], crossfade: 0.5 }, true);
    expect(short.status).toBe(422);
    expect((await short.json()).error).toMatch(/^Clip 2 is 0.8 s, too short for a 0.5 s crossfade/);
    expect((await (await post({ tool: "join", engine: "open", clips: clips.slice(0, 1) })).json()).error).toBe("Add 2 to 10 audio clips to join");
    expect((await (await post({ tool: "loop", engine: "open", audio: "/etc/passwd", duration: 20 })).json()).error).toBe("Add the audio to loop");
    expect((await (await post({ tool: "loop", engine: "open", audio: "/api/files/uploads/nope.wav", duration: 20 }, true)).json()).error).toBe("That audio file is gone — add it again");
    setSetting("engineMode", "cloud");
    try {
      expect((await (await post({ tool: "join", engine: "open", clips }, true)).json()).error).toMatch(/cloud APIs only/);
    } finally {
      setSetting("engineMode", "both");
    }
  });
});
