import { afterAll, afterEach, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Placeholder results are opt-in: off by default on every install, hosted or local, so a run with nothing connected is
 * refused with the connect card's marker instead of silently making a placeholder. A saved "auto" (the old default)
 * becomes off, a saved "on" stays. While on, every run makes a labelled placeholder.
 */

const dir = tempDir("fuobe-placeholders-");

process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here
delete process.env.FUOBE_DEMO_MODE;
delete process.env.FAL_KEY;
delete process.env.REPLICATE_API_TOKEN;

const { getSetting, setSetting, validateSetting, publicSettings } = await import("@/server/settings");
const { db } = await import("@/server/db");
const { chooseRoute, ConnectComfyError } = await import("@/server/generations");
const { getModel, MODELS } = await import("@/lib/catalog");
const { placeholderActions, placeholderLine, placeholdersOn, isPlaceholder, PLACEHOLDER_SETTING, PLACEHOLDER_CHIP, PLACEHOLDERS_ON } = await import("@/lib/demo-mode");
const { startLine } = await import("@/lib/connections");
const settingsRoute = await import("@/app/api/settings/route");

const put = (body: Record<string, string>) =>
  settingsRoute.PUT(new Request("http://localhost/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** Open the database again, as a restart does (db.ts clears a saved "auto" on every open). */
function restart() {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
  db();
}
const saved = () => (db().prepare("SELECT value FROM settings WHERE key = 'demo.mode'").get() as { value: string } | undefined)?.value;

afterEach(() => {
  delete process.env.FUOBE_DEMO_MODE;
  setSetting("demoMode", "");
});
afterAll(() => {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
});

describe("the setting", () => {
  it("is off on a fresh install, and only off or on can be saved", () => {
    expect(getSetting("demoMode")).toBe("off");
    expect(publicSettings().find((s) => s.name === "demoMode")).toMatchObject({ value: "off", isSet: false });
    // The Settings API takes off or on only; "auto" stays for code in this process (the test suite mixes routes with it).
    expect(() => validateSetting("demoMode", "auto", "api")).toThrow("demoMode must be one of: off, on");
    expect(() => validateSetting("demoMode", "auto")).not.toThrow();
    setSetting("demoMode", "on");
    expect(getSetting("demoMode")).toBe("on");
  });

  it("a saved auto (the old default) is cleared on start, so the install runs with placeholders off", () => {
    db().prepare("INSERT INTO settings (key, value) VALUES ('demo.mode', 'auto') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    restart();
    expect(saved()).toBeUndefined();
    expect(getSetting("demoMode")).toBe("off");
  });

  it("Settings saves on or off, and refuses auto", async () => {
    const refused = await put({ demoMode: "auto" });
    expect(refused.status).toBe(400);
    expect(saved()).toBeUndefined();
    expect((await put({ demoMode: "on" })).status).toBe(200);
    expect(getSetting("demoMode")).toBe("on");
    expect((await put({ demoMode: "off" })).status).toBe(200);
    expect(getSetting("demoMode")).toBe("off");
  });

  it("a saved on stays on through a restart", () => {
    setSetting("demoMode", "on");
    restart();
    expect(saved()).toBe("on");
    expect(getSetting("demoMode")).toBe("on");
  });

  it("FUOBE_DEMO_MODE=auto reads as off too; FUOBE_DEMO_MODE=on turns placeholders on", () => {
    process.env.FUOBE_DEMO_MODE = "auto";
    expect(getSetting("demoMode")).toBe("off");
    process.env.FUOBE_DEMO_MODE = "on";
    expect(getSetting("demoMode")).toBe("on");
  });
});

describe("a run with nothing connected", () => {
  const routesOf = (id: string) => getModel(id)!.routes;
  const refusal = (id: string) => {
    try {
      chooseRoute(routesOf(id));
    } catch (e) {
      return e;
    }
    throw new Error(`${id} ran`);
  };

  it("is refused with what would run it, never a silent placeholder", () => {
    const open = refusal("oss-z-image-turbo");
    expect(open).toBeInstanceOf(ConnectComfyError);
    expect(open).toMatchObject({ needs: "gpu", message: "Connect ComfyUI in Settings to run this model" });
    const paid = refusal("nano-banana-pro");
    expect(paid).toBeInstanceOf(ConnectComfyError);
    expect((paid as InstanceType<typeof ConnectComfyError>).needs).toBe("key");
    // A model on both engines: either way runs it.
    const both = MODELS.find((m) => m.routes.some((r) => r.provider === "comfyui") && m.routes.some((r) => r.provider === "fal"));
    if (both) expect((refusal(both.id) as InstanceType<typeof ConnectComfyError>).needs).toBe("any");
  });

  it("makes a placeholder only with the switch on, or when the request asks for a dry run", () => {
    expect(chooseRoute(routesOf("oss-z-image-turbo"), 0, [], undefined, true).demo).toBe(true);
    setSetting("demoMode", "on");
    expect(chooseRoute(routesOf("oss-z-image-turbo")).demo).toBe(true);
    expect(chooseRoute(routesOf("nano-banana-pro")).demo).toBe(true);
  });
});

describe("words and ways out", () => {
  it("names the switch, the sidebar chip and the result chip", () => {
    expect(PLACEHOLDER_SETTING).toBe("Show placeholder results (for a tour)");
    expect(PLACEHOLDERS_ON).toBe("Placeholders on");
    expect(PLACEHOLDER_CHIP).toBe("Placeholder");
  });

  it("is on only for on", () => {
    expect(placeholdersOn("on")).toBe(true);
    for (const v of ["off", "auto", "", undefined]) expect(placeholdersOn(v)).toBe(false);
  });

  it("labels a result the demo provider made, and nothing else", () => {
    expect(isPlaceholder({ provider: "mock" })).toBe(true);
    expect(isPlaceholder({ provider: "comfyui" })).toBe(false);
    expect(isPlaceholder(null)).toBe(false);
  });

  it("offers the owner the ComfyUI on this computer, a key, and the switch off while it's on; nobody else anything", () => {
    expect(placeholderActions({ owner: true, engineMode: "both", demoMode: "on" })).toEqual(["computer", "key", "off"]);
    expect(placeholderActions({ owner: true, engineMode: "both", demoMode: "off" })).toEqual(["computer", "key"]);
    expect(placeholderActions({ owner: true, engineMode: "open", demoMode: "on" })).toEqual(["computer", "off"]);
    expect(placeholderActions({ owner: true, engineMode: "cloud", demoMode: "on" })).toEqual(["key", "off"]);
    expect(placeholderActions({ owner: false, engineMode: "both", demoMode: "on" })).toEqual([]);
    expect(placeholderLine("on")).toMatch(/Placeholder results are on in Settings/);
    expect(placeholderLine("off")).toMatch(/Connect a model and run it again/);
  });

  it("Home's Start line never promises a free demo while the switch is off", () => {
    const quote = { cloud: { name: "Nano Banana Pro", price: "$0.15", providers: ["fal"] }, open: { name: "Z-Image Turbo", providers: ["comfyui"] } };
    const state = (demoMode: string) => ({ providers: { replicate: { configured: true } }, engineMode: "both" as const, demoMode });
    expect(startLine(state("off"), quote, "cloud", "image")?.text).toBe("Nano Banana Pro needs a fal.ai key, so Start can't run it yet");
    expect(startLine(state("on"), quote, "cloud", "image")?.text).toBe("Placeholder results are on (Settings), so Start makes a stand-in");
  });
});
