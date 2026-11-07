import { describe, expect, it } from "vitest";
import { addPhotoLabel, firstPhoto, frameSize, noStillWhy, pictureSource, referenceWords, stillCache, stillLine, thumbSource } from "@/lib/clip-thumb";

describe("thumbSource", () => {
  it("draws a photo as itself", () => {
    expect(thumbSource("/api/files/abc.png")).toEqual({ kind: "image", src: "/api/files/abc.png" });
    expect(thumbSource("/api/files/abc.jpg?v=2")).toEqual({ kind: "image", src: "/api/files/abc.jpg?v=2" });
    // A poster is ignored for a photo.
    expect(thumbSource("/api/files/abc.webp", "/api/files/other.jpg")).toEqual({ kind: "image", src: "/api/files/abc.webp" });
  });

  it("never hands a clip to an image: its poster when known, else a still to grab", () => {
    for (const clip of ["/api/files/a.mp4", "/api/files/a.MOV", "/x/a.m4v?t=1", "/x/a.webm#t=0.1"]) {
      expect(thumbSource(clip)).toEqual({ kind: "clip", clip });
      expect(thumbSource(clip, null)).toEqual({ kind: "clip", clip });
    }
    expect(thumbSource("/api/files/a.mp4", "/api/files/a-poster.jpg")).toEqual({ kind: "clip", clip: "/api/files/a.mp4", poster: "/api/files/a-poster.jpg" });
    // A "poster" that is itself a clip is not used as one.
    expect(thumbSource("/api/files/a.mp4", "/api/files/b.mp4")).toEqual({ kind: "clip", clip: "/api/files/a.mp4" });
  });
});

describe("frameSize", () => {
  it("scales the longest side down to the limit and keeps the shape", () => {
    expect(frameSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(frameSize(720, 1280, 640)).toEqual({ width: 360, height: 640 });
    expect(frameSize(320, 240, 640)).toEqual({ width: 320, height: 240 });
    expect(frameSize(0, 1080)).toEqual({ width: 0, height: 0 });
    expect(frameSize(NaN, NaN)).toEqual({ width: 0, height: 0 });
  });
});

describe("stillCache", () => {
  it("grabs each clip once, keeps a clip that can't be read as null, and decodes at most `limit` at once", async () => {
    let running = 0;
    let most = 0;
    const calls: string[] = [];
    const grab = async (clip: string) => {
      calls.push(clip);
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (clip.includes("bad")) throw new Error("unreadable");
      return clip.includes("none") ? null : `blob:${clip}`;
    };
    const cache = stillCache(grab, 2);
    expect(cache.peek("/a.mp4")).toBeUndefined();
    const all = await Promise.all(["/a.mp4", "/b.mp4", "/a.mp4", "/bad.mp4", "/none.mp4", "/c.mp4"].map((c) => cache.get(c)));
    expect(all).toEqual(["blob:/a.mp4", "blob:/b.mp4", "blob:/a.mp4", null, null, "blob:/c.mp4"]);
    expect(calls.sort()).toEqual(["/a.mp4", "/b.mp4", "/bad.mp4", "/c.mp4", "/none.mp4"]);
    expect(most).toBe(2);
    // Known now: no second grab.
    expect(cache.peek("/a.mp4")).toBe("blob:/a.mp4");
    expect(cache.peek("/bad.mp4")).toBeNull();
    await cache.get("/bad.mp4");
    expect(calls).toHaveLength(5);
  });
});

describe("firstPhoto", () => {
  it("gives the first reference that is not a clip", () => {
    expect(firstPhoto(["/api/files/a.mp4", "/api/files/b.jpg", "/api/files/c.png"])).toBe("/api/files/b.jpg");
    expect(firstPhoto(["/api/files/b.jpg"])).toBe("/api/files/b.jpg");
    expect(firstPhoto(["/api/files/a.mp4", "/api/files/a.mov"])).toBeUndefined();
    expect(firstPhoto([])).toBeUndefined();
  });
});

describe("referenceWords", () => {
  it("counts photos and clips apart", () => {
    expect(referenceWords(["/a.jpg"])).toBe("1 photo");
    expect(referenceWords(["/a.jpg", "/b.png"])).toBe("2 photos");
    expect(referenceWords(["/a.mp4"])).toBe("1 clip");
    expect(referenceWords(["/a.mp4", "/b.jpg", "/c.webm", "/d.jpg", "/e.jpg"])).toBe("3 photos · 2 clips");
    expect(referenceWords([])).toBe("");
  });
});

describe("pictureSource", () => {
  it("gives a photo first, else the clip to take a still from, else nothing", () => {
    expect(pictureSource(["/a.mp4", "/b.jpg"])).toEqual({ photo: "/b.jpg" });
    expect(pictureSource(["/b.jpg"])).toEqual({ photo: "/b.jpg" });
    expect(pictureSource(["/a.mp4", "/c.webm"])).toEqual({ clip: "/a.mp4" });
    expect(pictureSource([])).toBeNull();
  });

  it("says where the picture came from, and how to give one when the clip can't be read", () => {
    expect(stillLine("Maya")).toBe("Using a still from Maya's clip");
    expect(noStillWhy("Maya")).toBe("Maya's clip can't be read here, so there is no still to use");
    expect(addPhotoLabel("Maya")).toBe("Add a photo to Maya");
  });
});
