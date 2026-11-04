import { describe, expect, it } from "vitest";
import { LINE_GAP, setType, trackingFor, wordSpaceFor, type BoxMeasure } from "@/lib/motion/type/glyphs";

const px = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
// A face with a narrow space (0.1 em), letters 0.5 em, caps from 0.1 to 0.8 em and descenders to 1 em.
const measure: BoxMeasure = Object.assign((text: string, font: string) => [...text].reduce((w, ch) => w + (ch === " " ? 0.1 : 0.5) * px(font), 0), {
  box: (text: string, font: string) => ({ top: px(font) * 0.1, bottom: px(font) * (/[gjpqy]/.test(text) ? 1 : 0.8), left: 0, right: measure(text, font) }),
});

const spec = (text: string, o: Partial<Parameters<typeof setType>[0]> = {}) => ({ field: "t", text, family: "Test", weight: 400, max: 60, min: 60, x: 0, y: 0, width: 5000, maxLines: 4, leading: 1, ...o });

describe("type rules", () => {
  it("never tracks copy with lower-case letters open, nor tighter than 0 below hero size, nor anything tighter than -1 %", () => {
    expect(trackingFor("Discover the scent", 0.14, 30)).toBe(0.01);
    expect(trackingFor("Software that ships", -0.02, 40)).toBe(0);
    expect(trackingFor("SHIP IT", -0.03, 300)).toBe(-0.01);
    expect(trackingFor("MAISON", 0.25, 30)).toBe(0.25);
  });

  it("opens a narrow word space to at least the face's minimum, and keeps the words exactly as typed", () => {
    const set = setType(spec("Software that ships itself", { style: "italic" }), measure);
    const [a, b] = set.words;
    const gap = b.x - (a.x + a.w);
    expect(gap / set.size).toBeGreaterThanOrEqual(wordSpaceFor(60, "italic") - 1e-9);
    expect(set.words.map((w) => w.gap + w.text).join("")).toBe("Software that ships itself");
  });

  it("never lets one line's ink touch the next line's", () => {
    const set = setType(spec("Opening\nNight", { leading: 0.8 }), measure);
    const capH = set.cap.bottom - set.cap.top;
    const [l0, l1] = set.lines;
    expect(l1.ink.y - (l0.ink.y + l0.ink.h)).toBeGreaterThanOrEqual(LINE_GAP * capH - 1e-9);
  });

  it("ends no line on a little joining word when the words allow it", () => {
    const set = setType(spec("Eau de parfum, for the hours after dark", { width: 60 * 0.5 * 24, maxLines: 2 }), measure);
    expect(set.lines.length).toBe(2);
    expect(set.lines[0].text).not.toMatch(/\b(for|the)$/);
  });
});
