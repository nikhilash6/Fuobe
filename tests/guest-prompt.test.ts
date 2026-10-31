import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A refused change shows one thing: its card (GuestPrompt: "Create a free account", "Connect your GPU"), never an error
// toast on top of it, and never a card over the sign-in page, whose own form says what went wrong.

const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: (m: string) => void toasts.error.push(m) }) }));
// The studios' hooks, called outside React: a mutation is its mutationFn, and the query client does nothing.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => new Proxy({}, { get: () => () => undefined }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: o.mutationFn }),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T,>(f: T) => f,
  useMemo: <T,>(f: () => T) => f(),
}));

import { useChatActions } from "@/components/assist/hooks";
import { useCanvasActions } from "@/components/canvas/use-canvas";
import { useCreateProject } from "@/components/cinema/hooks";
import { ApiError, useCreateSeries } from "@/components/content-factory/hooks";
import { useDubActions } from "@/components/dub/hooks";
import { readDocument } from "@/components/faceless/hooks";
import { uploadDerived } from "@/components/layers/render";
import { LayersRequestError, useLayerActions } from "@/components/layers/use-layers";
import { useCreateBrand } from "@/components/marketing/hooks";
import { useMoodboardActions } from "@/components/moodboards/hooks";
import { usePaletteActions } from "@/components/palettes/hooks";
import { send as shortsSend } from "@/components/shorts/hooks";
import { fileToSlot, type SlotValue } from "@/components/studio/media-slot";
import { useCreateSwapProject } from "@/components/swap-studio/hooks";
import { runGpuCheck } from "@/hooks/use-gpu";
import { askToSignUp, assetUsage, CONNECT_GPU_EVENT, enhance, GUEST_PROMPT_EVENT, refusalCard, signInHref, watchGuestRefusals } from "@/lib/api";
import { CONNECT_GPU_HEADER, CONNECT_GPU_MESSAGE, CONNECT_GPU_UPLOAD_MESSAGE, GUEST_HEADER, GUEST_LIBRARY_MESSAGE, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { refusalShown, toastError } from "@/lib/refusals";

const answer = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const guestRefusal = () => answer(401, { error: GUEST_RUN_MESSAGE }, { [GUEST_HEADER]: "1" });

let events: string[] = [];
/** What each card's event said (its detail): what was refused. */
let details: unknown[] = [];
let server: (url: string, init?: RequestInit) => Response = () => answer(200, {});

/** A page at `pathname` with the watcher installed: `window` is this global, as in a browser. */
function page(pathname: string, search = "") {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { pathname, search, href: `http://localhost${pathname}${search}` });
  vi.stubGlobal("dispatchEvent", (e: Event) => {
    events.push(e.type);
    details.push((e as CustomEvent).detail ?? null);
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => server(input instanceof Request ? new URL(input.url).pathname : String(input), init));
  watchGuestRefusals();
}

const picture = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" });

/** Upload a picture into an image tile, as Face Swap's Target photo does: what the tile was given. */
async function uploadToTile(): Promise<(SlotValue | null)[]> {
  const given: (SlotValue | null)[] = [];
  await fileToSlot(picture(), (v) => void given.push(v), "image");
  return given;
}

beforeEach(() => {
  events = [];
  details = [];
  toasts.error.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { __fuobeGuestFetch?: boolean }).__fuobeGuestFetch;
});

describe("a guest's refused upload (an image tile: Face Swap's Target photo)", () => {
  it("opens one card and shows no error toast on top of it", async () => {
    page("/apps/app-face-swap");
    server = (url, init) => (url === "/api/uploads" && init?.method === "POST" ? guestRefusal() : answer(200, {}));
    const given = await uploadToTile();
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    // The card is about the file: "Create a free account to add your own files".
    expect(details).toEqual([{ action: "upload" }]);
    expect(toasts.error).toEqual([]);
    // The local preview while it uploads, then the empty tile again.
    expect(given.map((v) => v && { uploading: v.uploading })).toEqual([{ uploading: true }, null]);
  });

  it("still toasts any other failure (too big, a server error)", async () => {
    page("/apps/app-face-swap");
    server = () => answer(413, { error: "That picture is over 25 MB." });
    await uploadToTile();
    expect(events).toEqual([]);
    expect(toasts.error).toEqual(["That picture is over 25 MB."]);
  });

  it("an account without its GPU gets Connect your GPU alone, about its files", async () => {
    page("/apps/app-face-swap");
    server = () => answer(403, { error: CONNECT_GPU_UPLOAD_MESSAGE, code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
    await uploadToTile();
    expect(events).toEqual([CONNECT_GPU_EVENT]);
    expect(details).toEqual([{ action: "upload" }]);
    expect(toasts.error).toEqual([]);
  });

  it("a clip's facts (read from an upload) count as adding a file too, whichever way fetch is called", async () => {
    page("/upscale");
    server = () => guestRefusal();
    await fetch("/api/media/probe", { method: "POST", body: "{}" });
    await fetch(new Request("http://localhost/api/uploads", { method: "POST", body: "x" }));
    expect(details).toEqual([{ action: "upload" }, { action: "upload" }]);
  });
});

describe("askToSignUp", () => {
  it("opens Create a free account about the visitor's own files, with no request sent", () => {
    page("/apps/app-face-swap");
    const sent = vi.fn(server);
    server = sent;
    askToSignUp();
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    expect(details).toEqual([{ action: "upload" }]);
    expect(sent).not.toHaveBeenCalled();
  });

  it("or about a run", () => {
    page("/image");
    askToSignUp("run");
    expect(details).toEqual([{ action: "run" }]);
  });
});

describe("a guest's refused run", () => {
  it("opens the card, and the error it throws says the card shows it already", async () => {
    page("/image");
    server = () => guestRefusal();
    const e = await enhance("a red coat", "image", "t2i").catch((err: unknown) => err);
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    // The card is about a run: "Create a free account to run this".
    expect(details).toEqual([{ action: "run" }]);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe(GUEST_RUN_MESSAGE);
    expect(refusalShown(e)).toBe(true);
  });

  it("a refused read opens nothing, so its own message is the one shown", async () => {
    page("/library");
    server = () => answer(401, { error: GUEST_LIBRARY_MESSAGE }, { [GUEST_HEADER]: "1" });
    const e = await assetUsage("abc").catch((err: unknown) => err);
    expect(events).toEqual([]);
    expect(refusalShown(e)).toBe(false);
    expect((e as Error).message).toBe(GUEST_LIBRARY_MESSAGE);
  });

  it("other errors are never marked as shown", () => {
    expect(refusalShown(new Error("Request failed (500)"))).toBe(false);
    expect(refusalShown(null)).toBe(false);
    expect(refusalShown("text")).toBe(false);
  });

  it("a studio's error toast stays quiet for it, and says any other failure", async () => {
    page("/storyboard");
    server = () => guestRefusal();
    toastError(await enhance("a red coat", "image", "t2i").catch((err: unknown) => err));
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    expect(toasts.error).toEqual([]);
    toastError(new Error("Couldn't start the film"));
    toastError(new Error(""), "Upload failed");
    expect(toasts.error).toEqual(["Couldn't start the film", "Upload failed"]);
  });
});

describe("each studio's own fetch helper", () => {
  // The first thing a guest tries in each studio: the error its helper throws says the card shows it already.
  const runs: [string, () => Promise<unknown>][] = [
    ["Assist: send a message", () => useChatActions().start({ text: "a red coat", engine: "cloud", autoApprove: false })],
    ["Canvas: New canvas", () => useCanvasActions().create({ name: "Untitled canvas" })],
    ["Cinema: Create project", () => useCreateProject().mutateAsync({ name: "Untitled project" })],
    ["Content Factory: a series", () => useCreateSeries().mutateAsync({ reference: null, engine: "cloud" })],
    ["Dub: a video", () => useDubActions().create.mutateAsync({ engine: "cloud", mode: "oneshot", video: "/api/files/clip.mp4", targets: ["es"] })],
    ["Explainer: read a document", () => readDocument(new File(["A red coat"], "notes.txt", { type: "text/plain" }), "cloud")],
    ["Layers: a project", () => useLayerActions().create({ source: "/api/files/photo.png", width: 640, height: 480 })],
    ["Layers: a picture for the model", () => uploadDerived(new Blob([new Uint8Array([1])], { type: "image/png" }), "mask")],
    ["Marketing: a brand", () => useCreateBrand().mutateAsync({ description: "A red coat label" })],
    ["Moodboards: a board", () => useMoodboardActions().create.mutateAsync({ name: "Coats", images: [], collages: [], engine: "cloud" })],
    ["Palettes: a palette", () => usePaletteActions().create.mutateAsync({ name: "Coats", colors: ["#aa2222"], source: "manual" })],
    ["Shorts and Genjutsu: a run", () => shortsSend("/api/genjutsu", "POST", {})],
    ["Swap Studio: a project", () => useCreateSwapProject().mutateAsync({ engine: "cloud" })],
    ["Your GPU: the check", () => runGpuCheck(() => {})],
  ];

  it.each(runs)("%s: a guest's 401 opens the card, and its error is marked", async (_, run) => {
    page("/studio");
    server = () => guestRefusal();
    const e = await run().catch((err: unknown) => err);
    expect(events).toEqual([GUEST_PROMPT_EVENT]);
    expect((e as Error).message).toBe(GUEST_RUN_MESSAGE);
    expect(refusalShown(e)).toBe(true);
    toastError(e);
    expect(toasts.error).toEqual([]);
  });

  it("an account without its GPU: Connect your GPU marks it the same way", async () => {
    page("/canvas/abc");
    server = () => answer(403, { error: CONNECT_GPU_MESSAGE, code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
    const e = await useCanvasActions()
      .create({ name: "Untitled canvas" })
      .catch((err: unknown) => err);
    expect(events).toEqual([CONNECT_GPU_EVENT]);
    expect(details).toEqual([{ action: "run" }]);
    expect(refusalShown(e)).toBe(true);
  });

  it("keeps each helper's own error: its class, status and body", async () => {
    page("/studio");
    server = () => guestRefusal();
    const assist = (await useChatActions()
      .start({ text: "a red coat", engine: "cloud", autoApprove: false })
      .catch((err: unknown) => err)) as Error & { status?: number };
    expect(assist.status).toBe(401);
    const canvas = (await useCanvasActions()
      .create({})
      .catch((err: unknown) => err)) as Error & { status?: number; body?: { error?: string } };
    expect([canvas.status, canvas.body?.error]).toEqual([401, GUEST_RUN_MESSAGE]);
    const series = await useCreateSeries()
      .mutateAsync({ reference: null, engine: "cloud" })
      .catch((err: unknown) => err);
    expect(series).toBeInstanceOf(ApiError);
    expect(refusalShown(series)).toBe(true);
    const layers = await useLayerActions()
      .create({ source: "/api/files/photo.png", width: 640, height: 480 })
      .catch((err: unknown) => err);
    expect(layers).toBeInstanceOf(LayersRequestError);
    expect((layers as LayersRequestError).status).toBe(401);
  });

  it("any other failure is never marked, so its toast still shows", async () => {
    page("/canvas");
    server = () => answer(500, { error: "The canvas couldn't be saved" });
    const e = await useCanvasActions()
      .create({ name: "Untitled canvas" })
      .catch((err: unknown) => err);
    expect(events).toEqual([]);
    expect(refusalShown(e)).toBe(false);
    toastError(e);
    expect(toasts.error).toEqual(["The canvas couldn't be saved"]);
  });
});

describe("the sign-in page", () => {
  it("never opens a card: a refusal there keeps its own message", async () => {
    page("/login", "?next=%2Fcolor-grade");
    server = () => guestRefusal();
    await uploadToTile();
    expect(events).toEqual([]);
    expect(toasts.error).toEqual([GUEST_RUN_MESSAGE]);
  });

  it("a wrong password is the form's own error, with no card", async () => {
    page("/login");
    server = () => answer(401, { error: "Wrong email or password" });
    const res = await fetch("/api/auth/login", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Wrong email or password");
    expect(events).toEqual([]);
  });
});

describe("refusalCard", () => {
  it("a guest's card comes back to the page it opened on", () => {
    const card = refusalCard("guest", { pathname: "/color-grade", search: "?look=noir" });
    expect(card).toEqual({ kind: "guest", here: "/color-grade?look=noir" });
    expect(card?.kind === "guest" && signInHref("login", card.here)).toBe("/login?next=%2Fcolor-grade%3Flook%3Dnoir");
  });

  it("Connect your GPU", () => {
    expect(refusalCard("gpu", { pathname: "/motions", search: "" })).toEqual({ kind: "gpu" });
  });

  it("none on the sign-in page, in any of its modes", () => {
    for (const search of ["", "?signup=1", "?owner=1", "?next=%2Fcolor-grade"]) {
      expect(refusalCard("guest", { pathname: "/login", search })).toBeNull();
      expect(refusalCard("gpu", { pathname: "/login", search })).toBeNull();
    }
  });
});
