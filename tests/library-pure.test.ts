import { describe, expect, it } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { applyToList, applyToPages, applyToThread, backoff, needsCatchUp, parseSse, shareById, sharePagesById, streamResponse, toChannelMessage, toStreamEvent } from "@/lib/generation-stream";
import {
  buildEntries,
  byDeleted,
  byNewest,
  byPinned,
  childFolders,
  cursorAfter,
  dayLabel,
  describeUses,
  downloadName,
  filterToSearch,
  folderAndDescendants,
  folderMoveError,
  folderPath,
  folderTree,
  freeName,
  isHelperFeature,
  matchesFilter,
  MAX_FOLDER_DEPTH,
  splitByDate,
  trashDaysLeft,
  userTitle,
  zipSegment,
  type Folder,
} from "@/lib/library";
import { toSrt, toVtt } from "@/lib/cues";
import { cueTime, layerInfo, modelPreview, outputActions, shownOutputs, textOf } from "@/lib/output-actions";
import { filtersFor, hasFilters, NO_FILTERS, type Filters } from "@/components/library/filters";

let n = 0;
function gen(p: Partial<Generation> = {}): Generation {
  n++;
  return {
    id: p.id ?? `g${String(n).padStart(3, "0")}`,
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "mock",
    op: "t2i",
    kind: "image",
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: [{ url: `/api/files/outputs/d/${p.id ?? n}.png`, kind: "image" }],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1000 + n,
    updatedAt: 1000 + n,
    completedAt: null,
    deletedAt: null,
    folderId: null,
    ...p,
  };
}

describe("outputActions", () => {
  const ids = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).map((a) => `${a.placement}:${a.id}`);

  it("gives images Animate first, Download and Favorite on the bar, the rest in the menu", () => {
    expect(ids(gen(), { reuse: true })).toEqual([
      "primary:animate",
      "bar:download",
      "bar:favorite",
      "menu:edit",
      "menu:upscale",
      "menu:reference",
      "menu:grade",
      "menu:layers",
      "menu:genjutsu",
      "menu:save-character",
      "menu:reuse",
      "menu:make-skill",
      "menu:copy-prompt",
      "menu:share",
      "menu:pin",
      "menu:review",
      "menu:delete",
    ]);
    const [animate, download] = outputActions(gen({ id: "abcdef123456" }), 0);
    expect(animate.href).toBe("/video?image=%2Fapi%2Ffiles%2Foutputs%2Fd%2Fabcdef123456.png");
    expect(download.download).toBe("a-fox-abcdef.png");
    expect(download.href).toBe("/api/files/outputs/d/abcdef123456.png?download=a-fox-abcdef.png");
  });

  it("gives SVG results no raster hand-offs, but keeps them on demo placeholders", () => {
    const svg = (p: Partial<Generation>, o: Partial<Generation["outputs"][number]> = {}) => gen({ provider: "fal", outputs: [{ url: "/api/files/outputs/d/logo.svg", kind: "image", contentType: "image/svg+xml", ...o }], ...p });
    expect(ids(svg({}))).toEqual(["bar:download", "bar:favorite", "menu:make-skill", "menu:copy-prompt", "menu:share", "menu:pin", "menu:review", "menu:delete"]);
    expect(ids(svg({}, { url: "https://v3.fal.media/files/x/logo.svg", contentType: undefined }))[0]).toBe("bar:download");
    expect(ids(svg({ feature: "upload", provider: "local" }))).toEqual(["bar:download", "menu:delete-upload"]);
    // A demo picture is an SVG standing in for a raster result: it can still be animated (a demo Vectorize result can't).
    expect(ids(svg({ provider: "mock", op: "t2i" }))[0]).toBe("primary:animate");
    expect(ids(svg({ provider: "mock", op: "vectorize" }))[0]).toBe("bar:download");
    expect(ids(gen({ outputs: [{ url: "/api/files/o/a.png", kind: "image", contentType: "image/png" }] }))[0]).toBe("primary:animate");
  });

  it("gives videos Extend first and the video hand-offs", () => {
    const g = gen({ kind: "video", op: "t2v", outputs: [{ url: "/api/files/o/v.mp4", kind: "video", draftId: "d1" }] });
    expect(ids(g)).toEqual([
      "primary:extend",
      "bar:download",
      "bar:favorite",
      "menu:reframe",
      "menu:lipsync",
      "menu:upscale",
      "menu:add-sound",
      "menu:split-soundtrack",
      "menu:grade",
      "menu:genjutsu",
      "menu:finalize",
      "menu:make-skill",
      "menu:copy-prompt",
      "menu:share",
      "menu:pin",
      "menu:review",
      "menu:delete",
    ]);
  });

  it("offers Make a skill right after Reuse settings, on finished results only", () => {
    const menu = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).filter((a) => a.placement === "menu").map((a) => a.id);
    const m = menu(gen(), { reuse: true });
    expect(m.indexOf("make-skill")).toBe(m.indexOf("reuse") + 1);
    expect(outputActions(gen(), 0).find((a) => a.id === "make-skill")).toEqual({ id: "make-skill", label: "Make a skill from this…", placement: "menu" });
    for (const status of ["queued", "running", "failed", "canceled"] as const) expect(menu(gen({ status }))).not.toContain("make-skill");
    expect(menu(gen({ deletedAt: 5 }))).not.toContain("make-skill");
    expect(menu(gen({ feature: "upload" }))).not.toContain("make-skill");
  });

  it("handles audio, text, 3D, layers, favorites and the Trash", () => {
    expect(ids(gen({ kind: "audio", outputs: [{ url: "/a.wav", kind: "audio" }] }))[0]).toBe("primary:lipsync");
    const text = gen({ kind: "text", op: "transcribe", outputs: [{ url: "/t.txt", kind: "text", text: "Hi", meta: { cues: [{ start: 0, end: 1.5, text: "Hi" }] } }] });
    expect(ids(text).slice(0, 4)).toEqual(["primary:copy-text", "bar:download", "bar:favorite", "menu:download-srt"]);
    expect(outputActions(text, 0)[1].label).toBe("Download .txt");
    const glb = gen({ kind: "model3d", op: "image-to-3d", outputs: [{ url: "/m.glb", kind: "model3d" }] });
    expect(ids(glb).slice(0, 2)).toEqual(["primary:view-3d", "bar:download"]);
    expect(ids(glb, { inViewer: true })[0]).toBe("bar:download");
    const layers = gen({ op: "layers", outputs: [{ url: "/l0.png", kind: "image" }, { url: "/l1.png", kind: "image" }] });
    expect(outputActions(layers, 1).find((a) => a.id === "download-all")?.href).toBe(`/api/generations/zip?ids=${layers.id}`);
    expect(outputActions(gen({ favorite: true }), 0)[2].label).toBe("Unfavorite");
    expect(ids(gen({ deletedAt: 5 }))).toEqual(["primary:restore", "bar:download", "menu:delete-forever"]);
    expect(ids(gen({ feature: "upload" }))).not.toContain("menu:delete");
    expect(ids(gen({ feature: "upload" }))).not.toContain("bar:favorite");
    expect(outputActions(gen(), 3)).toEqual([]);
  });
});

describe("text, layer and 3D outputs", () => {
  it("formats cues for the viewer and as SRT / VTT (one writer, src/lib/cues.ts)", () => {
    expect(cueTime(75.5)).toBe("1:15.5");
    expect(cueTime(3725.04)).toBe("1:02:05");
    const cues = [{ start: 0, end: 1.25, text: " Hello " }, { start: 1.25, end: 3, text: "there" }];
    expect(toSrt(cues)).toBe("1\n00:00:00,000 --> 00:00:01,250\nHello\n\n2\n00:00:01,250 --> 00:00:03,000\nthere\n");
    expect(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nHello\n")).toBe(true);
    // A transcript saved as .srt offers .txt and .vtt; one saved as text offers .srt and .vtt.
    const srt = gen({ kind: "text", op: "transcribe", outputs: [{ url: "/t.srt", kind: "text", text: "Hello\nthere", meta: { cues } }] });
    expect(outputActions(srt, 0).map((a) => a.id)).toEqual(expect.arrayContaining(["download-txt", "download-vtt"]));
    expect(outputActions(srt, 0).map((a) => a.id)).not.toContain("download-srt");
    expect(textOf({ meta: { cues: [{ start: 0, end: 1, text: "a" }, { start: 1, end: 2, text: "b" }] } })).toBe("a\nb");
  });

  it("reads layer names and 3D previews from meta", () => {
    expect(layerInfo({ meta: { name: "Logo", z: 3 } }, 1)).toEqual({ name: "Logo", z: 3 });
    expect(layerInfo({ meta: { layer: { name: "Sky", z: 0 } } }, 0)).toEqual({ name: "Sky", z: 0 });
    expect(layerInfo({}, 2)).toEqual({ name: "Layer 3", z: 2 });
    const o = { url: "/m.glb", kind: "model3d" as const, meta: { poster: "/p.png" } };
    expect(modelPreview({ outputs: [o, { url: "/t.mp4", kind: "video" }] }, o)).toEqual({ poster: "/p.png", video: "/t.mp4" });
  });
});

describe("stream reducer", () => {
  const ev = (g: Generation) => ({ type: "generation" as const, generation: g });

  it("parses server-sent events across chunk boundaries", () => {
    const a = parseSse(': ping\n\nevent: generation\ndata: {"id":"a"}\n\nevent: deleted\ndata: {"id"');
    expect(a.events).toEqual([{ event: "generation", data: '{"id":"a"}' }]);
    const b = parseSse(`${a.rest}:"b"}\n\n`);
    expect(b.events).toEqual([{ event: "deleted", data: '{"id":"b"}' }]);
    expect(toStreamEvent(b.events[0])).toEqual({ type: "deleted", id: "b" });
    expect(toStreamEvent({ event: "generation", data: "nope" })).toBeNull();
    expect(toStreamEvent({ event: "generation", data: JSON.stringify(gen({ id: "x" })) })?.type).toBe("generation");
  });

  it("patches by id and keeps unchanged lists identical", () => {
    const a = gen({ status: "running" });
    const b = gen();
    const list = [b, a];
    const done = { ...a, status: "succeeded" as const, updatedAt: a.updatedAt + 5 };
    const next = applyToList(list, {}, ev(done))!;
    expect(next).not.toBe(list);
    expect(next[1]).toBe(done);
    expect(next[0]).toBe(b); // structural sharing: untouched items keep their identity
    expect(applyToList(next, {}, ev({ ...a, updatedAt: a.updatedAt - 1 }))).toBe(next); // late event
    expect(applyToList(list, {}, { type: "deleted", id: "missing" })).toBe(list);
    expect(applyToList(list, {}, { type: "deleted", id: a.id })).toEqual([b]);
    expect(applyToList(undefined, {}, ev(a))).toBeUndefined();
  });

  it("inserts new matching ones in order and drops ones that stop matching", () => {
    const old = gen();
    const list = [old];
    const fresh = gen();
    expect(applyToList(list, {}, ev(fresh))).toEqual([fresh, old]);
    expect(applyToList(list, { kind: "video" }, ev(fresh))).toBe(list);
    expect(applyToList(list, { features: ["vid*"] }, ev(gen({ feature: "video" })))?.length).toBe(2);
    const fav = gen({ favorite: true });
    expect(applyToList([fav], { favorites: true }, ev({ ...fav, favorite: false, updatedAt: fav.updatedAt + 1 }))).toEqual([]);
    expect(applyToList([fav], {}, ev({ ...fav, deletedAt: 9, updatedAt: fav.updatedAt + 1 }))).toEqual([]);
    // A full list doesn't take items older than what it shows (they're on an unloaded page).
    const full = [gen(), gen()].reverse();
    const older = gen({ createdAt: 1 });
    expect(applyToList(full, { limit: 2 }, ev(older))).toBe(full);
  });

  it("patches paged lists and Assist threads", () => {
    const p1 = [gen(), gen()].reverse();
    const p2 = [gen({ createdAt: 10 }), gen({ createdAt: 5 })];
    const data = { pages: [p1, p2], pageParams: [undefined, p1[1].createdAt] };
    const moved = { ...p2[1], favorite: true, updatedAt: 99_999 };
    const next = applyToPages(data, {}, ev(moved))!;
    expect(next.pages[0]).toBe(p1);
    expect(next.pages[1][1].favorite).toBe(true);
    const fresh = gen();
    expect(applyToPages(data, {}, ev(fresh))!.pages[0][0]).toBe(fresh);
    expect(applyToPages(data, {}, { type: "deleted", id: p2[0].id })!.pages[1]).toHaveLength(1);
    expect(applyToPages({ pages: [[]], pageParams: [undefined] }, {}, ev(fresh))!.pages[0]).toEqual([fresh]);

    const view = { thread: { id: "t" }, generations: [p1[0]] };
    expect(applyToThread(view, ev(fresh))).toBe(view);
    expect(applyToThread(view, ev({ ...p1[0], favorite: true, updatedAt: 99_999 }))!.generations[0].favorite).toBe(true);
    expect(applyToThread(view, { type: "deleted", id: p1[0].id })!.generations).toEqual([]);
  });

  it("shares unchanged generations by id when the list shifts (one new result at the top)", () => {
    const a = gen();
    const b = gen();
    const prev = [b, a];
    const fresh = gen();
    // What the server returns next: new objects (JSON), shifted by one.
    const next = JSON.parse(JSON.stringify([fresh, b, a])) as Generation[];
    const shared = shareById(prev, next) as Generation[];
    expect(shared[1]).toBe(b);
    expect(shared[2]).toBe(a);
    expect(shareById(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev);
    const changed = shareById(prev, [{ ...b, status: "failed" }, a]) as Generation[];
    expect(changed[0]).not.toBe(b);
    expect(changed[1]).toBe(a);
    const pages = { pages: [[b], [a]], pageParams: [undefined, b.createdAt] };
    const morePages = sharePagesById(pages, JSON.parse(JSON.stringify({ pages: [[fresh, b], [a]], pageParams: [null, b.createdAt] }))) as { pages: Generation[][] };
    expect(morePages.pages[0][1]).toBe(b);
    expect(morePages.pages[1]).toBe(pages.pages[1]);
  });

  it("backs off between reconnects", () => {
    expect([0, 1, 2, 10].map((a) => backoff(a))).toEqual([1000, 2000, 4000, 30_000]);
    expect(backoff(0, true)).toBe(300_000);
  });
});

describe("library helpers", () => {
  it("matches filters like the server", () => {
    const g = gen({ prompt: "Neon KOI pond", request: { feature: "image", modelId: "m1", prompt: "neon koi" }, folderId: "f1", modelId: "m1", status: "failed" });
    expect(matchesFilter(g, { q: "koi" })).toBe(true);
    expect(matchesFilter(g, { q: "fox" })).toBe(false);
    expect(matchesFilter(g, { folderId: "f1", models: ["m1"], statuses: ["failed"] })).toBe(true);
    expect(matchesFilter(g, { since: g.createdAt + 1 })).toBe(false);
    expect(matchesFilter(g, { trashed: true })).toBe(false);
  });

  it("names downloads and counts Trash days", () => {
    expect(downloadName(gen({ id: "zzzzzz999" }), { url: "/x/out.webm", kind: "video" }, 1)).toBe("a-fox-zzzzzz-2.webm");
    const now = Date.UTC(2026, 9, 17);
    expect(trashDaysLeft(now - 29.5 * 86_400_000, now)).toBe(1);
    expect(trashDaysLeft(now - 40 * 86_400_000, now)).toBe(0);
  });

  it("splits by date", () => {
    const now = new Date(2026, 9, 17, 15).getTime();
    expect(dayLabel(now, now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 16, 23).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 12, 9).getTime(), now)).toBe("Mon, Oct 12");
    expect(dayLabel(new Date(2025, 0, 2).getTime(), now)).toBe("Jan 2, 2025");
    const items = [now, now - 1000, new Date(2026, 9, 16, 8).getTime()].map((t) => ({ t }));
    expect(splitByDate(items, (x) => x.t, now).map((s) => [s.label, s.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
    ]);
  });

  it("stacks a batch into one card titled with the user's idea", () => {
    const frame = (i: number) =>
      gen({
        batchId: "b1",
        feature: "storyboard",
        prompt: `Frame ${i + 1} of a storyboard: …`,
        request: { feature: "storyboard", modelId: "m", prompt: "internal", frame: { scene: `establishing wide shot: A lighthouse keeper finds a bottle — beat ${i + 1} of 2`, index: i, of: 2 } },
      });
    const film = gen({ batchId: "b1-film", op: "concat", prompt: "x", request: { feature: "storyboard-film", modelId: "join-clips", step: { label: "Film · 2 shots", index: 2, of: 3 } } });
    const solo = gen();
    const entries = buildEntries([solo, film, frame(1), frame(0)]);
    expect(entries.map((e) => e.type)).toEqual(["single", "stack"]);
    const stack = entries[1];
    expect(stack.type === "stack" && stack.title).toBe("A lighthouse keeper finds a bottle");
    expect(stack.type === "stack" && stack.label).toBe("Storyboard · 2 frames + film");
    expect(stack.type === "stack" && stack.items[0].request.frame?.index).toBe(0);
    const takes = [gen({ batchId: "t" }), gen({ batchId: "t" })];
    const t = buildEntries(takes)[0];
    expect(t.type === "stack" && [t.title, t.label]).toEqual(["a fox", "2 takes"]);
    expect(buildEntries(takes, { stacks: false })).toHaveLength(2);
  });
});

describe("round-3 fixes", () => {
  it("pages with a timestamp + id cursor and orders the Trash like the server", () => {
    const g = gen({ id: "abc123", createdAt: 500, deletedAt: 900 });
    expect(cursorAfter(g)).toBe("500:abc123");
    expect(cursorAfter(g, true)).toBe("900:abc123");
    expect(cursorAfter(gen({ deletedAt: null }), true)).toBeUndefined();
    expect(filterToSearch({ limit: 60 }, "500:abc123").get("before")).toBe("500:abc123");
    // Same deletion time (one bulk trash): id descending, as the server's ORDER BY.
    const a = gen({ id: "a", deletedAt: 5, createdAt: 9 });
    const b = gen({ id: "b", deletedAt: 5, createdAt: 1 });
    expect([a, b].sort(byDeleted).map((x) => x.id)).toEqual(["b", "a"]);
    expect([a, b].sort(byNewest).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("decides what to do with the stream's answer and when to catch up", () => {
    const sse = { ok: true, status: 200, contentType: "text/event-stream; charset=utf-8", hasBody: true };
    expect(streamResponse(sse, 3)).toEqual({ open: true });
    // No stream on this server: poll, look again in 5 minutes.
    expect(streamResponse({ ...sse, ok: false, status: 404 }, 0)).toEqual({ open: false, retryIn: 300_000 });
    expect(streamResponse({ ...sse, contentType: "text/html" }, 0)).toEqual({ open: false, retryIn: 300_000 });
    // A guest or an account: no content (the proxy answers 204, which the browser logs as no error), same wait.
    expect(streamResponse({ ok: true, status: 204, contentType: null, hasBody: false }, 0)).toEqual({ open: false, retryIn: 300_000 });
    // A server error backs off.
    expect(streamResponse({ ...sse, ok: false, status: 502 }, 2)).toEqual({ open: false, retryIn: 4000 });
    expect(needsCatchUp(false, true, false)).toBe(false); // first connection: the lists just loaded
    expect(needsCatchUp(false, true, true)).toBe(true); // back after a drop or a hand-over
    expect(needsCatchUp(true, true, true)).toBe(false);
    expect(needsCatchUp(true, false, true)).toBe(false);
  });

  it("only passes on well-formed messages between tabs", () => {
    const g = gen();
    expect(toChannelMessage({ type: "event", ev: { type: "generation", generation: g } })).toEqual({ type: "event", ev: { type: "generation", generation: g } });
    expect(toChannelMessage({ type: "event", ev: { type: "deleted", id: "x" } })).toEqual({ type: "event", ev: { type: "deleted", id: "x" } });
    expect(toChannelMessage({ type: "state", connected: true })).toEqual({ type: "state", connected: true });
    expect(toChannelMessage({ type: "hello" })).toEqual({ type: "hello" });
    // "Anyone on screen?" and its answer (no notification while you're looking at another Fuobe tab).
    expect(toChannelMessage({ type: "seen?", id: "q1" })).toEqual({ type: "seen?", id: "q1" });
    expect(toChannelMessage({ type: "seen", id: "q1", extra: 1 })).toEqual({ type: "seen", id: "q1" });
    for (const bad of [null, "x", { type: "state" }, { type: "event", ev: { type: "generation", generation: { id: 1 } } }, { type: "nope" }, { type: "seen?" }, { type: "seen", id: 3 }]) expect(toChannelMessage(bad)).toBeNull();
  });

  it("lets a server event replace a local edit (no browser clock in updatedAt)", () => {
    // A favorite applied locally keeps the server's updatedAt, so the server's next event (same or later) wins.
    const g = gen({ updatedAt: 1000 });
    const local = { ...g, favorite: true };
    const server = { ...g, favorite: true, status: "succeeded" as const, updatedAt: 1000 };
    expect(applyToList([local], {}, { type: "generation", generation: server })![0]).toBe(server);
  });

  it("names results made without words by what was done", () => {
    expect(userTitle(gen({ op: "transcribe", modelName: "Whisper", prompt: null, request: { feature: "transcribe", modelId: "w" } }))).toBe("Transcribe · Whisper");
    expect(userTitle(gen({ op: "image-to-3d", modelName: "Hunyuan3D", prompt: "image-to-3d", request: { feature: "3d", modelId: "h" } }))).toMatch(/ · Hunyuan3D$/);
    expect(userTitle(gen({ request: { feature: "image", modelId: "m", prompt: "a fox", title: "Fox poster" } }))).toBe("Fox poster");
    // A chained translation got a transcript's cue list as its prompt: that's data, not a title.
    const cuesIn = gen({ id: "tr0000000001", op: "translate", modelName: "Claude", prompt: '[{"start":0,"end":1,"text":"Hi"}]', request: { feature: "dub", modelId: "text-llm", prompt: '[{"start":0,"end":1,"text":"Hi"}]', params: { targetLanguage: "Spanish" } } });
    expect(userTitle(cuesIn)).toBe("Translate into Spanish · Claude");
    expect(downloadName(cuesIn, { url: "/x/a.srt", kind: "text" }, 0)).toBe("Translate-into-Spanish-Claude-tr0000.srt");
  });

  it("titles an Assist plan's stack with its summary and labels mixed results", () => {
    const plan = [
      gen({ batchId: "p", prompt: "a fox", request: { feature: "assist", modelId: "m", prompt: "a fox", batchTitle: "Three animal posters" } }),
      gen({ batchId: "p", prompt: "an owl", request: { feature: "assist", modelId: "m", prompt: "an owl", batchTitle: "Three animal posters" } }),
    ];
    const e = buildEntries(plan)[0];
    expect(e.type === "stack" && [e.title, e.label]).toEqual(["Three animal posters", "2 results"]);
    // Each card keeps its own words.
    expect(userTitle(plan[1])).toBe("an owl");
  });

  it("shows a 3D model's turntable as its preview, not as a second result", () => {
    const glb = gen({ kind: "model3d", op: "image-to-3d", outputs: [{ url: "/m.glb", kind: "model3d" }, { url: "/t.mp4", kind: "video" }] });
    expect(shownOutputs(glb)).toEqual([0]);
    expect(shownOutputs(gen({ outputs: [{ url: "/1.png", kind: "image" }, { url: "/2.png", kind: "image" }] }))).toEqual([0, 1]);
    expect(modelPreview(glb, glb.outputs[0]).video).toBe("/t.mp4");
  });
});

describe("round 4: helper steps, pins, review, nested folders, where a file is used", () => {
  const ev = (g: Generation) => ({ type: "generation" as const, generation: g });

  it("knows every helper feature the studios create, and nothing else", () => {
    for (const f of ["shorts-step", "mixed-media-step", "marketing-step", "click-to-ad-step", "ad-multiplier-step", "mixed-media-preview", "faceless-avatar", "faceless-voice", "moodboard", "eval"]) {
      expect(isHelperFeature(f), f).toBe(true);
    }
    for (const f of ["image", "shorts", "mixed-media", "marketing", "click-to-ad", "ad-multiplier", "dub", "katana", "faceless", "explainer", "storyboard", "storyboard-film", "upload", "app:app-step-up"]) {
      expect(isHelperFeature(f), f).toBe(false);
    }
  });

  it("leaves helper steps out of lists that don't name their features, as the server does", () => {
    const step = gen({ feature: "shorts-step" });
    expect(matchesFilter(step, {})).toBe(false);
    expect(matchesFilter(step, { kinds: ["image"] })).toBe(false);
    expect(matchesFilter(step, { steps: true })).toBe(true);
    // A studio reading its own steps names them.
    expect(matchesFilter(gen({ feature: "mixed-media-step" }), { features: ["mixed-media", "mixed-media-step"] })).toBe(true);
    expect(matchesFilter(step, { features: ["shorts*"] })).toBe(true);
    // The live stream doesn't slip one into the home feed or the Library.
    const list = [gen()];
    expect(applyToList(list, { limit: 6 }, ev(step))).toBe(list);
    expect(applyToList(list, { limit: 6, steps: true }, ev(step))).toHaveLength(2);
    expect(filterToSearch({ steps: true }).get("steps")).toBe("1");
    expect(filterToSearch({}).get("steps")).toBeNull();
  });

  it("keeps pinned results in their own list, most recently pinned first", () => {
    const a = gen({ id: "pa", pinnedAt: 100 });
    const b = gen({ id: "pb", pinnedAt: 300 });
    const c = gen({ id: "pc", pinnedAt: null });
    expect(matchesFilter(a, { pinned: true })).toBe(true);
    expect(matchesFilter(c, { pinned: true })).toBe(false);
    expect(matchesFilter(a, { pinned: false })).toBe(false);
    expect(matchesFilter(c, { pinned: false })).toBe(true);
    expect(matchesFilter(c, {})).toBe(true);
    expect([a, b].sort(byPinned).map((g) => g.id)).toEqual(["pb", "pa"]);
    expect(cursorAfter(a, { pinned: true })).toBe("100:pa");
    expect(cursorAfter(a, {})).toBe(`${a.createdAt}:pa`);
    expect(filterToSearch({ pinned: true }).get("pinned")).toBe("1");
    expect(filterToSearch({ pinned: false }).get("pinned")).toBe("0");
    // Pinning moves a card from the main list to the pinned list (in pin order); unpinning moves it back.
    const pinnedList = [b, a];
    const pinnedC = { ...c, pinnedAt: 200, updatedAt: c.updatedAt + 1 };
    expect(applyToList(pinnedList, { pinned: true }, ev(pinnedC))!.map((g) => g.id)).toEqual(["pb", "pc", "pa"]);
    expect(applyToList([c], { pinned: false }, ev(pinnedC))).toEqual([]);
    expect(applyToList(pinnedList, { pinned: true }, ev({ ...a, pinnedAt: null, updatedAt: a.updatedAt + 1 }))!.map((g) => g.id)).toEqual(["pb"]);
  });

  it("filters by review status, with “none” for results without one", () => {
    const ok = gen({ review: "approved" });
    const none = gen({ review: null });
    expect(matchesFilter(ok, { reviews: ["approved"] })).toBe(true);
    expect(matchesFilter(ok, { reviews: ["rejected", "needs-review"] })).toBe(false);
    expect(matchesFilter(none, { reviews: ["none"] })).toBe(true);
    expect(matchesFilter(ok, { reviews: ["none"] })).toBe(false);
    expect(filterToSearch({ reviews: ["approved", "none"] }).get("reviews")).toBe("approved,none");
    expect(filterToSearch({ folderIds: ["a", "b"] }).get("folders")).toBe("a,b");
    expect(matchesFilter(gen({ folderId: "b" }), { folderIds: ["a", "b"] })).toBe(true);
    expect(matchesFilter(gen({ folderId: null }), { folderIds: ["a", "b"] })).toBe(false);
  });

  it("offers Pin and Review on results, and a checked Delete on uploads", () => {
    const ids = (g: Generation) => outputActions(g, 0).map((a) => a.id);
    expect(outputActions(gen(), 0).find((a) => a.id === "pin")?.label).toBe("Pin to top");
    expect(outputActions(gen({ pinnedAt: 5 }), 0).find((a) => a.id === "pin")?.label).toBe("Unpin");
    expect(ids(gen())).toContain("review");
    expect(ids(gen({ deletedAt: 5 }))).not.toContain("pin");
    const upload = gen({ feature: "upload" });
    expect(ids(upload)).toContain("delete-upload");
    expect(ids(upload)).not.toContain("pin");
    expect(ids(upload)).not.toContain("review");
  });

  const folder = (id: string, parentId: string | null, p: Partial<Folder> = {}): Folder => ({
    id,
    name: id.toUpperCase(),
    color: "lime",
    count: 0,
    folders: 0,
    cover: null,
    parentId,
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  });
  // a ─ b ─ c, a ─ d; e at the root
  const tree = [folder("a", null, { createdAt: 1 }), folder("b", "a", { createdAt: 2 }), folder("c", "b"), folder("d", "a", { createdAt: 3 }), folder("e", null, { createdAt: 2 })];

  it("walks nested folders: children, breadcrumbs, subtrees, tree order", () => {
    expect(childFolders(tree, null).map((f) => f.id)).toEqual(["a", "e"]);
    expect(childFolders(tree, "a").map((f) => f.id)).toEqual(["b", "d"]);
    // Pinned first, in the order they were pinned.
    const pinned = tree.map((f) => (f.id === "e" ? { ...f, pinnedAt: 9 } : f.id === "d" ? { ...f, pinnedAt: 5 } : f));
    expect(childFolders(pinned, null).map((f) => f.id)).toEqual(["e", "a"]);
    expect(childFolders(pinned, "a").map((f) => f.id)).toEqual(["d", "b"]);
    expect(folderPath(tree, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(folderPath(tree, "gone")).toEqual([]);
    // A loop in bad data doesn't hang the breadcrumbs.
    expect(folderPath([folder("x", "y"), folder("y", "x")], "x").map((f) => f.id)).toEqual(["y", "x"]);
    expect(folderAndDescendants(tree, "a").sort()).toEqual(["a", "b", "c", "d"]);
    expect(folderAndDescendants(tree, "c")).toEqual(["c"]);
    expect(folderTree(tree).map(({ folder: f, depth }) => `${f.id}${depth}`)).toEqual(["a0", "b1", "c2", "d1", "e0"]);
  });

  it("refuses folder moves that would loop or nest too deep, in Higgsfield's words", () => {
    expect(folderMoveError(tree, "a", "a")).toBe("Cannot move into itself");
    expect(folderMoveError(tree, "a", "c")).toBe("Cannot move into a subfolder");
    expect(folderMoveError(tree, "a", "b")).toBe("Cannot move into a subfolder");
    expect(folderMoveError(tree, "b", "a")).toBe("Already in this folder");
    expect(folderMoveError(tree, "a", null)).toBe("Already in this folder");
    expect(folderMoveError(tree, "gone", null)).toBe("That folder doesn't exist anymore");
    expect(folderMoveError(tree, "a", "gone")).toBe("That folder doesn't exist anymore");
    expect(folderMoveError(tree, "a", "e")).toBeNull();
    expect(folderMoveError(tree, "c", null)).toBeNull();
    expect(folderMoveError(tree, "d", "c")).toBeNull();
    // A chain MAX_FOLDER_DEPTH deep can't take another level below its last folder, nor a 2-level subtree lower down.
    const chain = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => folder(`l${i}`, i ? `l${i - 1}` : null));
    expect(folderMoveError([...chain, folder("z", null)], "z", `l${MAX_FOLDER_DEPTH - 1}`)).toMatch(/levels deep/);
    expect(folderMoveError([...chain, folder("z", null)], "z", `l${MAX_FOLDER_DEPTH - 2}`)).toBeNull();
    expect(folderMoveError([...chain, folder("z", null), folder("z2", "z")], "z", `l${MAX_FOLDER_DEPTH - 2}`)).toMatch(/levels deep/);
  });

  it("names folders that move up next to a namesake, and folder paths inside a zip", () => {
    expect(freeName("Drafts", ["Shots"])).toBe("Drafts");
    expect(freeName("Drafts", ["drafts", "Drafts 2"])).toBe("Drafts 3");
    expect(zipSegment("Spring / Summer")).toBe("Spring - Summer");
    expect(zipSegment('a<b>:"c|?*')).toBe("abc");
    expect(zipSegment("..")).toBe("Folder");
    expect(zipSegment("  ")).toBe("Folder");
  });

  it("says where a file is used, in one line", () => {
    expect(describeUses([])).toBe("");
    expect(describeUses([{ what: "result", key: "g1", name: null }])).toBe("1 result");
    expect(
      describeUses([
        { what: "result", key: "g1", name: "a fox" },
        { what: "result", key: "g2", name: null, trashed: true },
        { what: "element", key: "c1", name: "Maya" },
        // A chat found in two tables is one chat.
        { what: "Assist chat", key: "t1", name: "Posters" },
        { what: "Assist chat", key: "t1", name: "Posters" },
        { what: "canvas", key: "k1", name: "A" },
        { what: "canvas", key: "k2", name: "B" },
      ]),
    ).toBe("2 results (1 in the Trash), the element “Maya”, the Assist chat “Posters” and 2 canvases");
    expect(describeUses([{ what: "result", key: "g", name: "x", trashed: true }])).toBe("the result “x” (in the Trash)");
  });

  it("keys the Pinned section's stacks apart from the main list's (one batch can have a stack in each)", () => {
    const pinned = [gen({ batchId: "bx", pinnedAt: 2 }), gen({ batchId: "bx", pinnedAt: 1 })];
    const rest = [gen({ batchId: "bx" }), gen({ batchId: "bx" })];
    const top = buildEntries(pinned, { prefix: "pinned:" });
    const main = buildEntries(rest);
    expect(top.map((e) => e.key)).toEqual(["pinned:stack:bx"]);
    expect(main.map((e) => e.key)).toEqual(["stack:bx"]);
    // Singles keep their id: a result is in one section only.
    expect(buildEntries([gen({ id: "solo" })], { prefix: "pinned:" }).map((e) => e.key)).toEqual(["solo"]);
  });

  it("turns off the filters a view hides, keeping the choice for the views that show them", () => {
    const chosen: Filters = { ...NO_FILTERS, pinned: true, steps: true, subfolders: true, review: "approved" };
    // The Trash: no Pinned or Show steps chip, so neither can empty it or ask to be cleared.
    const trash = filtersFor(chosen, { trash: true, subfolders: true });
    expect(trash).toMatchObject({ pinned: false, steps: false, subfolders: true, review: "approved" });
    expect(hasFilters(filtersFor({ ...NO_FILTERS, pinned: true }, { trash: true }))).toBe(false);
    // A folder without subfolders: no Subfolders chip.
    expect(filtersFor(chosen, {})).toMatchObject({ pinned: true, steps: true, subfolders: false });
    expect(filtersFor(chosen, { uploads: true })).toBe(NO_FILTERS);
    // Nothing hidden: the same object, so memoized lists don't refetch.
    expect(filtersFor(chosen, { subfolders: true })).toBe(chosen);
  });
});
