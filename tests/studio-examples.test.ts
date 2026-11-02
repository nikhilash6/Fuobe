import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPreset, MODELS } from "@/lib/catalog";
import { HOME_CAPTION_MAX, HOME_WALL } from "@/lib/home-showcase";
import { thumbOf } from "@/lib/preset-cards";
import { PRESET_BEFORE_AFTER } from "@/lib/preset-before-after.generated";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { EXAMPLE_LINES, STUDIO_EXAMPLES, studioExamples, type ExampleStudio } from "@/lib/studio-examples";

// home-showcase.ts (which the examples borrow from) imports next/cache for its own showcase.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

/*
 * The studios' and tools' rows of examples (src/lib/studio-examples.ts) against the catalog and the files in public/:
 * every preset a row names is real and has its cover, clip, peak frame and small copies, every line fits a phone's
 * tile and reads as plain copy, and every page that has a row passes it on.
 */

const root = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(root, "src", ...p), "utf8");
/** A cover URL's file in public/ is there and not empty: the URL as the site gives it, ending in its version (?v=). */
const exists = (url: string) => {
  expect(url, url).toMatch(/^\/previews\/[^?]+\?v=[0-9a-f]{8}$/);
  return (fs.statSync(path.join(root, "public", url.split("?")[0]), { throwIfNoEntry: false })?.size ?? 0) > 0;
};
const studios = Object.keys(STUDIO_EXAMPLES) as ExampleStudio[];

/** The Studio pages (a composer of their own), the hubs (ModeSwitchStudio) and the tools or project lists (ExampleRow). */
const COMPOSER = ["image", "video", "edit", "video-edit", "extend", "reframe", "inpaint", "lipsync", "motion-control"] as const;
const HUBS = ["upscale", "video-tools", "audio"] as const;
/** Each tool's or list's component, which shows the row itself. */
const ROW_IN: Record<string, string[][]> = {
  layers: [["components", "layers", "projects-view.tsx"]],
  genjutsu: [["components", "genjutsu", "genjutsu-studio.tsx"]],
  "character-swap": [["components", "swap-studio", "home.tsx"]],
  "image-to-3d": [["components", "model3d", "model3d-studio.tsx"]],
  katana: [["components", "katana", "katana-studio.tsx"]],
  cinema: [["components", "cinema", "projects-view.tsx"]],
  ads: [
    ["components", "ads", "ads-home.tsx"],
    ["components", "ads", "multiplier.tsx"],
  ],
};

describe("the studios' examples", () => {
  it("has a row for every studio and tool without covers of its own: four each, none twice, and Mixed Media's one reveal", () => {
    expect([...studios].sort()).toEqual([...COMPOSER, ...HUBS, ...Object.keys(ROW_IN), "mixed-media"].sort());
    for (const s of studios) {
      const ids = STUDIO_EXAMPLES[s].tiles.map((e) => e.id);
      expect(ids, s).toHaveLength(s === "mixed-media" ? 1 : 4);
      expect(new Set(ids).size, s).toBe(ids.length);
    }
  });

  it("says over Image's and Edit's apps that they are apps, over Mixed Media's reveal that it plays, and elsewhere what the studio makes", () => {
    for (const s of studios) {
      const heading = { image: "Or start from an app", edit: "Or start from an app", upscale: "Or start from an app", "mixed-media": "See a look play out" }[s as string] ?? "See what it makes";
      expect(studioExamples(s).heading, s).toBe(heading);
    }
  });

  it("names real presets, each with its cover, its clip, its peak frame and their small copies", () => {
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
        // An effect or an app rests on its peak frame (what it made), as on Home; a camera motion on its poster.
        if (card.id.startsWith("motion-")) expect(card.preview.rest, card.id).toBeUndefined();
        else {
          expect(PRESET_PEAKS[card.id], `${card.id} has a peak frame (node scripts/gen-preset-peaks.mjs ${card.id})`).toBeDefined();
          expect(exists(card.preview.rest!.src), card.preview.rest!.src).toBe(true);
          expect(exists(thumbOf(card.preview.rest!.src)), thumbOf(card.preview.rest!.src)).toBe(true);
        }
      }
    }
  });

  it("gives each a line that fits a phone's tile whole, and says what kind it is", () => {
    const wallKinds = new Map<string, string>(HOME_WALL.map((t) => [t.id, t.kind]));
    for (const s of studios) {
      for (const e of studioExamples(s).tiles) {
        expect(e.caption.length, e.card.id).toBeGreaterThan(0);
        expect(e.caption.length, e.card.id).toBeLessThanOrEqual(HOME_CAPTION_MAX.card);
        const type = getPreset(e.card.id)!.type;
        // An app whose cover wipes from a before to an after (Home's wall says so, or it has Home's HD pair) says so.
        const kind =
          type === "motion" ? "Camera motion" : type === "effect" ? "Effect" : (wallKinds.get(e.card.id) ?? (PRESET_BEFORE_AFTER[e.card.id] ? "App · before → after" : "App"));
        expect(e.kind, e.card.id).toBe(kind);
      }
    }
  });

  it("writes every line as plain copy: no model or maker, no status words, a sentence without a full stop", () => {
    const lines = studios.flatMap((s) => studioExamples(s).tiles.map((e) => [e.card.id, e.caption] as const));
    // Every line of EXAMPLE_LINES is shown by a row, and every line a row shows is checked here.
    const shown = new Set(lines.map(([id]) => id));
    for (const id of Object.keys(EXAMPLE_LINES)) expect(shown.has(id), `${id} is in no row`).toBe(true);
    const names = [...new Set(MODELS.flatMap((m) => [m.name, m.vendor]).filter((n) => n.trim().length >= 3))];
    const status = /\b(placeholder|demo|sample|beta|unverified|not checked|coming soon|todo|tbd|draft|gpu|comfy|lora|checkpoint)\b/i;
    for (const [id, line] of lines) {
      expect(line, id).toBe(line.trim());
      expect(line, id).toMatch(/^[A-Z]/);
      expect(line, id).not.toMatch(/[.!?;:]$/);
      expect(line, id).not.toMatch(status);
      for (const n of names) expect(line.toLowerCase().includes(n.toLowerCase()), `${id}: "${line}" names ${n}`).toBe(false);
    }
  });

  it("opens an app on its own page, and picks a motion or effect in the Video studio", () => {
    for (const s of studios) {
      for (const e of studioExamples(s).tiles) {
        expect(e.href, e.card.id).toBe(getPreset(e.card.id)!.type === "app" ? `/apps/${e.card.id}` : `/video?preset=${e.card.id}`);
      }
    }
    // Edit and Image show apps, Video shows what its studio picks.
    for (const s of ["image", "edit"] as const) for (const e of studioExamples(s).tiles) expect(getPreset(e.card.id)!.type, e.card.id).toBe("app");
    for (const e of studioExamples("video").tiles) expect(["motion", "effect"], e.card.id).toContain(getPreset(e.card.id)!.type);
  });

  it("stays on the server: the pages take only its type, and load the tiles in their own chunk", () => {
    expect(read("lib", "studio-examples.ts")).toMatch(/^import "server-only";$/m);
    const page = read("components", "studio", "studio-page.tsx");
    expect(page).toMatch(/^import type \{ StudioExample, StudioExampleRow \} from "@\/lib\/studio-examples";$/m);
    expect(page).toMatch(/dynamic\(\(\) => import\("@\/components\/home\/showcase-tile"\)/);
    expect(page).not.toMatch(/^import [^;]*from "@\/components\/home\/showcase-tile";$/m);
    const row = read("components", "studio", "example-row.tsx");
    expect(row).toMatch(/^import type \{ StudioExampleRow \} from "@\/lib\/studio-examples";$/m);
    expect(row).toMatch(/dynamic\(\(\) => import\("@\/components\/home\/showcase-tile"\)/);
    expect(row).not.toMatch(/^import [^;]*from "@\/components\/home\/showcase-tile";$/m);
    for (const [s, files] of Object.entries(ROW_IN)) {
      for (const f of files) {
        const code = read(...f);
        expect(code, f.join("/")).toMatch(/^import type \{ StudioExampleRow \} from "@\/lib\/studio-examples";$/m);
        expect(code, f.join("/")).not.toMatch(/^import (?!type )[^;]*from "@\/lib\/studio-examples";$/m);
        expect(code, `${s}: ${f.join("/")}`).toContain("<ExampleRow row={examples}");
      }
    }
  });

  it("is passed on by every page that shows a row", () => {
    const pageOf = (...p: string[]) => read("app", "(studio)", ...p, "page.tsx");
    for (const s of [...COMPOSER, ...HUBS, ...Object.keys(ROW_IN)]) expect(pageOf(s), s).toContain(`examples={studioExamples("${s}")}`);
    // Ad Multiplier shows Ads Studio's row; Mixed Media's reveal opens "How it works".
    expect(pageOf("ads", "multiplier")).toContain('examples={studioExamples("ads")}');
    expect(pageOf("mixed-media")).toContain('how={studioExamples("mixed-media")}');
    const mixed = read("components", "mixed-media", "mixed-studio.tsx");
    expect(mixed).toMatch(/<How onStart=\{[^}]+\} cloud=\{[^}]+\} reveal=\{how\} \/>/);
    expect(mixed).toMatch(/\{!!reveal\?\.tiles\.length && <HowReveal row=\{reveal\} \/>\}/);
    // A hub hands its row to its first mode's studio (the hub's own URL), as the Studio pages do.
    expect(read("components", "studio", "mode-switch-studio.tsx")).toMatch(/<StudioPage [^>]*examples=\{examples\} \/>/);
  });

  it("shows only once the feed is known to be empty, and a Video tile picks its move through the composer", () => {
    const page = read("components", "studio", "studio-page.tsx");
    expect(page).toMatch(/\{feed\.isSuccess && !hasItems && !!examples\?\.tiles\.length && <StudioExamples /);
    expect(page).toMatch(/onNavigate=\{pickHere\(e\.href\)\}/);
    expect(read("components", "studio", "composer.tsx")).toMatch(/bridgeRef\.pick = pickPreset;/);
    // A tile picked from the keyboard hands its focus to its own studio's composer, not to a hidden studio's.
    expect(page).toMatch(/closest\("\[data-studio\]"\)\?\.querySelector<HTMLElement>\("\[data-composer\]"\)/);
    expect(page).toMatch(/if \(keyboard\) requestAnimationFrame\(\(\) => \(composer\?\.querySelector\("textarea"\) \?\? composer\?\.querySelector\("button"\)\)\?\.focus\(\{ preventScroll: true \}\)\)/);
    expect(page).toMatch(/^\s+data-studio$/m);
    // The first pick loads the move's card: only the card waits for its code, so the studio (and the focus) stays.
    expect(page).toMatch(/<Suspense fallback=\{null\}>\s*<ActivePresetHeader \/>\s*<\/Suspense>/);
  });
});
