import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardStateWords, stacksOffReason } from "@/lib/library";

/**
 * Controls that look like they act must act, or say why they can't: a Library card with nothing to open, a view setting
 * a tab doesn't use, a Refresh that failed, a key cap no key is bound to.
 */
const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("Library cards and view settings", () => {
  it("names the state of a card that has nothing to open", () => {
    expect(cardStateWords("queued")).toBe("queued");
    expect(cardStateWords("running")).toBe("still generating");
    expect(cardStateWords("failed")).toBe("failed");
    expect(cardStateWords("canceled")).toBe("stopped");
  });

  it("gives no pointer or hover to a card that can't open, select or expand", () => {
    const card = src("src/components/library/asset-card.tsx");
    expect(card).toContain("const acts = selecting || !!stack || done;");
    expect(card).toContain('acts && "cursor-pointer hover:bg-accent"');
    expect(card).not.toMatch(/"group\/card relative flex min-h-16 cursor-pointer/);
  });

  it("says why Stack batches doesn't apply in Trash and Uploads", () => {
    expect(stacksOffReason("trash")).toMatch(/Trash/);
    expect(stacksOffReason("uploads")).toMatch(/Uploads/);
    expect(stacksOffReason("all")).toBeUndefined();
    expect(src("src/components/library-view.tsx")).toContain("noStacks={stacksOffReason(tab.id)}");
  });
});

describe("buttons that answer every press", () => {
  it("a failed balance Refresh says so", () => {
    expect(src("src/components/keys/use-key-info.ts")).toMatch(/catch \{[^}]*toast\.error\("Couldn't refresh the balance/);
  });

  it("New creation shows no Enter key cap that nothing is bound to", () => {
    expect(src("src/components/nav/create-menu.tsx")).not.toContain("↵");
  });

  it("the Kinetic export buttons wait, with words, while the scene isn't ready", () => {
    const sheet = src("src/components/kinetic/export-sheet.tsx");
    expect(sheet).toContain("disabled={!!blocked || !!waiting ||");
    expect(src("src/components/kinetic/editor.tsx")).toContain('waiting={plan ? null : "Getting the scene ready…"}');
  });
});

describe("studio pickers say what the picked model can't do", () => {
  it("Storyboard: 21:9 on the cloud's own frame models needs a look or a partner", async () => {
    const { boardShapeProblem } = await import("@/lib/catalog/storyboard");
    expect(boardShapeProblem({ engine: "cloud", aspectRatio: "21:9" })).toMatch(/16:9 at their widest/);
    expect(boardShapeProblem({ engine: "cloud", aspectRatio: "21:9", look: "noir" })).toBeUndefined();
    expect(boardShapeProblem({ engine: "cloud", aspectRatio: "16:9" })).toBeUndefined();
    expect(boardShapeProblem({ engine: "open", aspectRatio: "21:9" })).toBeUndefined();
    // The reason holds: the cloud's frame models draw 21:9 as their 16:9 size.
    const { getModel } = await import("@/lib/catalog");
    const { STORYBOARD_MODELS } = await import("@/lib/catalog/storyboard");
    for (const id of [STORYBOARD_MODELS.cloud.first, STORYBOARD_MODELS.cloud.next]) {
      const route = getModel(id)!.routes.find((r) => r.map?.aspectRatio)!;
      const f = route.map!.aspectRatio as { values?: Record<string, unknown> };
      expect(f.values?.["21:9"]).toBe(f.values?.["16:9"]);
    }
  });

  it("Layout: FLUX.3 reads no canvas type or style tags, Ideogram no canvas type", async () => {
    const { layoutReads } = await import("@/lib/layout-prompt");
    expect(layoutReads({ options: { layout: "flux3" } })).toEqual({ canvas: false, tags: false });
    expect(layoutReads({ options: { layout: "ideogram" } })).toEqual({ canvas: false, tags: true });
    expect(layoutReads({ options: { layout: "moss" } })).toEqual({ canvas: true, tags: true });
    expect(layoutReads(undefined)).toEqual({ canvas: true, tags: true });
  });

  it("Captions: the open burner's preview draws its own font", async () => {
    const { BURN_CAPS, burnNote } = await import("@/lib/av/captions");
    expect(BURN_CAPS.open.fonts).toBe(false);
    expect(BURN_CAPS.veed.fonts).toBe(true);
    expect(burnNote("open")).toMatch(/one font/);
  });

  it("Ad Multiplier: Quality knows what each recreate model makes", async () => {
    const { marketingModelInfo } = await import("@/components/marketing/model-info");
    const info = marketingModelInfo();
    // Kling O3's edit sends no size (it keeps the reference's); Genjutsu on your GPU is sent none either.
    expect(info["kling-o3"]?.editSizes).toBe(false);
    expect(info["fuobe-genjutsu-motion"]?.editSizes).toBe(false);
    const hh = info["happy-horse-video-edit"]?.editSizes;
    expect(Array.isArray(hh) && !hh.includes("480p")).toBe(true);
  });

  it("Turnaround: Landscape on WorldCast says it films portrait", () => {
    expect(src("src/components/turnaround/turnaround-dialog.tsx")).toContain('why: "WorldCast films portrait only"');
  });

  it("Mixed Media: 2K and 4K per frame on your GPU say the 1536 px limit", () => {
    expect(src("src/components/mixed-media/mixed-studio.tsx")).toContain("const gpuCap = !cloud && r !== \"1K\";");
  });
});

describe("Dub, Relight and Swap Studio", () => {
  it("Dub: HeyGen's one shot says it detects the spoken language, ElevenLabs keeps the menu", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SourceLanguageSelect } = await import("@/components/av/language-picker");
    const html = renderToStaticMarkup(createElement(SourceLanguageSelect, { id: "s", value: "es", onChange: () => {}, unavailable: "HeyGen Translate detects the spoken language itself" }));
    expect(html).toContain("detects the spoken language itself");
    expect(html).toContain("disabled");
    const dub = src("src/components/dub/dub-studio.tsx");
    expect(dub).toContain('unavailable={oneShot && model !== "elevenlabs-dubbing"');
    // The reason holds: only ElevenLabs' one shot is sent the spoken language.
    expect(src("src/lib/av/dub.ts")).toContain('...(o.model === "elevenlabs-dubbing" && source && { sourceLanguage: source })');
  });

  it("Relight: Glow says it is on screen only, as the saved picture has none", () => {
    expect(src("src/components/relight/relight-tool.tsx")).toContain("On screen only: shows where each light sits");
    expect(src("src/components/relight/relight-tool.tsx")).toContain("glow: false,");
  });

  it("Swap Studio: the anchor model shown is the one sent, after an engine switch or a model switched off", () => {
    const s = src("src/components/swap-studio/stage-anchors.tsx");
    expect(s).toContain("const modelId = models.find((m) => m.id === asked && m.offered)?.id ?? models.find((m) => m.offered)?.id");
  });
});
