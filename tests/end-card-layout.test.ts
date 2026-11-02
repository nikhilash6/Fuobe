import { describe, expect, it } from "vitest";
import { contrast, themeFrom } from "@/components/ads/layout";
import { planEndCard } from "@/components/marketing/end-card";
import { cardColours, endCardRest, type EndCardRest } from "@/lib/motion/scenes/end-card/shared";
import { designSize, type SizeSpec } from "@/lib/motion/sizes";
import { measure } from "./helpers/motion";

// The end card's rest layout at every size (end-card-layout): sizes from the short side, the whole stack inside the
// frame, the address under the pill (never under it on screen), a tall card's foot clear, and the kit's own colours.

const theme = themeFrom({ colors: ["#0e3b2f", "#cfae6e"], fonts: { heading: "Cormorant Garamond", body: "Manrope" } });
const content = { brand: "Aurèle", product: "Crème Absolue Régénérante Intense", cta: "Discover the ritual", website: "aurele-paris.com" };

const rest = (size: SizeSpec, logo: { w: number; h: number } | null = { w: 1400, h: 360 }) => endCardRest({ theme, content, logo, measure, size: designSize(size), colors: ["#0e3b2f", "#cfae6e"] });

/** The stack's boxes, top to bottom. */
function boxes(r: EndCardRest) {
  const out: { name: string; top: number; bottom: number; left: number; right: number }[] = [];
  if (r.logo) out.push({ name: "logo", top: r.logo.y, bottom: r.logo.y + r.logo.h, left: r.logo.x, right: r.logo.x + r.logo.w });
  if (r.brand) out.push({ name: "brand", top: r.brand.y, bottom: r.brand.y + r.brand.layout.height, left: r.brand.cx - r.brand.layout.width / 2, right: r.brand.cx + r.brand.layout.width / 2 });
  const h = r.headline;
  out.push({ name: "headline", top: h.y, bottom: h.y + h.layout.height, left: h.cx - h.layout.width / 2, right: h.cx + h.layout.width / 2 });
  if (r.cta) out.push({ name: "pill", top: r.cta.y, bottom: r.cta.y + r.cta.h, left: r.cta.x, right: r.cta.x + r.cta.w });
  if (r.site) out.push({ name: "site", top: r.site.y, bottom: r.site.y + r.site.layout.height, left: r.site.cx - r.site.layout.width / 2, right: r.site.cx + r.site.layout.width / 2 });
  return out;
}

describe("the end card's layout (end-card-layout)", () => {
  for (const size of ["9:16", "16:9", "1:1", "4:5"] as const) {
    for (const logo of [{ w: 1400, h: 360 }, null]) {
      it(`keeps a two-line headline's stack inside a ${size} frame, in order, nothing overlapping (${logo ? "logo" : "name"})`, () => {
        const r = rest(size, logo);
        expect(r.overflow).toEqual([]);
        expect(r.headline.layout.lines.length).toBe(2);
        const b = boxes(r);
        for (const x of b) {
          expect(x.top, `${size} ${x.name}`).toBeGreaterThanOrEqual(r.margin - 0.5);
          expect(x.bottom, `${size} ${x.name}`).toBeLessThanOrEqual(r.h - r.margin + 0.5);
          expect(x.left, `${size} ${x.name}`).toBeGreaterThanOrEqual(r.margin - 0.5);
          expect(x.right, `${size} ${x.name}`).toBeLessThanOrEqual(r.w - r.margin + 0.5);
        }
        for (let i = 1; i < b.length; i++) expect(b[i].top, `${size} ${b[i].name} under ${b[i - 1].name}`).toBeGreaterThan(b[i - 1].bottom);
        // The address sits just under the pill, not at the frame's foot.
        const pill = b.find((x) => x.name === "pill")!;
        const site = b.find((x) => x.name === "site")!;
        expect(site.top - pill.bottom).toBeLessThan(r.h * 0.06);
      });
    }
  }

  it("sizes type and the pill from the short side: a wide card sets what a tall one does", () => {
    const tall = rest("9:16");
    const wide = rest("16:9");
    expect(wide.headline.layout.size).toBeCloseTo(tall.headline.layout.size, 6);
    expect(wide.cta!.h).toBeCloseTo(tall.cta!.h, 6);
    // A 16:9 headline and pill are no taller than a third of the frame together.
    expect(wide.headline.layout.height + wide.cta!.h).toBeLessThan(wide.h / 3);
  });

  it("keeps a tall card's bottom fifth clear (where phone apps put their buttons and captions)", () => {
    for (const logo of [{ w: 1400, h: 360 }, { w: 400, h: 400 }, null]) {
      const r = rest("9:16", logo);
      const last = boxes(r).at(-1)!;
      expect(last.bottom).toBeLessThanOrEqual(r.h * 0.8 + 0.5);
    }
  });

  it("dresses the words and the pill in the kit's own colours when one reads on the brand colour", () => {
    // Emerald and gold: gold words and pill, the label in emerald.
    expect(cardColours(theme, ["#0e3b2f", "#cfae6e"])).toEqual({ ink: "#cfae6e", pill: "#cfae6e", label: "#0e3b2f" });
    // Ivory and navy: navy words on ivory, the label in ivory.
    const light = themeFrom({ colors: ["#f3ede2", "#1c2b4a"] });
    expect(light.accent).toBe("#f3ede2");
    expect(cardColours(light, ["#f3ede2", "#1c2b4a"])).toEqual({ ink: "#1c2b4a", pill: "#1c2b4a", label: "#f3ede2" });
    // No kit colour reads (a pale yellow beside the accent): white or near-black, whichever reads.
    const one = themeFrom({ colors: ["#c1121f", "#e05a5a"] });
    const c = cardColours(one, ["#c1121f", "#e05a5a"]);
    expect(c.ink).toBe(one.onAccent);
    expect(contrast(c.ink, one.accent)).toBeGreaterThanOrEqual(3);
  });

  it("gives the still card the same colours and places as the animated rest frame", () => {
    const size = designSize("9:16");
    const still = planEndCard({ theme, content, logo: null, measure, size, colors: ["#0e3b2f", "#cfae6e"] });
    const r = rest("9:16", null);
    expect(still.headline.color).toBe(r.headline.color);
    expect(still.cta!.color).toBe("#cfae6e");
    expect(still.cta!.text.color).toBe("#0e3b2f");
    expect(still.headline.y).toBeCloseTo(r.headline.y, 6);
  });
});
