import { describe, expect, it } from "vitest";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { REGEN_OFFERED } from "@/lib/catalog/regenerate";
import { UPSCALE_FIRST_STEPS } from "@/lib/catalog/upscale-first";
import { VIDEO_UPSCALE_STUDIO } from "@/lib/studios";
import { getModel } from "@/lib/catalog";
import { paletteItems } from "@/lib/catalog/canvas";
import { nextSteps, outputActions } from "@/lib/output-actions";
import { HUB_MODES } from "@/lib/hubs";

// Regenerate · creative is switched off until it has run on a card that fits it; Restore & colourise and Remove
// dialogue run on a self-hosted Fuobe only, so a guest or an account is never sent to them.

const out = (url = "/api/files/a.mp4"): OutputFile => ({ url, kind: "video" }) as OutputFile;
const gen = (p: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "video",
    presetId: null,
    modelId: "oss-minimax-h3",
    engine: "open",
    provider: "comfyui",
    op: "t2v",
    kind: "video",
    status: "succeeded",
    progress: null,
    message: null,
    prompt: "a fox runs through snow",
    request: { feature: "video", modelId: "oss-minimax-h3", prompt: "a fox runs through snow" },
    outputs: [out()],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
    ...p,
  }) as Generation;
const ids = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).map((a) => a.id);
const upload = () => gen({ feature: "upload", modelId: "upload", provider: "mock" as Generation["provider"], prompt: null, request: { feature: "upload", modelId: "upload" } });

describe("Regenerate while it is switched off", () => {
  it("is off", () => {
    expect(REGEN_OFFERED).toBe(false);
  });

  it("is not a step before upscaling, a finishing choice, a model to pick or a Canvas node", () => {
    expect(UPSCALE_FIRST_STEPS.map((s) => s.id)).not.toContain("regenerate");
    expect(UPSCALE_FIRST_STEPS.map((s) => s.id)).toContain("restore");
    expect(VIDEO_UPSCALE_STUDIO.finishChoices).toBeUndefined();
    expect(getModel("oss-h3-regenerate")?.hidden).toBe(true);
    expect(paletteItems("both").map((p) => p.id)).not.toContain("upscale-regenerate");
  });

  it("is not offered on a clip or an upload", () => {
    expect(ids(gen())).not.toContain("regenerate");
    expect(ids(upload())).not.toContain("regenerate");
    expect(nextSteps(gen(), 0, 5).map((a) => a.id)).not.toContain("regenerate");
  });
});

describe("tools a guest or an account can't open", () => {
  it("leaves Restore & colourise and Remove dialogue out of a visitor's result menus, and keeps them for the owner", () => {
    const owner = ids(gen());
    expect(owner).toContain("restore-video");
    const visitor = ids(gen(), { visitor: true });
    expect(visitor).not.toContain("restore-video");
    expect(visitor).not.toContain("remove-dialogue");
    expect(ids(upload(), { visitor: true })).not.toContain("restore-video");
  });

  it("marks their Video tools tabs as the owner's only", () => {
    const tabs = Object.fromEntries(HUB_MODES["video-tools"].map((m) => [m.id, m.ownerOnly ?? false]));
    expect(tabs).toMatchObject({ restore: true, "remove-dialogue": true, matte: false, evolution: false });
  });
});
