import { createElement, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIST_PROMPT_MAX, ASSIST_SUGGESTIONS } from "@/lib/assist";
import { APERTURES, CAMERA_BODIES, CAMERA_MOVES, ERAS, GENRES, LENSES, LIGHTING_PRESETS, PALETTES, TEMPOS } from "@/lib/catalog/cinema";
import { handleFor } from "@/lib/catalog/elements";
import { lookCard } from "@/lib/catalog/soul-cards";
import { MAX_FRAMES, STORYBOARD_ASPECTS } from "@/lib/catalog/storyboard";
import { exampleById, FORBIDDEN_WORDS } from "@/lib/examples/catalog";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";
import { guestRead, isLibraryChange } from "@/lib/guest-access";
import { hiddenStarterPage, unknownStarterPage } from "@/lib/record-pages";
import { ASSIST_STARTER_SKILLS, PHOTO_SKILLS, STARTERS, starterCards, starterFills, starterIds, starterOn, type Starter } from "@/lib/starters/catalog";
import { starterCovered } from "@/lib/starters/ids";
import { starterHref, starterShown, type StarterSurface } from "@/lib/starters/types";
import { STARTER_ICONS } from "@/components/starters/starter-icon";
import { getSkill } from "@/server/skills";
import { sampleFile } from "@/server/canvas-samples";

// The starters of Assist, the Library, Cinema Studio, Storyboard and Elements: each one is real (its skill, look, slugs,
// files and links exist), speaks plainly to a visitor, and shows to a visitor only with its real cover.
// tests/starters-run.test.ts makes and runs every one in demo mode.

const SURFACES: StarterSurface[] = ["assist", "library", "cinema", "storyboard", "elements"];
const ENGINE_WORDS = /Nano Banana|MiniMax|Qwen|Ideogram|Seedance|Kling|\bVeo\b|\bWan\b|\bLTX\b|\bLoRA\b|Soul ID/i;
const of = (surface: StarterSurface) => STARTERS.filter((s) => s.surface === surface);
const card = (s: Starter) => starterOn(s.surface, s.id)!;

describe("studio starters", () => {
  it("each surface has its own, ranked once each, premium first", () => {
    expect(of("assist")).toHaveLength(5);
    expect(of("library")).toHaveLength(4);
    expect(of("cinema")).toHaveLength(3);
    expect(of("storyboard")).toHaveLength(3);
    expect(of("elements")).toHaveLength(5);
    for (const surface of SURFACES) {
      const ranks = of(surface).map((s) => s.rank);
      expect(new Set(ranks).size, surface).toBe(ranks.length);
    }
    expect(of("cinema").sort((a, b) => a.rank - b.rank)[0].id).toBe("cinema.riviera-night");
    expect(of("storyboard").sort((a, b) => a.rank - b.rank)[0].id).toBe("storyboard.perfume-ad");
  });

  it("speak plainly: no model names, nothing a card must never say, an icon of their own", () => {
    for (const s of STARTERS.filter((x) => SURFACES.includes(x.surface))) {
      const words = [s.name, s.description, s.makes, ...s.flow, ...s.steps, ...s.words.flatMap((w) => [w.label, w.text]), ...(s.samples ?? []).map((f) => f.label)].join("\n");
      expect(words, s.id).not.toMatch(ENGINE_WORDS);
      for (const re of FORBIDDEN_WORDS) expect(words, `${s.id} ${re}`).not.toMatch(re);
      expect(Object.keys(STARTER_ICONS), s.id).toContain(s.icon);
    }
  });

  it("bring only Fuobe's own published files, and borrow only published covers", () => {
    for (const s of STARTERS.filter((x) => SURFACES.includes(x.surface))) {
      for (const f of s.samples ?? []) expect(sampleFile(f.src), `${s.id} ${f.src}`).toBeTruthy();
      const ref = s.coverOf;
      if (ref && "files" in ref) for (const f of ref.files) expect(EXAMPLE_MEDIA[f]?.role, `${s.id} ${f}`).toBe("in");
      if (ref && "example" in ref) expect(exampleById(ref.example), s.id).toBeTruthy();
      // A starter's borrowed starter cover is another starter's own.
      if (ref && "template" in ref && ref.template.startsWith("starters/")) expect(STARTERS.map((x) => `starters/${x.id}`), s.id).toContain(ref.template);
    }
    // A cover that exists today shows its versioned files.
    const amara = card(STARTERS.find((s) => s.id === "elements.amara")!);
    expect(amara.cover?.poster).toMatch(/^\/examples\/app-makeup-studio\/1\/in-image\.jpg\?v=[0-9a-f]{8}$/);
    const gown = card(STARTERS.find((s) => s.id === "library.namib-gown")!);
    expect(gown.cover?.poster).toMatch(/^\/examples\/image\/1\/out\.[a-z]+\?v=/);
  });

  it("show to a visitor only with their real cover; the owner sees every one", () => {
    for (const surface of SURFACES) {
      // A page carries only the covered ones; the owner's list (GET /api/starters) has every one.
      const page = starterCards(surface);
      for (const c of page) expect(c.cover, c.id).toBeTruthy();
      const all = starterCards(surface, { all: true });
      expect(all.filter((c) => starterShown(c, false))).toHaveLength(of(surface).length);
      expect(all.filter((c) => starterShown(c, true)).map((c) => c.id)).toEqual(page.map((c) => c.id));
    }
    // The elements made from Fuobe's published photos show at once, and the voice with its own cover.
    expect(starterCards("elements").filter((c) => starterShown(c, true)).map((c) => c.id)).toEqual(["elements.amara", "elements.highland-castle", "elements.solitaire-ring", "elements.gilded-salon", "elements.studio-voice"]);
  });
});

describe("Assist starters", () => {
  it("name a built-in skill (or none), fit a new chat's composer and fill it from the address", () => {
    const fills = starterFills("assist", { all: true });
    for (const s of of("assist")) {
      if (s.seed.kind !== "assist") throw new Error(s.id);
      if (s.seed.skill) expect(getSkill(s.seed.skill), s.id).toBeTruthy();
      const text = s.seed.skill ? `/${s.seed.skill} ${s.seed.prompt}` : s.seed.prompt;
      expect(text.length, s.id).toBeLessThanOrEqual(ASSIST_PROMPT_MAX);
      expect(card(s).use).toEqual({ kind: "fill", href: `/chat/make?starter=${encodeURIComponent(s.id)}` });
      expect(starterHref(card(s))).toBe(`/chat/make/start/${s.id}`);
      expect(fills[s.id]).toEqual({ kind: "assist", text });
    }
    // A page's fills, like its cards, are the covered starters' only: an owner-only job's words never reach a visitor.
    expect(Object.keys(starterFills("assist")).sort()).toEqual(starterCards("assist").map((c) => c.id).sort());
  });

  it("never name a skill that asks for the person's own photo: a starter types words, it attaches nothing", () => {
    const skillText = (name: string) => fs.readFileSync(path.join(process.cwd(), "skills", name, "SKILL.md"), "utf8");
    // These skills ask for a photo when none is attached (or take an earlier upload as the product).
    const asks = /photo the user attached|Product photo \(attachment|ask for one clear photo/i;
    for (const name of PHOTO_SKILLS) expect(skillText(name), name).toMatch(asks);
    for (const name of ASSIST_STARTER_SKILLS) expect(skillText(name), name).not.toMatch(asks);
    for (const s of of("assist")) if (s.seed.kind === "assist" && s.seed.skill) expect(PHOTO_SKILLS as readonly string[], s.id).not.toContain(s.seed.skill);
  });

  it("the suggestion chips ask for fashion models, and none repeats a ready job", () => {
    expect(ASSIST_SUGGESTIONS[1]).toMatch(/black velvet suit/);
    expect(ASSIST_SUGGESTIONS[3]).toMatch(/red silk gown/);
    for (const s of ASSIST_SUGGESTIONS) expect(s).not.toMatch(/\b(fox|lighthouse|owl|otter)\b/i);
    // The jobs right above them (Assist's starters, Storyboard's heist) are not asked for again.
    for (const s of ASSIST_SUGGESTIONS) expect(s).not.toMatch(/\b(perfume|heist|necklace|linen|serum|Monaco)\b/i);
  });
});

describe("Cinema starters", () => {
  const slug = (list: { slug: string | null }[]) => list.map((x) => x.slug);
  it("set a look the Director knows, and three shots whose moves exist", () => {
    for (const s of of("cinema")) {
      if (s.seed.kind !== "cinema") throw new Error(s.id);
      const d = s.seed.director;
      if (d.genre) expect(slug(GENRES), s.id).toContain(d.genre);
      if (d.era) expect(slug(ERAS), s.id).toContain(d.era);
      if (d.tempo) expect(slug(TEMPOS), s.id).toContain(d.tempo);
      if (d.camera) expect(slug(CAMERA_BODIES), s.id).toContain(d.camera);
      if (d.lens) expect(slug(LENSES), s.id).toContain(d.lens);
      if (d.aperture) expect(slug(APERTURES), s.id).toContain(d.aperture);
      if (d.lighting?.kind === "preset") expect(slug(LIGHTING_PRESETS), s.id).toContain(d.lighting.slug);
      if (d.palette?.kind === "preset") expect(slug(PALETTES), s.id).toContain(d.palette.slug);
      expect(s.seed.shots, s.id).toHaveLength(3);
      for (const sh of s.seed.shots) {
        for (const m of sh.moves ?? []) expect(slug(CAMERA_MOVES), `${s.id} ${m}`).toContain(m);
        expect(sh.duration).toBe(5);
      }
      expect(s.seed.brief.body).toContain(s.seed.shots[0].prompt);
      expect(card(s).use).toEqual({ kind: "create" });
    }
    // The Riviera film: a fashion model in an emerald silk gown, three shots.
    expect(STARTERS.find((s) => s.id === "cinema.riviera-night")!.words[0].text).toMatch(/emerald silk gown/);
  });
});

describe("Storyboard starters", () => {
  it("fit the composer: a story, a frame count, a shape and a look that exist", () => {
    const fills = starterFills("storyboard", { all: true });
    for (const s of of("storyboard")) {
      if (s.seed.kind !== "storyboard") throw new Error(s.id);
      expect(s.seed.frames, s.id).toBeLessThanOrEqual(MAX_FRAMES);
      expect(STORYBOARD_ASPECTS as readonly string[], s.id).toContain(s.seed.aspectRatio);
      if (s.seed.look) expect(lookCard(s.seed.look), s.id).toBeTruthy();
      expect(card(s).use).toEqual({ kind: "fill", href: `/storyboard?starter=${encodeURIComponent(s.id)}` });
      // A guest or an account sees it in the composer, with its price (Generate is the owner's): "See", not "Try".
      expect(card(s).tryIn).toMatchObject({ href: `/storyboard?starter=${encodeURIComponent(s.id)}`, text: "See it in Storyboard" });
      expect(fills[s.id]).toMatchObject({ kind: "storyboard", story: s.seed.story, frames: s.seed.frames });
    }
    expect(STARTERS.find((s) => s.id === "storyboard.perfume-ad")!.seed).toMatchObject({ frames: 6, aspectRatio: "16:9" });
  });
});

describe("Element starters", () => {
  it("name the @handle they are saved as, and take the files their kind takes", () => {
    for (const s of of("elements")) {
      if (s.seed.kind !== "element") throw new Error(s.id);
      if (s.seed.element.kind !== "voice") expect(s.makes, s.id).toContain(`@${handleFor(s.seed.element.name)}`);
      expect(s.samples?.length, s.id).toBeGreaterThan(0);
      for (const f of s.samples ?? []) expect(/\.m4a$/.test(f.src), `${s.id} ${f.src}`).toBe(s.seed.element.kind === "voice");
      expect(starterHref(card(s))).toBe(`/elements/start/${s.id}`);
      // A visitor's next step: the app or the camera move its photo comes from, with that example loaded.
      if (s.seed.element.kind !== "voice") {
        const t = card(s).tryIn;
        expect(t?.example, s.id).toBeTruthy();
        expect(t?.href, s.id).toMatch(new RegExp(`^(/apps/[a-z0-9-]+\\?|/video\\?preset=[a-z0-9-]+&)example=${t!.example!.replace(".", "\\.")}$`));
      }
    }
    // A portrait shows from its top in a wide frame; the other pictures from their middle.
    expect(card(STARTERS.find((s) => s.id === "elements.amara")!).coverTop).toBe(true);
    expect(card(STARTERS.find((s) => s.id === "elements.highland-castle")!).coverTop).toBeUndefined();
  });
});

describe("Library starters", () => {
  it("each opens a studio with its content loaded, for everyone", () => {
    const cards = of("library").sort((a, b) => a.rank - b.rank).map(card);
    expect(cards.map((c) => (c.use.kind === "link" ? c.use.href : ""))).toEqual([
      "/video?preset=effect-pearl-earring&example=effect-pearl-earring.1",
      "/image?example=image.1",
      "/video?preset=effect-superstar&example=effect-superstar.1",
      "/storyboard?starter=storyboard.perfume-ad",
    ]);
    for (const c of cards) expect(starterHref(c)).toBe(c.use.kind === "link" ? c.use.href : "");
    // The owner opens the Pearl Earring's ready board, which they can save.
    expect(starterHref(cards[0], true)).toBe("/canvas/start/effect-chain-pearl-earring");
    expect(starterHref(cards[1], true)).toBe("/image?example=image.1");
  });
});

describe("starter pages and the owner's tap", () => {
  it("pages exist for Assist, Cinema, Storyboard and Elements, and nowhere else", () => {
    for (const surface of ["assist", "cinema", "storyboard", "elements"] as const) expect(starterIds(surface).every((id) => starterOn(surface, id)), surface).toBe(true);
    expect(starterOn("cinema", "elements.amara")).toBeUndefined();
    expect(starterOn("cinema", "cinema.nope")).toBeUndefined();
  });

  it("a guest reads the pages; making a starter is the owner's (guest 401, account 403 library)", () => {
    for (const p of ["/chat/make/start/assist.jewel-campaign", "/cinema/start/cinema.riviera-night", "/storyboard/start/storyboard.heist", "/elements/start/elements.amara"]) expect(guestRead(p).kind, p).toBe("pass");
    expect(isLibraryChange("POST", "/api/starters/cinema.riviera-night")).toBe(true);
    expect(isLibraryChange("POST", "/api/starters/elements.amara")).toBe(true);
  });

  it("every card a visitor sees opens: its page is there for them, or its link's studio has what it names", () => {
    for (const surface of SURFACES) {
      for (const c of starterCards(surface)) {
        expect(starterCovered(c.id), c.id).toBe(true);
        const href = starterHref(c);
        if (c.use.kind === "link") {
          // A Library link to another starter shows only once that one is shown too.
          const other = /[?&]starter=([^&]+)/.exec(href)?.[1];
          if (other) expect(starterCovered(decodeURIComponent(other)), c.id).toBe(true);
          continue;
        }
        expect(unknownStarterPage(href), href).toBe(false);
        expect(hiddenStarterPage(href), href).toBe(false);
      }
      // And a card a visitor doesn't see has no page for them.
      for (const c of starterCards(surface, { all: true }).filter((x) => !x.cover && x.use.kind !== "link")) expect(hiddenStarterPage(starterHref(c)), c.id).toBe(true);
    }
  });

  it("a card never shows a visitor the owner's mark; a Library card opens its studio", async () => {
    const { StarterTile } = await import("@/components/starters/starter-section");
    const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(StarterTile as FC<Record<string, unknown>>, props));
    const amara = starterCards("elements")[0];
    const guest = html({ s: amara, owner: false, busy: false, onUse: () => {} });
    expect(guest).not.toContain("No cover yet");
    expect(guest).toContain("See how it works");
    expect(guest).toContain(`href="/elements/start/${amara.id}"`);
    expect(html({ s: amara, owner: true, busy: false, onUse: () => {} })).toContain("Use template");
    const link = starterCards("library").find((c) => c.cover)!;
    const linkHtml = html({ s: link, owner: false, busy: false, onUse: () => {} });
    expect(linkHtml).toContain("Open it");
    expect(linkHtml).toContain(`href="${link.use.kind === "link" ? link.use.href.replace(/&/g, "&amp;") : ""}"`);
  });
});
