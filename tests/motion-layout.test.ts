import { describe, expect, it } from "vitest";
import { directionOf, graphemes, layoutText, spelled, type TextSpec } from "@/lib/motion/layout";
import { measure } from "./helpers/motion";

// Text set exactly as typed: balanced breaks, no truncation, no case change, words never split, any script.

const cp = (...c: number[]) => String.fromCodePoint(...c);
const FAMILY = cp(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467);
const spec = (text: string, over: Partial<TextSpec> = {}): TextSpec => ({ text, family: "Inter", weight: 700, width: 600, maxLines: 2, max: 60, min: 40, letters: true, ...over });

describe("text layout (motion-layout)", () => {
  it("balances lines: no lone short word on the last line", () => {
    // Greedy wrapping would put "now." alone on line 2.
    const l = layoutText(spec("Invoices that chase themselves now.", { width: 1000, max: 60, min: 60 }), measure);
    expect(l.overflow).toBe(false);
    expect(l.lines.length).toBe(2);
    const [a, b] = l.lines.map((x) => x.width);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(150);
    expect(l.lines.map((x) => x.text)).toEqual(["Invoices that chase", "themselves now."]);
  });

  it("uses the largest size that fits before adding lines", () => {
    const one = layoutText(spec("Quietly exceptional.", { width: 700 }), measure);
    expect(one.lines.length).toBe(1);
    expect(one.size).toBe(60);
    const shrunk = layoutText(spec("Quietly exceptional cream for evenings.", { width: 700, maxLines: 1 }), measure);
    expect(shrunk.size).toBeLessThan(60);
    expect(shrunk.size).toBeGreaterThanOrEqual(40 * 0.99);
  });

  it("flags overflow instead of cutting: never an ellipsis, never a broken word", () => {
    const text = "An extraordinarily long product name that will never fit in two short lines at all";
    const l = layoutText(spec(text, { width: 300 }), measure);
    expect(l.overflow).toBe(true);
    expect(l.size).toBe(40);
    expect(l.lines.map((x) => x.text).join(" ")).toBe(text);
    for (const line of l.lines) expect(line.text).not.toMatch(/…|\.\.\./);
    const word = layoutText(spec("Supercalifragilisticexpialidocious", { width: 300 }), measure);
    expect(word.overflow).toBe(true);
    expect(word.lines.map((x) => x.text)).toEqual(["Supercalifragilisticexpialidocious"]);
  });

  it("never changes case, keeps typed line breaks and runs of spaces", () => {
    const l = layoutText(spec("iPhone  stays\nexactly SO", { width: 2000, maxLines: 3 }), measure);
    expect(l.lines.map((x) => x.text)).toEqual(["iPhone  stays", "exactly SO"]);
    expect(l.lines[1].gap).toBe("\n");
    expect(spelled(l.lines)).toBe("iPhone  stays\nexactly SO");
    expect(spelled(l.lines.flatMap((x) => x.words))).toBe("iPhone  stays\nexactly SO");
    expect(spelled(l.lines.flatMap((x) => x.graphemes ?? []))).toBe("iPhone  stays\nexactly SO");
  });

  it("trims only the ends", () => {
    const l = layoutText(spec("  two  spaces  "), measure);
    expect(l.text).toBe("two  spaces");
    expect(spelled(l.lines)).toBe("two  spaces");
  });

  it("round-trips emoji, accents, CJK and right-to-left text, and keeps grapheme clusters whole", () => {
    for (const text of [`${FAMILY} family`, `É${cp(0x301)}cole ${cp(0xfb01)}ne`, "日本語のテキストを正確に", "العربية الجميلة", "iPhone® 15 — 20 % off!"]) {
      const l = layoutText(spec(text, { width: 300, maxLines: 4 }), measure);
      expect(spelled(l.lines), text).toBe(text);
      expect(spelled(l.lines.flatMap((x) => x.words)), text).toBe(text);
      const letters = l.lines.flatMap((x) => x.graphemes ?? x.words);
      expect(spelled(letters), text).toBe(text);
    }
    const fam = layoutText(spec(`${FAMILY} family`), measure);
    expect(fam.lines[0].graphemes![0].text).toBe(FAMILY);
    expect(graphemes(FAMILY)).toHaveLength(1);
    // Arabic joins its letters: drawn by word, right to left.
    const ar = layoutText(spec("العربية الجميلة"), measure);
    expect(ar.dir).toBe("rtl");
    expect(ar.lines[0].graphemes).toBeNull();
    expect(ar.lines[0].words[0].x).toBeGreaterThan(ar.lines[0].words[1].x);
    expect(directionOf("Hello")).toBe("ltr");
    // CJK may break between its words.
    const ja = layoutText(spec("日本語のテキストを正確に表示します", { width: 260, maxLines: 4, max: 40, min: 30 }), measure);
    expect(ja.lines.length).toBeGreaterThan(1);
    expect(ja.lines.map((x) => x.text).join("")).toBe("日本語のテキストを正確に表示します");
  });

  it("places letters and words where the whole line puts them", () => {
    const l = layoutText(spec("Shop now"), measure);
    const line = l.lines[0];
    expect(line.words[1].x).toBeCloseTo(measure("Shop ", l.font));
    const last = line.graphemes!.at(-1)!;
    expect(last.x + last.w).toBeCloseTo(line.width);
  });

  it("handles empty text", () => {
    const l = layoutText(spec("   "), measure);
    expect(l.lines).toEqual([]);
    expect(l.overflow).toBe(false);
  });
});
