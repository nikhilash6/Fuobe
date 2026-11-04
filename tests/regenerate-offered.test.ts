import { describe, expect, it } from "vitest";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { REGEN_OFFERED } from "@/lib/catalog/regenerate";
import { UPSCALE_FIRST_STEPS } from "@/lib/catalog/upscale-first";
import { VIDEO_UPSCALE_STUDIO } from "@/lib/studios";
import { getModel } from "@/lib/catalog";
import { paletteItems } from "@/lib/catalog/canvas";
import { nextSteps, outputActions } from "@/lib/output-actions";
import { HUB_MODES } from "@/lib/hubs";
import { CHARACTER_QUALITIES } from "@/lib/catalog/character-swap";
import { MAKERS } from "@/lib/catalog/genjutsu";
import { OPEN_SHARPEN_OFF, sharpenOffered, sharpenOptions } from "@/lib/catalog/sharpen";
import { STUDIO_ROWS } from "@/server/gpu/tools";

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
    // The finishing row stays, with Restore · faithful (and Quick · RTX, which the row adds), and no Regenerate.
    expect(VIDEO_UPSCALE_STUDIO.finishChoices?.map((c) => c.modelId)).toEqual(["oss-seedvr2"]);
    expect(getModel("oss-h3-regenerate")?.hidden).toBe(true);
    expect(paletteItems("both").map((p) => p.id)).not.toContain("upscale-regenerate");
  });

  it("leaves the Character swap's 1080p / 2K / 4K on your GPU out, and keeps the cloud's 2K / 4K", () => {
    expect(CHARACTER_QUALITIES.open).toEqual(["480p", "768p"]);
    expect(CHARACTER_QUALITIES.cloud).toEqual(["480p", "768p", "2K", "4K"]);
    for (const m of MAKERS.filter((m) => m.h3 && m.engine === "open")) expect(m.qualities).toEqual(["480p", "768p"]);
    expect(sharpenOffered("open")).toBe(false);
    expect(sharpenOffered("cloud")).toBe(true);
    const film = { width: 1920, height: 1080 };
    expect(sharpenOptions("open", film).every((o) => !o.available && o.reason === OPEN_SHARPEN_OFF)).toBe(true);
    expect(sharpenOptions("cloud", film).find((o) => o.tier === "2K")?.available).toBe(true);
    expect(STUDIO_ROWS.map((r) => r.label)).not.toContain("Character swap in 2K");
    expect(STUDIO_ROWS.map((r) => r.label)).not.toContain("Regenerate in 2K");
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

  it("leaves Clean up dialogue out of a visitor's result menus and keeps it for the owner; Remove a person is everyone's", () => {
    // An uploaded clip gets both (a clip with sound).
    expect(ids(upload())).toEqual(expect.arrayContaining(["remove-person", "clean-dialogue"]));
    const visitor = ids(upload(), { visitor: true });
    // An account runs Remove a person on its own GPU (tests/account-video-tools.test.ts); a guest signs up there.
    expect(visitor).toContain("remove-person");
    expect(visitor).not.toContain("clean-dialogue");
  });

  it("leaves Restore & colourise's Video tools tab out for a visitor; Remove a person's tab is everyone's", () => {
    const tabs = Object.fromEntries(HUB_MODES["video-tools"].map((m) => [m.id, m.ownerOnly ?? false]));
    expect(tabs).toMatchObject({ restore: true, "remove-person": false, "remove-dialogue": false, matte: false, evolution: false, "remove-object": false });
  });
});
