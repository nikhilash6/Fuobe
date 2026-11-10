import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EngineMode } from "@/lib/api";
import type { Engine } from "@/lib/catalog/types";

/*
 * A ready film's page names its whole recipe: the look line (the Director's settings in the studio's own words, then its
 * shape), its shots, and "Use template" first. Each shot has "Make this shot", which opens that shot in the film, in the
 * film's look and shape (tests/starters-run.test.ts makes it on the server). A Storyboard story's page names its look,
 * shape and frames.
 */

const viewer = vi.hoisted(() => ({ owner: false, visitor: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/cinema/start/cinema.desert-couture",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", async (load) => ({
  ...(await load<typeof import("@/lib/api")>()),
  useHydrated: () => true,
  useIsOwner: () => viewer.owner,
  useIsVisitor: () => viewer.visitor,
  useEngine: (): [Engine, (e: Engine) => void, EngineMode] => ["open", () => {}, "both"],
}));

const { cinemaLook, storyboardLook } = await import("@/lib/starters/look");
const { lookLine, proposedShotLine } = await import("@/lib/starters/types");
const { STARTERS, starterCards, starterOn } = await import("@/lib/starters/catalog");
const { GENRES, LENSES, LIGHTING_PRESETS, PALETTES, CAMERA_BODIES, ERAS, APERTURES, FOCAL_LENGTHS } = await import("@/lib/catalog/cinema");
const { StarterPage } = await import("@/components/starters/starter-page");

const page = (id: string, surface: "cinema" | "storyboard") => {
  const s = starterOn(surface, id)!;
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(StarterPage, { s })));
};

describe("a starter's look line", () => {
  it("names Desert couture's whole look in the Director's words, ending with its 16:9 shape", () => {
    const s = starterOn("cinema", "cinema.desert-couture")!;
    expect(lookLine(s.look!)).toBe("Epic · Modern · Anamorphic · Silhouette · Oil & Ochre · 16:9");
    // The palette's chip shows its colours.
    const palette = s.look!.find((i) => i.name === "Oil & Ochre")!;
    expect(palette.swatch).toHaveLength(4);
    for (const c of palette.swatch!) expect(PALETTES.find((p) => p.slug === "oil-ochre")!.hex).toContain(c);
  });

  it("reads every field the Director's Panel sets, and leaves out what the model picks", () => {
    expect(
      lookLine(
        cinemaLook({
          genre: "drama",
          era: "2020s",
          tempo: "calm",
          camera: "35mm-film",
          lens: "anamorphic",
          focal: "85mm",
          aperture: "f14-wide-open",
          lighting: { kind: "preset", slug: "practicals" },
          palette: { kind: "preset", slug: "twilight-fable" },
        }),
      ),
    ).toBe("Drama · 2020s · 35mm Film · Anamorphic · 85mm · f/1.4 · Practicals · Twilight Fable · 16:9");
    expect(lookLine(cinemaLook({ genre: null, lens: null, lighting: { kind: "preset", slug: "nope" } }))).toBe("16:9");
    expect(lookLine(cinemaLook({ lighting: { kind: "custom", lights: [{ direction: "top", color: "#ffffff", brightness: 50, diffuse: 50 }] }, palette: { kind: "custom", name: "Dune", hex: ["#111111", "#222222"] } }, "21:9"))).toBe(
      "Custom light · Dune · 21:9",
    );
  });

  it("gives every ready film a look line of real picker names", () => {
    const names = new Set([...GENRES, ...ERAS, ...CAMERA_BODIES, ...LENSES, ...FOCAL_LENGTHS, ...LIGHTING_PRESETS].map((o) => o.name).concat(APERTURES.map((a) => a.name.replace(/ .*/, "")), PALETTES.map((p) => p.name)));
    for (const s of starterCards("cinema", { all: true })) {
      expect(s.look?.length, s.id).toBeGreaterThan(2);
      expect(s.look!.at(-1)!.name, s.id).toBe("16:9");
      for (const i of s.look!.slice(0, -1)) expect(names.has(i.name), `${s.id}: ${i.name}`).toBe(true);
      expect(s.look!.some((i) => i.name === "Auto" || i.name === "General"), s.id).toBe(false);
    }
  });

  it("names a story's look, shape and frames", () => {
    expect(lookLine(starterOn("storyboard", "storyboard.perfume-ad")!.look!)).toBe("Quiet luxury · 16:9 · 6 frames");
    expect(lookLine(starterOn("storyboard", "storyboard.heist")!.look!)).toBe("16:9 · 6 frames");
    expect(lookLine(starterOn("storyboard", "storyboard.capri-swim")!.look!)).toBe(`${storyboardLook({ look: "v2-warm-vivid-film", aspectRatio: "9:16", frames: 4 })[0].name} · 9:16 · 4 frames`);
  });

  it("leaves the other studios' starters without one", () => {
    for (const s of STARTERS.filter((x) => x.surface !== "cinema" && x.surface !== "storyboard")) expect(starterOn(s.surface, s.id)!.look, s.id).toBeUndefined();
  });
});

describe("a ready film's shots", () => {
  it("are numbered by their words, in order", () => {
    for (const s of STARTERS.filter((x) => x.seed.kind === "cinema")) {
      const card = starterOn("cinema", s.id)!;
      expect(card.inputs.map((i) => i.shot), s.id).toEqual([1, 2, 3]);
    }
    for (const s of starterCards("storyboard", { all: true })) expect(s.inputs.every((i) => i.shot === undefined), s.id).toBe(true);
  });

  it("say where the other shots are once one is in the prompt bar", () => {
    expect(proposedShotLine(1, 3)).toBe("Shot 1 of 3 is ready below. Shots 2 and 3 are in the AI Director.");
    expect(proposedShotLine(2, 3)).toBe("Shot 2 of 3 is ready below. Shots 1 and 3 are in the AI Director.");
    expect(proposedShotLine(3, 3)).toBe("Shot 3 of 3 is ready below. Shots 1 and 2 are in the AI Director.");
    expect(proposedShotLine(1, 2)).toBe("Shot 1 of 2 is ready below. Shot 2 is in the AI Director.");
    expect(proposedShotLine(1, 5)).toBe("Shot 1 of 5 is ready below. Shots 2 to 5 are in the AI Director.");
    expect(proposedShotLine(3, 5)).toBe("Shot 3 of 5 is ready below. The other 4 shots are in the AI Director.");
  });
});

describe("the ready film's page", () => {
  it("shows the look, then Use template first, then Make this shot on each shot, for a visitor", () => {
    viewer.owner = false;
    viewer.visitor = true;
    const html = page("cinema.desert-couture", "cinema");
    expect(html).toContain("Look: Epic · Modern · Anamorphic · Silhouette · Oil &amp; Ochre · 16:9");
    const use = html.indexOf("Use template");
    const shot = html.indexOf("Make this shot");
    expect(use).toBeGreaterThan(0);
    expect(shot).toBeGreaterThan(use);
    expect(html.match(/Make this shot/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Make shot 2 in this look"');
    expect(html).toContain("The whole film opens in Cinema Studio: its look, its brief and every shot, ready to make.");
    // The shot's own words are still there to read.
    expect(html).toContain("Aerial shot of a fashion model in flowing saffron silk");
  });

  it("shows the same to the owner", () => {
    viewer.owner = true;
    viewer.visitor = false;
    const html = page("cinema.riviera-night", "cinema");
    expect(html.match(/Make this shot/g)).toHaveLength(3);
    expect(html).toContain("Look: Drama · 2020s · 35mm Film · Anamorphic · f/1.4 · Practicals · Twilight Fable · 16:9");
  });

  it("gives a story its look line and its way into Storyboard, with no shot buttons", () => {
    viewer.owner = false;
    viewer.visitor = true;
    const html = page("storyboard.perfume-ad", "storyboard");
    expect(html).toContain("Look: Quiet luxury · 16:9 · 6 frames");
    expect(html).toContain("See it in Storyboard");
    expect(html).not.toContain("Make this shot");
  });
});
