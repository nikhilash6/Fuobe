import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * What an account sees around a GPU or key problem, in the browser: the check before Run in the composer (the status
 * strip's answer, never a new call to the GPU), "Run with your fal.ai key" on the tool's cloud version, and the buttons
 * a failed run's tile and Settings show (Start your pod as a link to RunPod, Check my GPU, Settings, Add credit).
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { beforeRunTail, gpuBeforeRun, onCloudKey, runOnceOnKey, GPU_OFF_WORDS } = await import("@/lib/before-run");
const { failedRunHandlers, movingRun, reuseHref, studioHrefFor, waitingRunHandlers } = await import("@/lib/run-trouble");
const { RunTroubleActions } = await import("@/components/gpu/run-trouble-actions");
const { StatusCover } = await import("@/components/library/asset-card");
type RunTroubleDeps = import("@/lib/run-trouble").RunTroubleDeps;
const { diagnoseGpu, RUNPOD_CONSOLE_URL, troubleOf, withKeyAction, withOfferAfterFirst } = await import("@/lib/diagnose");
const { getModel, getPreset } = await import("@/lib/catalog");
const { TroubleActions, TroubleDetails, autoCheckIn, fitActions } = await import("@/components/gpu/trouble");
const { FailedTile } = await import("@/components/studio/feed");
const { smallerRun } = await import("@/lib/smaller-run");
const { readFileSync } = await import("node:fs");

const has = (id: string) => !!getModel(id);
const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));

const POD = "https://abc123xyz-8188.proxy.runpod.net";
const stopped = diagnoseGpu({ stage: "status", status: 404, body: "" }, { kind: "link", url: POD });
const offline = { connected: true, mode: "link" as const, online: false, trouble: stopped };
const account = (gpu: object, keys: ("fal" | "replicate")[] = []) => ({ kind: "account" as const, gpu: gpu as typeof offline, keys, paidAllowed: true });
const fpv = getPreset("motion-fpv-drone")!;
const h3 = getModel("oss-minimax-h3")!;

describe("the check before Run", () => {
  it("shows a stopped pod's words and buttons above Generate, read from the status strip's answer", () => {
    const shown = gpuBeforeRun({ viewer: account(offline), model: h3, engine: "open", preset: fpv, has, getModel })!;
    // Settings' "we connect as soon as it answers" becomes what happens to runs.
    expect(shown.words).toBe("Your RunPod pod isn't running, or ComfyUI isn't on port 8188. Start your pod, and your runs start as soon as it answers.");
    expect(shown.waits).toBe(true);
    expect(beforeRunTail(shown.waits)).toBe("A run you start now waits for it.");
    expect(shown.details).toBe(stopped.details);
    expect(shown.actions.map((a) => a.kind)).toEqual(["start-gpu", "check-gpu", "gpu-settings"]);
    expect(shown.actions[0]).toMatchObject({ label: "Start your pod", target: RUNPOD_CONSOLE_URL });
  });

  it("offers the tool's cloud version on the account's own key, an explicit button right after Start your pod", () => {
    const withFal = gpuBeforeRun({ viewer: account(offline, ["fal"]), model: h3, engine: "open", preset: fpv, has, getModel })!;
    expect(withFal.actions.map((a) => a.kind)).toEqual(["start-gpu", "run-with-key", "check-gpu", "gpu-settings"]);
    // The cloud version itself (its model and operation there), so one click runs it, once.
    expect(withFal.actions[1]).toEqual(withKeyAction("fal", "minimax-h3", "i2v"));
    expect(withFal.actions[1].label).toBe("Run with your fal.ai key");
    // A key the provider refused (or whose balance ran out) isn't offered.
    expect(gpuBeforeRun({ viewer: { ...account(offline, ["fal"]), usableKeys: [] }, model: h3, engine: "open", preset: fpv, has, getModel })!.actions.map((a) => a.kind)).not.toContain("run-with-key");
    // What waiting can't fix doesn't say a run waits.
    const password = gpuBeforeRun({ viewer: account({ ...offline, trouble: diagnoseGpu({ stage: "status", status: 401 }, { kind: "link", url: POD }) }), model: h3, engine: "open", preset: fpv, has, getModel })!;
    expect(password.waits).toBe(false);
    expect(password.words).toBe("Your GPU asks for a password. Add it in Settings → Your GPU.");
    expect(beforeRunTail(password.waits)).toBe("Runs can't reach your GPU until this is fixed.");
    // FPV Drone's cloud versions are on fal.ai only: a Replicate token runs none of them.
    expect(gpuBeforeRun({ viewer: account(offline, ["replicate"]), model: h3, engine: "open", preset: fpv, has, getModel })!.actions.map((a) => a.kind)).not.toContain("run-with-key");
    // A studio that is open-source only: no key is offered.
    expect(gpuBeforeRun({ viewer: { ...account(offline, ["fal"]), paidAllowed: false }, model: h3, engine: "open", preset: fpv, has, getModel })!.actions.map((a) => a.kind)).not.toContain("run-with-key");
  });

  it("says nothing when the run doesn't go to the account's own GPU at a web address, or the GPU answered", () => {
    const base = { model: h3, engine: "open" as const, preset: fpv, has, getModel };
    expect(gpuBeforeRun({ ...base, viewer: account({ ...offline, online: true }) })).toBeNull();
    expect(gpuBeforeRun({ ...base, viewer: { ...account(offline), kind: "guest" } })).toBeNull();
    // This computer and a paired ComfyUI have notes of their own.
    expect(gpuBeforeRun({ ...base, viewer: account({ connected: true, mode: "computer", online: false }) })).toBeNull();
    // This studio's GPUs (hosted runs), a cloud model, a Fuobe Original on the Cloud engine.
    expect(gpuBeforeRun({ ...base, viewer: account(offline), onPool: true })).toBeNull();
    expect(gpuBeforeRun({ ...base, viewer: account(offline), model: getModel("minimax-h3"), preset: undefined })).toBeNull();
    expect(gpuBeforeRun({ ...base, viewer: account(offline), model: getModel("fuobe-soul"), engine: "cloud", preset: undefined })).toBeNull();
    // An older answer without a reason still says the GPU isn't answering, with Check my GPU.
    const bare = gpuBeforeRun({ ...base, viewer: account({ connected: true, mode: "link", online: false }) })!;
    expect(bare.words).toBe(GPU_OFF_WORDS);
    expect(bare.actions.map((a) => a.kind)).toEqual(["check-gpu", "gpu-settings"]);
  });
});

describe("Run with your key on a failed run", () => {
  it("asks for the same run on the cloud version: its model and operation there, without the open graph's settings", () => {
    const req = { feature: "video" as const, modelId: "oss-minimax-h3", presetId: "motion-fpv-drone", op: "i2v" as const, prompt: "", inputs: { images: ["/files/a.png"] }, params: { duration: 6, extra: { quality: "draft" } } };
    expect(onCloudKey(req, { modelId: "minimax-h3", op: "i2v" })).toEqual({ ...req, engine: "cloud", modelId: "minimax-h3", op: "i2v", params: { duration: 6 } });
    // On the key the button named.
    expect(onCloudKey(req, { modelId: "minimax-h3", op: "i2v", target: "fal" })).toMatchObject({ engine: "cloud", prefer: "fal" });
    // A Fuobe Original: the same model, on the cloud engine, with all its settings.
    const soul = { feature: "image" as const, modelId: "fuobe-soul", prompt: "a portrait", params: { extra: { look: "x" } } };
    expect(onCloudKey(soul, { modelId: "fuobe-soul" })).toEqual({ ...soul, engine: "cloud" });
  });
});

describe("the buttons", () => {
  it("Start your pod opens RunPod in a new tab; Settings is a link; Check my GPU is a button", () => {
    const html = render(createElement(TroubleActions, { actions: stopped.actions }));
    expect(html).toContain(`href="${RUNPOD_CONSOLE_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Start your pod");
    expect(html).toContain("Check my GPU");
    expect(html).toContain('href="/settings#your-gpu"');
  });

  it("leaves out what can't be done here, and shows at most so many", () => {
    const actions = [{ kind: "retry" as const, label: "Retry" }, withKeyAction("fal", "minimax-h3"), { kind: "pick-model" as const, label: "Pick another model" }, ...stopped.actions];
    // No run to retry, no key handler, no model picker: those buttons aren't drawn.
    const bare = render(createElement(TroubleActions, { actions }));
    expect(bare).not.toMatch(/Retry|Run with your|Pick another model/);
    const handled = render(createElement(TroubleActions, { actions, handlers: { onRetry: () => {}, onRunWithKey: () => {} }, skip: ["retry"], max: 2 }));
    expect(handled).toContain("Run with your fal.ai key");
    expect(handled).toContain("Start your pod");
    expect(handled).not.toMatch(/Retry|Check my GPU/);
    expect(render(createElement(TroubleActions, { actions: [] }))).toBe("");
  });

  it("when few fit, the ones that help least go first, never the first; a tile's Settings gives way to Check my GPU", () => {
    const run = [{ kind: "start-gpu" as const, label: "Start your pod" }, { kind: "retry" as const, label: "Retry" }, { kind: "check-gpu" as const, label: "Check my GPU" }, { kind: "gpu-settings" as const, label: "Open Settings → Your GPU" }];
    expect(fitActions(run, 2).map((a) => a.kind)).toEqual(["start-gpu", "check-gpu"]);
    expect(fitActions(run, 3).map((a) => a.kind)).toEqual(["start-gpu", "retry", "check-gpu"]);
    const tile = render(createElement(TroubleActions, { actions: run, skip: ["retry"], compact: true }));
    expect(tile).toContain("Check my GPU");
    expect(tile).not.toContain("Settings");
    // One line each, cut short when narrow (never wrapping out of the pill).
    expect(tile).toMatch(/whitespace-nowrap/);
  });

  it("the stopped pod's failed tile keeps Run with your fal.ai key among its buttons (the server's real order)", () => {
    const end = diagnoseGpu({ stage: "poll", status: 404 }, { kind: "link", url: POD });
    const trouble = troubleOf({ ...end, actions: withOfferAfterFirst(end.actions, withKeyAction("fal", "minimax-h3", "i2v")) });
    const g = { id: "g1", status: "failed", error: end.words, trouble, request: { feature: "video", modelId: "oss-minimax-h3", presetId: "motion-fpv-drone" }, modelId: "oss-minimax-h3", op: "i2v" };
    const html = render(createElement(FailedTile, { g: g as never, ratio: 9 / 16, onRetry: () => {} }));
    expect(html).toContain("Start your pod");
    expect(html).toContain("Run with your fal.ai key");
    expect(html).toContain(end.words.replaceAll("'", "&#x27;"));
  });

  it("the details line is small and only there when there is something to say", () => {
    expect(render(createElement(TroubleDetails, { details: "RunPod pod, port 8188 · HTTP 404" }))).toContain("HTTP 404");
    expect(render(createElement(TroubleDetails, {}))).toBe("");
  });

  it("Settings checks again by itself with a growing wait, within the check's budget", () => {
    const start = 1_000_000;
    expect(autoCheckIn("gpu-stopped", 1, start, start)).toBe(15_000);
    expect(autoCheckIn("gpu-offline", 1, start, start)).toBe(5_000);
    expect(autoCheckIn("gpu-offline", 3, start, start)).toBe(20_000);
    // Past the budget (3 minutes for a GPU that doesn't answer), and never for what waiting can't fix.
    expect(autoCheckIn("gpu-offline", 9, start, start + 3 * 60_000)).toBeNull();
    expect(autoCheckIn("gpu-password", 1, start, start)).toBeNull();
  });
});

describe("Run with your key from the composer runs once", () => {
  it("sends this run on the cloud version and that key, and changes nothing else: the next run goes to the GPU again", async () => {
    // The engine switch is remembered in the browser (useEngine): a press that wrote it would move every later run.
    const written: string[] = [];
    const store = { getItem: () => null, setItem: (k: string) => void written.push(k), removeItem: (k: string) => void written.push(k), clear: () => {}, key: () => null, length: 0 };
    vi.stubGlobal("localStorage", store);
    try {
      const sent: unknown[] = [];
      const mutate = vi.fn(async (r: unknown) => void sent.push(r));
      const req = { feature: "video" as const, modelId: "oss-minimax-h3", presetId: "motion-fpv-drone", op: "i2v" as const, prompt: "", inputs: { images: ["/files/a.png"] }, params: { duration: 6, extra: { quality: "draft" } } };
      const words = await runOnceOnKey(req, withKeyAction("fal", "minimax-h3", "i2v"), mutate);
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(sent[0]).toEqual({ ...req, engine: "cloud", modelId: "minimax-h3", op: "i2v", params: { duration: 6 }, prefer: "fal" });
      expect(words).toBe("Running once on fal.ai with your key. Your next runs go to your GPU again.");
      expect(written).toEqual([]);
      // A refusal comes back to the composer (its toast), and nothing is said as started.
      await expect(runOnceOnKey(req, withKeyAction("fal", "minimax-h3", "i2v"), async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    } finally {
      vi.unstubAllGlobals();
    }
    // The composer's own handler is this one, and never flips the switch.
    const src = readFileSync("src/components/studio/composer.tsx", "utf8").replace(/\r\n/g, "\n");
    const handler = /const runOnceWithKey = \(a: TroubleAction\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
    expect(handler).toContain("runOnceOnKey(");
    expect(handler).not.toMatch(/setEngine|preferEngine|localStorage/);
    expect(src).toMatch(/onRunWithKey: runOnceWithKey/);
  });
});

describe("a run's buttons, in a studio and in the Library", () => {
  const failed = { id: "run1", batchId: null, feature: "video", kind: "video", status: "failed", modelId: "oss-minimax-h3", request: { feature: "video", modelId: "oss-minimax-h3", prompt: "", params: { resolution: "720p" } } } as never;
  const deps = (more: Partial<RunTroubleDeps> = {}) => {
    const ran: unknown[] = [];
    const d: RunTroubleDeps = { run: async (r) => (ran.push(r), true), onError: vi.fn(), ...more };
    return { ran, d };
  };

  it("Pick another model: in a studio the run comes back into the composer and the picker opens; in the Library its studio opens so", () => {
    const reuse = vi.fn();
    const openPicker = vi.fn();
    failedRunHandlers(failed, deps({ reuse, openPicker }).d).onPickModel!();
    expect(reuse).toHaveBeenCalledWith(failed);
    expect(openPicker).toHaveBeenCalledTimes(1);
    const go = vi.fn();
    failedRunHandlers(failed, deps({ go }).d).onPickModel!();
    expect(go).toHaveBeenCalledWith("/video?reuse=run1&pick=1");
    // Nowhere to pick one: no button.
    expect(failedRunHandlers(failed, deps().d).onPickModel).toBeUndefined();
    expect(studioHrefFor({ feature: "app:app-outfit-swap", kind: "image" })).toBe("/apps/app-outfit-swap");
    expect(studioHrefFor({ feature: "effect:fpv", kind: "video" })).toBe("/video");
    expect(studioHrefFor({ feature: "translate", kind: "audio" })).toBe("/audio");
    expect(reuseHref({ id: "run1", feature: "image", kind: "image" })).toBe("/image?reuse=run1");
  });

  it("Try one size smaller in the Library reads the run's model when pressed; a copy that can't be made offers the next thing to try", async () => {
    const model = { options: { resolutions: ["480p", "720p"] }, defaults: { resolution: "720p" } };
    const { ran, d } = deps({ loadModel: async () => model as never, go: vi.fn() });
    const h = failedRunHandlers(failed, { ...d, smallerCopy: async () => Promise.reject(new Error("This file is as small as we can make it here.")) });
    await h.onTrySmaller!();
    expect(ran[0]).toMatchObject({ params: { resolution: "480p" } });
    await h.onSendSmaller!();
    expect(d.onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ label: "Try one size smaller" }));
  });

  it("Run with your key on a waiting tile takes the run's place, and the batch's other tiles don't offer it while it goes", async () => {
    const waiting = { ...(failed as object), id: "job1", batchId: "b1", status: "queued" } as never;
    let release: (v: boolean) => void = () => {};
    const sent: unknown[] = [];
    const run = (r: unknown) => (sent.push(r), new Promise<boolean>((res) => (release = res)));
    const press = waitingRunHandlers(waiting, { run, onError: vi.fn() }).onRunWithKey!(withKeyAction("fal", "minimax-h3", "i2v"));
    expect(sent[0]).toMatchObject({ replaces: "job1", engine: "cloud" });
    expect(movingRun("b1")).toBe("job1");
    // Its batch's other job: drawn without the button, and a press anyway sends nothing.
    const other = { ...(waiting as object), id: "job2" } as never;
    const html = render(createElement(RunTroubleActions, { g: other, actions: [withKeyAction("fal", "minimax-h3", "i2v"), { kind: "check-gpu", label: "Check my GPU" }] }));
    expect(html).not.toContain("Run with your fal.ai key");
    await waitingRunHandlers(other, { run, onError: vi.fn() }).onRunWithKey!(withKeyAction("fal", "minimax-h3", "i2v"));
    // Nor does another of the same run's pending tiles.
    await waitingRunHandlers(waiting, { run, onError: vi.fn() }).onRunWithKey!(withKeyAction("fal", "minimax-h3", "i2v"));
    expect(sent).toHaveLength(1);
    // Refused: the button comes back.
    release(false);
    await press;
    expect(movingRun("b1")).toBeUndefined();
  });

  it("a Library card acts: a waiting run offers Run with your key, a failed one Pick another model", () => {
    const actions = [withKeyAction("fal", "minimax-h3", "i2v"), { kind: "pick-model" as const, label: "Pick another model" }];
    const waitingCard = { ...(failed as object), id: "w1", status: "queued", outputs: [], createdAt: Date.now(), waiting: { cause: "gpu-stopped", words: "x", actions, retryable: true } } as never;
    expect(render(createElement(StatusCover, { g: waitingCard, actionable: true }))).toContain("Run with your fal.ai key");
    // The owner's view of an account's runs only shows them.
    expect(render(createElement(StatusCover, { g: waitingCard }))).not.toContain("Run with your fal.ai key");
    const failedCard = { ...(failed as object), id: "f1", outputs: [], error: "x", trouble: { cause: "gpu-isolated", words: "x", actions: [{ kind: "pick-model", label: "Pick another model" }], retryable: false } } as never;
    expect(render(createElement(StatusCover, { g: failedCard, actionable: true }))).toContain("Pick another model");
  });
});

describe("Settings → Your GPU: a local address", () => {
  it("offers Use this computer where this browser can reach its ComfyUI, and elsewhere says why, with Pair with a code", async () => {
    const { LocalAddressWays, USE_COMPUTER_ELSEWHERE } = await import("@/components/gpu/your-gpu");
    const button = '<span class="truncate">Use this computer</span>';
    const ok = render(createElement(LocalAddressWays, { support: "ok", onUseComputer: () => {} }));
    expect(ok).toContain(button);
    expect(ok).toContain("Pair with a code");
    for (const why of ["safari", "phone", "http"] as const) {
      const html = render(createElement(LocalAddressWays, { support: why, onUseComputer: () => {} }));
      expect(html).not.toContain(button);
      expect(html).toContain(USE_COMPUTER_ELSEWHERE[why].replaceAll("'", "&#x27;"));
      expect(html).toContain("Pair with a code");
    }
    expect(USE_COMPUTER_ELSEWHERE.safari).toBe("Use this computer works in Chrome, Edge or Firefox. Safari doesn't let a website reach programs on your Mac.");
  });

  it("Use this computer sends the account's runs to the ComfyUI on this computer", async () => {
    const { chooseThisComputer } = await import("@/components/gpu/your-gpu");
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return Response.json({ gpu: { mode: "computer" } });
    });
    try {
      expect(await chooseThisComputer()).toEqual({ gpu: { mode: "computer" } });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toEqual([{ url: "/api/account/gpu", method: "PUT", body: JSON.stringify({ mode: "computer" }) }]);
  });
});

describe("Try one size smaller", () => {
  it("steps the size down first, then the length, and offers nothing when neither can", () => {
    const model = { options: { resolutions: ["480p", "720p", "1080p"], durations: [5, 10] }, defaults: { resolution: "1080p", duration: 10 } };
    const req = { feature: "video", modelId: "m", prompt: "x" };
    expect(smallerRun(req, model as never)).toMatchObject({ request: { params: { resolution: "720p" } }, what: "720p" });
    expect(smallerRun({ ...req, params: { resolution: "480p", duration: 10 } }, model as never)).toMatchObject({ request: { params: { duration: 5 } }, what: "5 s" });
    expect(smallerRun({ ...req, params: { resolution: "480p", duration: 5 } }, model as never)).toBeNull();
  });
});
