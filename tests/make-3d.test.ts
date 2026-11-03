import { describe, expect, it } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { make3dHref, nextSteps, outputActions } from "@/lib/output-actions";
import { MAKE_3D_HINT, idolPhotoFor, linkedIdolQuality, linkedPicture, readModel3dLink } from "@/lib/av/model3d";
import { make3dOffered, openEngineReady } from "@/lib/connections";

/**
 * Make it 3D (quick) on image results (idol-5, docs/research/idol-9.md §8, §9): a menu action that opens Image to 3D →
 * Splat on Idol 3D's Quick look with the picture in the slot, shown only where the open engine runs; the studio's link
 * parsing; and when results count the open engine as ready.
 */

let n = 0;
function gen(p: Partial<Generation> = {}): Generation {
  n++;
  return {
    id: `g${n}`,
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "fal",
    op: "t2i",
    kind: "image",
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: [{ url: `/api/files/outputs/d/${n}.png`, kind: "image" }],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1000 + n,
    updatedAt: 1000 + n,
    completedAt: null,
    deletedAt: null,
    folderId: null,
    ...p,
  };
}

const ids = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).map((a) => a.id);
const make3d = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).find((a) => a.id === "make-3d");

describe("Make it 3D (quick) on a result", () => {
  it("is a menu action on pictures when the open engine can run, with Idol 3D's Quick look and the picture", () => {
    const g = gen({ outputs: [{ url: "/api/files/outputs/d/fox 1.png", kind: "image" }] });
    expect(make3d(g, { openEngine: true })).toEqual({
      id: "make-3d",
      label: "Make it 3D (quick)",
      placement: "menu",
      href: "/image-to-3d?mode=splat&model=oss-idol&quality=quick&image=%2Fapi%2Ffiles%2Foutputs%2Fd%2Ffox%201.png",
    });
    expect(make3d(g, { openEngine: true, engineMode: "open" })).toBeDefined();
    expect(make3d(g, { openEngine: true, engineMode: "both" })).toBeDefined();
  });

  it("is hidden without the open engine and on installs that run paid APIs only", () => {
    const g = gen();
    expect(make3d(g)).toBeUndefined();
    expect(make3d(g, { openEngine: false, engineMode: "open" })).toBeUndefined();
    expect(make3d(g, { openEngine: true, engineMode: "cloud" })).toBeUndefined();
  });

  it("keeps the other picture actions and their order, and sits after the hand-offs", () => {
    const g = gen();
    const without = ids(g, { reuse: true });
    const withIt = ids(g, { reuse: true, openEngine: true });
    expect(withIt.filter((id) => id !== "make-3d")).toEqual(without);
    expect(withIt.indexOf("make-3d")).toBe(withIt.indexOf("genjutsu") + 1);
  });

  it("never appears on videos, sound, text, 3D models, vector pictures or deleted results", () => {
    const ctx = { openEngine: true, engineMode: "both" as const };
    expect(ids(gen({ kind: "video", op: "t2v", outputs: [{ url: "/api/files/a.mp4", kind: "video" }] }), ctx)).not.toContain("make-3d");
    expect(ids(gen({ kind: "audio", op: "tts", outputs: [{ url: "/api/files/a.mp3", kind: "audio" }] }), ctx)).not.toContain("make-3d");
    expect(ids(gen({ kind: "text", outputs: [{ url: "/api/files/a.txt", kind: "text", text: "hi" }] }), ctx)).not.toContain("make-3d");
    expect(ids(gen({ kind: "model3d", outputs: [{ url: "/api/files/a.glb", kind: "model3d" }] }), ctx)).not.toContain("make-3d");
    expect(ids(gen({ outputs: [{ url: "/api/files/logo.svg", kind: "image", contentType: "image/svg+xml" }] }), ctx)).not.toContain("make-3d");
    expect(ids(gen({ deletedAt: 5 }), ctx)).not.toContain("make-3d");
  });

  it("opens an upload with the photo crop on", () => {
    const up = make3d(gen({ feature: "upload", provider: "local", outputs: [{ url: "/api/files/uploads/p.jpg", kind: "image" }] }), { openEngine: true });
    expect(up?.href).toBe(make3dHref("/api/files/uploads/p.jpg", true));
    expect(up?.href).toMatch(/&photo=1$/);
  });

  it("leaves a picture's next steps as they are", () => {
    for (const ctx of [{}, { openEngine: true }, { openEngine: true, engineMode: "open" as const }]) {
      expect(nextSteps(gen(), 0, 3, ctx).map((a) => a.id)).toEqual(["animate", "upscale", "edit"]);
    }
  });

  it("says tens of seconds on your GPU, never two", () => {
    expect(MAKE_3D_HINT).toBe("Turns this picture into a 3D splat on your GPU and renders a turning preview. Takes tens of seconds on a consumer GPU.");
    expect(MAKE_3D_HINT).not.toMatch(/2 ?s\b|seconds\)/);
  });
});

describe("Image to 3D's link (readModel3dLink)", () => {
  const read = (q: string) => readModel3dLink(new URLSearchParams(q));

  it("reads Make it 3D's link: Idol 3D on the open engine in Splat, Quick look, the picture as a generated one", () => {
    expect(read(make3dHref("/api/files/outputs/d/x.png").split("?")[1])).toEqual({
      model: { mode: "splat", engine: "open", id: "oss-idol" },
      quality: "quick",
      image: "/api/files/outputs/d/x.png",
      photo: false,
    });
    expect(read(make3dHref("/api/files/uploads/p.jpg", true).split("?")[1])).toMatchObject({ image: "/api/files/uploads/p.jpg", photo: true });
  });

  it("keeps ⌘K's ?model=, ?mode= and Rig & animate's links as they were", () => {
    expect(read("model=oss-triposplat")).toEqual({ model: { mode: "splat", engine: "open", id: "oss-triposplat" } });
    expect(read("model=idol-3d&quality=best")).toEqual({ model: { mode: "splat", engine: "cloud", id: "idol-3d" }, quality: "best" });
    expect(read("model=meshy-rigging")).toEqual({ rig: true });
    expect(read("mode=splat")).toEqual({ mode: "splat" });
    expect(read("mode=nope")).toEqual({});
    expect(read("model=nope&mode=text")).toEqual({ mode: "text" });
  });

  it("ignores an unknown quality and pictures that aren't a kept file or an https link", () => {
    expect(read("mode=splat&quality=fast")).toEqual({ mode: "splat" });
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://example.com/a.png", "/etc/passwd", `/api/files/${"a".repeat(3000)}`]) {
      expect(read(`image=${encodeURIComponent(bad)}`).image).toBeUndefined();
    }
    expect(read(`image=${encodeURIComponent("https://cdn.example.com/a.png")}`).image).toBe("https://cdn.example.com/a.png");
  });

  it("a handed-over result starts the photo crop off, an upload on (the studio's slot value)", () => {
    expect(idolPhotoFor({ ref: "/api/files/x.png", source: "generation" }, null)).toBe(false);
    expect(idolPhotoFor({ ref: "/api/files/x.png", source: "upload" }, null)).toBe(true);
  });
});

describe("openEngineReady", () => {
  const s = (p: Partial<Parameters<typeof openEngineReady>[0] & object> = {}) => ({ providers: {}, engineMode: "both" as const, ...p });
  it("needs open models in Engine mode and ComfyUI connected, the owner's computer, or placeholder results", () => {
    expect(openEngineReady(undefined)).toBe(false);
    expect(openEngineReady(s())).toBe(false);
    expect(openEngineReady(s({ providers: { comfyui: { configured: true } } }))).toBe(true);
    expect(openEngineReady(s({ engineMode: "open", providers: { comfyui: { configured: true } } }))).toBe(true);
    expect(openEngineReady(s({ demoMode: "on" }))).toBe(true);
    expect(openEngineReady(s({ ownerGpu: { mode: "computer", online: false } }))).toBe(true);
  });
  it("is off on installs that run paid APIs only, and for guests and accounts", () => {
    expect(openEngineReady(s({ engineMode: "cloud", providers: { comfyui: { configured: true } }, demoMode: "on" }))).toBe(false);
    expect(openEngineReady(s({ providers: { comfyui: { configured: true } }, viewer: { kind: "account" } }))).toBe(false);
    expect(openEngineReady(s({ demoMode: "on", viewer: { kind: "guest" } }))).toBe(false);
  });
});

describe("make3dOffered", () => {
  const ready = { providers: { comfyui: { configured: true } }, engineMode: "both" as const };
  it("follows openEngineReady when every model is on", () => {
    expect(make3dOffered(ready)).toBe(true);
    expect(make3dOffered({ ...ready, access: { off: [] } })).toBe(true);
    expect(make3dOffered(undefined)).toBe(false);
    expect(make3dOffered({ ...ready, engineMode: "cloud" })).toBe(false);
    expect(make3dOffered({ ...ready, viewer: { kind: "account" } })).toBe(false);
  });
  it("is hidden when Idol 3D is switched off in Settings, or switched on for the cloud only", () => {
    expect(make3dOffered({ ...ready, access: { off: ["oss-idol"] } })).toBe(false);
    expect(make3dOffered({ ...ready, access: { off: [], engines: { "oss-idol": ["cloud"] } } })).toBe(false);
    expect(make3dOffered({ ...ready, access: { off: [], engines: { "oss-idol": ["open"] } } })).toBe(true);
    expect(make3dOffered({ ...ready, access: { off: ["oss-trellis2"] } })).toBe(true);
  });
});

describe("the studio's hand-over from a link", () => {
  it("puts a result's picture in the photo slot with the photo crop off, an upload's with it on", () => {
    const url = "/api/files/abc.png";
    const result = linkedPicture(url, false);
    expect(result).toMatchObject({ ref: url, preview: url, kind: "image", source: "generation" });
    expect(idolPhotoFor(result, null)).toBe(false);
    const upload = linkedPicture(url, true);
    expect(upload.source).toBe("upload");
    expect(idolPhotoFor(upload, null)).toBe(true);
  });
  it("sets Idol 3D's look for the linked mode and engine only, and only for Idol", () => {
    const prev = { "splat:cloud": "best" as const };
    expect(linkedIdolQuality(prev, "splat", "open", "oss-idol", "quick")).toEqual({ "splat:cloud": "best", "splat:open": "quick" });
    expect(linkedIdolQuality(prev, "splat", "open", "oss-idol")).toBe(prev);
    expect(linkedIdolQuality(prev, "image", "open", "oss-trellis2", "quick")).toBe(prev);
  });
  it("reads a Make it 3D link into exactly that state", () => {
    const link = readModel3dLink(new URLSearchParams(make3dHref("/api/files/abc.png").split("?")[1]));
    expect(link.model).toEqual({ mode: "splat", engine: "open", id: "oss-idol" });
    expect(linkedIdolQuality({}, link.model!.mode, link.model!.engine, link.model!.id, link.quality)).toEqual({ "splat:open": "quick" });
    expect(linkedPicture(link.image!, !!link.photo).source).toBe("generation");
  });
});
