import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { CINEMA_MODELS, LOCATION_MODELS, planCinema, STILL_EDIT_MODELS, STILL_REFERENCES, type CinemaGenerateInput } from "@/lib/catalog/cinema";

// Cinema Studio's menus: Fuobe Cinema first, MiniMax H3 next on both engines; the open stills on Ideogram 4, Qwen-Image
// 2.1, Krea 2 Realism and MOSS-Image; stills and grids with references on Qwen-Image 2.1 with up to 4 of them.

const ctx = { cloudAllowed: true };
const SETTINGS = { camera: "modern", lens: "clean-sharp", focal: "50mm" } as CinemaGenerateInput["settings"];
const input = (over: Partial<CinemaGenerateInput>): CinemaGenerateInput => ({ engine: "open", mode: "video", action: "generate", prompt: "A keeper climbs the stairs", settings: {}, duration: 5, batch: 1, ...over });
const refs = Array.from({ length: 6 }, (_, i) => `/api/files/uploads/r${i}.png`);

describe("Cinema Studio's models", () => {
  it("video: Fuobe Cinema, then MiniMax H3, on both engines; the cloud adds H3 Max and Wan 3.0", () => {
    expect(CINEMA_MODELS.video.open).toEqual(["fuobe-cinema", "oss-minimax-h3", "oss-ltx25", "oss-wan22-14b"]);
    expect(CINEMA_MODELS.video.cloud).toEqual(["fuobe-cinema", "minimax-h3", "seedance-2-5", "kling-3", "veo-3-1", "minimax-h3-max", "wan-3"]);
    for (const engine of ["open", "cloud"] as const) for (const id of CINEMA_MODELS.video[engine]) expect(getModel(id), id).toBeTruthy();
    // The default stays Fuobe Cinema.
    expect(planCinema(input({}), ctx).model.id).toBe("fuobe-cinema");
    expect(planCinema(input({ engine: "cloud" }), ctx).model.id).toBe("fuobe-cinema");
  });

  it("MiniMax H3 picked on the GPU: a 5, 10 or 15 s take, the camera moves in words", () => {
    const plan = planCinema(input({ modelId: "oss-minimax-h3", duration: 4, moves: ["dolly-in"] }), ctx);
    expect(plan.model.id).toBe("oss-minimax-h3");
    expect(plan.steps[0].request).toMatchObject({ modelId: "oss-minimax-h3", params: { duration: 5 } });
    expect(plan.steps[0].request.loras).toBeUndefined();
    expect(plan.notes.join(" ")).toMatch(/MiniMax H3 makes 5s clips/);
    expect(planCinema(input({ modelId: "oss-minimax-h3", duration: 12 }), ctx).steps[0].request.params?.duration).toBe(10);
    expect(planCinema(input({ modelId: "oss-minimax-h3", duration: 14 }), ctx).steps[0].request.params?.duration).toBe(15);
    expect(planCinema(input({ engine: "cloud", modelId: "minimax-h3" }), ctx).model.id).toBe("minimax-h3");
  });

  it("stills: the open menu is Soul Cinema, Ideogram 4, Qwen-Image 2.1, Krea 2 Realism and MOSS-Image", () => {
    expect(CINEMA_MODELS.image.open).toEqual(["fuobe-soul-cinema", "oss-ideogram-4", "oss-qwen-image-21", "oss-krea2-realism", "oss-moss-image"]);
    for (const id of CINEMA_MODELS.image.open) expect(getModel(id), id).toBeTruthy();
  });

  it("stills and grids with references run on Qwen-Image 2.1 on the GPU, with up to 4 references", () => {
    expect(STILL_EDIT_MODELS.open).toBe("oss-qwen-image-21");
    expect(STILL_REFERENCES.open).toBe(4);
    expect(getModel("oss-qwen-image-21")!.options.maxImages).toBe(4);
    const still = planCinema(input({ mode: "image", settings: SETTINGS, images: refs }), ctx);
    expect(still.model.id).toBe("oss-qwen-image-21");
    expect(still.steps[0].request).toMatchObject({ modelId: "oss-qwen-image-21", inputs: { images: refs.slice(0, 4) } });
    expect(still.notes).toContain("Stills with references run on Qwen-Image 2.1");
    const grid = planCinema(input({ mode: "image", action: "grid", grid: { size: "2x2", type: "freeform" }, images: refs }), ctx);
    expect(grid.steps[0].request).toMatchObject({ modelId: "oss-qwen-image-21", inputs: { images: refs.slice(0, 4) } });
    // The cloud keeps Nano Banana Pro with up to 10.
    const cloud = planCinema(input({ engine: "cloud", mode: "image", settings: SETTINGS, images: refs }), ctx);
    expect(cloud.steps[0].request).toMatchObject({ modelId: "nano-banana-pro", inputs: { images: refs } });
  });

  it("the grid's words name what the sheet shows", () => {
    const grid = planCinema(input({ mode: "image", action: "grid", grid: { size: "3x3", type: "zooms" } }), ctx);
    expect(grid.steps[0].request.prompt).toMatch(/thin, straight white gutters, the grid filling the frame edge to edge, every panel a clean picture of the scene alone/);
    expect(grid.steps[0].request.prompt).not.toMatch(/\b(no|not|without)\b/i);
  });

  it("Soul Location's open alternatives: Qwen-Image 2.1, Krea 2 Realism, MOSS-Image and Z-Image Turbo after Fuobe Soul", () => {
    expect(LOCATION_MODELS.open).toEqual(["fuobe-soul", "oss-qwen-image-21", "oss-krea2-realism", "oss-moss-image", "oss-z-image-turbo"]);
    for (const id of LOCATION_MODELS.open) expect(getModel(id), id).toBeTruthy();
    const plan = planCinema(input({ mode: "image", action: "location", modelId: "oss-moss-image", prompt: "An empty diner" }), { ...ctx, has: () => true });
    expect(plan.model.id).toBe("oss-moss-image");
  });
});
