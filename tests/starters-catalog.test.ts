import { createElement, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/catalog/models";
import { guestRead, isLibraryChange } from "@/lib/guest-access";
import { hiddenStarterPage, recordForPath, unknownStarterPage } from "@/lib/record-pages";
import { assertStarters, STARTERS, starterCards, starterCover, starterFills, starterIds, starterOn, starterVoice, type Starter } from "@/lib/starters/catalog";
import { STARTER_IDS, starterCovered } from "@/lib/starters/ids";
import { STARTER_SURFACES, starterHref, starterShown, type StarterSurface } from "@/lib/starters/types";
import { sampleFile } from "@/server/canvas-samples";
import { exampleStat } from "@/server/example-files";

// The ready-made starters of Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and Marketing Studio:
// each names what exists (a style, a preset, a template, a published photo), speaks plain visitor words, and shows
// to a guest or an account only with its real cover. tests/starters-create.test.ts makes and runs every one.

const { StarterTile } = await import("@/components/starters/starter-section");
const tile = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(StarterTile as FC<Record<string, unknown>>, props));

const SURFACES = Object.keys(STARTER_SURFACES) as StarterSurface[];
/** Words visitors never read: engine words and product terms that aren't theirs. */
const ENGINE_WORDS = /Fuobe DoP|Effects 2\.0|\bGPU\b|ComfyUI|Variant|\bfal\b|Replicate|\bLLM\b|placeholder|demo/i;
const NEGATIONS = /\b(no|not|without|never|unmarked|logo-free)\b/i;
const visitorWords = (s: Starter) => [s.name, s.description, s.makes, ...s.steps, ...s.flow, ...s.words.map((w) => `${w.label} ${w.text}`)].join("\n");

describe("the starters catalog", () => {
  it("has ready starters on every surface, ids unique and named <surface>.<slug>, ranks unique per surface", () => {
    expect(() => assertStarters()).not.toThrow();
    for (const surface of SURFACES) {
      const list = STARTERS.filter((s) => s.surface === surface);
      expect(list.length, surface).toBeGreaterThanOrEqual(2);
      expect(new Set(list.map((s) => s.rank)).size, surface).toBe(list.length);
    }
    expect(STARTERS.filter((s) => s.surface === "faceless")).toHaveLength(3);
    expect(STARTERS.filter((s) => s.surface === "content-factory")).toHaveLength(3);
    expect(STARTERS.filter((s) => s.surface === "explainer")).toHaveLength(3);
  });

  it("refuses a starter that names what isn't there", () => {
    const one = STARTERS[0];
    const bad = (seed: Starter["seed"]) => () => assertStarters([{ ...one, seed }]);
    expect(bad({ kind: "faceless", channel: { idea: "x", genre: "history", name: "x" }, episode: { topic: "x", styleId: "nope", length: 60 } })).toThrow(/no Faceless style/);
    expect(bad({ kind: "faceless", channel: { idea: "x", genre: "history", name: "x" }, episode: { topic: "x", styleId: "paper-collage", length: 45 } })).toThrow(/isn't a Faceless length/);
    expect(bad({ kind: "fill", fill: { kind: "content-factory", presetId: "nope", prompt: "x", length: 30, episodes: 1 } })).toThrow(/no Content Factory preset/);
    expect(bad({ kind: "fill", fill: { kind: "explainer", prompt: "x", styleId: "nope", duration: 60, aspect: "16:9" } })).toThrow(/no Explainer style/);
    const kit = STARTERS.find((s) => s.seed.kind === "product")!.seed;
    if (kit.kind !== "product") throw new Error("no product starter");
    expect(bad({ ...kit, kit: { ...kit.kit, product: { ...kit.kit.product, image: { src: "/examples/nope/1/in-image.jpg", name: "x" } } } })).toThrow(/published example file/);
    expect(bad({ ...kit, open: { to: "marketing", template: "nope" } })).toThrow(/no Marketing template/);
    expect(() => assertStarters([one, one])).toThrow(/listed twice/);
  });

  it("speaks plain, short visitor words: no model names, no engine words, only what is wanted", () => {
    const names = MODELS.map((m) => m.name).filter((n) => n.length > 4);
    for (const s of STARTERS) {
      expect(s.name.length, s.id).toBeLessThanOrEqual(32);
      expect(s.description.length, s.id).toBeLessThanOrEqual(90);
      for (const w of s.flow) expect(w.length, `${s.id} ${w}`).toBeLessThanOrEqual(10);
      expect(s.steps.length, s.id).toBeGreaterThanOrEqual(2);
      const words = visitorWords(s);
      expect(words, s.id).not.toMatch(ENGINE_WORDS);
      for (const name of names) expect(words, `${s.id}: ${name}`).not.toContain(name);
      // The words a starter puts in (its prompts and topics) name only what should be there.
      const seed = s.seed;
      const prompts = seed.kind === "faceless" ? [seed.channel.idea, seed.episode.topic] : seed.kind === "fill" ? [seed.fill.prompt] : [seed.kit.brand.description, seed.kit.product.description];
      for (const p of prompts) expect(p, s.id).not.toMatch(NEGATIONS);
    }
  });

  it("brings only published example photos, read with the bytes the manifest lists", () => {
    for (const s of STARTERS)
      if (s.seed.kind === "product") {
        const src = s.seed.kit.product.image.src;
        expect(exampleStat(src), `${s.id} ${src}`).toBeTruthy();
        expect(sampleFile(src), `${s.id} ${src}`).toBeTruthy();
      }
  });

  it("covers Marketing's shoots with the app cover that shows the same shot, and keeps the rest for the owner until theirs are made", () => {
    for (const s of STARTERS) {
      const card = starterOn(s.surface, s.id)!;
      expect(card.coverKey).toBe(`starters/${s.id}`);
      // An ad and a video ad aren't a plain product shot: Ads Studio and Click to Ad wait for their own covers.
      if (s.surface === "ads" || s.surface === "click-to-ad") expect(s.coverFrom, s.id).toBeUndefined();
      if (s.surface === "marketing") {
        expect(card.cover, s.id).toBeTruthy();
        // The finished shot alone: never the app's before → after clip, which opens on the plain photo.
        expect(card.cover!.poster, s.id).toMatch(/^\/previews\/presets\/peak\/app-[a-z-]+\.jpg\?v=[0-9a-f]{8}$/);
        expect(card.cover!.video, s.id).toBeUndefined();
        expect(card.cover!.at, s.id).toBeUndefined();
      }
      // A product's photo shows on its page; words show as words; a visitor goes on to the app that makes the same.
      if (s.seed.kind === "product") {
        expect(card.inputs[0].image?.thumb, s.id).toMatch(/^\/examples\//);
        expect(card.tryIn?.href, s.id).toMatch(/^\/apps\/app-[a-z-]+\?example=app-[a-z-]+\.1$/);
        // The same photo as the example it links.
        expect(s.seed.kit.product.image.src, s.id).toBe(`/examples/${s.tryIn!.app}/1/in-image.jpg`);
      }
    }
  });

  it("gives a page only the covered starters; the owner's list (all) has every one, covered first, then by rank", () => {
    for (const surface of SURFACES) {
      // The prerendered page's props: no starter without its real cover, so its words never reach a visitor.
      expect(starterCards(surface).every((c) => !!c.cover), surface).toBe(true);
      expect(starterCards(surface).map((c) => c.id)).toEqual(starterCards(surface, { all: true }).filter((c) => c.cover).map((c) => c.id));
      const cards = starterCards(surface, { all: true });
      expect(cards.map((c) => c.id).sort()).toEqual(starterIds(surface).sort());
      const covered = cards.map((c) => !!c.cover);
      expect(covered, surface).toEqual([...covered].sort((a, b) => Number(b) - Number(a)));
      for (const c of cards) {
        expect(starterShown(c, false)).toBe(true);
        expect(starterShown(c, true)).toBe(!!c.cover);
        expect(starterHref(c)).toBe(`${STARTER_SURFACES[surface].base}/start/${c.id}`);
      }
    }
    expect(starterOn("faceless", "cf.narcissus")).toBeUndefined();
  });

  it("fills Content Factory and Explainer from the address, and makes the others on the server", () => {
    for (const c of [...starterCards("content-factory", { all: true }), ...starterCards("explainer", { all: true })]) {
      expect(c.use.kind, c.id).toBe("fill");
      if (c.use.kind === "fill") expect(c.use.href).toBe(`${STARTER_SURFACES[c.surface].base}?starter=${encodeURIComponent(c.id)}`);
    }
    for (const surface of ["faceless", "ads", "click-to-ad", "marketing"] as const) for (const c of starterCards(surface, { all: true })) expect(c.use.kind, c.id).toBe("create");
    for (const surface of ["content-factory", "explainer"] as const) {
      expect(Object.keys(starterFills(surface, { all: true })).sort()).toEqual(starterIds(surface).sort());
      // A page's fills, like its cards, are the covered starters' only.
      expect(Object.keys(starterFills(surface)).sort()).toEqual(starterCards(surface).map((c) => c.id).sort());
    }
  });

  it("gives every narrated starter its own narrator sample's place, versioned, and none to the others", () => {
    for (const s of STARTERS) {
      const v = starterVoice(s);
      if (s.surface === "faceless" || s.surface === "content-factory" || s.surface === "explainer") expect(v?.src, s.id).toBe(`/starters/${s.id}/1/voice.m4a`);
      else expect(v, s.id).toBeUndefined();
    }
    // Read like Fuobe's other sample files once published, never by a path that steps out of public/.
    expect(sampleFile("/starters/x/../../package.json")).toBeNull();
  });
});

describe("who may use a starter", () => {
  it("opens a starter's page to everyone, as catalog data, not a stored record", () => {
    for (const s of STARTERS) {
      const href = starterHref(s);
      expect(recordForPath(href), href).toBeNull();
      expect(guestRead(href), href).toEqual({ kind: "pass" });
      expect(unknownStarterPage(href), href).toBe(false);
      expect(unknownStarterPage(`${href}/`), href).toBe(false);
    }
  });

  it("keeps a starter with no cover yet the owner's: the proxy's 404 for others matches the catalog's covers", () => {
    for (const s of STARTERS) {
      expect(starterCovered(s.id), s.id).toBe(!!starterCover(s));
      expect(hiddenStarterPage(starterHref(s)), s.id).toBe(!starterCover(s));
      expect(hiddenStarterPage(`${starterHref(s)}/`), s.id).toBe(!starterCover(s));
    }
    expect(hiddenStarterPage("/explainer/start/nope.x")).toBe(false);
    expect(hiddenStarterPage("/faceless/abc/new")).toBe(false);
  });

  it("answers a real 404 for a starter page that isn't that studio's (the proxy's client-safe id list matches the catalog)", () => {
    for (const surface of SURFACES) expect([...STARTER_IDS[surface]].sort(), surface).toEqual(starterIds(surface).sort());
    expect(unknownStarterPage("/ads/start/faceless.boat-hotels")).toBe(true);
    expect(unknownStarterPage("/explainer/start/nope.x")).toBe(true);
    expect(unknownStarterPage("/marketing/click-to-ad/start/mk.perfume-moss")).toBe(true);
    expect(unknownStarterPage("/marketing/start/mk.perfume-moss")).toBe(false);
    expect(unknownStarterPage("/faceless/abc/def")).toBe(false);
  });

  it("makes a starter for the owner only: an account's POST is a library change", () => {
    for (const s of STARTERS) expect(isLibraryChange("POST", `/api/starters/${s.id}`), s.id).toBe(true);
    expect(isLibraryChange("GET", "/api/starters/faceless.boat-hotels")).toBe(false);
    // The owner's list of every starter (with the cover-less ones) is closed to guests and accounts.
    expect(guestRead("/api/starters")).toEqual({ kind: "closed" });
  });
});

describe("a starter's card", () => {
  const covered = starterCards("marketing")[0];
  const bare = starterCards("faceless", { all: true }).find((c) => !c.cover);

  it("shows a visitor the cover, the steps in a few words and how it works; the owner a Use template", () => {
    const visitor = tile({ s: covered, owner: false, busy: false, onUse: () => {} });
    expect(visitor).toContain("See how it works");
    expect(visitor).not.toContain("Use template");
    expect(visitor).not.toContain("No cover yet");
    expect(visitor).toContain(`href="${starterHref(covered)}"`);
    for (const w of covered.flow) expect(visitor).toContain(w);
    const owner = tile({ s: covered, owner: true, busy: false, onUse: () => {} });
    expect(owner).toContain("Use template");
  });

  it("marks a card with no cover yet for the owner, drawn as its steps", () => {
    if (!bare) return;
    const owner = tile({ s: bare, owner: true, busy: false, onUse: () => {} });
    expect(owner).toContain("No cover yet");
    expect(owner).toContain("<svg");
  });
});
