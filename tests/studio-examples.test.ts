import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPreset } from "@/lib/catalog";
import { HOME_CAPTION_MAX } from "@/lib/home-showcase";
import { thumbOf } from "@/lib/preset-cards";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { STUDIO_EXAMPLES, studioExamples, type ExampleStudio } from "@/lib/studio-examples";

// home-showcase.ts (which the examples borrow from) imports next/cache for its own showcase.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

/*
 * The empty Image, Video and Edit studios' row of examples (src/lib/studio-examples.ts) against the catalog and the
 * files in public/: every preset it names is real and has its cover, clip and small copies, and every line fits.
 */

const root = process.cwd();
const exists = (url: string) => (fs.statSync(path.join(root, "public", url), { throwIfNoEntry: false })?.size ?? 0) > 0;
const studios = Object.keys(STUDIO_EXAMPLES) as ExampleStudio[];

describe("the studios' examples", () => {
  it("shows four for each of Image, Video and Edit, none twice", () => {
    expect(studios.sort()).toEqual(["edit", "image", "video"]);
    for (const s of studios) {
      const ids = STUDIO_EXAMPLES[s].tiles.map((e) => e.id);
      expect(ids, s).toHaveLength(4);
      expect(new Set(ids).size, s).toBe(4);
    }
  });

  it("says over Image's and Edit's apps that they are apps, and over Video's moves what the studio makes", () => {
    expect(studioExamples("image").heading).toBe("Or start from an app");
    expect(studioExamples("edit").heading).toBe("Or start from an app");
    expect(studioExamples("video").heading).toBe("See what it makes");
  });

  it("names real presets, each with its cover, its clip and their small copies", () => {
    for (const s of studios) {
      for (const { card } of studioExamples(s).tiles) {
        expect(getPreset(card.id), card.id).toBeDefined();
        const cover = PRESET_PREVIEWS[card.id];
        expect(cover, `${card.id} has a real cover`).toBeDefined();
        expect(card.preview.poster, card.id).toBe(cover.poster);
        expect(exists(cover.poster), cover.poster).toBe(true);
        expect(exists(thumbOf(cover.poster)), thumbOf(cover.poster)).toBe(true);
        expect(cover.video, `${card.id} has a clip`).toBeDefined();
        expect(exists(cover.video!), cover.video).toBe(true);
        // An effect or an app rests on its peak frame, as on Home; a camera motion on its poster.
        if (card.id.startsWith("motion-")) expect(card.preview.rest, card.id).toBeUndefined();
        else {
          expect(PRESET_PEAKS[card.id], card.id).toBeDefined();
          expect(exists(card.preview.rest!.src), card.preview.rest!.src).toBe(true);
          expect(exists(thumbOf(card.preview.rest!.src)), thumbOf(card.preview.rest!.src)).toBe(true);
        }
      }
    }
  });

  it("gives each a line that fits a phone's tile whole, and says what kind it is", () => {
    for (const s of studios) {
      for (const e of studioExamples(s).tiles) {
        expect(e.caption.length, e.card.id).toBeGreaterThan(0);
        expect(e.caption.length, e.card.id).toBeLessThanOrEqual(HOME_CAPTION_MAX.card);
        expect(e.kind, e.card.id).toBe({ app: "App · before → after", motion: "Camera motion", effect: "Effect" }[getPreset(e.card.id)!.type]);
      }
    }
  });

  it("opens an app on its own page, and picks a motion or effect in the Video studio", () => {
    const [image, video] = [studioExamples("image").tiles, studioExamples("video").tiles];
    expect(image[0].href).toBe(`/apps/${image[0].card.id}`);
    for (const e of video) expect(e.href, e.card.id).toBe(`/video?preset=${e.card.id}`);
    // Edit and Image show apps, Video shows what its studio picks.
    for (const s of ["image", "edit"] as const) for (const e of studioExamples(s).tiles) expect(getPreset(e.card.id)!.type, e.card.id).toBe("app");
    for (const e of video) expect(["motion", "effect"], e.card.id).toContain(getPreset(e.card.id)!.type);
  });

  it("stays on the server: the studio page takes only its type, and loads the tiles in their own chunk", () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(root, "src", ...p), "utf8");
    expect(read("lib", "studio-examples.ts")).toMatch(/^import "server-only";$/m);
    const page = read("components", "studio", "studio-page.tsx");
    expect(page).toMatch(/^import type \{ StudioExample, StudioExampleRow \} from "@\/lib\/studio-examples";$/m);
    expect(page).toMatch(/dynamic\(\(\) => import\("@\/components\/home\/showcase-tile"\)/);
    expect(page).not.toMatch(/^import [^;]*from "@\/components\/home\/showcase-tile";$/m);
    for (const s of studios) expect(read("app", "(studio)", s, "page.tsx"), s).toContain(`examples={studioExamples("${s}")}`);
  });

  it("shows only once the feed is known to be empty, and a Video tile picks its move through the composer", () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(root, "src", ...p), "utf8");
    const page = read("components", "studio", "studio-page.tsx");
    expect(page).toMatch(/\{feed\.isSuccess && !hasItems && !!examples\?\.tiles\.length && <StudioExamples /);
    expect(page).toMatch(/onNavigate=\{pickHere\(e\.href\)\}/);
    expect(read("components", "studio", "composer.tsx")).toMatch(/bridgeRef\.pick = pickPreset;/);
    // A tile picked from the keyboard hands its focus to its own studio's composer, not to a hidden studio's.
    expect(page).toMatch(/closest\("\[data-studio\]"\)\?\.querySelector<HTMLElement>\("\[data-composer\]"\)/);
    expect(page).toMatch(/if \(keyboard\) requestAnimationFrame\(\(\) => composer\?\.querySelector<HTMLElement>\("textarea, button"\)\?\.focus\(\{ preventScroll: true \}\)\)/);
    expect(page).toMatch(/^\s+data-studio$/m);
  });
});
