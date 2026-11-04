/**
 * Colour for Kinetic looks (pure): OKLab maths, and the palette a look derives from a brand kit's two colours.
 *
 * - Every derived colour stays on the brand's hues: tonal steps move lightness only, in OKLab, so the hue a person
 *   chose never shifts. Contrast is fixed the same way (lightness moves, never the hue).
 * - `paper` is a warm off-white tinted toward the brand; `night` is the brand's hue near black. Large fields are never
 *   pure white or pure black.
 * - Gradients between two colours are sampled in OKLab (a canvas blends in sRGB, which goes muddy in the middle).
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgbOf(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB hex to OKLab. */
export function toLab(hex: string): Lab {
  const [r, g, b] = rgbOf(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

function labToLinear({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (c: [number, number, number]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLab to sRGB hex; out-of-gamut colours lose chroma (keeping lightness and hue) until they fit. */
export function fromLab(lab: Lab): string {
  let c = labToLinear(lab);
  if (!inGamut(c)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(labToLinear({ L: lab.L, a: lab.a * k, b: lab.b * k }))) lo = k;
      else hi = k;
    }
    c = labToLinear({ L: lab.L, a: lab.a * lo, b: lab.b * lo });
  }
  return `#${c.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Two colours mixed in OKLab (p = 0: a, 1: b). */
export function mixOk(a: string, b: string, p: number): string {
  const x = toLab(a);
  const y = toLab(b);
  return fromLab({ L: x.L + (y.L - x.L) * p, a: x.a + (y.a - x.a) * p, b: x.b + (y.b - x.b) * p });
}

/** The colour at OKLab lightness L, same hue (chroma kept where it fits). */
export function withLightness(hex: string, L: number): string {
  const c = toLab(hex);
  return fromLab({ L: Math.min(1, Math.max(0, L)), a: c.a, b: c.b });
}

/** Chroma (colourfulness) in OKLab. */
export const chroma = (hex: string): number => {
  const c = toLab(hex);
  return Math.hypot(c.a, c.b);
};

/** WCAG relative luminance and contrast ratio. */
export function luminanceOf(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastOf(a: string, b: string): number {
  const x = luminanceOf(a);
  const y = luminanceOf(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * `fg` moved in lightness only until it reaches `min` contrast against `bg`: away from `bg` first (darker on a light
 * ground), the other way when that can't reach it (a mid-tone ground), else whichever end reads best.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastOf(fg, bg) >= min) return fg;
  const L = toLab(fg).L;
  const search = (darker: boolean): string | null => {
    let lo = darker ? 0 : L;
    let hi = darker ? L : 1;
    // The lightness nearest the original that passes.
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const ok = contrastOf(withLightness(fg, mid), bg) >= min;
      if (darker) {
        if (ok) lo = mid;
        else hi = mid;
      } else if (ok) hi = mid;
      else lo = mid;
    }
    const out = withLightness(fg, darker ? lo : hi);
    return contrastOf(out, bg) >= min ? out : null;
  };
  const first = toLab(bg).L > 0.6;
  const found = search(first) ?? search(!first);
  if (found) return found;
  return contrastOf("#0b0b0c", bg) >= contrastOf("#fbfaf7", bg) ? "#0b0b0c" : "#fbfaf7";
}

/** `n` gradient stops from a to b sampled in OKLab (for a canvas gradient that stays clean in the middle). */
export function okStops(a: string, b: string, n = 5, from = 0, to = 1): { at: number; color: string }[] {
  return Array.from({ length: n }, (_, i) => ({ at: from + ((to - from) * i) / (n - 1), color: mixOk(a, b, i / (n - 1)) }));
}

export type Look = "brand" | "light" | "dark";

export interface KineticPalette {
  look: Look;
  ground: string;
  /** The hero colour (the strongest contrast against the ground). */
  ink: string;
  /** Tonal steps of the ground toward the ink (ghost type, panels, rings). */
  tone1: string;
  tone2: string;
  /** Overlays: the pill, the highlighter, one word. */
  accent: string;
  /** Ink on the accent. */
  onAccent: string;
  paper: string;
  night: string;
  /** Small details (ink at 75 %). */
  meta: string;
  /** The brand's two colours as given. */
  brand: [string, string];
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgbOf(hex).map((v) => Math.round(v * 255));
  return `rgba(${r},${g},${b},${a})`;
};

/** A look's palette from a brand kit's colours (§ brand first: no hue outside the kit but paper, night and light). */
export function kineticPalette(colors: readonly string[], look: Look): KineticPalette {
  const kit = colors.filter((c) => HEX.test(c)).map((c) => (c.startsWith("#") ? c : `#${c}`).toLowerCase());
  const c0 = kit[0] ?? "#1f3a5f";
  const c1 = kit[1] ?? mixOk(c0, "#ffffff", 0.7);
  const paper = mixOk("#faf7f2", c0, 0.035);
  // Night: the brand's own hue near black with only a trace of its colour (a muddy mid-chroma dark reads olive or khaki).
  const lab0 = toLab(c0);
  const C0 = Math.hypot(lab0.a, lab0.b);
  const nc = C0 > 1e-4 ? Math.min(0.032, C0 * 0.4) / C0 : 0;
  const night = fromLab({ L: 0.135, a: lab0.a * nc, b: lab0.b * nc });
  let ground: string;
  let ink: string;
  let accent: string;
  if (look === "light") {
    ground = paper;
    ink = ensureContrast(c0, ground, 4.5);
    accent = c1;
  } else if (look === "dark") {
    ground = night;
    ink = paper;
    accent = ensureContrast(c1, ground, 3);
  } else {
    ground = c0;
    // The second colour on the first when it reads (a two-tone look), else paper or night.
    const candidates = [c1, paper, night];
    ink = candidates.find((c) => contrastOf(c, ground) >= 4.5) ?? candidates.sort((a, b) => contrastOf(b, ground) - contrastOf(a, ground))[0];
    // A mid-tone brand colour that nothing reads on at 4.5:1: the ground steps in lightness (away from the ink) until it does.
    if (contrastOf(ink, ground) < 4.5) ground = ensureContrast(ground, ink, 4.5);
    accent = ink === c1 ? (contrastOf(paper, ground) > contrastOf(night, ground) ? paper : night) : c1;
  }
  const gL = toLab(ground).L;
  const iL = toLab(ink).L;
  const step = (k: number) => withLightness(ground, gL + (iL - gL) * k);
  const onAccent = [ground, paper, night].sort((a, b) => contrastOf(b, accent) - contrastOf(a, accent))[0];
  return { look, ground, ink, tone1: step(0.09), tone2: step(0.15), accent, onAccent, paper, night, meta: rgba(ink, 0.75), brand: [c0, c1] };
}

/** A colour at OKLCh (lightness, chroma, hue in degrees); out-of-gamut chroma is reduced to fit. */
export function fromLch(L: number, C: number, h: number): string {
  const r = (h * Math.PI) / 180;
  return fromLab({ L: Math.min(1, Math.max(0, L)), a: C * Math.cos(r), b: C * Math.sin(r) });
}

/** OKLCh of a colour (hue in degrees). */
export function lchOf(hex: string): { L: number; C: number; h: number } {
  const c = toLab(hex);
  return { L: c.L, C: Math.hypot(c.a, c.b), h: ((Math.atan2(c.b, c.a) * 180) / Math.PI + 360) % 360 };
}

/**
 * A lit two-stop field for a look (§3.2): the dark stop is the brand's hue deep (L 0.11, chroma at least 60 % of the
 * brand's), the light stop 0.2 lighter with the hue turned 20° (an analogous pair, never grey). Olive-prone hues
 * (yellows and greens near 70–125°) keep their chroma low. Light looks: paper tinted toward the brand, a step deeper at
 * its far corner. Brand looks: the brand colour a step either side.
 */
export function fieldStops(pal: KineticPalette): { dark: string; light: string } {
  const b = lchOf(pal.brand[0]);
  const olive = b.h > 70 && b.h < 125;
  if (pal.look === "light") {
    const C = Math.min(0.03, b.C * 0.25);
    return { light: fromLch(0.975, C * 0.6, b.h), dark: fromLch(0.92, C, (b.h + 18) % 360) };
  }
  const g = lchOf(pal.ground);
  if (pal.look === "brand" && g.L > 0.2) {
    return { dark: fromLch(g.L - 0.07, g.C * 1.05, g.h), light: fromLch(g.L + 0.08, g.C, (g.h + 18) % 360) };
  }
  const C = olive ? Math.min(0.035, b.C * 0.4) : Math.max(0.6 * b.C, Math.min(0.08, b.C));
  return { dark: fromLch(0.115, C * 0.75, b.h), light: fromLch(0.32, C, (b.h + 20) % 360) };
}

/** Whether two hues are close enough for a gradient between them (within ±30° in OKLCh). */
export function analogous(a: string, b: string, maxDeg = 30): boolean {
  const x = toLab(a);
  const y = toLab(b);
  if (Math.hypot(x.a, x.b) < 0.02 || Math.hypot(y.a, y.b) < 0.02) return true;
  const d = Math.abs(Math.atan2(x.b, x.a) - Math.atan2(y.b, y.a)) * (180 / Math.PI);
  return Math.min(d, 360 - d) <= maxDeg;
}
