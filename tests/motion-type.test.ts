import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { facesOf, fontOf, isKineticFamily, KINETIC_FACES, KINETIC_UNICODE_RANGE, weightFor } from "@/lib/motion/type/faces";
import { heroTracking, isAllCaps, PAIRING_IDS, pairingFaces, pairingFor, PAIRINGS } from "@/lib/motion/type/pairings";
import { figureCell, inkOf, setSpelling, setType, type BoxMeasure, type TypeSpec } from "@/lib/motion/type/glyphs";
import { planType, drawType } from "@/lib/motion/type/animate";
import { textNodes } from "@/lib/motion/display";
import { spelled } from "@/lib/motion/layout";
import { measure } from "./helpers/motion";

// Kinetic's own type: self-hosted open-licence faces, nine pairings, and type set for motion with exact text.

const ROOT = join(__dirname, "..");
const pub = (url: string) => join(ROOT, "public", url.replace(/^\//, ""));

describe("Kinetic faces", () => {
  it("ships every face as a subset WOFF2 with its licence, at the size and version listed", () => {
    expect(KINETIC_FACES.length).toBeGreaterThanOrEqual(20);
    // Only faces a pairing draws with are shipped.
    const used = new Set(Object.values(PAIRINGS).flatMap((p) => [p.hero, p.accent, p.meta, p.body, p.figures].filter((f) => !!f).map((f) => f!.family)));
    for (const f of KINETIC_FACES) expect(used.has(f.family), f.family).toBe(true);
    let total = 0;
    for (const f of KINETIC_FACES) {
      const file = pub(f.file);
      expect(existsSync(file), f.file).toBe(true);
      expect(statSync(file).size, f.id).toBe(f.bytes);
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), f.id).toBe("wOF2");
      expect(f.bytes, `${f.id} stays small (subset)`).toBeLessThan(100 * 1024);
      expect(existsSync(pub(f.licence)), f.licence).toBe(true);
      expect(readFileSync(pub(f.licence), "utf8"), f.licence).toMatch(/SIL OPEN FONT LICENSE/i);
      expect(f.v).toMatch(/^[0-9a-f]{8}$/);
      total += f.bytes;
    }
    expect(total).toBeLessThan(1.5 * 1024 * 1024);
    expect(KINETIC_UNICODE_RANGE).toMatch(/^U\+0020-007E/);
  });

  it("never ships a face under a closed or Fontshare licence", () => {
    const banned = /satoshi|clash|general sans|cabinet|switzer|helvetica|futura|gotham|proxima/i;
    for (const f of KINETIC_FACES) expect(f.family, f.id).not.toMatch(banned);
  });

  it("loads only the faces asked for, in the styles asked for", () => {
    expect(facesOf(["Kinetic Anton"]).map((f) => f.id)).toEqual(["anton"]);
    expect(facesOf([{ family: "Kinetic Instrument Serif", style: "italic" }]).map((f) => f.id)).toEqual(["instrument-serif-italic"]);
    expect(facesOf(["Kinetic Instrument Serif"]).map((f) => f.id).sort()).toEqual(["instrument-serif", "instrument-serif-italic"]);
    expect(facesOf(["Inter", "Playfair Display", null, undefined])).toEqual([]);
    expect(isKineticFamily("Kinetic Fraunces Soft")).toBe(true);
    expect(isKineticFamily("Inter")).toBe(false);
  });

  it("never takes over a brand font: families a brand kit can pick stay on the web-font service", () => {
    // A brand set in Manrope or Anton keeps every weight and script the web-font service has.
    for (const f of KINETIC_FACES) expect(f.family, f.id).toMatch(/^Kinetic /);
    for (const brand of ["Anton", "Manrope", "Outfit", "Instrument Serif", "Unbounded", "Caveat", "Fraunces", "Inter"]) expect(isKineticFamily(brand), brand).toBe(false);
    expect(facesOf(["Manrope", "Anton"])).toEqual([]);
  });

  it("asks a face only for a weight it has (a static face isn't faked bolder)", () => {
    expect(weightFor("Kinetic Anton", 800)).toBe(400);
    expect(weightFor("Kinetic Big Shoulders Display", 400)).toBe(600);
    expect(weightFor("Kinetic Big Shoulders Display", 950)).toBe(900);
    expect(weightFor("Kinetic Space Mono", 650)).toBe(700);
    expect(fontOf("Kinetic Bodoni Moda Display", 120.4, 500, "italic")).toBe('italic 500 120px "Kinetic Bodoni Moda Display", Georgia, serif');
  });
});

describe("type pairings", () => {
  it("are all hosted faces, with weights and styles each face has", () => {
    for (const id of PAIRING_IDS) {
      const p = PAIRINGS[id];
      for (const role of [p.hero, p.accent, p.meta, p.body, p.figures]) {
        if (!role) continue;
        const faces = KINETIC_FACES.filter((f) => f.family === role.family && f.style === (role.style ?? "normal"));
        expect(faces.length, `${id} ${role.family} ${role.style ?? "normal"}`).toBeGreaterThan(0);
        expect(faces.some((f) => role.weight >= f.weight[0] && role.weight <= f.weight[1]), `${id} ${role.family} ${role.weight}`).toBe(true);
      }
      expect(pairingFaces(id).length, id).toBeGreaterThanOrEqual(2);
      expect(pairingFaces(id).length, `${id}: two families plus one mono at most`).toBeLessThanOrEqual(4);
    }
  });

  it("set condensed caps tight and luxury caps wide, never tracking body copy", () => {
    expect(PAIRINGS.T1.hero.leading).toBeGreaterThanOrEqual(0.82);
    expect(PAIRINGS.T1.hero.leading).toBeLessThanOrEqual(0.9);
    for (const id of PAIRING_IDS) expect(PAIRINGS[id].body.tracking, id).toBe(0);
    for (const id of PAIRING_IDS) expect(PAIRINGS[id].meta.tracking, id).toBeGreaterThanOrEqual(0.06);
    expect(heroTracking(PAIRINGS.T4, "MAISON")).toBe(0.25);
    expect(heroTracking(PAIRINGS.T4, "Maison")).toBe(-0.005);
    expect(isAllCaps("20% OFF")).toBe(true);
    expect(pairingFor("beauty").id).toBe("T5");
    expect(pairingFor("unknown").id).toBe("T1");
  });
});

const spec = (text: string, over: Partial<TypeSpec> = {}): TypeSpec => ({ field: "headline", text, family: "Anton", weight: 400, max: 200, min: 60, x: 100, y: 300, width: 880, maxLines: 3, leading: 0.84, ...over });

/** A measure with kerning: "AV" and "To" are 0.2 em tighter than their letters' sum. */
const kerned: BoxMeasure = (text, font) => {
  const px = Number(/(\d+)px/.exec(font)![1]);
  let w = measure(text, font);
  for (const pair of ["AV", "To"]) w -= (text.split(pair).length - 1) * 0.2 * px;
  return w;
};

describe("type set for motion", () => {
  it("spells the typed words back from its lines, words and letters, in any script", () => {
    for (const text of ["Make it count", "Invoices  that chase\nthemselves.", "Le Sérum Nuit", "مرحبا بالعالم", "東京の夜", "👩‍👩‍👧 family first", "office fluff"]) {
      const s = setType(spec(text), measure);
      expect(setSpelling(s), text).toBe(text.trim());
      const p = planType("headline", s, { in: "cut-rise-glyph", at: 0 }, { w: 1080, h: 1920 });
      expect(spelled(textNodes(drawType(p, { fill: "#000" }, 10).nodes)[0].runs), text).toBe(text.trim());
    }
  });

  it("places each letter from the measured line up to it, so kerning survives when letters move apart", () => {
    const s = setType(spec("AVATAR To", { max: 100, min: 100 }), kerned);
    const font = s.font;
    const line = "AVATAR To";
    s.glyphs.forEach((g, k) => {
      const offset = [...line].findIndex((_, i) => [...line.slice(0, i)].filter((c) => c !== " ").length === k && line[i] !== " ");
      const expected = s.lines[0].x + kerned(line.slice(0, offset + 1), font) - measure(g.text, font);
      expect(g.x, g.text).toBeCloseTo(expected, 6);
    });
  });

  it("adds tracking after every letter (spaces too) and widens the line by it", () => {
    const plain = setType(spec("BIG IDEA", { max: 100, min: 100 }), measure);
    const tracked = setType(spec("BIG IDEA", { max: 100, min: 100, tracking: 0.1 }), measure);
    expect(tracked.lines[0].w - plain.lines[0].w).toBeCloseTo(0.1 * 100 * 7, 6);
    expect(tracked.glyphs[3].x - plain.glyphs[3].x).toBeCloseTo(0.1 * 100 * 4, 6);
  });

  it("chooses its size so the animation's widest moment fits, else flags the overflow", () => {
    const s = setType(spec("LUMEN", { max: 300, min: 60, width: 700 }), measure);
    const wide = setType(spec("LUMEN", { max: 300, min: 60, width: 700, widest: { tracking: 0.4 } }), measure);
    expect(wide.size).toBeLessThan(s.size);
    expect(wide.lines[0].w + 0.4 * wide.size * 4).toBeLessThanOrEqual(700 + 1e-6);
    expect(setType(spec("SUPERCALIFRAGILISTIC", { max: 100, min: 60, width: 500, widest: { tracking: 0.4 } }), measure).overflow).toBe(true);
    expect(setType(spec("Big", { max: 200, min: 60, width: 400, widest: { scale: 1.15 } }), measure).lines[0].w * 1.15).toBeLessThanOrEqual(400 + 1e-6);
  });

  it("aligns the first line's cap top to y, and centres or right-aligns lines in the box", () => {
    const s = setType(spec("Big idea", { max: 100, min: 100 }), measure);
    expect(s.lines[0].y + s.cap.top).toBeCloseTo(300, 6);
    const c = setType(spec("Big idea", { max: 100, min: 100, align: "centre" }), measure);
    expect(c.lines[0].x + c.lines[0].w / 2).toBeCloseTo(100 + 440, 6);
    const r = setType(spec("Big idea", { max: 100, min: 100, align: "right" }), measure);
    expect(r.lines[0].x + r.lines[0].w).toBeCloseTo(980, 6);
  });

  it("hangs an opening quote outside the left edge, and starts other lines at the ink", () => {
    const boxed: BoxMeasure = Object.assign((t: string, f: string) => measure(t, f), { box: (t: string, f: string) => ({ top: 10, bottom: 80, left: t.startsWith("B") ? 6 : 0, right: measure(t, f) }) });
    const q = setType(spec("“Big idea”", { max: 100, min: 100 }), boxed);
    expect(q.glyphs[1].x).toBeCloseTo(100, 6);
    const b = setType(spec("Big idea", { max: 100, min: 100 }), boxed);
    expect(b.lines[0].x).toBeCloseTo(100 - 6, 6);
  });

  it("puts figures in equal cells when tabular, so a changing number never jitters", () => {
    const narrow1: BoxMeasure = (t, f) => {
      const px = Number(/(\d+)px/.exec(f)![1]);
      return [...t].reduce((w, c) => w + (c === "1" ? 0.3 : 0.5) * px, 0);
    };
    const s = setType(spec("1,184", { max: 100, min: 100, tabular: true }), narrow1);
    const cell = figureCell(narrow1, s.font);
    expect(cell).toBe(50);
    const ones = s.glyphs.filter((g) => g.text === "1");
    // A "1" sits centred in a full figure's cell.
    expect(ones[0].x - s.lines[0].x).toBeCloseTo((50 - 30) / 2, 6);
  });

  it("moves joining scripts and ligature lines by word only, with no tracking", () => {
    const ar = setType(spec("مرحبا بالعالم", { tracking: 0.2 }), measure);
    expect(ar.tracking).toBe(0);
    expect(ar.splittable).toBe(false);
    expect(ar.glyphs).toEqual([]);
    const lig = setType(spec("office fluff"), measure);
    expect(lig.lines[0].glyphs).toBeNull();
    const p = planType("headline", lig, { in: "pop-in", at: 0 }, { w: 1080, h: 1920 });
    expect(p.units.map((u) => u.info.kind)).toEqual(["word", "word"]);
  });

  it("estimates ink without browser metrics, and uses the browser's where given", () => {
    expect(inkOf(measure, "Hg", '400 100px "Anton"').bottom).toBe(100);
    expect(inkOf(measure, "H", '400 100px "Anton"')).toEqual({ top: 10, bottom: 82, left: 0, right: 50 });
    const boxed: BoxMeasure = Object.assign((t: string, f: string) => measure(t, f), { box: () => ({ top: 1, bottom: 2, left: 3, right: 4 }) });
    expect(inkOf(boxed, "H", "x")).toEqual({ top: 1, bottom: 2, left: 3, right: 4 });
  });
});
