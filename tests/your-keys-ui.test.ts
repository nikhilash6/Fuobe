import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { accountEngine, addKeyLabel, billedTo, needsKey, paidThrough, startingModel, type KeyStatus } from "@/lib/your-keys";

/** Your keys in the studios: which paid models an account can run, who pays, and what the engine switch says. */
const account = (keys: ("fal" | "replicate")[], o: { gpu?: boolean; paidAllowed?: boolean } = {}): KeyStatus => ({
  viewer: { kind: "account", gpu: { connected: !!o.gpu }, keys, paidAllowed: o.paidAllowed ?? true },
});
const owner: KeyStatus = {};
const guest: KeyStatus = { viewer: { kind: "guest", gpu: { connected: false } } };

const nanoPro = getModel("nano-banana-pro")!; // fal.ai and Replicate
const imagen = getModel("imagen-4")!; // Replicate only
const nano2 = getModel("nano-banana-2")!; // fal.ai only
const open = { id: "oss", engine: "open", routes: [{ provider: "comfyui" }] };

describe("which paid models an account can run", () => {
  it("dims a paid model none of whose providers it has a key for, and names them (fal.ai first)", () => {
    expect(needsKey(nanoPro, account([]))).toEqual(["fal", "replicate"]);
    expect(needsKey(nanoPro, account(["replicate"]))).toBeNull();
    expect(needsKey(imagen, account(["fal"]))).toEqual(["replicate"]);
    expect(needsKey(nano2, account(["replicate"]))).toEqual(["fal"]);
    expect(needsKey(nano2, account(["fal"]))).toBeNull();
  });

  it("never dims open models, or anything for the owner or a guest", () => {
    expect(needsKey(open, account([]))).toBeNull();
    expect(needsKey(nanoPro, owner)).toBeNull();
    expect(needsKey(nanoPro, guest)).toBeNull();
    expect(needsKey(undefined, account([]))).toBeNull();
  });

  it("says who pays: the first provider that serves it and has the account's key", () => {
    expect(paidThrough(nanoPro, account(["fal", "replicate"]))).toBe("fal");
    expect(paidThrough(nanoPro, account(["replicate"]))).toBe("replicate");
    expect(paidThrough(imagen, account(["fal"]))).toBeNull();
    expect(paidThrough(nanoPro, owner)).toBeNull();
    expect(paidThrough(open, account(["fal"]))).toBeNull();
    expect(billedTo("fal")).toBe("your fal.ai account");
    expect(addKeyLabel("replicate")).toBe("Add your Replicate key");
  });

  it("starts a studio on a model the account can run; the default when it can", () => {
    const list = [nano2, nanoPro, imagen];
    expect(startingModel("nano-banana-2", list, account(["fal"]))).toBe("nano-banana-2");
    expect(startingModel("nano-banana-2", list, account(["replicate"]))).toBe("nano-banana-pro");
    expect(startingModel("nano-banana-2", list, owner)).toBe("nano-banana-2");
    // Nothing it can run: the default stays (Generate then asks for the key).
    expect(startingModel("nano-banana-2", [nano2], account(["replicate"]))).toBe("nano-banana-2");
  });
});

describe("the engine switch for an account", () => {
  it("is locked on open source without a key, pointing at Your keys", () => {
    expect(accountEngine(account([]))).toEqual({
      locked: { text: "Open source only", tip: "Your runs use your own GPU. Add a fal.ai or Replicate key to use paid models.", href: "/settings#your-keys", addKey: true },
    });
  });

  it("is locked when the studio runs open-source models only, saying so", () => {
    expect(accountEngine(account(["fal"], { paidAllowed: false }))).toMatchObject({ locked: { tip: "This studio runs open-source models only." } });
  });

  it("switches with a key, saying who pays and where open models run", () => {
    expect(accountEngine(account(["fal"]))).toEqual({ tips: { cloud: "Paid models, billed to your fal.ai account", open: "Open models on your own GPU. Connect it first" } });
    expect(accountEngine(account(["fal", "replicate"], { gpu: true }))).toEqual({
      tips: { cloud: "Paid models, billed to your fal.ai and Replicate accounts", open: "Open models on your own GPU" },
    });
  });

  it("leaves the owner's and a guest's switch to Settings → Engine mode", () => {
    expect(accountEngine(owner)).toBeNull();
    expect(accountEngine(guest)).toBeNull();
  });
});
