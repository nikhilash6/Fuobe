import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chooseMaker, makersFor } from "@/lib/catalog/genjutsu";
import { MOTION_MODELS } from "@/lib/av/katana";
import { chooseEraser, erasersFor } from "@/lib/catalog/remove-object";
import { SHORTS_MODELS } from "@/lib/catalog/shorts";
import { TOOL_MODELS } from "@/lib/layers";
import { keepOffered, offered } from "@/lib/model-access";

/**
 * Settings → Models & licences in the studios with their own model menus (Genjutsu, Remove object, Shorts, Layers,
 * Katana, Marketing's Ad Multiplier, Faceless): a model switched off leaves the menu, and a default that is off
 * gives way to the next one that is on, in the browser (keepOffered + offered) as on the server (firstOn, isOffered).
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-access-studios-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
const { changeAccess, firstOn, isOffered } = await import("@/server/model-access");
const { toolModel } = await import("@/server/layers");
const { planKatana } = await import("@/server/katana");
const { multiplierModel } = await import("@/server/marketing");
const { withOfferedMusic, withOfferedVideo } = await import("@/server/faceless");
const { setSetting } = await import("@/server/settings");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  changeAccess([{ kind: "reset" }]);
  setSetting("engineMode", "both");
  setSetting("demoMode", "on");
});

describe("a studio's own model menu", () => {
  it("keeps the choices that are on, and all of them when none is (a run then names the switch)", () => {
    const summary = { off: ["a", "b"] };
    expect(keepOffered(["a", "b", "c"], (id) => offered(summary, id))).toEqual(["c"]);
    expect(keepOffered(["a", "b"], (id) => offered(summary, id))).toEqual(["a", "b"]);
    expect(keepOffered(["a"], (id) => offered(undefined, id))).toEqual(["a"]);
  });

  it("Genjutsu and Remove object pick past a model that is off", () => {
    const motion = makersFor("cloud", "motion");
    expect(motion.length).toBeGreaterThan(1);
    const first = chooseMaker({ engine: "cloud", mode: "motion" });
    expect("maker" in first).toBe(true);
    const firstId = "maker" in first ? first.maker.id : "";
    const next = chooseMaker({ engine: "cloud", mode: "motion", offered: (id) => id !== firstId });
    expect("maker" in next && next.maker.id).not.toBe(firstId);
    // An explicit pick that is off isn't kept while another is on.
    expect(chooseMaker({ engine: "cloud", mode: "motion", modelId: firstId, offered: (id) => id !== firstId })).toMatchObject({ maker: { id: expect.not.stringMatching(firstId) } });
    // With every one off, the default stays: its run names the switch.
    expect(chooseMaker({ engine: "cloud", mode: "motion", offered: () => false })).toMatchObject({ maker: { id: firstId } });

    const eraser = chooseEraser({ engine: "cloud", mode: "type" });
    const eraserId = "eraser" in eraser ? eraser.eraser.id : "";
    expect(erasersFor("cloud", "type").length).toBeGreaterThan(1);
    const other = chooseEraser({ engine: "cloud", mode: "type", offered: (id) => id !== eraserId });
    expect("eraser" in other && other.eraser.id).not.toBe(eraserId);
    expect(chooseEraser({ engine: "cloud", mode: "type", offered: () => false })).toMatchObject({ eraser: { id: eraserId } });
  });
});

describe("a studio's default on the server", () => {
  it("is the first model that is on (Shorts, Layers, Katana), else the first", () => {
    expect(firstOn(SHORTS_MODELS.cloud, "cloud")).toBe(SHORTS_MODELS.cloud[0]);
    changeAccess([{ kind: "model", id: SHORTS_MODELS.cloud[0], on: false }]);
    expect(firstOn(SHORTS_MODELS.cloud, "cloud")).toBe(SHORTS_MODELS.cloud[1]);

    const [seedream, flash] = TOOL_MODELS.decompose.cloud;
    expect(toolModel("decompose", "cloud").id).toBe(seedream);
    changeAccess([{ kind: "model", id: seedream, on: false }]);
    expect(toolModel("decompose", "cloud").id).toBe(flash);
    // A model asked for by name is the caller's choice: it runs (or is refused) as it is.
    expect(toolModel("decompose", "cloud", seedream).id).toBe(seedream);

    const [kling, next] = MOTION_MODELS.cloud;
    const katana = { engine: "cloud" as const, reference: "/api/files/ref.mp4", duration: 8, photos: ["/api/files/me.png"] };
    expect(planKatana(katana).input.motionModel).toBe(kling.id);
    changeAccess([{ kind: "model", id: kling.id, on: false }]);
    expect(planKatana(katana).input.motionModel).toBe(next.id);
    expect(isOffered(kling.id, "cloud")).toBe(false);
  });

  it("Ad Multiplier and Faceless fall back past a switched-off default", () => {
    expect(multiplierModel({ engine: "cloud" }).id).toBe("kling-o3");
    changeAccess([{ kind: "model", id: "kling-o3", on: false }]);
    expect(multiplierModel({ engine: "cloud" }).id).not.toBe("kling-o3");

    const settings = { engine: "cloud" as const, animation: "animated" } as Parameters<typeof withOfferedVideo>[0];
    expect(withOfferedVideo(settings)).toBe(settings);
    changeAccess([{ kind: "model", id: "gemini-omni-flash", on: false }]);
    expect(withOfferedVideo(settings).videoModel).toBe("minimax-h3");
    // A pick stays the pick.
    expect(withOfferedVideo({ ...settings, videoModel: "gemini-omni-flash" }).videoModel).toBe("gemini-omni-flash");
  });

  it("Faceless's music bed gives way when the one picked is switched off, as its picker shows", () => {
    const settings = { engine: "cloud" as const, animation: "animated", music: true, musicModel: "minimax-music-3" } as Parameters<typeof withOfferedMusic>[0];
    expect(withOfferedMusic(settings)).toBe(settings);
    changeAccess([{ kind: "model", id: "minimax-music-3", on: false }]);
    expect(withOfferedMusic(settings).musicModel).toBe("sonilo-music");
    changeAccess([{ kind: "model", id: "sonilo-music", on: false }]);
    expect(withOfferedMusic(settings).musicModel).toBe("elevenlabs-music-2-5");
    // No bed, nothing to change.
    expect(withOfferedMusic({ ...settings, music: false })).toEqual({ ...settings, music: false });
  });
});
