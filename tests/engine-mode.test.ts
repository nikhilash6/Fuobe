import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// Isolated database for this file (must be set before the server modules load).
const dir = tempDir("fuobe-test-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here → open models fall back to demo

const { setSetting, getSetting, validateSetting } = await import("@/server/settings");
const { chooseRoute, createGenerations, previewGeneration } = await import("@/server/generations");
const { getModel } = await import("@/lib/catalog");

beforeAll(() => setSetting("demoMode", "auto"));

describe("engine mode", () => {
  it("defaults to both and rejects invalid values", () => {
    expect(getSetting("engineMode")).toBe("both");
    expect(() => validateSetting("engineMode", "gpu")).toThrow(/both, open, cloud/);
    expect(() => setSetting("cloudProvider", "openai")).toThrow();
  });

  it("open-source-only blocks paid models on the server", () => {
    setSetting("engineMode", "open");
    expect(() => createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "x" })).toThrow(/isn't available here/);
    const [g] = createGenerations({ feature: "image", modelId: "oss-z-image-turbo", prompt: "x" });
    expect(g.engine).toBe("open");
  });

  it("paid-only blocks open models", () => {
    setSetting("engineMode", "cloud");
    expect(() => createGenerations({ feature: "image", modelId: "oss-z-image-turbo", prompt: "x" })).toThrow(/isn't available here/);
    setSetting("engineMode", "both");
  });
});

describe("preferred cloud provider", () => {
  it("orders routes by the preferred aggregator when both are configured", () => {
    setSetting("falKey", "fal_test_key_123456");
    setSetting("replicateToken", "r8_test_token_123456");
    const routes = getModel("nano-banana-pro")!.routes.filter((r) => r.op === "t2i");
    expect(chooseRoute(routes).route.provider).toBe("fal");
    setSetting("cloudProvider", "replicate");
    expect(chooseRoute(routes).route.provider).toBe("replicate");
    setSetting("cloudProvider", "auto");
    setSetting("falKey", "");
    expect(chooseRoute(routes).route.provider).toBe("replicate");
    setSetting("replicateToken", "");
    expect(chooseRoute(routes)).toMatchObject({ demo: true });
  });
});

describe("routes that take fewer images or can't batch", () => {
  const edit = () => getModel("grok-imagine-image-2")!.routes.filter((r) => r.op === "edit");

  it("says when a run sends more images than the model's only route takes", () => {
    setSetting("falKey", "fal_test_key_123456");
    expect(chooseRoute(edit(), 3).route.provider).toBe("fal");
    expect(() => chooseRoute(edit(), 8)).toThrow("This model takes up to 5 images on fal.ai — remove some");
    setSetting("falKey", "");
  });

  it("runs one job per take on a route without a batch count", () => {
    setSetting("replicateToken", "r8_test_token_123456");
    const req = { feature: "image", modelId: "nano-banana-pro", prompt: "a fox", params: { numOutputs: 4 } };
    expect(previewGeneration(req)).toMatchObject({ providerId: "replicate", jobs: 4, outputs: 4 });
    setSetting("falKey", "fal_test_key_123456");
    expect(previewGeneration(req)).toMatchObject({ providerId: "fal", jobs: 1, outputs: 4 });
    setSetting("falKey", "");
    setSetting("replicateToken", "");
  });
});
