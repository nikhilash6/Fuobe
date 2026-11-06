import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * The composer's Enhance button (/api/enhance) on an H3 Max look: fal's look endpoints apply their own style ("Describe the
 * scene, action, camera and sound. The … style is applied automatically.", each endpoint's prompt field), so the rewrite
 * adds no light, lens or film look of Fuobe's. Without a model, or for another model, the full rewrite stays. The AI helper
 * is off, so the offline rewrite runs. No provider is called.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-look-enhance-button-");
delete process.env.FUOBE_PASSWORD;

const { setSetting } = await import("@/server/settings");
const { POST } = await import("@/app/api/enhance/route");
setSetting("enhanceProvider", "none");

const IDEA = "A lighthouse keeper climbs a spiral stair at night, rain on the glass, a foghorn far off";
const FUOBE_LOOK = /cinematic|volumetric|depth of field|film look|realistic physics/i;
const enhance = async (body: Record<string, unknown>) =>
  ((await (await POST(new Request("http://localhost/api/enhance", { method: "POST", body: JSON.stringify({ prompt: IDEA, kind: "video", ...body }) }))).json()) as { prompt: string }).prompt;

describe("the Enhance button on an H3 Max look", () => {
  it.each(["minimax-h3-max-look-pixel", "minimax-h3-max-look-vhs"])("%s: no light, lens or film look of Fuobe's", async (modelId) => {
    for (const op of ["t2v", "i2v"]) {
      const p = await enhance({ op, modelId });
      expect(p.startsWith(IDEA)).toBe(true);
      expect(p).not.toMatch(FUOBE_LOOK);
    }
  });

  it("another model, or none, keeps the full rewrite", async () => {
    expect(await enhance({ op: "t2v", modelId: "minimax-h3" })).toMatch(/24fps film look/);
    expect(await enhance({ op: "t2v" })).toMatch(/24fps film look/);
  });
});
