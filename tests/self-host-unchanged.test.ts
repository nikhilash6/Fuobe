import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusInfo, ViewerInfo } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

/*
 * A self-hosted install with hosted runs off (the default: no FUOBE_HOSTED_RUNS) keeps every word and every element it
 * had before runs on this install's GPUs got their own place name and words. The golden files under
 * tests/golden/self-host were recorded from the code before those changes: the feed's tiles and header, a Library
 * card, the home steps, Settings → Your GPU and Your keys, the engine switch and its tips, the place chip's words for
 * every viewer and engine, Run again's words, and the account-limit words. A difference here is a change self-hosters
 * would see.
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-self-host-");
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_MODERATION_URL", "FUOBE_PLACE_NAME"]) delete process.env[k];

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

const { PendingTile, FailedTile, Feed } = await import("@/components/studio/feed");
const { StatusCover } = await import("@/components/library/asset-card");
const { StartSteps } = await import("@/components/home/home-islands");
const { AccountGpuSection } = await import("@/components/gpu/account-gpu-section");
const { AccountKeysSection, KeyInstead } = await import("@/components/keys/your-keys");
const { EngineSwitch } = await import("@/components/studio/engine-switch");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { runPlace } = await import("@/lib/run-place");
const { accountEngine } = await import("@/lib/your-keys");
const { againWhere } = await import("@/lib/demo-mode");
const { ACCOUNT_MESSAGES } = await import("@/server/account-files");
const auth = await import("@/server/auth");
const { visitorStatus } = await import("@/server/account-gpu");

const GOLDEN = "./golden/self-host";
const NOW = Date.parse("2026-11-01T12:00:00Z");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));

/** One element per line, so a golden file's difference reads as the words that changed. */
const lines = (html: string) => html.replace(/></g, ">\n<");

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
    createdAt: NOW - 90_000,
    updatedAt: NOW - 30_000,
    completedAt: null,
    ...o,
  }) as Generation;

const ownerViewer: ViewerInfo = { signedIn: true, owner: true, publicSignup: true };
const accountViewer: ViewerInfo = { signedIn: true, owner: false, publicSignup: true, account: { email: "ana@example.com" } };
const guestViewer: ViewerInfo = { signedIn: false, owner: false, publicSignup: true };

/** A visitor's status with hosted runs off: what the server sends a self-hoster's guests and accounts. */
function statusOf(v: Partial<NonNullable<StatusInfo["viewer"]>> = {}): StatusInfo {
  return {
    providers: { comfyui: { label: "Your GPU", configured: true } },
    demoMode: "off",
    engineMode: "both",
    cloudProvider: "auto",
    onboarded: true,
    viewer: { kind: "account", gpu: { connected: false }, keys: [], paidAllowed: true, ...v },
  } as StatusInfo;
}

const ownerStatus: StatusInfo = { providers: { comfyui: { label: "ComfyUI", configured: true } }, demoMode: "off", engineMode: "both", cloudProvider: "auto", onboarded: true } as StatusInfo;

beforeEach(() => {
  state.hydrated = true;
  state.viewer = undefined;
  state.status = undefined;
});

describe("a self-hosted install with hosted runs off", () => {
  it("has hosted runs off in this test", () => {
    expect(process.env.FUOBE_HOSTED_RUNS ?? "").toBe("");
  });

  it("the feed's tiles: in line, working, failed, stopped", async () => {
    const html = [
      render(createElement(PendingTile, { g: gen({ status: "queued", message: "Queued" }), ratio: 1 })),
      render(createElement(PendingTile, { g: gen({ status: "running", message: "Generating", progress: 0.42 }), ratio: 1 })),
      render(createElement(FailedTile, { g: gen({ status: "failed", error: "Your GPU ran out of memory. Try a smaller size or a shorter clip." }), ratio: 1, onRetry: () => {} })),
      render(createElement(FailedTile, { g: gen({ status: "canceled" }), ratio: 1, onRetry: () => {} })),
    ].map(lines);
    await expect(html.join("\n\n")).toMatchFileSnapshot(`${GOLDEN}/feed-tiles.html`);
  });

  it("the feed's header for a result on your GPU and in the cloud", async () => {
    const out = { url: "/api/files/a1", kind: "image" as const, contentType: "image/png", width: 1024, height: 1024 };
    const items = [
      gen({ id: "g-open", status: "succeeded", outputs: [out], completedAt: NOW - 20_000 }),
      gen({ id: "g-cloud", engine: "cloud", provider: "fal", modelId: "nano-banana", status: "succeeded", outputs: [out], costUsd: 0.04, completedAt: NOW - 20_000 }),
      gen({ id: "g-failed", status: "failed", error: "ComfyUI isn't answering. Start it again, and Fuobe goes on by itself." }),
    ];
    const html = render(createElement(Feed, { items, empty: createElement("p", null, "Nothing yet") }));
    await expect(lines(html)).toMatchFileSnapshot(`${GOLDEN}/feed.html`);
  });

  it("a Library card's cover in each state", async () => {
    const html = [
      render(createElement(StatusCover, { g: gen({ status: "queued", message: "Queued" }) })),
      render(createElement(StatusCover, { g: gen({ status: "running", message: "Generating", progress: 0.42 }) })),
      render(createElement(StatusCover, { g: gen({ status: "failed", error: "Your GPU ran out of memory. Try a smaller size or a shorter clip." }) })),
      render(createElement(StatusCover, { g: gen({ status: "canceled" }) })),
    ].map(lines);
    await expect(html.join("\n\n")).toMatchFileSnapshot(`${GOLDEN}/library-cover.html`);
  });

  it("the home steps for a guest, an account, an account with its GPU, and the owner", async () => {
    const out: string[] = [];
    for (const [viewer, status] of [
      [guestViewer, statusOf({ kind: "guest" })],
      [accountViewer, statusOf()],
      [accountViewer, statusOf({ gpu: { connected: true, mode: "link", online: true } })],
      [ownerViewer, ownerStatus],
    ] as const) {
      state.viewer = viewer;
      state.status = status;
      out.push(lines(render(createElement(StartSteps))));
    }
    await expect(out.join("\n\n")).toMatchFileSnapshot(`${GOLDEN}/home-steps.html`);
  });

  it("Settings → Your GPU and Your keys for an account", async () => {
    state.viewer = accountViewer;
    state.status = statusOf();
    const html = [render(createElement(AccountGpuSection)), render(createElement(AccountKeysSection, { prices: "about $0.04 a picture" })), render(createElement(KeyInstead))].map(lines);
    await expect(html.join("\n\n")).toMatchFileSnapshot(`${GOLDEN}/settings-account.html`);
  });

  it("the engine switch for an account with no key, and with a key", async () => {
    state.viewer = accountViewer;
    const out: string[] = [];
    for (const status of [statusOf(), statusOf({ keys: ["fal"] }), statusOf({ keys: ["fal"], gpu: { connected: true, mode: "link", online: true } })]) {
      state.status = status;
      out.push(lines(render(createElement(EngineSwitch, { value: "open", onChange: () => {} }))));
    }
    await expect(out.join("\n\n")).toMatchFileSnapshot(`${GOLDEN}/engine-switch.html`);
  });

  it("the words: the place chip for every viewer and engine, engine tips, Run again and the account limits", async () => {
    const format = (usd: number) => `$${usd.toFixed(2)}`;
    const place: Record<string, unknown> = {};
    for (const audience of ["owner", "account", "guest"] as const)
      for (const engine of ["open", "cloud", "browser"] as const)
        for (const gpu of [false, true])
          for (const costUsd of [undefined, 0.04]) {
            const key = `${audience} ${engine}${gpu ? " gpu" : ""}${costUsd ? " priced" : ""}`;
            place[key] = runPlace({ audience, engine, gpu, costUsd, models: ["Z-Image Turbo"], payer: audience === "account" && gpu ? "fal" : null, format });
            place[`${key} hosted-off`] = runPlace({ audience, engine, gpu, costUsd, models: ["Z-Image Turbo"], hosted: false, format });
          }
    const tips: Record<string, unknown> = {};
    for (const [name, v] of Object.entries({
      "no key": statusOf(),
      "a key": statusOf({ keys: ["fal"] }),
      "a key and a GPU": statusOf({ keys: ["fal", "replicate"], gpu: { connected: true, mode: "link", online: true } }),
      "open only": statusOf({ paidAllowed: false }),
      guest: statusOf({ kind: "guest" }),
    }))
      tips[name] = accountEngine(v);
    const again = {
      open: againWhere({ engine: "open" }, { placeholders: false }),
      cloud: againWhere({ engine: "cloud" }, { placeholders: false }, 0.42),
      placeholders: againWhere({ engine: "open" }, { placeholders: true }),
    };
    const words = { place, tips, again, accountLimits: ACCOUNT_MESSAGES };
    await expect(`${JSON.stringify(words, null, 2)}\n`).toMatchFileSnapshot(`${GOLDEN}/words.json`);
  });

  it("the status a guest and an account read: nothing of hosted runs, their place or their pick", async () => {
    auth.setPassword("install password");
    const a = auth.createAccount("self-host@example.com", "long enough");
    for (const s of [await visitorStatus(a), await visitorStatus(null)]) {
      expect(Object.keys(s.viewer).sort()).toEqual(["gpu", "keys", "kind", "paidAllowed"]);
      expect(JSON.stringify(s.viewer)).not.toMatch(/placeName|runOn|prefer|hosted|"pool"/);
    }
  });

  it("the engine switch: the browser's one switch, Cloud with nothing stored, and a saved key moves it to Cloud", async () => {
    const { engineSlot, engineAfterKeySave, SHARED_SLOT } = await import("@/lib/engine-pref");
    const { readEngine } = await import("@/lib/api");
    const a = auth.createAccount("self-host-engine@example.com", "long enough");
    for (const s of [await visitorStatus(a), await visitorStatus(null)]) {
      expect(engineSlot({ known: true, viewer: s.viewer, email: "self-host-engine@example.com" })).toEqual(SHARED_SLOT);
    }
    expect(engineSlot({ known: true })).toEqual(SHARED_SLOT);
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) });
    try {
      expect(readEngine()).toBe("cloud");
      stored.set("fuobe.engine", "open");
      expect(readEngine()).toBe("open");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(engineAfterKeySave(false)).toBe("cloud");
  });

  it("where runs go: the route doesn't exist, nothing reads a pick, and the composer and tools pick as before", async () => {
    vi.doMock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
    const route = await import("@/app/api/account/run-on/route");
    const { setRunOn } = await import("@/server/run-on");
    const { decidePlace } = await import("@/server/hosted-run");
    const { composerPlace, openCheckPlace, placeRows, retryRequest } = await import("@/lib/run-place");
    const { pickerRules } = await import("@/lib/pool-rules");
    const a = auth.createAccount("self-host-run-on@example.com", "long enough");
    const cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a.id).value}`;
    const put = await route.PUT(new Request("http://localhost:3000/api/account/run-on", { method: "PUT", headers: { cookie, host: "localhost:3000" }, body: JSON.stringify({ runOn: "site" }) }));
    expect(put.status).toBe(404);
    expect((await route.GET(new Request("http://localhost:3000/api/account/run-on", { headers: { cookie, host: "localhost:3000" } }))).status).toBe(404);
    // A pick left in the table changes nothing while hosted runs are off.
    setRunOn(a.id, { runOn: "site" });
    expect((await visitorStatus(a)).viewer).not.toHaveProperty("runOn");
    expect((await decidePlace(a, { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" }, undefined)).kind).toBe("own");
    // The browser: no pick is sent, so the composer, the tools' price check, the Run on list and Retry are as before.
    expect(composerPlace(null, undefined, true, false)).toEqual({ runOn: "own", place: "own" });
    expect(openCheckPlace({ audience: "account", gpu: true, hosted: false, preferPool: false })).toBeNull();
    expect(placeRows({ kind: "account", gpu: { connected: true, online: true } }, { key: { provider: "fal" } })).toBeNull();
    const request = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" };
    expect(retryRequest({ request }, false)).toBe(request);
    expect(pickerRules({ gpu: { connected: true }, pool: { deny: ["x"] } })).toBeUndefined();
  });

  it("runs that wait to enter the line: none is ever made, a run cut off before it started fails in today's words, and the limit of 4 counts every run", async () => {
    const { db } = await import("@/server/db");
    const { ensureRunner } = await import("@/server/generations");
    const { accountActiveRuns, ownActiveRuns } = await import("@/server/pool-limits");
    const a = auth.createAccount("self-host-holds@example.com", "long enough");
    const row = (id: string, place: "pool" | null, at: number) =>
      db()
        .prepare(
          `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, outputs_json, cost_usd, favorite, created_at, updated_at)
           VALUES (?, NULL, 'image', NULL, 'oss-z-image-turbo', 'open', 'comfyui', 'generate', 'image', 'queued', NULL, 'Submitting', 'a fox', ?, '[]', NULL, 0, ?, ?)`,
        )
        .run(id, JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", account: a.id, ...(place && { place }) }), at, at);
    // The studio's own limit of runs at once counts every run of the account, wherever it goes, as before.
    row("self-host-own-1", null, Date.now());
    row("self-host-site-1", "pool", Date.now());
    expect(ownActiveRuns(a.id)).toBe(accountActiveRuns(a.id));
    expect(ownActiveRuns(a.id)).toBe(2);
    // Rows whose GPU task never came (the app stopped in between), three minutes old: both fail as before, nothing waits.
    const old = Date.now() - 3 * 60_000;
    db().prepare("UPDATE generations SET created_at = ?, updated_at = ? WHERE id IN ('self-host-own-1', 'self-host-site-1')").run(old, old);
    ensureRunner();
    await globalThis.__fuobeRunner?.tick();
    for (const id of ["self-host-own-1", "self-host-site-1"]) {
      const g = db().prepare("SELECT status, error FROM generations WHERE id = ?").get(id) as { status: string; error: string };
      expect(g).toEqual({ status: "failed", error: "This run stopped before it started. Press Retry." });
    }
    expect((db().prepare("SELECT COUNT(*) AS n FROM pool_holds").get() as { n: number }).n).toBe(0);
  });
});
