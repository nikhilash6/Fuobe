import fs from "node:fs";
import path from "node:path";
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
  key = (i: number) => [...this.m.keys()][i] ?? null;
  get length() {
    return this.m.size;
  }
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
const { heldToDrop } = await import("@/components/studio/attachments");
const { uploadKept } = await import("@/components/studio/guest-draft");
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

  it("keeps reference clips and sounds as it keeps references", () => {
    const clip = value({ id: "c1", held: "c1", kind: "video", preview: "blob:c" });
    const sound = value({ id: "s1", held: "s1", kind: "audio", preview: "blob:s" });
    const kept = draftLib.keepDraft(draft({ refClips: [clip, value({ id: "c2", kind: "video", uploading: true, preview: "blob:u" })], refAudios: [sound] }));
    expect(kept.refClips).toEqual([{ ...clip, preview: "" }]);
    expect(kept.refAudios).toEqual([{ ...sound, preview: "" }]);
    expect(draftLib.heldValues(kept).map((v) => v.held)).toEqual(["c1", "s1"]);
    // A draft with none keeps none.
    expect("refClips" in draftLib.keepDraft(draft())).toBe(false);
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

  const step = (o: Partial<Parameters<typeof draftLib.pendingStep>[0]>) =>
    draftLib.pendingStep({ settled: true, blocked: false, pool: true, shown: free, quote: { allowed: true, amount: 0, text: "Free" }, lost: false, same: true, ...o });

  it("starts by itself only when the price is the one the guest saw; a new price is shown and waits for a click", () => {
    expect(step({})).toBe("start");
    expect(step({ settled: false })).toBe("wait");
    expect(step({ quote: { allowed: true, amount: 2, text: "2 units" } })).toBe("note");
    // Refused now (a limit, busy): Run is off and says why; nothing starts.
    expect(step({ quote: { allowed: false, amount: 0, text: "Free" } })).toBe("none");
    // A required file missing: the blocker says so.
    expect(step({ blocked: true })).toBe("none");
    // No price to compare (the guest's run wasn't on this studio's GPUs): never by itself.
    expect(step({ shown: null })).toBe("none");
    expect(step({ pool: false })).toBe("none");
    // No billing service: no words either side, the same price.
    expect(step({ shown: { amount: 0, priceVersion: "", text: "" }, quote: { allowed: true, amount: 0, text: "" } })).toBe("start");
  });

  it("never starts without a kept file that didn't come back, even in a slot the run could do without", () => {
    // When every run costs the same ("Free") and a reference photo or start frame is optional, only the lost file
    // stops it, and the person is asked to add it again.
    expect(step({ lost: true })).toBe("lost");
    expect(step({ lost: true, settled: false })).toBe("lost");
  });

  it("a kept file that didn't come back is said before it leaves the draft (in the same turn, so the run can't start first)", async () => {
    const order: string[] = [];
    const kept = [value({ id: "h1", held: "h1" }), value({ id: "h2", held: "h2" })];
    await uploadKept(kept, async (v) => (v.id === "h1" ? { ...v, held: undefined, ref: "/api/files/uploads/h1.png" } : null), {
      lost: () => order.push("lost"),
      swap: (id, v) => order.push(`${id}:${v ? "up" : "gone"}`),
    });
    expect(order).toEqual(["h1:up", "lost", "h2:gone"]);
  });

  it("starts by itself only on the draft Run was pressed on; a draft edited after Run waits for a click", () => {
    const pressed = draft({ slots: { image: value({ id: "h1", held: "h1", ref: PLACEHOLDER.image, preview: "blob:1" }) } });
    draftLib.saveDraft("/image", pressed);
    draftLib.savePendingRun("/image", free, pressed);
    const run = draftLib.takePendingRun("/image")!;
    expect(run.draft).toBeTruthy();
    // Read back after the sign-up: the same draft.
    expect(draftLib.sameDraft(run, draftLib.readDraft("/image"))).toBe(true);
    // Edited while still a guest (the draft goes on being saved): not the one pressed.
    draftLib.saveDraft("/image", { ...pressed, prompt: "a fox in the rain" });
    expect(draftLib.sameDraft(run, draftLib.readDraft("/image"))).toBe(false);
    draftLib.saveDraft("/image", { ...pressed, slots: {} });
    expect(draftLib.sameDraft(run, draftLib.readDraft("/image"))).toBe(false);
    // A run kept with no draft to compare never starts by itself.
    expect(draftLib.sameDraft({}, draftLib.readDraft("/image"))).toBe(false);
    expect(step({ same: false })).toBe("ask");
    expect(step({ same: false, quote: { allowed: false, amount: 0, text: "Free" } })).toBe("none");
  });

  it("the run a guest pressed comes back with the words it was pressed on, even when the link brought other words", () => {
    // The sign-up returns to the page's address, ?prompt= and all: the guest's own words win for the run it pressed.
    expect(draftLib.restoredPrompt("a cat", "a fox in the rain", true)).toBe("a fox in the rain");
    // No run pressed (or a draft edited after Run): the link's words win, as they do for the words kept per page.
    expect(draftLib.restoredPrompt("a cat", "a fox in the rain", false)).toBe("a cat");
    expect(draftLib.restoredPrompt("", "a fox in the rain", false)).toBe("a fox in the rain");
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

  it("each studio's draft forgets only the files it held itself: one taken out of a draft never takes another studio's", () => {
    // Two studio pages open at once (/image and /video), each with its own draft and its own list.
    const image = new Set<string>();
    const video = new Set<string>();
    expect(heldToDrop(image, new Set(["x"]))).toEqual([]);
    // The Video studio's draft never held x: nothing of the Image studio's is dropped there.
    expect(heldToDrop(video, new Set())).toEqual([]);
    expect(heldToDrop(video, new Set(["y"]))).toEqual([]);
    expect(heldToDrop(video, new Set())).toEqual(["y"]);
    // x is still in the Image studio's draft: kept, until that draft lets it go.
    expect(heldToDrop(image, new Set(["x"]))).toEqual([]);
    expect(heldToDrop(image, new Set())).toEqual(["x"]);
    expect(heldToDrop(image, new Set())).toEqual([]);
  });

  it("are cleared once nobody needs them: after a day, and when no draft of an open tab holds them", () => {
    const now = Date.now();
    const rows = [
      { id: "old", at: now - 24 * 60 * 60_000 - 1, tab: "t1" },
      { id: "mine-kept", at: now, tab: "t1" },
      { id: "mine-gone", at: now, tab: "t1" },
      { id: "open-tab", at: now, tab: "t2" },
      { id: "closed-tab", at: now, tab: "t3" },
      { id: "no-tab", at: now },
    ];
    // A guest's studio page in tab t1, with t2 open too.
    expect(held.heldToSweep(rows, { now, tab: "t1", keep: new Set(["mine-kept"]), open: new Set(["t1", "t2"]) })).toEqual(["old", "mine-gone", "closed-tab", "no-tab"]);
    // A browser that can't tell which tabs are open: another tab's files stay until their day is up.
    expect(held.heldToSweep(rows, { now, tab: "t1", keep: new Set(["mine-kept"]), open: null })).toEqual(["old", "mine-gone", "no-tab"]);
    // Anyone else (or before who is looking is known): only the files older than a day.
    expect(held.heldToSweep(rows, { now, tab: "t1", keep: null, open: null })).toEqual(["old"]);
  });

  it("the files a tab may still need are those its saved drafts hold, on any page", () => {
    draftLib.saveDraft("/image", draft({ slots: { image: value({ id: "a", held: "a" }) } }));
    draftLib.saveDraft("/video", draft({ refs: [value({ id: "b", held: "b" }), value({ id: "c" })] }));
    expect([...draftLib.savedHeldIds()].sort()).toEqual(["a", "b"]);
  });

  it("each tab marks its files as in use while a page of it is open; a duplicated tab takes an id of its own", async () => {
    globalThis.__fuobeHeldTab = undefined;
    storage.setItem("fuobe:held-tab", "copied");
    // The tab it was copied from still has a page open.
    let release = () => {};
    void navigator.locks.request("fuobe-held:copied", () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 10));
    const tab = await held.claimTab();
    expect(tab).not.toBe("copied");
    expect(storage.getItem("fuobe:held-tab")).toBe(tab);
    expect(await held.claimTab()).toBe(tab);
    const names = ((await navigator.locks.query()).held ?? []).map((l) => l.name);
    expect(names).toContain(`fuobe-held:${tab}`);
    release();
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

  it("a recording, or a drawing on a kept picture, is uploaded as soon as it is made: the guest signs up first", () => {
    const src = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    // The Record chip (VoicePicker's recorder) and its Upload button ask before the microphone or the file chooser.
    expect(src("src/components/studio/voice-recorder.tsx")).toContain("useAskBeforeUpload({ hold: false })");
    expect(src("src/components/studio/audio-controls.tsx")).toContain("useAskBeforeUpload({ hold: false })");
    // Paint area and Draw on a kept picture ask before the editor opens, and it never opens by itself.
    const sketch = src("src/components/studio/sketch-tools.tsx");
    expect(sketch).toContain("useAskBeforeUpload({ hold: false })");
    expect(sketch).toContain("if (held && askFirst()) return;");
    expect(sketch).toContain("autoOpen && !held");
    expect(src("src/components/studio/composer.tsx")).toContain("held={!!draft.slots.image.held}");
  });
});
