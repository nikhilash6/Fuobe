import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import type { Generation } from "@/lib/catalog/types";
import { FINAL_3D, MODELS_3D, finalBuildHref, model3dView, modeOf } from "@/lib/av/model3d";
import { offered, type AccessSummary } from "@/lib/model-access";

/**
 * Draft then final (idol-6, docs/research/idol-9.md §8): a finished Idol 3D splat on your GPU links to Image to 3D with
 * TRELLIS.2 picked and the same picture filled in, while TRELLIS.2 is switched on and runs here.
 */

const PHOTO = "/api/files/abc123.png";

function result(modelId: string, images: string[] = [PHOTO]): Pick<Generation, "outputs" | "request"> {
  return {
    request: { feature: "image-to-3d", modelId, op: modelId === "oss-idol" ? "splat" : "image-to-3d", inputs: { images } },
    outputs: [{ kind: "model3d", url: "/api/files/out.spz", meta: { format: "spz" } }],
  } as Pick<Generation, "outputs" | "request">;
}

const href = (g: Pick<Generation, "outputs" | "request">, allowed = true) => finalBuildHref(g, model3dView(g), allowed);

describe("Build the final with TRELLIS.2", () => {
  it("links an Idol 3D result on your GPU to Image to 3D with TRELLIS.2 and its own picture", () => {
    const link = href(result("oss-idol"));
    expect(link).toBe(`/image-to-3d?mode=image&model=oss-trellis2&image=${encodeURIComponent(PHOTO)}`);
    const q = new URL(link!, "http://x").searchParams;
    expect(Object.fromEntries(q)).toEqual({ mode: "image", model: "oss-trellis2", image: PHOTO });
    // The studio reads ?model=oss-trellis2 as From an image on the open engine.
    expect(modeOf(q.get("model")!)).toMatchObject({ mode: "image", engine: "open" });
  });

  it("shows only on Idol 3D results on your GPU that have a source picture", () => {
    expect(href(result("oss-idol", []))).toBeNull();
    // fal's Idol is not drafted into the open TRELLIS.2: no Idol draft on the cloud.
    expect(href(result("idol-3d"))).toBeNull();
    for (const other of ["oss-triposplat", "oss-trellis2", "oss-pixal3d", "triposplat", "trellis-2"]) expect(href(result(other))).toBeNull();
  });

  it("hides when TRELLIS.2 isn't offered here", () => {
    expect(href(result("oss-idol"), false)).toBeNull();
  });

  it("respects Settings → Models & licences the way the studio's picker does", () => {
    const off: AccessSummary = { off: ["oss-trellis2"] };
    const otherOff: AccessSummary = { off: ["oss-pixal3d"] };
    expect(offered(undefined, FINAL_3D.model, "open")).toBe(true);
    expect(offered(otherOff, FINAL_3D.model, "open")).toBe(true);
    expect(offered(off, FINAL_3D.model, "open")).toBe(false);
    expect(href(result("oss-idol"), offered(off, FINAL_3D.model, "open"))).toBeNull();
  });

  it("names a real open model the studio offers, with its GPU need", () => {
    expect(getModel(FINAL_3D.model)?.name).toBe("TRELLIS.2");
    expect(MODELS_3D.image.open.map((m) => m.id)).toContain(FINAL_3D.model);
    expect(getModel(FINAL_3D.model)?.tagline).toContain("16 GB GPU");
    expect(FINAL_3D.note).toBe("A textured, riggable .glb · 16 GB GPU");
  });

  it("is wired into the card and the studio (model access, open models, no visitors; ?image= fills the picture)", () => {
    const root = process.cwd();
    const card = fs.readFileSync(path.join(root, "src/components/model3d/model-card.tsx"), "utf8");
    const studio = fs.readFileSync(path.join(root, "src/components/model3d/model3d-studio.tsx"), "utf8");
    expect(card).toContain("finalBuildHref(g, view, finalAllowed)");
    expect(card).toContain("{FINAL_3D.note}");
    expect(studio).toContain('const finalAllowed = !visitor && engineMode !== "cloud" && offered(access, FINAL_3D.model, "open");');
    expect(studio).toContain('params.get("image")');
    expect(studio).toContain("onImage={fromImage}");
    // A second click on the same link still fills the form (the URL doesn't change, so UrlModel can't).
    expect(card).toContain("onClick={() => view.photo && onFinal?.(view.photo)}");
    expect(studio).toContain("onFinal={toFinal}");
    expect(studio).toContain("if (found) fromUrl(found.mode, found.engine, FINAL_3D.model);");
    // ?image= leaves Idol's "It's a photo" as it is: the picture is usually the user's own upload.
    const fromImage = studio.slice(studio.indexOf("const fromImage = useCallback"), studio.indexOf("const fromUrl = useCallback"));
    expect(fromImage).toContain("setPhoto(v);");
    expect(fromImage).not.toContain("setIdolPhoto");
  });
});
