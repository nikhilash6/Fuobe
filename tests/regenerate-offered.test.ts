import { describe, expect, it } from "vitest";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { REGEN_OFFERED } from "@/lib/catalog/regenerate";
import { UPSCALE_FIRST_STEPS } from "@/lib/catalog/upscale-first";
import { VIDEO_UPSCALE_STUDIO } from "@/lib/studios";
import { getModel } from "@/lib/catalog";
import { paletteItems } from "@/lib/catalog/canvas";
import { outputActions } from "@/lib/output-actions";
import { HUB_MODES } from "@/lib/hubs";
import { CHARACTER_QUALITIES } from "@/lib/catalog/character-swap";
import { MAKERS } from "@/lib/catalog/genjutsu";
import { sharpenOptions } from "@/lib/catalog/sharpen";
import { STUDIO_ROWS } from "@/server/gpu/tools";

// Regenerate · creative shows for everyone with what it needs (a 48 GB card) and runs on the visitor's own GPU; Restore & colourise and Remove
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

describe("Regenerate shows for everyone with what it needs, and runs on the visitor's own GPU", () => {
  it("is still off on this studio's GPUs", () => {
    expect(REGEN_OFFERED).toBe(false);
  });

  it("is a step before upscaling, a finishing choice and a Canvas node, each with its own-setup id", () => {
    expect(UPSCALE_FIRST_STEPS.map((s) => s.id)).toEqual(["restore", "regenerate"]);
    expect(UPSCALE_FIRST_STEPS.find((s) => s.id === "regenerate")?.ownSetup).toBe("regenerate:upscale");
    // Restore · faithful stays first, the default; Regenerate · creative sits beside it.
    expect(VIDEO_UPSCALE_STUDIO.finishChoices?.map((c) => c.modelId)).toEqual(["oss-seedvr2", "oss-h3-regenerate"]);
    expect(VIDEO_UPSCALE_STUDIO.defaultModels.open).toBe("oss-seedvr2");
    expect(VIDEO_UPSCALE_STUDIO.extraModels).toContain("oss-h3-regenerate");
    // Out of the model lists (its choice is how it is picked).
    expect(getModel("oss-h3-regenerate")?.hidden).toBe(true);
    expect(paletteItems("both").find((p) => p.id === "upscale-regenerate")?.data?.modelId).toBe("oss-h3-regenerate");
  });

  it("offers the Character swap's 1080p / 2K / 4K on your GPU, sharpens on both engines, and lists the GPU checks", () => {
    expect(CHARACTER_QUALITIES.open).toEqual(["480p", "768p", "1080p", "2K", "4K"]);
    expect(CHARACTER_QUALITIES.cloud).toEqual(["480p", "768p", "2K", "4K"]);
    for (const m of MAKERS.filter((m) => m.h3 && m.engine === "open")) expect(m.qualities).toEqual(["480p", "768p", "1080p", "2K", "4K"]);
    const film = { width: 1920, height: 1080 };
    expect(sharpenOptions("open", film).find((o) => o.tier === "1080p")?.available).toBe(true);
    expect(sharpenOptions("cloud", film).find((o) => o.tier === "2K")?.available).toBe(true);
    expect(STUDIO_ROWS.map((r) => r.label)).toEqual(expect.arrayContaining(["Character swap in 2K", "Regenerate in 2K", "MiniMax H3 in 2K"]));
  });

  it("is offered on a clip and an upload, with its label; Enhance on an Edit video result too", () => {
    const regen = outputActions(gen(), 0, { visitor: true }).find((a) => a.id === "regenerate");
    expect(regen?.ownSetup).toBe("regenerate:upscale");
    expect(ids(upload(), { visitor: true })).toContain("regenerate");
    const edit = gen({ feature: "video-edit", request: { feature: "video-edit", modelId: "oss-minimax-h3", prompt: "x", params: { duration: 5 } } });
    expect(outputActions(edit, 0, { visitor: true }).find((a) => a.id === "enhance-h3")?.ownSetup).toBe("regenerate:enhance");
    // Not on Paid APIs only (nobody hosts it).
    expect(ids(gen(), { engineMode: "cloud" })).not.toContain("regenerate");
  });
});

describe("tools a guest or an account can't open", () => {
  it("leaves Restore & colourise out of a visitor's result menus, keeps it for the owner, and offers Remove dialogue to both", () => {
    const owner = ids(gen());
    expect(owner).toContain("restore-video");
    const visitor = ids(gen(), { visitor: true });
    expect(visitor).not.toContain("restore-video");
    // An account runs Remove dialogue on its own GPU (tests/account-audio.test.ts).
    expect(visitor).toContain("remove-dialogue");
    expect(ids(upload(), { visitor: true })).not.toContain("restore-video");
  });

  it("offers Remove a person and Clean up dialogue in a visitor's result menus, as the owner's", () => {
    // An uploaded clip gets both (a clip with sound).
    expect(ids(upload())).toEqual(expect.arrayContaining(["remove-person", "clean-dialogue"]));
    const visitor = ids(upload(), { visitor: true });
    // An account runs both on its own GPU (tests/account-video-tools.test.ts, account-audio.test.ts); a guest signs up there.
    expect(visitor).toContain("remove-person");
    expect(visitor).toContain("clean-dialogue");
  });

  it("leaves Restore & colourise's Video tools tab out for a visitor; Remove a person's and Remove dialogue's tabs are everyone's", () => {
    const tabs = Object.fromEntries(HUB_MODES["video-tools"].map((m) => [m.id, m.ownerOnly ?? false]));
    expect(tabs).toMatchObject({ restore: true, "remove-person": false, "remove-dialogue": false, matte: false, evolution: false, "remove-object": false });
  });
});
