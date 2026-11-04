import { describe, expect, it } from "vitest";
import { checkedPool, IN_BROWSER, mainModel, placePrice, runPlace, type RunPlaceInput } from "@/lib/run-place";

/** Where a run happens and what it costs, for each audience and engine (the composers' place chip and send button). */
const fmt = (usd: number) => `$${usd.toFixed(2)}`;
const at = (o: Partial<RunPlaceInput> & Pick<RunPlaceInput, "audience" | "engine">) => runPlace({ format: fmt, ...o });
const AUDIENCES = ["owner", "account", "guest"] as const;

describe("the price's words", () => {
  it("says free on the open engine, even before the run is priced", () => {
    expect(placePrice({ open: true }, fmt)).toBe("Free");
    expect(placePrice({ open: true, costUsd: 0 }, fmt)).toBe("Free");
  });
  it("prices the cloud, says when no price is published, and nothing while pricing", () => {
    expect(placePrice({ open: false, costUsd: 0.04 }, fmt)).toBe("≈ $0.04");
    expect(placePrice({ open: false, costUsd: null }, fmt)).toBe("Price unknown");
    expect(placePrice({ open: false }, fmt)).toBe("");
  });
  it("says placeholder results are free stand-ins on either engine", () => {
    expect(placePrice({ open: false, demo: true, costUsd: 0.4 }, fmt)).toBe("Placeholder · free");
    expect(placePrice({ open: true, demo: true }, fmt)).toBe("Placeholder · free");
  });
});

describe("the owner", () => {
  it("runs open models on its own GPU, free", () => {
    const p = at({ audience: "owner", engine: "open", models: ["Qwen Image 2.1", "Qwen Image 2.1"], costUsd: 0 });
    expect(p).toMatchObject({ where: "gpu", label: "Your GPU", price: "Free", title: "Runs on your GPU", send: "Free · your GPU" });
    expect(p.tip).toBe("Runs on your own GPU with Qwen Image 2.1. Free.");
    expect(p.needs).toBeUndefined();
  });
  it("runs paid models in the cloud, named by the main model, billed to its key", () => {
    const p = at({ audience: "owner", engine: "cloud", models: ["GPT-5 mini", "Nano Banana Pro"], model: "Nano Banana Pro", costUsd: 0.15 });
    expect(p).toMatchObject({ where: "cloud", label: "Nano Banana Pro", price: "≈ $0.15", send: "≈ $0.15 · cloud" });
    expect(p.tip).toBe("Runs in the cloud with GPT-5 mini and Nano Banana Pro. Estimated cost, billed by the provider to your key.");
  });
  it("names the cloud before the run is priced, and the first model when no main one is given", () => {
    // Not priced and no model known: "Cloud" on the chip, nothing after the button's name, no model for the screen reader.
    const bare = at({ audience: "owner", engine: "cloud" });
    expect(bare).toMatchObject({ label: "Cloud", price: "", send: "" });
    expect(bare.model).toBeUndefined();
    expect(at({ audience: "owner", engine: "cloud", model: "Seedance 2.5" })).toMatchObject({ label: "Seedance 2.5", model: "Seedance 2.5", send: "" });
    expect(at({ audience: "account", engine: "cloud", model: "Seedance 2.5" })).toMatchObject({ needs: "key", send: "add your key" });
    expect(at({ audience: "owner", engine: "cloud", models: ["Kling 2.5"] }).label).toBe("Kling 2.5");
  });
  it("says placeholder results are free stand-ins", () => {
    const p = at({ audience: "owner", engine: "cloud", models: ["Nano Banana Pro"], costUsd: 0.15, demo: true });
    expect(p).toMatchObject({ price: "Placeholder · free", send: "Placeholder · free" });
    expect(p.tip).toMatch(/Placeholder results are on/);
  });
  it("runs a tool that is the owner's alone", () => {
    expect(at({ audience: "owner", engine: "open", ownerOnly: "Marketing Studio" }).where).toBe("gpu");
    expect(at({ audience: "owner", engine: "cloud", ownerOnly: "Marketing Studio", costUsd: 0.04 }).price).toBe("≈ $0.04");
  });
});

describe("an account", () => {
  it("with its own GPU: free on it", () => {
    const p = at({ audience: "account", engine: "open", gpu: true });
    expect(p).toMatchObject({ where: "gpu", price: "Free", send: "Free · your GPU" });
    expect(p.needs).toBeUndefined();
  });
  it("without one: still free, and connects its GPU first", () => {
    const p = at({ audience: "account", engine: "open", gpu: false });
    expect(p).toMatchObject({ where: "gpu", price: "Free", needs: "gpu", send: "Free · connect your GPU first" });
    expect(p.tip).toMatch(/Connect your GPU to run it\.$/);
  });
  it("with a key: the cloud's price, billed to its own provider account", () => {
    const p = at({ audience: "account", engine: "cloud", models: ["Nano Banana Pro"], costUsd: 0.15, payer: "fal" });
    expect(p).toMatchObject({ where: "cloud", price: "≈ $0.15", send: "≈ $0.15 · cloud" });
    expect(p.tip).toBe("Runs in the cloud with Nano Banana Pro. Estimated cost, billed to your fal.ai account.");
    expect(p.needs).toBeUndefined();
  });
  it("without a key: adds one first, never billed to the studio", () => {
    const p = at({ audience: "account", engine: "cloud", models: ["Nano Banana Pro"], costUsd: 0.15, payer: null });
    expect(p).toMatchObject({ needs: "key", send: "≈ $0.15 · add your key" });
    expect(p.tip).toMatch(/your own fal\.ai or Replicate account: add your key in Settings → Your keys\.$/);
  });
});

describe("a guest", () => {
  it("is told to sign up before a run on its GPU, never a bare free", () => {
    const p = at({ audience: "guest", engine: "open" });
    expect(p).toMatchObject({ where: "gpu", needs: "signup", send: "Free · your GPU, after sign-up" });
    expect(p.tip).toMatch(/Create a free account and connect your GPU to run it\.$/);
  });
  it("is told a cloud run is billed to its own key, after sign-up", () => {
    const p = at({ audience: "guest", engine: "cloud", models: ["Nano Banana Pro"], costUsd: 0.15 });
    expect(p).toMatchObject({ where: "cloud", needs: "signup", send: "≈ $0.15 · cloud, after sign-up" });
    expect(p.tip).toMatch(/your own fal\.ai or Replicate account: create a free account and add your key to run it\.$/);
  });
});

describe("hosted runs (this studio's GPUs)", () => {
  it("an account with no GPU runs open models there, at the quoted price", () => {
    const p = at({ audience: "account", engine: "open", hosted: true, gpu: false, models: ["Tap to Recolor"], pool: { text: "$0.02" } });
    expect(p).toMatchObject({ where: "pool", label: "This studio's GPUs", price: "$0.02", title: "Runs on this studio's GPUs", send: "$0.02 · this studio's GPUs" });
    expect(p.tip).toBe("Runs on this studio's GPUs with Tap to Recolor.");
    expect(p.needs).toBeUndefined();
  });
  it("says the service's own words, free when it quotes no price, and nothing while pricing", () => {
    expect(at({ audience: "account", engine: "open", hosted: true, pool: { text: "", sub: "Included in your plan" } })).toMatchObject({ price: "Free", tip: "Included in your plan" });
    expect(at({ audience: "account", engine: "open", hosted: true })).toMatchObject({ where: "pool", price: "", send: "this studio's GPUs" });
  });
  it("an account with its own GPU still runs there, free; the owner always on its own", () => {
    expect(at({ audience: "account", engine: "open", hosted: true, gpu: true }).where).toBe("gpu");
    expect(at({ audience: "owner", engine: "open", hosted: true }).where).toBe("gpu");
  });
  it("with the studio's GPUs first, an account with its own GPU runs on the studio's; the owner still on its own", () => {
    expect(at({ audience: "account", engine: "open", hosted: true, gpu: true, preferPool: true }).where).toBe("pool");
    expect(at({ audience: "owner", engine: "open", hosted: true, preferPool: true }).where).toBe("gpu");
  });
  it("a guest signs up first", () => {
    const p = at({ audience: "guest", engine: "open", hosted: true });
    expect(p).toMatchObject({ where: "pool", needs: "signup", send: "this studio's GPUs, after sign-up" });
    expect(p.tip).toMatch(/Create a free account to run it.$/);
  });
  it("leaves the cloud and the owner's tools as they are", () => {
    expect(at({ audience: "account", engine: "cloud", hosted: true, payer: "fal", costUsd: 0.1 }).where).toBe("cloud");
    expect(at({ audience: "account", engine: "open", hosted: true, ownerOnly: "Ads Studio" }).where).toBe("unavailable");
  });
});

describe("a tool that runs for the owner only (the Marketing suite)", () => {
  for (const audience of ["account", "guest"] as const)
    for (const engine of ["open", "cloud"] as const)
      it(`tells ${audience === "account" ? "an account" : "a guest"} on ${engine} it isn't available here, with no price`, () => {
        const p = at({ audience, engine, ownerOnly: "Click to Ad", costUsd: 0, gpu: true, payer: "fal" });
        expect(p).toMatchObject({ where: "unavailable", label: "Not available here", price: "", send: "" });
        expect(p.tip).toBe("Click to Ad isn't available here. Try the Image, Video or Audio studio.");
        expect(p.needs).toBeUndefined();
      });
});

describe("a Kinetic template", () => {
  it("is the shared in-browser place", () => {
    expect(IN_BROWSER).toMatchObject({ where: "browser", label: "Your browser", price: "Free" });
  });
  it("runs in the browser, instant and free, for everyone (owner-only tools included)", () => {
    for (const audience of AUDIENCES) {
      const p = at({ audience, engine: "browser", ownerOnly: "Marketing Studio" });
      expect(p).toMatchObject({ where: "browser", label: "Your browser", price: "Free", title: "Runs in your browser", send: "Free · in your browser" });
      expect(p.tip).toMatch(/instantly and free/);
      expect(p.needs).toBeUndefined();
    }
  });
});

describe("no audience is told a run is free when it isn't", () => {
  it("a priced cloud run never reads free", () => {
    for (const audience of AUDIENCES) {
      const p = at({ audience, engine: "cloud", models: ["Kling 2.5"], costUsd: 0.7, payer: "fal" });
      expect(p.price).toBe("≈ $0.70");
      expect(p.send).not.toMatch(/free/i);
    }
  });
  it("the place's words hold no internal terms", () => {
    for (const audience of AUDIENCES)
      for (const engine of ["open", "cloud", "browser"] as const)
        for (const ownerOnly of [undefined, "Ad Multiplier"]) {
          for (const hosted of [false, true]) {
            const p = at({ audience, engine, ownerOnly, hosted, models: ["Kling 2.5"], costUsd: 0.7 });
            expect(`${p.label} ${p.price} ${p.title} ${p.tip} ${p.send}`).not.toMatch(/self-host|comfy|demo mode|pool|tenant|engine mode|hosted/i);
          }
          const p = at({ audience, engine, ownerOnly, models: ["Kling 2.5"], costUsd: 0.7 });
          expect(`${p.label} ${p.price} ${p.title} ${p.tip} ${p.send}`).not.toMatch(/self-host|comfy|demo mode|pool|tenant|engine mode/i);
        }
  });
});

describe("the main model of a pipeline", () => {
  it("is its costliest step, the first on a tie", () => {
    expect(
      mainModel([
        { modelName: "GPT-5 mini", costUsd: 0.001 },
        { modelName: "Kling 2.5", costUsd: 0.7 },
        { modelName: "ElevenLabs", costUsd: 0.05 },
      ]),
    ).toBe("Kling 2.5");
    expect(
      mainModel([
        { modelName: "Qwen Image 2.1", costUsd: 0 },
        { modelName: "Wan 2.2", costUsd: 0 },
      ]),
    ).toBe("Qwen Image 2.1");
    expect(mainModel([{ modelName: "Join", costUsd: null }, { modelName: "Seedance", costUsd: 0.2 }])).toBe("Seedance");
    expect(mainModel([])).toBeUndefined();
    expect(mainModel(undefined)).toBeUndefined();
  });
});

describe("checkedPool", () => {
  it("is this studio's GPUs only when the price check says the run goes there", () => {
    expect(checkedPool({ place: "pool", quote: { text: "$0.02", sub: "Billed to your balance" } })).toEqual({ text: "$0.02", sub: "Billed to your balance" });
    expect(checkedPool({ place: "pool", quote: { text: "$0.02" } }, 3)).toEqual({ text: "$0.02 each" });
    expect(checkedPool({ place: "pool", quote: { text: "" } }, 3)).toEqual({ text: "" });
  });
  it("is nothing before the check, for a model not offered there, or for a run on the viewer's own GPU or key", () => {
    expect(checkedPool(undefined)).toBeUndefined();
    expect(checkedPool(null)).toBeUndefined();
    expect(checkedPool({})).toBeUndefined();
    expect(checkedPool({ place: "pool" })).toBeUndefined();
  });
  it("leaves an account with no GPU on your GPU (connect it) when the check finds no place there", () => {
    const pool = checkedPool({});
    const p = runPlace({ audience: "account", engine: "open", hosted: !!pool, gpu: false, pool, format: (n) => `$${n.toFixed(2)}` });
    expect(p).toMatchObject({ where: "gpu", label: "Your GPU", needs: "gpu" });
  });
});
