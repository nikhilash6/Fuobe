import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A guest on a studio with hosted runs on: a photo can be attached before sign-up (kept in this browser, never uploaded),
 * the whole draft (words, settings, files) survives sign-up, and the run the guest pressed starts by itself once back as
 * an account when the price is unchanged; otherwise the new price shows and Run waits. With hosted runs off a guest's
 * file still opens "Create a free account", as before.
 */

/** This tab's storage, as a browser keeps it. */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
  clear = () => this.m.clear();
}
const storage = new MemoryStorage();
vi.stubGlobal("sessionStorage", storage);
const events: string[] = [];
const win = new EventTarget();
win.addEventListener("fuobe:guest-prompt", (e) => events.push(`guest:${(e as CustomEvent<{ action?: string }>).detail?.action}`));
vi.stubGlobal("window", win);

const draftLib = await import("@/lib/guest-draft");
const held = await import("@/lib/held-files");
const { heldSlot, uploadHeld } = await import("@/components/studio/media-slot");
const { useAskBeforeUpload } = await import("@/lib/api");
const { PLACEHOLDER } = await import("@/lib/composer");

const png = (name = "me.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const value = (o: Record<string, unknown> = {}) => ({ id: "v1", ref: "/api/files/uploads/a.png", preview: "/api/files/uploads/a.png", kind: "image" as const, ...o });
type Kept = import("@/lib/guest-draft").DraftLike & { prompt: string; params: Record<string, unknown>; presetId?: string } & Record<string, unknown>;
const draft = (o: Record<string, unknown> = {}): Kept => ({ prompt: "a fox", negativePrompt: "", modelId: "oss-z-image-turbo", params: { aspectRatio: "1:1" }, slots: {}, refs: [], presetOptions: {}, ...o }) as Kept;

beforeEach(() => {
  storage.clear();
  events.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("the draft a guest keeps through sign-up", () => {
  it("keeps everything: the words, the model, its settings and its files (a kept file without its page-only preview)", () => {
    const d = draft({
      presetId: "motion-orbit",
      slots: { image: value({ id: "h1", held: "h1", ref: PLACEHOLDER.image, preview: "blob:http://localhost/1" }), endImage: value({ id: "u1", uploading: true, preview: "blob:x" }) },
      refs: [value({ id: "r1" })],
      frames: [{ value: value({ id: "f1", held: "f1", preview: "blob:y" }), at: 0 }],
    });
    const kept = draftLib.keepDraft(d);
    expect(kept.prompt).toBe("a fox");
    expect(kept.params).toEqual({ aspectRatio: "1:1" });
    expect(kept.presetId).toBe("motion-orbit");
    expect(kept.slots.image).toMatchObject({ held: "h1", ref: PLACEHOLDER.image, preview: "" });
    // An upload that hadn't finished isn't there after a reload.
    expect(kept.slots.endImage).toBeNull();
    expect(kept.refs).toEqual([value({ id: "r1" })]);
    expect(kept.frames?.[0].value).toMatchObject({ held: "f1", preview: "" });
    expect(draftLib.heldValues(kept).map((v) => v.held)).toEqual(["h1", "f1"]);
  });

  it("is saved per page for a day, and read back", () => {
    draftLib.saveDraft("/image", draft({ prompt: "kept" }));
    expect(draftLib.readDraft<Kept>("/image")?.prompt).toBe("kept");
    expect(draftLib.readDraft("/video")).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60_000);
    expect(draftLib.readDraft("/image")).toBeNull();
    vi.restoreAllMocks();
    draftLib.clearDraft("/image");
    expect(draftLib.readDraft("/image")).toBeNull();
  });

  it("comes back with its kept files listed: uploading for an account (Run waits), shown again for a guest", () => {
    const kept = draftLib.keepDraft(draft({ slots: { image: value({ id: "h1", held: "h1", preview: "blob:1" }) }, refs: [value({ id: "r1" })] }));
    const account = draftLib.restoredDraft(kept, true);
    expect(account.held.map((v) => v.held)).toEqual(["h1"]);
    expect(account.draft.slots.image).toMatchObject({ held: "h1", uploading: true, preview: "" });
    expect(account.draft.refs[0]).toEqual(value({ id: "r1" }));
    expect(draftLib.restoredDraft(kept, false).draft.slots.image?.uploading).toBeUndefined();
  });
});

describe("the run a guest pressed", () => {
  const free = { amount: 0, priceVersion: "v1", text: "Free" };
  it("is kept for its page, taken once, and only within the hour", () => {
    draftLib.savePendingRun("/image", free);
    expect(draftLib.takePendingRun("/video")).toBeNull();
    expect(draftLib.takePendingRun("/image")).toMatchObject({ path: "/image", shown: free });
    expect(draftLib.takePendingRun("/image")).toBeNull();
    draftLib.savePendingRun("/image", free);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61 * 60_000);
    expect(draftLib.takePendingRun("/image")).toBeNull();
  });

  it("starts by itself only when the price is the one the guest saw; a new price is shown and waits for a click", () => {
    const step = (o: Partial<Parameters<typeof draftLib.pendingStep>[0]>) => draftLib.pendingStep({ settled: true, blocked: false, pool: true, shown: free, quote: { allowed: true, amount: 0, text: "Free" }, ...o });
    expect(step({})).toBe("start");
    expect(step({ settled: false })).toBe("wait");
    expect(step({ quote: { allowed: true, amount: 2, text: "2 units" } })).toBe("note");
    // Refused now (a limit, busy): Run is off and says why; nothing starts.
    expect(step({ quote: { allowed: false, amount: 0, text: "Free" } })).toBe("none");
    // A file that didn't come back: the blocker says so.
    expect(step({ blocked: true })).toBe("none");
    // No price to compare (the guest's run wasn't on this studio's GPUs): never by itself.
    expect(step({ shown: null })).toBe("none");
    expect(step({ pool: false })).toBe("none");
    // No billing service: no words either side, the same price.
    expect(draftLib.pendingStep({ settled: true, blocked: false, pool: true, shown: { amount: 0, priceVersion: "", text: "" }, quote: { allowed: true, amount: 0, text: "" } })).toBe("start");
  });
});

describe("a guest's files, kept in this browser", () => {
  it("are kept until sign-up and forgotten after", async () => {
    await held.holdFile("k1", png());
    expect((await held.readHeld("k1"))?.name).toBe("me.png");
    await held.dropHeld("k1");
    expect(await held.readHeld("k1")).toBeNull();
  });

  it("an attached photo gets its tile at once, with a stand-in for the price check, and nothing is uploaded", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const v = heldSlot(png(), "k2");
    expect(v).toMatchObject({ id: "k2", held: "k2", kind: "image", name: "me.png", ref: PLACEHOLDER.image });
    expect(v?.preview.startsWith("blob:")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await held.readHeld("k2"))?.name).toBe("me.png");
    // Over the size limit: not kept.
    expect(heldSlot({ size: 300 * 1024 * 1024, name: "big.png", type: "image/png" } as File, "k3")).toBeNull();
  });

  it("go up as the new account's own files, and the kept copy is dropped", async () => {
    await held.holdFile("k4", png("face.png"));
    const calls: { url: string; name: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, name: new Headers(init.headers).get("X-File-Name") });
      return Response.json({ id: "a1", url: "/api/files/uploads/face.png", kind: "image" }, { status: 201 });
    });
    const up = await uploadHeld({ id: "k4", held: "k4", ref: PLACEHOLDER.image, preview: "", kind: "image", name: "face.png", uploading: true });
    expect(calls).toEqual([{ url: "/api/uploads", name: "face.png" }]);
    expect(up).toEqual({ id: "k4", ref: "/api/files/uploads/face.png", preview: "/api/files/uploads/face.png", kind: "image", name: "face.png" });
    expect(await held.readHeld("k4")).toBeNull();
    // A file the browser no longer has leaves the draft (the composer then asks for it again).
    expect(await uploadHeld({ id: "k5", held: "k5", ref: PLACEHOLDER.image, preview: "", kind: "image" })).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", win);
  });
});

describe("attaching as a guest", () => {
  function Probe({ hold }: { hold?: boolean }) {
    const ask = useAskBeforeUpload(hold === undefined ? {} : { hold });
    return createElement("span", null, String(ask()));
  }
  const asGuest = (node: ReactNode, holds: boolean) => {
    const qc = new QueryClient();
    qc.setQueryData(["viewer"], { publicSignup: true, signedIn: false, owner: false, account: null });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(held.HoldFilesCtx.Provider, { value: holds }, node)));
  };

  it("in a studio that keeps a guest's files (hosted runs on): the file is taken, no sign-up card", () => {
    expect(asGuest(createElement(Probe), true)).toBe("<span>false</span>");
    expect(events).toEqual([]);
  });

  it("a voice sample still asks to sign up first; and with hosted runs off every file does, as before", () => {
    expect(asGuest(createElement(Probe, { hold: false }), true)).toBe("<span>true</span>");
    expect(asGuest(createElement(Probe), false)).toBe("<span>true</span>");
    expect(events).toEqual(["guest:upload", "guest:upload"]);
  });
});
