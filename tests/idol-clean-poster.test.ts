import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Generation, OutputFile } from "@/lib/catalog/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image-to-3d",
  useSearchParams: () => new URLSearchParams(),
}));

const { firstFrameSrc, isIdolClean, model3dView } = await import("@/lib/av/model3d");
const { keepGoing } = await import("@/lib/next-steps");

/**
 * Idol 3D's clean graph saves a still rendered from the camera Idol predicts (role "preview"). For a product seen side
 * on that camera can collapse: the red stiletto's still is a few coloured squares on black, while the same run's orbit
 * is clean from every side. The result card's still is the orbit's (a still made of it, else the clip's first frame) on
 * clean results; every other graph keeps its order. The fixtures are two real runs on the clean graph, as stored: the
 * stiletto (side view, the still collapsed) and headphones (three-quarter view, the still fine).
 */

const dir = path.join(process.cwd(), "tests", "fixtures", "idol-clean");
type Run = Pick<Generation, "id" | "feature" | "modelId" | "engine" | "provider" | "op" | "kind" | "status" | "request" | "outputs">;
const runs = JSON.parse(fs.readFileSync(path.join(dir, "runs.json"), "utf8")) as Record<"stiletto" | "headphones", Run>;
const byRole = (r: Run, role: string) => r.outputs.find((o) => o.meta?.role === role)!;
const photoOf = (r: Run) => r.request.inputs!.images![0];

/** The share of a picture's pixels that differ from its plain background (the top-left pixel), from 0 to 1. */
async function subjectShare(file: string): Promise<number> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]];
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40) n++;
  return n / (info.width * info.height);
}

describe("the fixtures: the stiletto run's own still collapsed, its orbit didn't", () => {
  it("the input-view still is a few squares on black; the orbit's first frame shows the shoe", async () => {
    const still = await subjectShare(path.join(dir, "stiletto-input-view.png"));
    const orbit = await subjectShare(path.join(dir, "stiletto-orbit-first-frame.jpg"));
    expect(still).toBeLessThan(0.02);
    expect(orbit).toBeGreaterThan(0.08);
  });

  it("both runs are clean-graph splats with an orbit and the input-view still", () => {
    for (const r of Object.values(runs)) {
      expect(r.outputs.map((o) => [o.kind, o.meta?.role])).toEqual([
        ["model3d", "splat"],
        ["video", "turntable"],
        ["image", "preview"],
      ]);
      expect(isIdolClean(r.outputs[0].meta)).toBe(true);
    }
  });
});

describe("the card's still on the clean graph: the orbit", () => {
  it("the stiletto run's still is not the collapsed preview: the card shows the orbit's first frame, the photo is the picture", () => {
    const r = runs.stiletto;
    const view = model3dView(r);
    const preview = byRole(r, "preview").url;
    expect(view.poster).not.toBe(preview);
    expect(view.stillClip).not.toBe(preview);
    expect(view.stillClip).toBe(byRole(r, "turntable").url);
    expect(view.turntable).toBe(byRole(r, "turntable").url);
    expect(view.poster).toBe(photoOf(r));
    expect(view.splat).toEqual({ url: r.outputs[0].url, format: "spz" });
    expect(view.clean).toEqual({ cleaned: true, text: "Cleaned: 221,589 Gaussians kept" });
  });

  it("so does every clean result, whatever its still looks like (the card can't tell a collapsed one)", () => {
    const r = runs.headphones;
    expect(model3dView(r)).toMatchObject({ stillClip: byRole(r, "turntable").url, poster: photoOf(r) });
  });

  it("a still made of the orbit is the poster, and then no clip stands in", () => {
    const r = runs.stiletto;
    const [splat, video, preview] = r.outputs;
    const still = "/api/files/outputs/orbit-still.webp";
    const on = (outputs: OutputFile[]) => {
      const v = model3dView({ ...r, outputs });
      return { poster: v.poster, stillClip: v.stillClip };
    };
    // The server's still of the orbit, on the splat.
    expect(on([{ ...splat, meta: { ...splat.meta, poster: still } }, video, preview])).toEqual({ poster: still, stillClip: undefined });
    // The graph's (an image with role "poster"), even after the input view.
    expect(on([splat, video, preview, { url: still, kind: "image", meta: { role: "poster" } }])).toEqual({ poster: still, stillClip: undefined });
    // The clip's own poster.
    expect(on([splat, { ...video, meta: { ...video.meta, poster: still } }, preview])).toEqual({ poster: still, stillClip: undefined });
  });

  it("the next steps take the photo, never the collapsed still", () => {
    const r = runs.stiletto;
    const steps = keepGoing(r as Generation, 0, {}, 6);
    const hrefs = steps.map((s) => s.href).join(" ");
    expect(hrefs).not.toContain(encodeURIComponent(byRole(r, "preview").url));
    expect(steps.find((s) => s.id === "product-360")?.href).toContain(encodeURIComponent(photoOf(r)));
  });

  it("a clean splat with no orbit keeps the old order", () => {
    const r = runs.stiletto;
    const view = model3dView({ ...r, outputs: r.outputs.filter((o) => o.kind !== "video") });
    expect(view).toMatchObject({ poster: byRole(r, "preview").url, turntable: undefined });
    expect(view.stillClip).toBeUndefined();
  });
});

describe("every other graph keeps its order", () => {
  const spz = (meta: Record<string, unknown>): OutputFile => ({ url: "/api/files/s.spz", kind: "model3d", meta: { role: "splat", format: "spz", ...meta } });
  const clip: OutputFile = { url: "/api/files/t.mp4", kind: "video", meta: { role: "turntable" } };
  const pic: OutputFile = { url: "/api/files/p.png", kind: "image" };
  const view = (outputs: OutputFile[]) => model3dView({ outputs, request: { feature: "image-to-3d", modelId: "oss-idol", op: "splat", inputs: { images: ["/api/files/photo.png"] } } });

  it("the core graph's splat (not pruned), TripoSplat's and fal's: the first picture", () => {
    for (const meta of [{ pruned: false }, {}]) {
      const v = view([spz(meta), clip, pic]);
      expect(v.poster).toBe(pic.url);
      expect(v.stillClip).toBeUndefined();
    }
  });

  it("a GLB: its preview, then the server's poster, then the first picture", () => {
    const glb = (meta: Record<string, unknown>): OutputFile => ({ url: "/api/files/m.glb", kind: "model3d", meta });
    expect(model3dView({ outputs: [glb({ preview: "/a.png", poster: "/b.webp" }), pic], request: { feature: "image-to-3d", modelId: "oss-trellis2", op: "image-to-3d", inputs: {} } }).poster).toBe("/a.png");
    expect(model3dView({ outputs: [glb({ poster: "/b.webp" }), pic], request: { feature: "image-to-3d", modelId: "oss-trellis2", op: "image-to-3d", inputs: {} } }).poster).toBe("/b.webp");
    expect(model3dView({ outputs: [glb({}), pic], request: { feature: "image-to-3d", modelId: "oss-trellis2", op: "image-to-3d", inputs: {} } }).poster).toBe(pic.url);
  });
});

describe("the card, rendered with the stiletto run", () => {
  it("plays the orbit from its own first frame and never shows the collapsed still", async () => {
    const { ModelCard } = await import("@/components/model3d/model-card");
    const r = runs.stiletto;
    const g = { ...r, batchId: null, presetId: null, progress: null, message: null, prompt: "", error: null, costUsd: 0, favorite: false, createdAt: 0, updatedAt: 0, completedAt: 0, modelName: "Idol 3D" } as Generation;
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ModelCard, { g, cloudAllowed: false })));
    const clip = byRole(r, "turntable").url;
    expect(html).not.toContain(byRole(r, "preview").url);
    // The turntable loop: no poster picture, the clip's first frame (it loads only what that frame needs).
    const video = /<video[^>]*>/.exec(html)?.[0] ?? "";
    expect(video).toContain(`src="${firstFrameSrc(clip)}"`);
    expect(video).toContain('preload="metadata"');
    expect(video).not.toContain("poster=");
  });

  it("the first-frame link keeps the file's path and adds the time", () => {
    expect(firstFrameSrc("/api/files/t.mp4")).toBe("/api/files/t.mp4#t=0.001");
    expect(firstFrameSrc("/api/files/t.mp4#t=2")).toBe("/api/files/t.mp4#t=2");
  });
});
