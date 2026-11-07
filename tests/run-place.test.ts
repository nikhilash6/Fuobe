import { describe, expect, it } from "vitest";
import { placeOf } from "@/lib/place-name";
import { quoteBody } from "@/lib/hosted";
import { barRuns, checkedPool, composerOnPool, composerPlace, IN_BROWSER, keyOnlyChip, mainModel, openCheckPlace, placePrice, placeRows, refusedBeforeRun, retryRequest, runPlace, toolPoolPrice, withPoolRefusal, type RunPlaceInput } from "@/lib/run-place";
import { RUN_SHOWN_HEADER, shownHeader } from "@/lib/guest-access";

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
    expect(p).toMatchObject({ where: "pool", label: "Our GPUs", price: "$0.02", title: "Runs on our GPUs", send: "$0.02" });
    expect(p.tip).toBe("Runs on our GPUs with Tap to Recolor.");
    expect(p.needs).toBeUndefined();
  });
  it("says the place by the name it is given, with no verb that has to agree with it", () => {
    const p = at({ audience: "account", engine: "open", hosted: true, models: ["Z-Image Turbo"], pool: { text: "" }, place: placeOf("Ana's render box") });
    expect(p).toMatchObject({ label: "Ana's render box", title: "Runs on Ana's render box", price: "Free", send: "Free" });
    expect(p.tip).toBe("Runs on Ana's render box with Z-Image Turbo.");
  });
  it("says the service's own words, free when it quotes no price, and nothing while pricing", () => {
    expect(at({ audience: "account", engine: "open", hosted: true, pool: { text: "", sub: "Included in your plan" } })).toMatchObject({ price: "Free", tip: "Included in your plan" });
    expect(at({ audience: "account", engine: "open", hosted: true })).toMatchObject({ where: "pool", price: "", send: "" });
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
    expect(p).toMatchObject({ where: "pool", needs: "signup", send: "sign up to run" });
    expect(p.tip).toMatch(/ Free with an account\.$/);
    expect(at({ audience: "guest", engine: "open", hosted: true, pool: { text: "" } }).send).toBe("Free · sign up to run");
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

describe("where a composer's run goes, and the place it names", () => {
  it("a place picked for this run, named", () => {
    expect(composerPlace("own", undefined, false, true)).toEqual({ runOn: "own", place: "own" });
    expect(composerPlace("pool", undefined, true, false)).toEqual({ runOn: "pool", place: "pool" });
    // A one-off place wins over the remembered pick.
    expect(composerPlace("pool", "gpu", true, false)).toEqual({ runOn: "pool", place: "pool" });
    expect(composerPlace("own", "site", true, true)).toEqual({ runOn: "own", place: "own" });
  });
  it("its own GPU while online, named; this studio's GPUs when it isn't, named", () => {
    expect(composerPlace(null, undefined, true, false)).toEqual({ runOn: "own", place: "own" });
    expect(composerPlace(null, undefined, false, false)).toEqual({ runOn: "pool", place: "pool" });
    expect(composerPlace(null, undefined, false, true)).toEqual({ runOn: "pool", place: "pool" });
  });
  it("this studio's GPUs first while its own GPU is online: shown, but not named, so the server can still use its own GPU", () => {
    expect(composerPlace(null, undefined, true, true)).toEqual({ runOn: "pool", place: undefined });
  });
  it("the remembered GPU: named, online or not, whatever the studio prefers (never moved without a word)", () => {
    for (const online of [true, false]) for (const prefer of [true, false]) expect(composerPlace(null, "gpu", online, prefer)).toEqual({ runOn: "own", place: "own" });
  });
  it("the remembered studio's GPUs (or key, whose open runs come here): first, even where its own GPU would be", () => {
    for (const pick of ["site", "key"] as const) {
      expect(composerPlace(null, pick, true, false)).toEqual({ runOn: "pool", place: undefined });
      expect(composerPlace(null, pick, true, true)).toEqual({ runOn: "pool", place: undefined });
      expect(composerPlace(null, pick, false, false)).toEqual({ runOn: "pool", place: "pool" });
    }
  });
});

describe("the place a tool's price check names, with the remembered pick", () => {
  const v = { audience: "account" as const, gpu: true, hosted: true, preferPool: false };
  it("its own GPU picked: no check here (the run goes there)", () => {
    expect(openCheckPlace({ ...v, preferPool: true, runOn: "gpu" })).toBeNull();
  });
  it("this studio's GPUs or the key picked: checked with no place, so the server decides as for the run", () => {
    expect(openCheckPlace({ ...v, runOn: "site" })).toBeUndefined();
    expect(openCheckPlace({ ...v, runOn: "key" })).toBeUndefined();
  });
  it("no pick: as before", () => {
    expect(openCheckPlace(v)).toBeNull();
    expect(openCheckPlace({ ...v, preferPool: true })).toBeUndefined();
    expect(openCheckPlace({ ...v, gpu: false, runOn: "gpu" })).toBe("pool");
    expect(openCheckPlace({ ...v, hosted: false, runOn: "site" })).toBeNull();
  });
});

describe("Retry and Run on <the place> on a run's tile", () => {
  const request = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" };
  it("Retry names the place the run ran (hosted runs on), so the pick never moves it", () => {
    expect(retryRequest({ request, place: "pool" }, true)).toEqual({ ...request, place: "pool" });
    expect(retryRequest({ request }, true)).toEqual({ ...request, place: "own" });
  });
  it("hosted runs off: the request as it was", () => {
    expect(retryRequest({ request, place: "pool" }, false)).toBe(request);
    expect(retryRequest({ request }, false)).toBe(request);
  });
});

describe("the Run on list", () => {
  const account = { kind: "account" as const, hosted: true, prefer: "pool" as const, placeName: "Studio North GPUs", gpu: { connected: false } };
  const gpu = { connected: true, online: true, device: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" };
  const quote = { text: "Free", wait: "ready in about 40 s" };
  it("no control without a choice: none for a guest, hosted runs off, nothing of one's own, or an item only one's own runs", () => {
    expect(placeRows({ ...account, kind: "guest", gpu }, {}, quote)).toBeNull();
    expect(placeRows({ ...account, hosted: false, gpu }, {}, quote)).toBeNull();
    expect(placeRows(account, {}, quote)).toBeNull();
    expect(placeRows(account, { key: null }, quote)).toBeNull();
    expect(placeRows({ ...account, gpu }, { siteRuns: false }, quote)).toBeNull();
    expect(placeRows(undefined, {}, quote)).toBeNull();
  });
  it("a GPU: this studio's GPUs first and picked by default, its GPU with a green dot and its card", () => {
    expect(placeRows({ ...account, gpu }, {}, quote)).toEqual({
      on: "site",
      rows: [
        { id: "site", label: "Studio North GPUs", sub: "Free · ready in about 40 s", selected: true },
        { id: "gpu", label: "Your GPU", sub: "Free · RTX 4090", online: true, selected: false },
      ],
    });
  });
  it("a GPU that doesn't answer: said, never greyed out, and picking it stays allowed", () => {
    const r = placeRows({ ...account, runOn: "gpu", gpu: { connected: true, online: false } }, {}, quote)!;
    expect(r.on).toBe("gpu");
    expect(r.rows[1]).toEqual({ id: "gpu", label: "Your GPU", sub: "Free · not answering right now", selected: true });
  });
  it("a key that runs this item's cloud version: its price first, and who bills it", () => {
    const r = placeRows(account, { key: { provider: "fal", price: "≈ $0.04" } }, quote)!;
    expect(r.rows.map((x) => x.label)).toEqual(["Studio North GPUs", "Your fal.ai key"]);
    expect(r.rows[1].sub).toBe("≈ $0.04 · billed to your fal.ai account");
    expect(placeRows(account, { key: { provider: "replicate" } }, quote)!.rows[1]).toMatchObject({ label: "Your Replicate key", sub: "Billed to your Replicate account" });
  });
  it("the remembered key: picked on the item's cloud version; on its open version the run is here", () => {
    const keyed = { ...account, runOn: "key" as const };
    expect(placeRows(keyed, { key: { provider: "fal", price: "≈ $0.04" }, cloud: true }, quote)!.on).toBe("key");
    expect(placeRows(keyed, { key: { provider: "fal", price: "≈ $0.04" } }, quote)!.on).toBe("site");
  });
  it("the remembered key on an item with no cloud version: here this once, and the chip says why", () => {
    const r = placeRows({ ...account, runOn: "key", gpu }, { key: null }, quote)!;
    expect(r.on).toBe("site");
    expect(r.note).toBe("Runs on Studio North GPUs. This one has no cloud version.");
  });
  it("no pick on an install that puts one's own GPU first: its GPU while it answers", () => {
    expect(placeRows({ ...account, prefer: undefined, gpu }, {}, quote)!.on).toBe("gpu");
    expect(placeRows({ ...account, prefer: undefined, gpu: { connected: true, online: false } }, {}, quote)!.on).toBe("site");
  });
  it("this studio's row says Free when the check has no words yet, and the name falls back to Our GPUs", () => {
    expect(placeRows({ ...account, placeName: undefined, gpu }, {})!.rows[0]).toEqual({ id: "site", label: "Our GPUs", sub: "Free", selected: true });
  });
});

describe("the top bar's balance pill", () => {
  const account = { kind: "account" as const, hosted: true, placeName: "Fuobe Cloud", gpu: { connected: false } };
  const gpu = { connected: true, online: true, device: "NVIDIA GeForce RTX 4090" };
  it("never a bare price: the price and where the runs go, the place alone below xl, and a name that says what it does", () => {
    const r = barRuns(account, "Free");
    expect(r).toMatchObject({ on: "site", text: "Free · Fuobe Cloud", short: "Fuobe Cloud", tip: "Where your runs go: Free on Fuobe Cloud", rows: null });
    expect(barRuns(account, "3 runs left", "refills in 5 h").tip).toBe("Where your runs go: 3 runs left on Fuobe Cloud, refills in 5 h");
    // The default name reads lower case inside a sentence.
    expect(barRuns({ ...account, placeName: undefined }, "Free")).toMatchObject({ text: "Free · Our GPUs", tip: "Where your runs go: Free on our GPUs" });
  });
  it("an account's own GPU or key when its runs go there, with the Run on rows to change it", () => {
    const own = barRuns({ ...account, gpu, runOn: "gpu" }, "Free", "refills in 5 h");
    expect(own).toMatchObject({ on: "gpu", text: "Free · Your GPU", short: "Your GPU", tip: "Where your runs go: Free on your GPU" });
    expect(own.rows?.map((r) => [r.id, r.selected])).toEqual([
      ["site", false],
      ["gpu", true],
    ]);
    const keyed = barRuns({ ...account, keys: ["replicate", "fal"], runOn: "key" }, "Free");
    expect(keyed).toMatchObject({ on: "key", key: "fal", text: "Your fal.ai key", tip: "Where your runs go: your fal.ai key" });
    expect(barRuns({ ...account, keys: ["replicate", "fal"], runKey: "replicate", runOn: "key" }, "Free").text).toBe("Your Replicate key");
    // A studio with paid models off takes no keys: its runs stay here.
    expect(barRuns({ ...account, keys: ["fal"], runOn: "key", paidAllowed: false }, "Free")).toMatchObject({ on: "site", rows: null });
  });
  it("hosted runs off for the account: the chip as the service says it", () => {
    expect(barRuns({ ...account, hosted: false }, "Free")).toMatchObject({ text: "Free", short: "Free", rows: null });
  });
});

describe("the price check asks with the place the run names", () => {
  const req = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" };
  it("named: with it; named none (the server decides): with none, so the answer is where the run would really go", () => {
    expect(JSON.parse(quoteBody(req, "pool")!)).toEqual({ ...req, place: "pool" });
    expect(JSON.parse(quoteBody(req, undefined)!)).toEqual(req);
    expect(quoteBody(null, "pool")).toBeNull();
  });

  it("a composer's run is one on this studio's GPUs when named there, or when its check says the server sends it there", () => {
    // Named: as named, whatever the check says.
    expect(composerOnPool("pool", undefined, false)).toBe(true);
    expect(composerOnPool("own", { place: "pool" }, true)).toBe(false);
    // Named none (this studio's GPUs first, its own GPU online): a model they don't take (LoRAs, a model kept off) gets
    // no pool answer, so it runs on its own GPU, with its own GPU's check before Run and no pool price.
    const lora = { place: undefined };
    expect(composerOnPool(undefined, lora, true)).toBe(false);
    expect(composerOnPool(undefined, null, true)).toBe(false);
    expect(composerOnPool(undefined, { place: "pool" }, false)).toBe(true);
    // No answer yet for a changed draft: the last answer stands meanwhile.
    expect(composerOnPool(undefined, undefined, true)).toBe(true);
    expect(composerOnPool(undefined, undefined, false)).toBe(false);
  });

  it("an app's tool: \"pool\" with no GPU of its own; none with one while this studio puts its GPUs first; else no check", () => {
    const v = (o: Partial<{ audience: "owner" | "account" | "guest"; gpu: boolean; hosted: boolean; preferPool: boolean }> = {}) => ({ audience: "account" as const, gpu: false, hosted: true, preferPool: false, ...o });
    expect(openCheckPlace(v())).toBe("pool");
    expect(openCheckPlace(v({ audience: "guest" }))).toBe("pool");
    expect(openCheckPlace(v({ gpu: true, preferPool: true }))).toBeUndefined();
    expect(openCheckPlace(v({ gpu: true }))).toBeNull();
    expect(openCheckPlace(v({ hosted: false }))).toBeNull();
    expect(openCheckPlace(v({ audience: "owner" }))).toBeNull();
    expect(openCheckPlace(v(), true)).toBeNull();
    expect(openCheckPlace(null)).toBeNull();
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

describe("a tool page's own price check, for a run on this studio's GPUs", () => {
  const line = { place: 2, etaSeconds: 180 };
  it("says the service's price and when the run would be ready instead of the page's own words, and carries the price shown", () => {
    const p = toolPoolPrice({ costUsd: 0, demo: false, notes: [], place: "pool", quote: { allowed: true, amount: 0, priceVersion: "v1", text: "Free" }, line });
    expect(p?.text).toBe("Free · ready in about 3 min");
    // Every GPU away: Run stays on, and the chip says it starts when one is free.
    expect(toolPoolPrice({ place: "pool", quote: { allowed: true, amount: 0, priceVersion: "v1", text: "Free" }, line: { place: 2, etaSeconds: null, unknown: true } })).toMatchObject({ text: "Free · starts automatically", refused: false });
    // Light work: ready in seconds.
    expect(toolPoolPrice({ place: "pool", quote: { allowed: true, amount: 0, priceVersion: "", text: "Free" }, line: { place: 1, etaSeconds: null, light: true } })?.text).toBe("Free · ready in seconds");
    expect(p?.text).not.toMatch(/GPU/);
    expect(p?.refused).toBe(false);
    expect(p?.headers).toEqual({ [RUN_SHOWN_HEADER]: shownHeader({ amount: 0, priceVersion: "v1" }) });
  });

  it("is refused in the service's words (Run off), or with the person's own setup that runs it", () => {
    expect(toolPoolPrice({ place: "pool", quote: { allowed: false, amount: 0, priceVersion: "", text: "You have 2 runs going. Start this one when one finishes." }, line })).toEqual({
      text: "You have 2 runs going. Start this one when one finishes.",
      refused: true,
      headers: {},
    });
    const setup = { need: "gpu" as const, vramGb: 24 };
    expect(toolPoolPrice({ place: "pool", quote: { allowed: false, amount: 0, priceVersion: "", text: "Runs on your own GPU · 24 GB", ownSetup: setup } })).toMatchObject({ refused: true, setup });
  });

  it("is nothing for a run on the person's own GPU or key, or no answer yet", () => {
    expect(toolPoolPrice({ costUsd: 0, demo: false, notes: [] })).toBeNull();
    expect(toolPoolPrice({ place: "own" })).toBeNull();
    expect(toolPoolPrice(undefined)).toBeNull();
    expect(toolPoolPrice(null)).toBeNull();
  });
});

describe("Run on a tool page (Character Sheet, AI Influencer) after its price check", () => {
  const busy = { costUsd: 0, demo: false, notes: [], place: "pool", quote: { allowed: false, amount: 0, priceVersion: "", text: "Busy right now. Try again in a little while." } };

  it("sends nothing only when this studio's GPUs refused the run, in their words", () => {
    const check = withPoolRefusal(busy as { notes: string[]; error?: string; poolRefused?: boolean });
    expect(check).toMatchObject({ error: "Busy right now. Try again in a little while.", poolRefused: true });
    expect(refusedBeforeRun(check)).toBe("Busy right now. Try again in a little while.");
  });

  it("sends the run for any other error of the check, so the server's refusal opens the connect or add-key card", () => {
    // The check of an owner on the cloud engine with no key, or an account without its GPU or key: an error, no pool quote.
    for (const error of ["Connect fal.ai or Replicate in Settings to run this model", "Add your fal.ai key in Settings to run this.", "Connect your GPU in Settings to run this."]) {
      const check = withPoolRefusal({ costUsd: null, demo: false, notes: [], error } as { notes: string[]; error?: string; poolRefused?: boolean });
      expect(check.poolRefused).toBeUndefined();
      expect(refusedBeforeRun(check)).toBeNull();
    }
    expect(refusedBeforeRun(withPoolRefusal({ ...busy, quote: { ...busy.quote, allowed: true, text: "Free" } } as { notes: string[]; error?: string }))).toBeNull();
    expect(refusedBeforeRun(undefined)).toBeNull();
  });

  it("never stops Run on a refusal from the check of earlier settings, kept on screen while the new one runs", () => {
    const check = withPoolRefusal(busy as { notes: string[]; error?: string; poolRefused?: boolean });
    expect(refusedBeforeRun(check, true)).toBeNull();
  });

  it("is how both pages read their check: no other error stops Run there", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const page of ["src/components/fashion/character-sheet.tsx", "src/components/influencer/influencer-builder.tsx"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
      expect(src, page).toContain("refusedBeforeRun(preview.data, preview.isPlaceholderData)");
      expect(src, page).not.toMatch(/if (preview.data?.error) return/);
    }
  });
});

describe("an item only an own setup runs, for an account whose runs go to its key", () => {
  const key = { provider: "fal" as const, price: "≈ $0.04" };
  const base = { ownSetup: true, key, gpu: false, picked: "key" as const, rows: false };
  it("the chip says the key's price first, and who bills it", () => {
    expect(keyOnlyChip(base)).toEqual({ text: "≈ $0.04 · your key", tip: "Runs with your fal.ai key · billed to your fal.ai account" });
  });
  it("never without a price, with a GPU, with another pick, with the Run on list, or for an item the GPUs take", () => {
    expect(keyOnlyChip({ ...base, key: { ...key, price: null } })).toBeNull();
    expect(keyOnlyChip({ ...base, key: null })).toBeNull();
    expect(keyOnlyChip({ ...base, gpu: true })).toBeNull();
    expect(keyOnlyChip({ ...base, picked: "site" })).toBeNull();
    expect(keyOnlyChip({ ...base, picked: null })).toBeNull();
    expect(keyOnlyChip({ ...base, rows: true })).toBeNull();
    expect(keyOnlyChip({ ...base, ownSetup: false })).toBeNull();
  });
});
