import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import type { PublicItem, PublicMedia, PublicShare, ShareLayout } from "@/lib/share";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

const { idolCameraStills, isIdolCameraStill, showableOutputs } = await import("@/lib/av/idol-camera-still");
const { firstFrameSrc, model3dView } = await import("@/lib/av/model3d");
const { modelPreview, sharedOutputs, shownOutputs } = await import("@/lib/output-actions");
const { keepGoing } = await import("@/lib/next-steps");
const { outputFiles, previewImage, shareFileUrl, storedPath } = await import("@/lib/share");

/**
 * Idol 3D's clean graph saves a still rendered from the camera Idol predicts (role "preview"); for the red stiletto seen
 * side on it is a few coloured squares on black (tests/idol-clean-poster.test.ts measures it). It is never a cover,
 * poster, tile or shown piece anywhere: the Library and feed Viewer, share and Publish pages, Assist's chat and project
 * tiles, the result card. The fixtures are the two real runs on the clean graph, as stored.
 */

const dir = path.join(process.cwd(), "tests", "fixtures", "idol-clean");
type Run = Pick<Generation, "id" | "feature" | "modelId" | "engine" | "provider" | "op" | "kind" | "status" | "request" | "outputs">;
const runs = JSON.parse(fs.readFileSync(path.join(dir, "runs.json"), "utf8")) as Record<"stiletto" | "headphones", Run>;
const byRole = (r: Run, role: string) => r.outputs.find((o) => o.meta?.role === role)!;
const photoOf = (r: Run) => r.request.inputs!.images![0];
const full = (r: Run): Generation =>
  ({ ...r, batchId: null, presetId: null, progress: null, message: null, prompt: "", error: null, costUsd: 0, favorite: false, createdAt: 0, updatedAt: 0, completedAt: 0, modelName: "Idol 3D" }) as Generation;
const html = (el: ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));
const both = Object.entries(runs) as ["stiletto" | "headphones", Run][];

describe("which output is the camera still", () => {
  it.each(both)("the %s run: its role \"preview\" picture, nothing else", (_, r) => {
    const preview = byRole(r, "preview");
    expect([...idolCameraStills(r)]).toEqual([preview.url]);
    expect(r.outputs.map((o) => isIdolCameraStill(r, o))).toEqual([false, false, true]);
    expect(showableOutputs(r)).toEqual([0, 1]);
  });

  it("only on a clean splat: the core graph's (not pruned), TripoSplat's and any other result keep every output", () => {
    const r = runs.stiletto;
    for (const meta of [{ role: "splat", format: "spz", pruned: false }, { role: "splat", format: "spz" }]) {
      const g = { ...r, outputs: [{ ...r.outputs[0], meta }, ...r.outputs.slice(1)] };
      expect(idolCameraStills(g).size).toBe(0);
      expect(showableOutputs(g)).toEqual([0, 1, 2]);
    }
    const pictures = { outputs: [{ url: "/a.png", kind: "image", meta: { role: "preview" } }, { url: "/b.png", kind: "image" }] as OutputFile[] };
    expect(showableOutputs(pictures)).toEqual([0, 1]);
  });
});

describe("the Library and feed Viewer (modelPreview → SplatPanel)", () => {
  it.each(both)("the %s splat's poster is never the camera still; its orbit is the video", (_, r) => {
    const { poster, video } = modelPreview(r, r.outputs[0]);
    expect(poster).toBeUndefined();
    expect(video).toBe(byRole(r, "turntable").url);
  });

  it("a still made of the orbit is the poster; a camera still named on the splat isn't", () => {
    const r = runs.stiletto;
    const [splat, clip, preview] = r.outputs;
    const still = "/api/files/outputs/orbit-still.webp";
    expect(modelPreview({ outputs: [splat, clip, { url: still, kind: "image", meta: { role: "poster" } }, preview] }, splat).poster).toBe(still);
    const named = { ...splat, meta: { ...splat.meta, preview: preview.url } };
    expect(modelPreview({ outputs: [named, clip, preview] }, named).poster).toBeUndefined();
  });

  it("every other 3D result keeps its picture", () => {
    const glb: OutputFile = { url: "/m.glb", kind: "model3d" };
    expect(modelPreview({ outputs: [glb, { url: "/p.png", kind: "image", meta: { role: "preview" } }] }, glb).poster).toBe("/p.png");
    const core = { ...runs.stiletto.outputs[0], meta: { role: "splat", format: "spz", pruned: false } };
    expect(modelPreview({ outputs: [core, ...runs.stiletto.outputs.slice(1)] }, core).poster).toBe(byRole(runs.stiletto, "preview").url);
  });

  it.each(both)("the Viewer, rendered with the %s run, plays the orbit from its first frame and never names the camera still", async (_, r) => {
    const { ModelViewer } = await import("@/components/studio/result-media");
    const out = html(createElement(ModelViewer, { output: r.outputs[0], g: full(r) }));
    expect(out).not.toContain(byRole(r, "preview").url);
    // Before hydration (and with reduced motion) the panel is the orbit video, paused on its own first frame.
    const video = /<video[^>]*>/.exec(out)?.[0] ?? "";
    expect(video).toContain(`src="${firstFrameSrc(byRole(r, "turntable").url)}"`);
    expect(video).toContain('preload="metadata"');
    expect(video).not.toContain("poster=");
  });

  it("a clean splat with no orbit shows the photo it was made from, not the camera still", async () => {
    const { ModelViewer } = await import("@/components/studio/result-media");
    const r = runs.stiletto;
    const g = full({ ...r, outputs: r.outputs.filter((o) => o.kind !== "video") });
    const out = html(createElement(ModelViewer, { output: g.outputs[0], g }));
    expect(out).not.toContain(byRole(r, "preview").url);
    expect(out).toContain(`src="${photoOf(r)}"`);
  });

  it.each(both)("the %s splat's Library tile (MediaThumb with its run) is the orbit, and the run tiles only the splat", async (_, r) => {
    const { MediaThumb } = await import("@/components/studio/result-media");
    expect(shownOutputs(r)).toEqual([0]);
    const out = html(createElement(MediaThumb, { output: r.outputs[0], g: r }));
    expect(out).not.toContain(byRole(r, "preview").url);
    expect(out).toContain(byRole(r, "turntable").url);
  });
});

/**
 * A share link's or Publish page's pieces as src/server/shares.ts builds them from a result: its shared outputs
 * (sharedOutputs), each at its share-scoped URL with a clip's own poster, and the cover the page falls back to (the first
 * picture, or a clip with a poster). shares.ts lists a piece's outputs with sharedOutputs.
 */
function pageOf(r: Run, layout: ShareLayout, token = "T".repeat(44)): { page: PublicShare; files: string[] } {
  const g = full(r);
  const media: PublicMedia[] = sharedOutputs(g).map((i) => {
    const o = g.outputs[i];
    const poster = ["poster", "thumbnail", "preview"].map((k) => o.meta?.[k]).find((v): v is string => typeof v === "string" && !!storedPath(v));
    return { url: shareFileUrl(token, o.url)!, kind: o.kind, ...(o.contentType && { contentType: o.contentType }), ...(o.kind === "video" && poster && { poster: shareFileUrl(token, poster)! }), download: `idol-3d-${i + 1}` };
  });
  const items: PublicItem[] = [1, 2].map((n) => ({ key: String(n), title: "3D model", model: "Idol 3D", kind: "model3d", aspectRatio: null, media, createdAt: 0 }));
  const cover = items.flatMap((it) => it.media).find((x) => x.kind === "image" || x.poster) ?? null;
  const page: PublicShare = { kind: "publish", title: "Products", description: "", tags: [], layout, showPrompts: false, cover, coverKey: cover ? "1" : null, items, truncated: false, updatedAt: 0 };
  return { page, files: sharedOutputs(g).flatMap((i) => outputFiles(g.outputs[i])) };
}

describe("share links and Publish pages: pieces, cover, link preview", () => {
  it.each(both)("the %s run's piece is its splat and orbit, never the camera still", (_, r) => {
    expect(sharedOutputs(r)).toEqual([0, 1]);
    const { files } = pageOf(r, "grid");
    expect(files).toEqual([storedPath(r.outputs[0].url), storedPath(r.outputs[1].url)]);
    expect(files).not.toContain(storedPath(byRole(r, "preview").url));
  });

  it.each(both)("the %s run gives no cover picture, so no og:image of the camera still", (_, r) => {
    const { page } = pageOf(r, "series");
    expect(page.cover).toBeNull();
    expect(previewImage(page.cover)).toBeNull();
  });

  it.each(["grid", "feature", "series", "carousel"] as const)("the %s page never shows the camera still", async (layout) => {
    const { SharePage } = await import("@/app/s/share-page");
    for (const r of Object.values(runs)) {
      const out = html(createElement(SharePage, { share: pageOf(r, layout).page }));
      const preview = storedPath(byRole(r, "preview").url)!;
      expect(out).not.toContain(preview);
      expect(out).toContain(storedPath(byRole(r, "turntable").url)!);
    }
  });

  it("any other result's pieces are what they were: a 3D result all its files, others what feeds show", () => {
    const glb = { kind: "model3d" as const, outputs: [{ url: "/api/files/m.glb", kind: "model3d" }, { url: "/api/files/t.mp4", kind: "video" }, { url: "/api/files/p.png", kind: "image", meta: { role: "preview" } }] as OutputFile[] };
    expect(sharedOutputs(glb)).toEqual([0, 1, 2]);
    const pictures = { kind: "image" as const, outputs: [{ url: "/1.png", kind: "image" }, { url: "/2.png", kind: "image" }] as OutputFile[] };
    expect(sharedOutputs(pictures)).toEqual([0, 1]);
  });
});

describe("Assist: the chat's and the project's tiles", () => {
  it.each(both)("the chat tiles the %s run's splat (as its orbit) and orbit, never the camera still", async (_, r) => {
    const { GenerationCards } = await import("@/components/assist/transcript");
    const g = full(r);
    const opened: number[] = [];
    const out = html(createElement(GenerationCards, { ids: [g.id], all: new Map([[g.id, g]]), onOpen: (_g: Generation, i: number) => opened.push(i) }));
    expect(out).not.toContain(byRole(r, "preview").url);
    // Two tiles, the splat's showing its orbit (it isn't a bare "3D model" box).
    expect(out.match(/aria-label="Open /g)).toHaveLength(2);
    expect(out).not.toContain(">3D model<");
    expect(out.split(byRole(r, "turntable").url).length - 1).toBe(2);
  });

  it("the project's assets and the chat's Viewer list the same outputs", () => {
    for (const r of Object.values(runs)) expect(showableOutputs(full(r))).toEqual([0, 1]);
  });
});

describe("Canvas and Cinema tiles", () => {
  it.each(both)("a Canvas node that ran the %s splat tiles the splat and its orbit, never the camera still", async (_, r) => {
    const { foldResultsKeep } = await import("@/components/canvas/canvas-context");
    const res = foldResultsKeep(undefined, [full(r)]);
    // The node's tiles, its Viewer's arrows and "Use result as an input" all read these.
    expect(res.outputs.map((x) => x.i)).toEqual([0, 1]);
    expect(res.outputs.map((x) => x.o.url)).not.toContain(byRole(r, "preview").url);
    expect(res.outputs.find((x) => ["image", "video", "audio"].includes(x.o.kind))?.o.url).toBe(byRole(r, "turntable").url);
  });

  it.each(both)("a Cinema project holding the %s splat tiles the splat and its orbit, at their own indexes", async (_, r) => {
    const { units } = await import("@/components/cinema/cinema-feed");
    const tiles = units([{ ...full(r), folderId: null, projectId: "p" } as never]);
    expect(tiles.map((u) => u.index)).toEqual([0, 1]);
    expect(tiles.map((u) => u.output?.url)).toEqual([r.outputs[0].url, byRole(r, "turntable").url]);
  });

  it("any other result keeps every tile (a picture run's takes, a grid's sheet)", async () => {
    const { foldResultsKeep } = await import("@/components/canvas/canvas-context");
    const { units } = await import("@/components/cinema/cinema-feed");
    const takes = { ...full(runs.stiletto), kind: "image", op: "t2i", outputs: [{ url: "/api/files/1.png", kind: "image", meta: { role: "preview" } }, { url: "/api/files/2.png", kind: "image" }] } as Generation;
    expect(foldResultsKeep(undefined, [takes]).outputs.map((x) => x.i)).toEqual([0, 1]);
    expect(units([{ ...takes, folderId: null, projectId: "p" } as never]).map((u) => u.index)).toEqual([0, 1]);
    const grid = { ...takes, feature: "cinema-grid" };
    expect(units([{ ...grid, folderId: null, projectId: "p" } as never]).map((u) => [u.index, !!u.tile])).toEqual([
      [0, false],
      [0, true],
    ]);
  });
});

describe("the result card and its next steps", () => {
  it("a clean splat with no orbit: the photo, never the camera still", async () => {
    const r = runs.stiletto;
    const outputs = r.outputs.filter((o) => o.kind !== "video");
    const view = model3dView({ ...r, outputs });
    expect(view).toMatchObject({ poster: photoOf(r), turntable: undefined });
    expect(view.stillClip).toBeUndefined();
    const { ModelCard } = await import("@/components/model3d/model-card");
    const out = html(createElement(ModelCard, { g: full({ ...r, outputs }), cloudAllowed: false }));
    expect(out).not.toContain(byRole(r, "preview").url);
    expect(out).toContain('alt="The photo the splat was made from"');
  });

  it.each(both)("the %s card never names the camera still", async (_, r) => {
    const { ModelCard } = await import("@/components/model3d/model-card");
    expect(html(createElement(ModelCard, { g: full(r), cloudAllowed: false }))).not.toContain(byRole(r, "preview").url);
  });

  it("Sharpen says what it sharpens: the photo on a clean splat, the still where the model has one", () => {
    const steps = keepGoing(full(runs.stiletto), 0, {}, 6);
    const up = steps.find((s) => s.id === "upscale")!;
    expect(up.verb).toBe("Sharpen the photo");
    expect(up.href).toBe(`/upscale?image=${encodeURIComponent(photoOf(runs.stiletto))}`);
    const glb = { ...full(runs.stiletto), modelId: "oss-trellis2", op: "image-to-3d", outputs: [{ url: "/api/files/m.glb", kind: "model3d", meta: { poster: "/api/files/m.webp" } }] } as Generation;
    expect(keepGoing(glb, 0, {}, 6).find((s) => s.id === "upscale")?.verb).toBe("Sharpen the still");
  });
});
