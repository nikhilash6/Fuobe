/**
 * Live edit's pure core: text keys, sizes and the auto ladder, input names, the render stream's framing, and the kept
 * step stack with its no-degradation invariants (src/lib/live).
 */
import { describe, expect, it } from "vitest";
import { completedWords, normalize, renderKey } from "@/lib/live/text";
import { aspectOf, AutoSize, editSize, keepAuto, sizeFor, ASPECT_NAMES } from "@/lib/live/sizes";
import { inputName, LIVE_INPUT, pictureExt, pngSize } from "@/lib/live/names";
import { eventFrame, FrameError, FrameReader, imageFrame } from "@/lib/live/frames";
import { restoreStack, StepError, StepStack, type Master } from "@/lib/live/steps";
import { INPUT_NAME } from "@/lib/relay";

describe("text", () => {
  it("normalizes what doesn't change the meaning, and keeps case", () => {
    expect(normalize("  add   gold hoop earrings. ")).toBe("add gold hoop earrings");
    expect(normalize("add gold​ hoop earrings!!")).toBe("add gold hoop earrings");
    expect(normalize("add\ngold\thoop earrings")).toBe("add gold hoop earrings");
    expect(normalize('a sign that says "OPEN"')).toBe('a sign that says "OPEN"');
    expect(normalize("Red")).not.toBe(normalize("red"));
    expect(normalize("...red scarf")).toBe("red scarf");
  });
  it("completed words stop at the last boundary", () => {
    expect(completedWords("add gold ho")).toBe("add gold");
    expect(completedWords("add gold ")).toBe("add gold ");
    expect(completedWords("add")).toBe("");
    expect(completedWords("add gold,")).toBe("add gold,");
  });
  it("render keys are stable over no-op changes and differ on real ones", () => {
    const k = (text: string, o: Partial<Parameters<typeof renderKey>[0]> = {}) => renderKey({ base: "b", text, seed: 7, size: 512, ...o });
    expect(k("add  gold hoop earrings.")).toBe(k("add gold hoop earrings"));
    expect(k("add gold")).not.toBe(k("add silver"));
    expect(k("x", { seed: 8 })).not.toBe(k("x"));
    expect(k("x", { size: 640 })).not.toBe(k("x"));
    expect(k("x", { quality: "keep" })).not.toBe(k("x"));
    expect(k("x", { base: "c" })).not.toBe(k("x"));
  });
});

describe("sizes", () => {
  // The original's table: 7 ratios x 5 sizes, defined at 2048 on the 32 grid.
  const table: Record<string, [number, number]> = { "1:1": [2048, 2048], "4:3": [2400, 1792], "3:4": [1792, 2400], "3:2": [2528, 1696], "2:3": [1696, 2528], "16:9": [2752, 1536], "9:16": [1536, 2752] };
  it("matches the reference size table for every ratio and size", () => {
    for (const a of ASPECT_NAMES)
      for (const res of [512, 768, 1024, 1536, 2048]) {
        const [bw, bh] = table[a];
        const want = [Math.max(32, Math.round((bw * res) / 2048 / 32) * 32), Math.max(32, Math.round((bh * res) / 2048 / 32) * 32)];
        expect(sizeFor(a, res)).toEqual(want);
      }
  });
  it("edit sizes keep the area and the shape on the grid", () => {
    const [w, h] = editSize(512, 1536, 2048);
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
    expect(Math.abs(w * h - 512 * 512) / (512 * 512)).toBeLessThan(0.1);
    expect(aspectOf(1536, 2048)).toBe("3:4");
    expect(aspectOf(1920, 1080)).toBe("16:9");
  });
  it("keep auto follows the base's long side, 1024 to 1536", () => {
    expect(keepAuto(undefined)).toBe(1024);
    expect(keepAuto(800)).toBe(1024);
    expect(keepAuto(1400)).toBe(1024);
    expect(keepAuto(2048)).toBe(1536);
  });
  it("auto size steps down on slow frames and up on fast ones, with hysteresis", () => {
    const a = new AutoSize(512);
    for (let i = 0; i < 4; i++) expect(a.record(1500)).toBe(512);
    expect(a.record(1500)).toBe(384);
    // One fast frame doesn't flip it back.
    expect(a.record(200)).toBe(384);
    for (let i = 0; i < 6; i++) a.record(200);
    expect(a.record(200)).toBe(512);
    for (let i = 0; i < 8; i++) a.record(300);
    expect(a.size).toBe(640);
    const capped = new AutoSize(640, 640);
    for (let i = 0; i < 10; i++) capped.record(100);
    expect(capped.size).toBe(640);
  });
});

describe("names", () => {
  it("names bytes by their hash, within Fuobe's input rule", async () => {
    const a = await inputName(new Uint8Array([1, 2, 3]), "png");
    const b = await inputName(new Uint8Array([1, 2, 3]), "png");
    const c = await inputName(new Uint8Array([1, 2, 4]), "png");
    expect(a).toEqual(b);
    expect(a.name).not.toBe(c.name);
    expect(a.name).toMatch(LIVE_INPUT);
    expect(a.name).toMatch(INPUT_NAME);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("sniffs pictures and reads a PNG's size", () => {
    const png = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d494844520000000200000003080600000072b60d24", "hex"));
    expect(pictureExt(png)).toBe("png");
    expect(pngSize(png)).toEqual({ w: 2, h: 3 });
    expect(pictureExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(pictureExt(Uint8Array.from(Buffer.from("RIFF0000WEBPVP8 ")))).toBe("webp");
    expect(pictureExt(Uint8Array.from(Buffer.from("<html>")))).toBeNull();
  });
});

describe("frames", () => {
  it("round-trips events and pictures, across any chunking", () => {
    const pic = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const all = new Uint8Array([...eventFrame({ type: "queued", pos: 2 }), ...imageFrame({ seq: 4, slot: "live", key: "k", w: 512, h: 512, type: "image/webp", ms: 210 }, pic), ...eventFrame({ type: "dropped", why: "replaced" })]);
    for (const size of [1, 3, 7, 64, all.length]) {
      const r = new FrameReader();
      const out = [];
      for (let i = 0; i < all.length; i += size) out.push(...r.push(all.subarray(i, i + size)));
      expect(out).toHaveLength(3);
      expect(out[0]).toEqual({ kind: "event", event: { type: "queued", pos: 2 } });
      expect(out[1].kind === "image" && out[1].header.seq === 4 && out[1].data.length === 1000 && out[1].data[999] === 999 % 251).toBe(true);
      expect(out[2]).toEqual({ kind: "event", event: { type: "dropped", why: "replaced" } });
      expect(r.pending).toBe(0);
    }
  });
  it("keeps a truncated frame pending and refuses garbage", () => {
    const f = eventFrame({ type: "started" });
    const r = new FrameReader();
    expect(r.push(f.subarray(0, f.length - 1))).toEqual([]);
    expect(r.pending).toBe(f.length - 1);
    expect(() => new FrameReader().push(Uint8Array.from([0x58, 0, 0, 0, 1, 0]))).toThrow(FrameError);
    expect(() => new FrameReader().push(Uint8Array.from([0x4a, 0xff, 0xff, 0xff, 0xff]))).toThrow(/too large/);
    expect(() => new FrameReader().push(Uint8Array.from([0x49, 0, 0, 0, 2, 0, 1]))).toThrow(FrameError);
  });
});

describe("steps", () => {
  const master = (n: number, o: Partial<Master> = {}): Master => ({ name: `fuobe_lv${String(n).padStart(20, "0")}.png`, w: 1536, h: 2048, sha256: `sha${n}`, format: "png", ...o });
  const keep = (s: StepStack, n: number, text = `edit ${n}`, o: Partial<Master> = {}) => s.keep({ text, norm: text, seed: n, method: "hybrid", keepRes: 1536, master: master(n, o), ms: 900 });

  it("keeps, undoes, redoes and branches, and picks the base per method", () => {
    const s = StepStack.from(master(0, { format: "jpg" }));
    keep(s, 1);
    keep(s, 2);
    expect(s.path().map((x) => x.text)).toEqual(["", "edit 1", "edit 2"]);
    expect(s.base("hybrid")?.sha256).toBe("sha2");
    expect(s.base("chain")?.sha256).toBe("sha2");
    expect(s.base("compose")?.sha256).toBe("sha0");
    expect(s.composePrompt("live")).toBe("edit 1. edit 2. live");
    expect(s.undo()?.text).toBe("edit 1");
    expect(s.canRedo()).toBe(true);
    expect(s.redo()?.text).toBe("edit 2");
    s.undo();
    keep(s, 3, "branch");
    expect(s.path().map((x) => x.text)).toEqual(["", "edit 1", "branch"]);
    expect(s.all).toHaveLength(4);
    s.undo();
    // Redo goes to the newest child.
    expect(s.redo()?.text).toBe("branch");
    expect(s.jump("s2")?.text).toBe("edit 2");
    expect(s.previous()?.text).toBe("edit 1");
    while (s.undo());
    expect(s.head?.id).toBe("s0");
    expect(s.canUndo()).toBe(false);
  });

  it("refuses a master that isn't PNG, is smaller than its base, or was a live frame", () => {
    const s = StepStack.from(master(0));
    expect(() => keep(s, 1, "x", { format: "webp" })).toThrow(StepError);
    expect(() => keep(s, 1, "x", { w: 384, h: 512 })).toThrow(/smaller/);
    s.sawLive("live-sha");
    expect(() => keep(s, 1, "x", { sha256: "live-sha" })).toThrow(/live frame/);
    expect(s.all).toHaveLength(1);
  });

  it("refuses a keep whose head moved while it rendered (an undo during the keep)", () => {
    const s = StepStack.from(master(0));
    keep(s, 1);
    const parent = s.head!.id;
    s.undo();
    expect(() => s.keep({ text: "late", norm: "late", seed: 2, method: "hybrid", keepRes: 1536, master: master(2), ms: 900 }, parent)).toThrow(/changed while keeping/);
    expect(s.all).toHaveLength(2);
    s.redo();
    expect(s.keep({ text: "late", norm: "late", seed: 2, method: "hybrid", keepRes: 1536, master: master(2), ms: 900 }, parent).parent).toBe(parent);
  });

  it("text to image starts empty and keeps a first picture of 1024 or more", () => {
    const s = new StepStack();
    expect(s.base("hybrid")).toBeNull();
    expect(() => keep(s, 1, "x", { w: 512, h: 512 })).toThrow(/1024/);
    keep(s, 1, "a portrait", { w: 1024, h: 1024 });
    expect(s.original?.text).toBe("a portrait");
  });

  it("survives a round trip through storage, and refuses junk", () => {
    const s = StepStack.from(master(0));
    keep(s, 1);
    keep(s, 2);
    s.undo();
    const back = restoreStack(JSON.parse(JSON.stringify(s)));
    expect(back.head?.id).toBe("s1");
    expect(back.all).toHaveLength(3);
    expect(keep(back, 3).id).toBe("s3");
    expect(restoreStack({ steps: [{ id: 1 }] }).empty).toBe(true);
    expect(restoreStack(null).empty).toBe(true);
  });
});
