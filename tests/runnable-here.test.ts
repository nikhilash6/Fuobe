import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import { FAKE_POLICY, listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import type { ModelDef } from "@/lib/catalog/types";

/*
 * "Runs here" (src/lib/runnable-here.ts): pickers list what runs on this install's GPUs now first, the studio's default
 * is always one of them, a model that doesn't gets a one-press free alternative, and all of it agrees with the run's own
 * check (hosted-run.ts poolGate), as the server sends it in GET /api/status.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const dir = tempDir("fuobe-runnable-here-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const { MODELS } = await import("@/lib/catalog/models");
const { groupModels } = await import("@/lib/composer");
const { carryParams, closestHere, hereDefault, hereOf, hereOwnLink, hereReason, hereRunLabel, hereSetup, hereTag, runsHere, splitHere } = await import("@/lib/runnable-here");
const { ownSetupOnly } = await import("@/lib/own-setup");

const byId = (id: string) => MODELS.find((m) => m.id === id)!;
const LTX25 = byId("oss-ltx25");
const H3 = byId("oss-minimax-h3");
const visitorHere = (own: Record<string, { need: "gpu"; vramGb?: number }>) => ({ rules: { own }, owner: false });

describe("where a viewer's open runs go here", () => {
  const gpu = { connected: false };
  it("a visitor whose runs go to this install's GPUs; never one whose runs go to its own GPU, nor with hosted runs off", () => {
    expect(hereOf({ viewer: { hosted: true, gpu, pool: { deny: ["x"] } } }, false)).toEqual({ rules: { deny: ["x"] }, owner: false });
    expect(hereOf({ viewer: { hosted: true, gpu } }, false)).toEqual({ rules: undefined, owner: false });
    expect(hereOf({ viewer: { hosted: true, runOn: "gpu", gpu: { connected: true } } }, false)).toBeNull();
    expect(hereOf({ viewer: { gpu } }, false)).toBeNull();
    expect(hereOf(undefined, false)).toBeNull();
  });
  it("the owner, while his ComfyUI runs on the workers (his status carries their `pool`)", () => {
    expect(hereOf({ pool: { own: { "oss-ltx25": { need: "gpu" } } } }, true)).toEqual({ rules: { own: { "oss-ltx25": { need: "gpu" } } }, owner: true });
    expect(hereOf({}, true)).toBeNull();
  });
});

describe("what runs here now", () => {
  it("a model no worker holds (the rules' `own`) runs on the visitor's own setup; the static items too; cloud models are the keys'", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu", vramGb: 24 } });
    expect(hereSetup(here, LTX25)).toEqual({ need: "gpu", vramGb: 24 });
    expect(runsHere(here, LTX25)).toBe(false);
    expect(runsHere(here, H3)).toBe(true);
    expect(hereSetup(here, byId("oss-h3-regenerate"))).toEqual(ownSetupOnly("oss-h3-regenerate"));
    const cloud = MODELS.find((m) => m.engine === "cloud" && !m.hidden)!;
    expect(runsHere(here, cloud)).toBe(true);
    // No place: nothing here has a say.
    expect(runsHere(null, LTX25)).toBe(true);
  });
  it("the owner: only what the workers lack, never the visitors' own-setup items", () => {
    const owner = { rules: { own: { "oss-ltx25": { need: "gpu" as const } } }, owner: true };
    expect(runsHere(owner, LTX25)).toBe(false);
    expect(runsHere(owner, byId("oss-h3-regenerate"))).toBe(true);
  });
  it("splits a list into what runs now (first) and the rest", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu" } });
    const { now, more } = splitHere([LTX25, H3], here);
    expect(now.map((m) => m.id)).toEqual(["oss-minimax-h3"]);
    expect(more.map((m) => m.id)).toEqual(["oss-ltx25"]);
  });
});

describe("the words", () => {
  const phrases = [
    hereTag({ need: "gpu", vramGb: 24 }),
    hereTag({ need: "key", provider: "fal" }),
    hereTag({ need: "gpu", orKey: "fal" }),
    hereTag({ need: "gpu" }, true),
    hereOwnLink("LTX-2.5", { need: "gpu", vramGb: 24 }),
    hereOwnLink("LTX-2.5", { need: "key", provider: "fal" }),
    hereRunLabel(H3),
    hereReason(LTX25, "Fuobe Cloud"),
  ];
  it("short and positive: what runs it, never a refusal", () => {
    expect(phrases).toEqual([
      "With your GPU · 24 GB",
      "With your fal.ai key",
      "With your GPU or fal.ai key",
      "Add to a worker",
      "Use LTX-2.5 with your own GPU",
      "Use LTX-2.5 with your fal.ai key",
      "Run free with MiniMax H3",
      "LTX-2.5 isn't on Fuobe Cloud yet",
    ]);
    for (const p of phrases) expect(p).not.toMatch(/can['’]t|cannot|not available|unavailable|unsupported/i);
    expect(hereRunLabel(H3, true)).toBe("Run with MiniMax H3");
  });
});

describe("the free alternative", () => {
  it("is the closest model that runs here: same kind and operation, open, premium first", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu", vramGb: 24 } });
    const alt = closestHere(LTX25, MODELS, here, { op: "t2v", params: { aspectRatio: "16:9", duration: 5 } })!;
    expect(alt.id).toBe("oss-minimax-h3");
    expect(alt.kind).toBe("video");
    expect(alt.engine).toBe("open");
    expect(alt.routes.some((r) => r.op === "t2v")).toBe(true);
  });
  it("never one that doesn't run here, and none when nothing does", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu" }, "oss-minimax-h3": { need: "gpu" } });
    const alt = closestHere(LTX25, MODELS, here, { op: "t2v" })!;
    expect(alt.id).not.toBe("oss-minimax-h3");
    expect(runsHere(here, alt)).toBe(true);
    const own = Object.fromEntries(MODELS.filter((m) => m.engine === "open").map((m) => [m.id, { need: "gpu" as const }]));
    expect(closestHere(LTX25, MODELS, visitorHere(own), { op: "t2v" })).toBeUndefined();
  });
  it("keeps the draft's settings where it can: a 4:3 clip goes to a model that makes 4:3", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu" }, "oss-minimax-h3": { need: "gpu" } });
    const alt = closestHere(LTX25, MODELS, here, { op: "t2v", params: { aspectRatio: "4:3" } })!;
    expect(alt.options.aspectRatios).toContain("4:3");
  });
  it("follows the draft's operation: a start frame asks for one that animates a picture", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu" } });
    const alt = closestHere(LTX25, MODELS, here, { op: "i2v", images: 1 })!;
    expect(alt.routes.some((r) => r.op === "i2v")).toBe(true);
  });
  it("an image model's stand-in is an image model", () => {
    const ideogram = byId("oss-ideogram-4");
    const alt = closestHere(ideogram, MODELS, visitorHere({ "oss-ideogram-4": { need: "gpu" } }), { op: "t2i" })!;
    expect(alt.kind).toBe("image");
    expect(alt.routes.some((r) => r.op === "t2i")).toBe(true);
    expect(alt.badges).toContain("top");
  });
  it("carries the settings it takes, and fits the ones it doesn't", () => {
    const to = { ...H3, options: { ...H3.options, aspectRatios: ["16:9", "9:16"], durations: [5, 10] }, defaults: { aspectRatio: "16:9" } } as ModelDef;
    expect(carryParams({ aspectRatio: "9:16", duration: 8, seed: 7 }, to)).toEqual({ aspectRatio: "9:16", duration: 10, seed: 7 });
    expect(carryParams({ aspectRatio: "21:9", duration: 6 }, to)).toEqual({ aspectRatio: "16:9", duration: 5 });
  });
});

describe("the studio's default", () => {
  it("is always one that runs here: an untouched default that doesn't moves, to the other default first", () => {
    const here = visitorHere({ "oss-ltx25": { need: "gpu" } });
    expect(hereDefault(H3, "oss-minimax-h3", MODELS, here)).toBeUndefined();
    expect(hereDefault(LTX25, "oss-minimax-h3", MODELS, here)?.id).toBe("oss-minimax-h3");
    const moved = hereDefault(LTX25, "oss-ltx25", MODELS, here, { op: "t2v" })!;
    expect(runsHere(here, moved)).toBe(true);
    expect(moved.kind).toBe("video");
  });
});

describe("the picker's order", () => {
  const video = MODELS.filter((m) => m.kind === "video" && m.engine === "open" && !m.hidden);
  const here = visitorHere({ "oss-ltx25": { need: "gpu", vramGb: 24 } });
  const runs = (m: ModelDef) => runsHere(here, m);
  it("what runs here first, in every section; the rest last as \"More models\"", () => {
    const { groups, count } = groupModels({ models: video, engine: "open", engines: ["open"], query: "", recent: ["oss-ltx25"], starred: ["oss-ltx25"], best: ["oss-ltx25", "oss-minimax-h3"], runs });
    expect(count).toBe(video.length);
    const last = groups.at(-1)!;
    expect(last).toMatchObject({ id: "more", label: "More models" });
    expect(last.models.map((m) => m.id)).toEqual(["oss-ltx25"]);
    for (const g of groups.slice(0, -1)) expect(g.models.every(runs), g.id).toBe(true);
    expect(groups.find((g) => g.id === "best")!.models[0].id).toBe("oss-minimax-h3");
    expect(groups.find((g) => g.id === "all")!.label).toBe("Ready to run");
    // Every model shows once.
    expect(groups.flatMap((g) => g.models).length).toBe(video.length);
  });
  it("an app's short list keeps its order, what runs first", () => {
    const { groups } = groupModels({ models: [LTX25, H3], engine: "open", engines: ["open"], query: "", recent: [], starred: [], best: [], flat: true, runs });
    expect(groups.map((g) => [g.id, g.models.map((m) => m.id)])).toEqual([
      ["all", ["oss-minimax-h3"]],
      ["more", ["oss-ltx25"]],
    ]);
  });
  it("a search lists what runs here first among equal matches", () => {
    const { groups } = groupModels({ models: video, engine: "open", engines: ["open"], query: "ltx", recent: [], starred: [], best: [], runs });
    const ids = groups[0].models.map((m) => m.id);
    expect(ids.indexOf("oss-ltx2")).toBeLessThan(ids.indexOf("oss-ltx25"));
  });
  it("with no place, as before", () => {
    const { groups } = groupModels({ models: video, engine: "open", engines: ["open"], query: "", recent: [], starred: [], best: [] });
    expect(groups.map((g) => g.id)).toEqual(["all"]);
  });
});

describe("the label and the run agree", () => {
  let fake: FakeBilling;
  let account: { id: string; email: string };
  let auth: typeof import("@/server/auth");
  let billing: typeof import("@/server/billing");
  beforeAll(async () => {
    auth = await import("@/server/auth");
    billing = await import("@/server/billing");
    fake = await startFakeBilling();
    auth.setPassword("install password");
    account = auth.accountById(auth.createAccount("runnable@example.com", "long enough").id)!;
  });
  afterAll(async () => {
    globalThis.__fuobeTestDiskFree = undefined;
    for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
    await fake.close();
    await comfy.close();
  });
  beforeEach(() => {
    billing.resetBillingCache();
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...FAKE_POLICY, pool: { deny: ["oss-ltx25"] } };
  });

  it("a visitor: what the status says runs here is what the price check before Run takes, and the rest it refuses with the same setup", async () => {
    const { visitorStatus } = await import("@/server/account-gpu");
    const { poolQuote } = await import("@/server/hosted-run");
    const acct = auth.accountById(account.id)!;
    const status = await visitorStatus(acct);
    const here = hereOf(status, false);
    expect(here).not.toBeNull();
    const ids = ["oss-ltx25", "oss-minimax-h3", "oss-wan22-5b", "oss-z-image-turbo", "oss-flux1-schnell", "oss-h3-regenerate"];
    for (const id of ids) {
      const m = byId(id);
      const op = m.routes[0].op;
      const req = { feature: m.kind === "image" ? "image" : "video", modelId: id, engine: "open", op, prompt: "A model walks a runway", params: {} } as Parameters<typeof poolQuote>[1];
      const q = await poolQuote(acct, req, undefined);
      const setup = (q?.quote as { ownSetup?: unknown } | undefined)?.ownSetup;
      // Runs here: priced. Doesn't: refused with an own setup of the same kind (the run names the memory where its index does).
      if (runsHere(here, m)) expect(setup, id).toBeUndefined();
      else expect((setup as { need?: string } | undefined)?.need, id).toBe(hereSetup(here, m)!.need);
    }
  });

  it("the owner's status carries the workers' set only while his ComfyUI runs on them", async () => {
    const { setSetting } = await import("@/server/settings");
    const { poolOwnModels } = await import("@/server/pool-own-setup");
    const { GET } = await import("@/app/api/status/route");
    setSetting("comfyWhere", "workers");
    try {
      const s = await (await GET()).json();
      expect(s.viewer).toBeUndefined();
      expect(s.pool).toEqual({ own: poolOwnModels() });
      const here = hereOf(s, true)!;
      for (const [id, o] of Object.entries(s.pool.own)) expect(hereSetup(here, byId(id) ?? { id, kind: "image", engine: "open" })).toEqual(o);
    } finally {
      setSetting("comfyWhere", "server");
    }
    const s = await (await GET()).json();
    expect(s.pool).toBeUndefined();
    expect(hereOf(s, true)).toBeNull();
  });
});
