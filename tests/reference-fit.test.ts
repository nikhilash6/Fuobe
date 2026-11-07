import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import type { StudioElement } from "@/lib/catalog/elements";
import { elementClipCheck, elementClips, elementClipWindow, referenceWindow, trimLine, trimTarget, windowProblem } from "@/lib/av/reference-fit";
import { h3ReferenceProblem } from "@/lib/h3-references";

const H3 = { min: 2, max: 15, total: 15 };
const words = { model: "MiniMax H3", label: (i: number) => `Video ${i + 1}`, all: "The reference videos" };

describe("reference windows", () => {
  it("takes the window of the model the take runs on", () => {
    expect(referenceWindow(getModel("minimax-h3"), "videos")).toEqual(H3);
    expect(referenceWindow(getModel("minimax-h3-max-turbo-refs"), "audios")).toEqual(H3);
    expect(referenceWindow(getModel("vidu-q4"), "audios")).toEqual({ min: 3, max: 12 });
    // The extend takes reference sound only: its clips keep the studio's own window.
    expect(referenceWindow(getModel("minimax-h3-max-turbo-extend"), "videos", { min: 2, max: 30, total: 30 })).toEqual({ min: 2, max: 30, total: 30 });
    expect(referenceWindow(getModel("oss-minimax-h3"), "videos")).toEqual(H3);
    expect(referenceWindow(undefined, "videos")).toBeUndefined();
  });
});

describe("trimTarget", () => {
  it("offers a part of the first one over the window", () => {
    expect(trimTarget([4, 20.3, 30], H3)).toEqual({ index: 1, max: 15 });
    expect(trimTarget([15.03], H3)).toBeNull();
    expect(trimTarget([undefined, 9], H3)).toBeNull();
  });

  it("over the total, says how much to cut and offers the longest", () => {
    expect(trimTarget([6, 10.4], H3)).toEqual({ index: 1, max: 9, over: 1.4 });
    // The longest can't give it all (never under 2 s): it keeps 2 s, and the next offer takes the rest.
    expect(trimTarget([9, 9, 9], H3)).toEqual({ index: 0, max: 2, over: 12 });
    expect(trimTarget([2, 2, 12], { min: 2, max: 15, total: 15 })).toEqual({ index: 2, max: 11, over: 1 });
    // Nothing can be cut: none of them is over the shortest allowed.
    expect(trimTarget([2, 2], { min: 2, max: 15, total: 3 })).toBeNull();
  });

  it("says what is wrong, and the picker's line", () => {
    expect(windowProblem([20.3], H3, words)).toBe("Video 1 is 20.3 s, and MiniMax H3 takes up to 15 s: trim it first");
    expect(windowProblem([1.2], H3, words)).toBe("Video 1 is 1.2 s, and MiniMax H3 needs at least 2 s: use a longer one");
    expect(windowProblem([6, 10.4], H3, words)).toBe("The reference videos add up to 16.4 s, and MiniMax H3 takes 15 s of them together: cut 1.4 s");
    expect(windowProblem([6, 9], H3, words)).toBeNull();
    expect(trimLine([20.3], { index: 0, max: 15 }, H3, words)).toBe("Video 1 is 20.3 s. MiniMax H3 takes up to 15 s: pick the part to use");
    expect(trimLine([6, 10.4], { index: 1, max: 9, over: 1.4 }, H3, words)).toBe(
      "The reference videos add up to 16.4 s, and MiniMax H3 takes 15 s together. Cut 1.4 s: pick the part of Video 2 to keep",
    );
  });

  it("words the H3 tray's total with how much to cut", () => {
    expect(h3ReferenceProblem({ images: 1, videos: [8, 9.2], audios: [] })).toBe("The clips add up to 17.2 s, and H3 takes 15 s of them together: cut 2.2 s");
  });
});

const el = (id: string, name: string, references: string[]): StudioElement => ({ id, name, handle: name.toLowerCase(), kind: "character", references, loras: [] }) as unknown as StudioElement;

describe("clip elements", () => {
  const maya = el("e1", "Maya", ["/api/files/maya.mp4", "/api/files/maya.jpg"]);
  const leo = el("e2", "Leo", ["/api/files/leo.mov"]);
  const kling = { id: "kling-4", name: "Kling 4.0" };

  it("finds the clips that go as the model's elements", () => {
    const request = { inputs: { videos: ["/api/files/ref.mp4", "/api/files/maya.mp4", "/api/files/leo.mov"] }, params: { elements: [{ video: 1 }, { images: [0] }, { video: 2 }] } };
    expect(elementClips(request, [maya, leo]).map((c) => [c.element.name, c.ref])).toEqual([
      ["Maya", "/api/files/maya.mp4"],
      ["Leo", "/api/files/leo.mov"],
    ]);
  });

  it("offers a part of a clip over 8 s, and says a short one can't be made longer", () => {
    const long = elementClipCheck(kling, [{ name: "Maya", seconds: 12.4 }]);
    expect(long?.problem).toBe("Kling 4.0 takes 3–8 s clips as elements, and Maya's is 12.4 s: trim it");
    expect(long?.target).toMatchObject({ index: 0, max: 8, min: 3 });
    expect(long?.target?.line).toBe("Maya's clip is 12.4 s. Kling 4.0 takes 3–8 s clips as elements: pick the part to use");
    const short = elementClipCheck(kling, [{ name: "Maya", seconds: 2 }]);
    expect(short?.problem).toMatch(/Maya's is 2 s: give Maya a longer clip, or photos instead/);
    expect(short?.target).toBeNull();
    expect(elementClipCheck(kling, [{ name: "Maya", seconds: 6 }])).toBeNull();
    expect(elementClipCheck({ id: "veo-3-1", name: "Veo" }, [{ name: "Maya", seconds: 20 }])).toBeNull();
  });

  it("over 30 s of clips in all, says how much to cut and offers the longest element's clip", () => {
    const r = elementClipCheck(kling, [{ name: "Maya", seconds: 8 }, { name: "Leo", seconds: 7 }], 20);
    expect(r?.problem).toBe("The clips add up to 35 s (the clip you edit, reference clips and clip elements together), and Kling 4.0 takes 30 s in all: cut 5 s");
    expect(r?.target).toMatchObject({ index: 0, max: 3, over: 5 });
    expect(r?.target?.line).toMatch(/Cut 5 s: pick the part of Maya's clip to keep$/);
  });

  it("fits an attached clip to Kling 4.0's window", () => {
    expect(elementClipWindow()).toEqual({ min: 3, max: 8 });
  });
});
