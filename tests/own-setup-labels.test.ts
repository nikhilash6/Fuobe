import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeOf } from "@/lib/place-name";

/*
 * What this install's GPUs don't run for a visitor with no GPU of its own shows in the pickers and galleries with its
 * own-setup label, never left out: a model over the memory of those GPUs, one none of them holds, a preset on such a
 * model. Run on it opens that setup (Connect your GPU, Add your key, or a guest's sign-up) instead of staying off, and
 * "Try free" stays on the items these GPUs run. The words say what to use, never why.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/video",
  useSearchParams: () => new URLSearchParams(),
}));

const { getModel, PRESETS } = await import("@/lib/catalog");
const { OWN_SETUP_IDS, ownSetupDetail, ownSetupLabel, ownSetupOnly, ownSetupShort, ownSetupStep } = await import("@/lib/own-setup");
const { modelOwnSetup, poolRulesOf, presetOwnSetup, tryFreeFor } = await import("@/lib/pool-rules");
const { poolRunState } = await import("@/lib/hosted");
const { checkedPool, runPlace } = await import("@/lib/run-place");
const { poolOwnSetups, needsGpu } = await import("@/server/pool-own-setup");
const { gateText } = await import("@/server/hosted-run");
const { loadIndex } = await import("@/server/gpu/index-file");
const { openOwnSetupStep } = await import("@/components/own-setup");
const { ModelRow } = await import("@/components/studio/model-picker");
const { PresetCard } = await import("@/components/preset-gallery");
const { PresetGrid } = await import("@/components/studio/preset-chips");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** Words a visitor never reads on a run that uses this install's GPUs: why it can't run there, or how they work. */
const REASON = /worker|comfy|lane|provider|pool|vram|queue|validat|tested|verified|held|owner|beta|experimental|soon|isn['’]t|can['’]t|cannot|not available|unavailable|not offered|refused|too small|missing|busy|paused/i;

const ACCOUNT = { kind: "account" as const, gpu: { connected: false }, keys: [] as string[] };
const H3 = getModel("oss-minimax-h3")!;
const REGEN = getModel("oss-h3-regenerate")!;
// An open model with presets of its own (camera motions and effects run on it).
const Z = getModel("oss-wan22-14b")!;
const zEndpoints = Z.routes.filter((r) => r.provider === "comfyui").map((r) => r.endpoint);
const rowHtml = (m: NonNullable<typeof Z>, setup: ReturnType<typeof modelOwnSetup>) =>
  render(createElement(ModelRow, { m, selected: false, starred: false, showEngine: false, today: null, onStar: () => {}, setup }));
const refusedCheck = (setup: NonNullable<ReturnType<typeof ownSetupOnly>>) => ({
  place: "pool" as const,
  quote: { allowed: false, amount: 0, priceVersion: "", text: ownSetupLabel(setup), code: "not-offered", ownSetup: setup },
});

const win = globalThis as { window?: unknown; CustomEvent?: unknown };
afterEach(() => {
  delete win.window;
});

describe("a model over the memory of this install's GPUs", () => {
  it("shows its label in the model picker, in place of its price", () => {
    // A static item: a card bigger than these GPUs'.
    const setup = modelOwnSetup(undefined, REGEN)!;
    expect(setup).toMatchObject({ need: "gpu", vramGb: 48 });
    const html = rowHtml(REGEN, setup);
    expect(html).toContain('data-slot="own-setup"');
    expect(html).toContain(ownSetupLabel(setup));
    expect(ownSetupLabel(setup)).toBe("Self-hosted");
    // A model that runs here has no label.
    expect(rowHtml(H3, modelOwnSetup(undefined, H3))).not.toContain('data-slot="own-setup"');
  });

  it("a workflow too big for every card these GPUs have names the memory it needs", () => {
    const off = new Set(H3.routes.filter((r) => r.provider === "comfyui").map((r) => r.endpoint));
    const own = poolOwnSetups((e) => !off.has(e), () => false);
    const gbs = [...off].map((e) => loadIndex().workflows[e]?.vramGb).filter((n): n is number => typeof n === "number" && n > 0);
    expect(own[H3.id]).toEqual({ need: "gpu", ...(gbs.length && { vramGb: Math.ceil(Math.min(...gbs)) }) });
    const rules = poolRulesOf({}, [], own);
    const setup = modelOwnSetup(rules, H3)!;
    expect(text(rowHtml(H3, setup))).toContain(ownSetupLabel(setup));
  });

  it("Run opens the setup instead of staying off: Connect your GPU, a guest's sign-up, or the run itself", () => {
    const setup = ownSetupOnly(REGEN.id)!;
    const state = poolRunState(refusedCheck(setup))!;
    expect(state).toMatchObject({ refused: true, text: ownSetupLabel(setup), setup });
    expect(ownSetupStep(state.setup!, ACCOUNT)).toEqual({ kind: "connect-gpu", gpuOnly: true });
    expect(ownSetupStep(state.setup!, { kind: "guest" })).toEqual({ kind: "sign-up" });
    expect(ownSetupStep(state.setup!, { ...ACCOUNT, gpu: { connected: true } })).toEqual({ kind: "run" });
    // The step opens the card.
    const target = new EventTarget();
    const seen: { type: string; detail: unknown }[] = [];
    target.addEventListener("fuobe:connect-gpu", (e) => seen.push({ type: e.type, detail: (e as CustomEvent).detail }));
    win.window = target;
    expect(openOwnSetupStep(ownSetupStep(setup, ACCOUNT))).toBe(true);
    expect(seen).toEqual([{ type: "fuobe:connect-gpu", detail: { action: "run", gpuOnly: true, needs: "gpu" } }]);
    // With the item's label, the card says what it needs under its title.
    openOwnSetupStep(ownSetupStep(setup, ACCOUNT), ownSetupLabel(setup));
    expect(seen[1]?.detail).toMatchObject({ requirement: "Self-hosted" });
  });

  it("an app's own tool says the label and sends Run to the setup, never a refusal", () => {
    const setup = ownSetupOnly(REGEN.id)!;
    const pool = checkedPool(refusedCheck(setup));
    expect(pool).toMatchObject({ refused: true, setup });
    const account = runPlace({ audience: "account", engine: "open", hosted: true, pool, format: String });
    expect(account).toMatchObject({ where: "gpu", title: ownSetupLabel(setup), send: ownSetupLabel(setup), needs: "gpu", setup });
    expect(account.refused).toBeUndefined();
    expect(runPlace({ audience: "guest", engine: "open", hosted: true, pool, format: String }).needs).toBe("signup");
    const key = { need: "key" as const, provider: "fal" };
    expect(runPlace({ audience: "account", engine: "open", hosted: true, pool: checkedPool(refusedCheck(key)), format: String })).toMatchObject({ needs: "key", send: "Self-hosted · your fal.ai key" });
    // Any other refusal still turns the button off with its words.
    const busy = checkedPool({ place: "pool", quote: { allowed: false, text: "Busy right now." } });
    expect(runPlace({ audience: "account", engine: "open", hosted: true, pool: busy, format: String }).refused).toBe("Busy right now.");
  });
});

describe("a model none of this install's GPUs holds", () => {
  const own = poolOwnSetups((e) => !zEndpoints.includes(e), () => false);
  const preset = PRESETS.find((p) => p.open?.modelId === Z.id);
  // A preset on a model these GPUs still run.
  const other = PRESETS.find((p) => p.open && getModel(p.open.modelId)?.kind === Z.kind && !own[p.open.modelId] && p.open.modelId !== Z.id);
  const rules = poolRulesOf({}, PRESETS.map((p) => ({ id: p.id, ...(p.open && getModel(p.open.modelId) && { model: { id: p.open.modelId, kind: getModel(p.open.modelId)!.kind } }) })), own);

  it("shows a label from the pool rules in the model picker", () => {
    expect(own[Z.id]).toEqual(needsGpu(zEndpoints[0]));
    const setup = modelOwnSetup(rules, Z)!;
    expect(setup).toEqual(own[Z.id]);
    expect(text(rowHtml(Z, setup))).toContain(ownSetupLabel(setup));
  });

  it("its presets show in the galleries and pickers with that label; Try free stays on the ones these GPUs run", () => {
    expect(preset && other).toBeTruthy();
    if (!preset || !other) return;
    // On the open engine (a preset with a cloud route keeps it on the cloud engine, as before).
    const setup = presetOwnSetup(rules, preset, "open")!;
    expect(setup).toEqual(own[Z.id]);
    expect(presetOwnSetup(rules, other, "open")).toBeNull();
    // A gallery card only knows the preset has an open route: a GPU of the visitor's own.
    const card = { id: preset.id, name: preset.name, description: preset.description, category: preset.category, icon: "Sparkles", hue: 200, cloud: false, open: true, preview: { kind: "none" } } as never;
    expect(presetOwnSetup(rules, card)).toEqual({ need: "gpu" });
    const html = render(createElement(PresetCard, { preset: card, href: "/x", setup: presetOwnSetup(rules, card) }));
    expect(text(html)).toContain(ownSetupLabel({ need: "gpu" }));
    expect(html).not.toContain("data-try-free");
    // The camera-motion and effect pickers list it, labelled, beside the ones that run here.
    const grid = render(createElement(PresetGrid, { list: [preset, other], noneLabel: "None", onPick: () => {}, rules, engine: "open" }));
    expect(text(grid)).toContain(preset.name);
    expect(text(grid)).toContain(other.name);
    expect(grid.match(/data-slot="own-setup"/g)).toHaveLength(1);
    // Try free: only on what these GPUs run.
    const tryFree = tryFreeFor({ hosted: true, cardText: "Try free", gpu: { connected: false }, pool: rules }, "both")!;
    expect(tryFree.runs({ id: preset.id, open: true })).toBe(false);
    expect(tryFree.runs({ id: other.id, open: true })).toBe(true);
  });

  it("with hosted runs off, or for a viewer with its own GPU, nothing is labelled by the rules", () => {
    expect(modelOwnSetup(undefined, Z)).toBeNull();
    expect(presetOwnSetup(undefined, preset!)).toBeNull();
  });
});

describe("the reason never appears in a visitor's words", () => {
  const setups = [
    ...OWN_SETUP_IDS.map((id) => ownSetupOnly(id) ?? null),
    { need: "gpu" as const },
    { need: "gpu" as const, vramGb: 12 },
    needsGpu(zEndpoints[0]),
    { need: "key" as const, provider: "fal" },
    { need: "key" as const, provider: "replicate" },
  ].filter((o): o is NonNullable<typeof o> => !!o);

  it("in the labels, the price check's words and the tools' place", () => {
    for (const o of setups) {
      const words = [ownSetupLabel(o), ownSetupShort(o), ownSetupDetail(o), gateText({ ok: false, reason: "ownSetup", setup: o }, true, placeOf(null)), gateText({ ok: false, reason: "ownSetup", setup: o }, false, placeOf(null))];
      for (const audience of ["account", "guest"] as const) {
        const place = runPlace({ audience, engine: "open", hosted: true, pool: checkedPool(refusedCheck(o)), format: String });
        words.push(place.label, place.title, place.tip, place.send);
      }
      for (const w of words) expect(w, JSON.stringify(o)).not.toMatch(REASON);
    }
  });

  it("in the picker rows and cards that show them", () => {
    for (const o of setups) {
      expect(text(rowHtml(Z, o))).not.toMatch(REASON);
      const card = { id: "p", name: "Orbit", description: "A slow orbit", category: "Orbit", icon: "Sparkles", hue: 200, cloud: false, open: true, preview: { kind: "none" } } as never;
      expect(text(render(createElement(PresetCard, { preset: card, href: "/x", setup: o })))).not.toMatch(REASON);
    }
  });
});

describe("beside a setting's value", () => {
  it("Kandinsky 6.0's Pro quality carries its label, and the server asks the run by the same id", async () => {
    const { controlSetup } = await import("@/lib/own-setup-controls");
    const { requestSetupIds } = await import("@/server/pool-own-setup");
    expect(controlSetup("oss-kandinsky6", "quality", "pro")).toBe("oss-kandinsky6:pro");
    expect(controlSetup("oss-kandinsky6", "quality", "lite")).toBeUndefined();
    expect(controlSetup("oss-minimax-h3", "quality", "pro")).toBeUndefined();
    expect(ownSetupLabel(ownSetupOnly("oss-kandinsky6:pro")!)).toBe("Self-hosted");
    expect(requestSetupIds({ feature: "video", modelId: "oss-kandinsky6", op: "t2v", params: { extra: { quality: "pro" } } })).toContain("oss-kandinsky6:pro");
    expect(requestSetupIds({ feature: "video", modelId: "oss-kandinsky6", op: "t2v", params: { extra: { quality: "lite" } } })).not.toContain("oss-kandinsky6:pro");
  });

  it("MiniMax H3's fast decoder carries its label, and the server asks the run by the same id", async () => {
    const { controlSetup } = await import("@/lib/own-setup-controls");
    const { requestSetupIds } = await import("@/server/pool-own-setup");
    expect(controlSetup("oss-minimax-h3", "decoder", "fast")).toBe("h3:fast-decode");
    expect(controlSetup("oss-minimax-h3", "decoder", "standard")).toBeUndefined();
    expect(ownSetupOnly("h3:fast-decode")).not.toBeNull();
    expect(ownSetupLabel(ownSetupOnly("h3:fast-decode")!)).not.toMatch(REASON);
    expect(requestSetupIds({ feature: "video", modelId: "oss-minimax-h3", op: "t2v", params: { extra: { decoder: "fast" } } })).toContain("h3:fast-decode");
    expect(requestSetupIds({ feature: "video", modelId: "oss-minimax-h3", op: "t2v", params: { extra: { decoder: "standard" } } })).not.toContain("h3:fast-decode");
  });
});

describe("a cloud model a visitor runs on its own key only", () => {
  it("is priced with its key's label, never as free on a GPU", async () => {
    const { keyOnlySetup } = await import("@/lib/own-setup-controls");
    const { costLabel } = await import("@/lib/composer");
    const song = getModel("mureka-extend");
    expect(song).toBeDefined();
    const setup = keyOnlySetup(song, "open");
    expect(setup).toEqual(ownSetupOnly("mureka-extend", "cloud"));
    expect(setup).not.toBeNull();
    if (setup) {
      expect(ownSetupLabel(setup)).toBe(`Self-hosted · your ${setup.provider === "fal" ? "fal.ai" : "Replicate"} key`);
      expect(ownSetupLabel(setup)).not.toBe(costLabel({ demo: false, cost: 0, gpu: true }, String));
    }
    // An open model, or a cloud model any key runs: no key label.
    expect(keyOnlySetup(H3, "open")).toBeNull();
    expect(keyOnlySetup(undefined, "open")).toBeNull();
  });
});

describe("Run on an item this install's GPUs don't run, for an account that has the setup", () => {
  it("says where the next press runs it, in plain words", async () => {
    const { movedToOwnText } = await import("@/lib/own-setup-controls");
    expect(movedToOwnText(true)).toBe("Switched to your GPU. Press Run to start.");
    expect(movedToOwnText(false)).toBe("Switched to your key. Press Run to start.");
    for (const said of [movedToOwnText(true), movedToOwnText(false)]) expect(said).not.toMatch(REASON);
  });
});
