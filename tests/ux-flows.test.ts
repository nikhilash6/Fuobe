import { describe, expect, it } from "vitest";
import { directorPicks } from "@/components/cinema/draft";
import { hadItemsScript, hadValue } from "@/components/use-had-items";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { leftLabel, notePace, timeLeft, untitledName, type Pace } from "@/lib/format";
import { toggleAll } from "@/lib/library";
import { nextSteps, videoPoster } from "@/lib/output-actions";

function gen(outputs: Partial<OutputFile>[], over: Partial<Generation> = {}): Generation {
  return {
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "fal",
    op: "t2i",
    kind: (outputs[0]?.kind ?? "image") as Generation["kind"],
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: outputs.map((o, i) => ({ url: `/api/files/out-${i}.png`, kind: "image", ...o }) as OutputFile),
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    completedAt: 0,
    ...over,
  };
}

describe("a new Cinema project starts with a name", () => {
  it("takes the first free Untitled project", () => {
    expect(untitledName([])).toBe("Untitled project");
    expect(untitledName(["Night Shift"])).toBe("Untitled project");
    expect(untitledName(["untitled project ", "Untitled project 2"])).toBe("Untitled project 3");
    expect(untitledName(["Untitled project 2"])).toBe("Untitled project");
  });
});

describe("the phone's folded Director chip", () => {
  it("counts the panel groups that are set", () => {
    expect(directorPicks({}, "video")).toBe(0);
    expect(directorPicks({ genre: "noir", era: "1970s", lens: "anamorphic" }, "video")).toBe(2);
    expect(directorPicks({ palette: { slug: "teal-orange" } as never, lighting: { preset: "golden" } as never, emotions: { mara: { family: "joy" } as never } }, "image")).toBe(3);
    // Tempo shapes video cuts only: a still ignores it, and so does the count.
    expect(directorPicks({ tempo: "fast" }, "image")).toBe(0);
    expect(directorPicks({ tempo: "fast" }, "video")).toBe(1);
  });
});

describe("next steps under a fresh result", () => {
  it("offers three hand-offs from the tile's own actions", () => {
    const img = nextSteps(gen([{ kind: "image" }]), 0);
    expect(img.map((a) => a.id)).toEqual(["animate", "upscale", "edit"]);
    expect(img[0].href).toBe(`/video?image=${encodeURIComponent("/api/files/out-0.png")}`);
    const vid = nextSteps(gen([{ kind: "video", url: "/api/files/clip.mp4" }], { kind: "video", op: "t2v" }), 0);
    expect(vid.map((a) => a.label)).toEqual(["Extend", "Upscale", "Add sound"]);
    expect(nextSteps(gen([{ kind: "audio", url: "/api/files/a.mp3" }], { kind: "audio", op: "tts" }), 0).map((a) => a.id)).toEqual(["lipsync", "voice-change", "split-soundtrack"]);
    // A clip that has its sound (Sound for video, a soundtrack mux) offers Split soundtrack in place of Add sound; Sound
    // for video's generated effects rarely carry speech, so it isn't offered Remove dialogue.
    const sounded = nextSteps(gen([{ kind: "video", url: "/api/files/clip.mp4" }], { kind: "video", op: "v2a" }), 0);
    expect(sounded.map((a) => [a.label, a.href])).toEqual([
      ["Extend", "/extend?video=%2Fapi%2Ffiles%2Fclip.mp4"],
      ["Upscale", "/upscale/video?video=%2Fapi%2Ffiles%2Fclip.mp4"],
      ["Split soundtrack", "/audio/split?video=%2Fapi%2Ffiles%2Fclip.mp4"],
    ]);
    // A lip-synced clip (speech) keeps Upscale and adds Remove dialogue.
    const spoken = nextSteps(gen([{ kind: "video", url: "/api/files/clip.mp4" }], { kind: "video", op: "lipsync" }), 0);
    expect(spoken.map((a) => a.label)).toEqual(["Extend", "Upscale", "Remove dialogue"]);
  });

  it("has none for what doesn't hand off (text, vectors) or isn't done", () => {
    expect(nextSteps(gen([{ kind: "text", url: "/api/files/t.txt", text: "hi" }], { kind: "text", op: "transcribe" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image", url: "/api/files/logo.svg", contentType: "image/svg+xml" }], { op: "vectorize" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image" }], { status: "running" }), 0)).toEqual([]);
    expect(nextSteps(gen([{ kind: "image" }]), 3)).toEqual([]);
  });
});

describe("time left on a running tile", () => {
  it("comes from the pace between the first report seen and the latest, counted down", () => {
    // 10 % → 30 % in 2 s: 0.7 to go at 0.1/s is 7 s; one second after that report, 6 s.
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 3000)).toBe(7);
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 4000)).toBe(6);
    // Past the estimate it stays at 0 ("almost done").
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 3000, progress: 0.3 }, 60_000)).toBe(0);
  });

  it("waits for a pace to go on", () => {
    expect(timeLeft({ at: 1000, progress: 0.1 }, { at: 1000, progress: 0.1 }, 2000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.01 }, { at: 1500, progress: 0.03 }, 2000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.5 }, { at: 3000, progress: 0.4 }, 3000)).toBeNull();
    expect(timeLeft({ at: 1000, progress: 0.2 }, { at: 3000, progress: 1 }, 3000)).toBeNull();
  });

  it("counts down while a step runs: a poll that rewrites updatedAt with the same progress isn't a report", () => {
    // A ComfyUI-like job: 5 % per 30 s sampler step, polled every 1.5 s, each poll bumping updatedAt.
    let pace: Pace = notePace(null, 0, null);
    const seen: number[] = [];
    for (let t = 1500; t <= 120_000; t += 1500) {
      const progress = Math.floor(t / 30_000) * 0.05 || null;
      const next = notePace(pace, t, progress);
      if (progress === pace.seen) expect(next).toBe(pace);
      pace = next;
      if (pace.first && pace.last) seen.push(timeLeft(pace.first, pace.last, t)!);
    }
    // From 60 s on (two changes seen): 0.9 to go at 0.05 / 30 s is 540 s, and it only goes down from there.
    expect(seen[0]).toBe(540);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
    // At 2 min, 20 % done: 0.8 to go at the same pace is 480 s.
    expect(seen.at(-1)).toBe(480);
  });

  it("starts at the first change when the tile opens part-way, and over when progress goes back", () => {
    // Opened at 40 %: when 40 % was reached is unknown, so no anchor until it moves.
    let pace = notePace(null, 10_000, 0.4);
    expect(pace.first).toBeNull();
    pace = notePace(pace, 12_000, 0.45);
    expect(pace).toMatchObject({ first: { at: 12_000, progress: 0.45 }, last: null });
    pace = notePace(pace, 42_000, 0.5);
    expect(timeLeft(pace.first!, pace.last!, 42_000)).toBe(300);
    // A new stage restarts at 10 %: the old pace no longer applies.
    pace = notePace(pace, 50_000, 0.1);
    expect(pace).toMatchObject({ first: { at: 50_000, progress: 0.1 }, last: null });
    // Queued or unknown progress changes nothing.
    expect(notePace(pace, 60_000, null)).toBe(pace);
  });

  it("reads as minutes and seconds", () => {
    expect(leftLabel(12)).toBe("12s left");
    expect(leftLabel(75)).toBe("1m 15s left");
    expect(leftLabel(0)).toBe("almost done");
  });
});

describe("Library: select a whole day, or everything", () => {
  it("adds the group when any is missing, removes it when all are in, and keeps the rest", () => {
    const day = ["a", "b", "c"];
    expect([...toggleAll(new Set(), day)]).toEqual(day);
    expect([...toggleAll(new Set(["a", "x"]), day)].sort()).toEqual(["a", "b", "c", "x"]);
    expect([...toggleAll(new Set(["a", "b", "c", "x"]), day)]).toEqual(["x"]);
    expect([...toggleAll(new Set(["x"]), [])]).toEqual(["x"]);
  });
});

describe("video tiles have a poster", () => {
  const clip = { kind: "video" as const, url: "/api/files/clip.mp4" };
  it("uses the output's own still, else the start frame it was made from", () => {
    expect(videoPoster(gen([clip], { op: "t2v" }), { ...clip, meta: { poster: "/api/files/p.jpg" } })).toBe("/api/files/p.jpg");
    const i2v = gen([clip], { op: "i2v", request: { feature: "video", modelId: "m", prompt: "", inputs: { images: ["/api/files/start.png"] } } });
    expect(videoPoster(i2v, clip)).toBe("/api/files/start.png");
    expect(videoPoster({ ...i2v, op: "flf2v" }, clip)).toBe("/api/files/start.png");
  });
  it("has none when nothing better than the clip's first frame is known", () => {
    expect(videoPoster(gen([clip], { op: "t2v" }), clip)).toBeUndefined();
    // A restyle's input image isn't its first frame.
    expect(videoPoster(gen([clip], { op: "v2v", request: { feature: "video", modelId: "m", prompt: "", inputs: { images: ["/api/files/ref.png"] } } }), clip)).toBeUndefined();
    expect(videoPoster(undefined, clip)).toBeUndefined();
    expect(videoPoster(gen([{ kind: "image" }]), { kind: "image" })).toBeUndefined();
  });
});

describe("a list's loading shape remembers how many it had", () => {
  it("reads the stored count back as the <html> attribute's value", () => {
    expect(hadValue("3")).toBe("3");
    expect(hadValue("6")).toBe("6");
    expect(hadValue("0")).toBeNull();
    expect(hadValue(null)).toBeNull();
    expect(hadValue("1\" onload=\"x")).toBeNull();
  });

  it("sets the same value before the first paint", () => {
    const run = (stored: string | null) => {
      const attrs: Record<string, string> = {};
      const localStorage = { getItem: () => stored };
      const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      new Function("localStorage", "document", hadItemsScript("home-recent"))(localStorage, document);
      return attrs;
    };
    expect(run("4")).toEqual({ "data-had-home-recent": "4" });
    expect(run("0")).toEqual({});
    expect(run(null)).toEqual({});
    expect(run("<b>")).toEqual({});
  });
});
