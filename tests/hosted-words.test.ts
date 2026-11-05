import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusInfo, ViewerInfo } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";

/*
 * What a guest or an account reads about runs on this install's GPUs (hosted runs on) says them by their place name and
 * in plain words: never "this studio's GPUs", never the machinery (worker, lane, ticket, pool, hosted, queue, catalog),
 * never "Press Retry" where the line retries by itself, never ComfyUI (it isn't theirs), and no verb that has to agree
 * with the name. Scanned over the server's word tables, the place chip's words, the engine tips, Run again, and the
 * rendered home steps, tiles, Library card and Settings → Your keys.
 */

const state = vi.hoisted(() => ({
  hydrated: true,
  viewer: undefined as ViewerInfo | undefined,
  status: undefined as StatusInfo | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", async (load) => ({
  ...(await load<typeof import("@/lib/api")>()),
  useHydrated: () => state.hydrated,
  useViewer: () => ({ data: state.viewer }),
  useStatus: () => ({ data: state.status }),
  useEngineMode: () => "both",
}));

const { hostedGuestWords, hostedWords, outputsWords } = await import("@/server/hosted");
const { gateText, ownGpuQuiet } = await import("@/server/hosted-run");
const { needsGpu } = await import("@/server/pool-own-setup");
const { SITE_HIDDEN_WORDS } = await import("@/server/output-checks");
const { SITE_FAILED_WORDS } = await import("@/lib/comfy-compose");
const { FILE_TROUBLE_WORDS, POOL_WORDS } = await import("@/lib/relay");
const { notePlaceName, placeOf } = await import("@/lib/place-name");
const { runPlace } = await import("@/lib/run-place");
const { accountEngine } = await import("@/lib/your-keys");
const { againWhere } = await import("@/lib/demo-mode");
const { PendingTile, FailedTile, Feed } = await import("@/components/studio/feed");
const { listStatus, StatusCover } = await import("@/components/library/asset-card");
const { StartSteps } = await import("@/components/home/home-islands");
const { AccountKeysSection, KeyInstead } = await import("@/components/keys/your-keys");
const { EngineSwitch, engineTip } = await import("@/components/studio/engine-switch");
const { TooltipProvider } = await import("@/components/ui/tooltip");

/** Words no visitor reads about runs on this install's GPUs (acceptance check A11). */
const FORBIDDEN = /studio's GPUs|\bworkers?\b|\blanes?\b|\btickets?\b|\bpool\b|\bhosted\b|\bqueue|\bcatalog|Press Retry|Try again later|isn't available here|Not available here|not checked|unverified|ComfyUI/i;

const NAMED = placeOf("Studio North GPUs");
const DEFAULT = placeOf(null);

/** The words in a page's markup, without its tags and attributes. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));

const gen = (o: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "oss-z-image-turbo",
    engine: "open",
    provider: "comfyui",
    op: "t2i",
    kind: "image",
    status: "queued",
    progress: null,
    message: null,
    prompt: "a fox in the snow",
    request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox in the snow" },
    outputs: [],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    completedAt: null,
    place: "pool",
    ...o,
  }) as Generation;

const accountViewer: ViewerInfo = { signedIn: true, owner: false, publicSignup: true, account: { email: "ana@example.com" } };
const guestViewer: ViewerInfo = { signedIn: false, owner: false, publicSignup: true };
function hostedStatus(v: Partial<NonNullable<StatusInfo["viewer"]>> = {}): StatusInfo {
  return {
    providers: { comfyui: { label: "Your GPU", configured: true } },
    demoMode: "off",
    engineMode: "both",
    cloudProvider: "auto",
    onboarded: true,
    viewer: { kind: "account", gpu: { connected: false }, keys: [], paidAllowed: true, hosted: true, placeName: NAMED.label, ...v },
  } as StatusInfo;
}

beforeEach(() => {
  state.hydrated = true;
  state.viewer = accountViewer;
  state.status = hostedStatus();
});
afterEach(() => notePlaceName(null));

/** Every sentence a visitor reads from the server's word tables, for a place. */
function serverWords(place: ReturnType<typeof placeOf>): string[] {
  const reasons = ["notOffered", "rtxCard", "loras", "inputs"] as const;
  return [
    ...Object.values(hostedWords(place)),
    ...Object.values(hostedGuestWords()),
    ...[1, 3].flatMap((cap) => [outputsWords(cap, false, place), outputsWords(cap, true, place)]),
    ...reasons.flatMap((reason) => [gateText({ ok: false, reason }, false, place), gateText({ ok: false, reason }, true, place)]),
    gateText({ ok: false, reason: "ownSetup", setup: needsGpu() }, false, place),
    gateText({ ok: false, reason: "outputs", cap: 2 }, false, place),
    ownGpuQuiet(place),
    ...Object.values(POOL_WORDS),
    ...Object.values(FILE_TROUBLE_WORDS),
    SITE_HIDDEN_WORDS,
    SITE_FAILED_WORDS,
  ];
}

/** Every word the place chip says for runs there, for a guest and an account, priced, free, waiting and refused. */
function chipWords(place: ReturnType<typeof placeOf>): string[] {
  const out: string[] = [];
  for (const audience of ["account", "guest"] as const)
    for (const pool of [undefined, { text: "" }, { text: "1 generation", wait: "ready in about 40 s" }, { text: "Free", wait: "starts when a GPU is free" }, { text: "You have 2 runs going.", refused: true }])
      for (const p of [runPlace({ audience, engine: "open", hosted: true, models: ["Z-Image Turbo"], pool, place, format: String })]) out.push(p.label, p.price, p.title, p.tip, p.send);
  return out.filter(Boolean);
}

describe("the words for runs on this install's GPUs", () => {
  it("never name the machinery, this studio's GPUs or ComfyUI, and never ask for Retry", () => {
    for (const place of [DEFAULT, NAMED]) {
      const words = [
        ...serverWords(place),
        ...chipWords(place),
        againWhere({ engine: "open", place: "pool" }, { placeholders: false, place }),
        ...(["queued", "running", "failed", "canceled"] as const).map((status) => listStatus({ status, place: "pool" })),
      ];
      for (const w of words) expect(w, w).not.toMatch(FORBIDDEN);
    }
  });

  it("say the place by its name, as a label and inside a sentence, with no verb that agrees with it", () => {
    expect(hostedWords(NAMED).notHosted).toBe("Your account can't run on Studio North GPUs right now. Your own GPU or key still works.");
    expect(hostedWords(DEFAULT).notHosted).toBe("Your account can't run on our GPUs right now. Your own GPU or key still works.");
    expect(outputsWords(3, false, NAMED)).toBe("Makes up to 3 at a time on Studio North GPUs. Pick 3 or fewer, or connect your own GPU in Settings.");
    expect(outputsWords(1, true, NAMED)).toBe("Makes one at a time. Pick one.");
    expect(runPlace({ audience: "account", engine: "open", hosted: true, pool: { text: "" }, place: NAMED, format: String })).toMatchObject({ label: "Studio North GPUs", title: "Runs on Studio North GPUs" });
    const agrees = new RegExp(`(Studio North GPUs|our GPUs|Our GPUs)\\s+(is|are|was|were|make|makes|run|runs|has|have)\\b`);
    for (const w of [...serverWords(NAMED), ...serverWords(DEFAULT), ...chipWords(NAMED), ...chipWords(DEFAULT)]) expect(w, w).not.toMatch(agrees);
  });

  it("one sentence for a run that can't be made, the same in the planner and the tile", () => {
    expect(POOL_WORDS.failed).toBe("Sorry, this one couldn't be made.");
    expect(SITE_FAILED_WORDS).toBe(POOL_WORDS.failed);
    expect(SITE_HIDDEN_WORDS).toBe("This result didn't pass the safety check, so it was removed. Not charged.");
  });

  it("the engine tips say runs are free on the place, a GPU of one's own optional", () => {
    const tips = [hostedStatus(), hostedStatus({ keys: ["fal"] }), hostedStatus({ keys: ["fal"], gpu: { connected: true, mode: "link", online: true } }), hostedStatus({ paidAllowed: false })].map((s) => accountEngine(s));
    expect(tips[0]).toMatchObject({ locked: { tip: "Free on Studio North GPUs. Add a fal.ai or Replicate key to use paid models." } });
    expect(tips[1]).toMatchObject({ tips: { open: "Open models, free on Studio North GPUs" } });
    expect(tips[2]).toMatchObject({ tips: { open: "Open models, free on Studio North GPUs or your GPU" } });
    expect(tips[3]).toMatchObject({ locked: { tip: "Free on Studio North GPUs." } });
    for (const t of tips) expect(JSON.stringify(t)).not.toMatch(FORBIDDEN);
  });
});

describe("the pages a visitor reads while hosted runs are on", () => {
  it("the home steps: runs on the place, then make something", () => {
    for (const viewer of [guestViewer, accountViewer]) {
      state.viewer = viewer;
      state.status = hostedStatus({ kind: viewer.account ? "account" : "guest" });
      const text = textOf(render(createElement(StartSteps)));
      expect(text).toContain("Runs on Studio North GPUs, or on your own GPU.");
      expect(text).toContain("Make something.");
      expect(text).toContain("Pick a studio and press Generate. Your own GPU or key is optional.");
      expect(text).toContain("Open the Video studio");
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it("a tile and a Library card: In line with its place, Working, then one sentence", () => {
    const pages = [
      render(createElement(PendingTile, { g: gen({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 3, etaSeconds: 130 } }), ratio: 1 })),
      render(createElement(PendingTile, { g: gen({ status: "running", message: POOL_WORDS.working, progress: 0.4 }), ratio: 1 })),
      render(createElement(FailedTile, { g: gen({ status: "failed", error: POOL_WORDS.failed }), ratio: 1, onRetry: () => {} })),
      render(createElement(StatusCover, { g: gen({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 3, etaSeconds: 130 } }) })),
      render(createElement(StatusCover, { g: gen({ status: "running", message: POOL_WORDS.working, progress: 0.4 }) })),
      render(createElement(StatusCover, { g: gen({ status: "failed", error: POOL_WORDS.failed }) })),
    ].map(textOf);
    expect(pages[3]).toContain("In line · 3rd · ready in about 2 min");
    expect(pages[4]).toContain("Working");
    expect(pages[5]).toContain("Sorry, this one couldn't be made.");
    expect(pages[5]).not.toContain("Couldn't generate this one");
    expect(listStatus({ status: "failed", place: "pool" })).toBe("Couldn't be made");
    expect(listStatus({ status: "queued", place: "pool" })).toBe("In line");
    expect(listStatus({ status: "running", place: "pool" })).toBe("Working");
    for (const t of pages) expect(t).not.toMatch(FORBIDDEN);
  });

  it("the feed's header names the place a result was made on", () => {
    notePlaceName(NAMED.label);
    const out = { url: "/api/files/a1", kind: "image" as const, contentType: "image/png", width: 1024, height: 1024 };
    const text = textOf(render(createElement(Feed, { items: [gen({ status: "succeeded", outputs: [out], completedAt: Date.now() })], empty: createElement("p", null, "Nothing yet") })));
    expect(text).toContain("Studio North GPUs");
    expect(text).not.toContain("Open source");
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("Settings → Your keys and the engine switch", () => {
    const keys = textOf([render(createElement(AccountKeysSection, { prices: "about $0.04 a picture" })), render(createElement(KeyInstead))].join(" "));
    expect(keys).toContain("On your key: up to 4 runs at once and 60 an hour.");
    expect(keys).toContain("Paid models: add your own fal.ai or Replicate key to use Nano Banana, Kling and Veo, billed to your account with them.");
    expect(keys).not.toContain("No GPU?");
    // A guest's switch (no tips of an account's own): open models run free on the place; the owner's words stay.
    expect(engineTip("open", null, NAMED)).toBe("Open models, free on Studio North GPUs");
    expect(engineTip("open", null, null)).toBe("Open-weight models running on your ComfyUI server");
    expect(engineTip("cloud", null, NAMED)).toBe("Frontier paid models via your fal.ai / Replicate key");
    state.viewer = guestViewer;
    state.status = hostedStatus({ kind: "guest" });
    expect(textOf(render(createElement(EngineSwitch, { value: "open", onChange: () => {} })))).not.toMatch(FORBIDDEN);
  });
});

describe("where runs go: the Run on list, Settings and the one-time note", () => {
  const gpu = { connected: true, online: true, device: "cuda:0 NVIDIA GeForce RTX 4090" };
  it("plain words, the place by its name, and no verb that agrees with it", async () => {
    const { placeRows, RUN_ON_FOOTER } = await import("@/lib/run-place");
    const { placeIntro } = await import("@/lib/place-intro");
    const { runsGoNowText } = await import("@/lib/run-on");
    const { runOnSiteAction, withKeyAction } = await import("@/lib/diagnose");
    const agrees = /(Studio North GPUs|our GPUs|Our GPUs)\s+(is|are|was|were|make|makes|run|runs|has|have|need|needs)\b/;
    for (const place of [NAMED, DEFAULT]) {
      const viewer = { kind: "account" as const, hosted: true, prefer: "pool" as const, placeName: place.label, gpu };
      const rows = [
        ...placeRows(viewer, { key: { provider: "fal", price: "≈ $0.04" } }, { text: "Free", wait: "ready in about 40 s" })!.rows,
        ...placeRows({ ...viewer, runOn: "gpu", gpu: { connected: true, online: false } }, { key: { provider: "replicate" } })!.rows,
      ].flatMap((r) => [r.label, r.sub]);
      const note = placeRows({ ...viewer, runOn: "key" }, { key: null })!.note!;
      const intros = [placeIntro({ ...viewer, ranOwn: true }, "Generate")!, placeIntro({ ...viewer, ranOwn: true, gpu: { connected: false }, keys: ["fal"] }, "Run")!].flatMap((i) => [i.lead, i.rest, i.keep.label]);
      state.status = hostedStatus({ placeName: place.label, gpu, keys: ["fal"] });
      const settings = textOf(render(createElement((await import("@/components/gpu/where-runs-go")).WhereRunsGo)));
      state.status = hostedStatus({ placeName: place.label });
      const nothing = textOf(render(createElement((await import("@/components/gpu/where-runs-go")).WhereRunsGo)));
      const words = [...rows, note, ...intros, RUN_ON_FOOTER, runsGoNowText(place), runOnSiteAction(place.label).label, withKeyAction("fal", "m", "t2i", "≈ $0.04").label, settings, nothing];
      for (const w of words) {
        expect(w, w).not.toMatch(FORBIDDEN);
        expect(w, w).not.toMatch(agrees);
      }
      expect(settings).toContain("Where your runs go");
      expect(settings).toContain(`Runs on ${place.text}: nothing to set up.`);
      expect(nothing).toContain(`Your runs go to ${place.text}. Connect a GPU or add a key to have a choice.`);
    }
  });
});
