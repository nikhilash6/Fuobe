/**
 * Colour grading that runs in the browser (WebGL): the parity studio's free "Color Grading" tool.
 * Every slider is -100…100 (0 = untouched) except grain/vignette/sharpness/fade (0…100).
 */

export interface Grade {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  hue: number;
  saturation: number;
  vibrance: number;
  fade: number;
  sharpness: number;
  grain: number;
  vignette: number;
  /** Split toning: hue (0–360) and strength (0–100) for shadows and highlights. */
  splitShadowHue: number;
  splitHighlightHue: number;
  splitAmount: number;
  /** A negative (0–100: how far towards it) and a solarise curve (0–100: highlights fold back to dark). */
  invert: number;
  solarize: number;
}

export const NEUTRAL: Grade = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  saturation: 0,
  vibrance: 0,
  fade: 0,
  sharpness: 0,
  grain: 0,
  vignette: 0,
  splitShadowHue: 210,
  splitHighlightHue: 35,
  splitAmount: 0,
  invert: 0,
  solarize: 0,
};

export interface GradeControl {
  key: keyof Grade;
  label: string;
  min: number;
  max: number;
  group: "Light" | "Color" | "Effects" | "Split tone";
}

export const CONTROLS: GradeControl[] = [
  { key: "exposure", label: "Exposure", min: -100, max: 100, group: "Light" },
  { key: "contrast", label: "Contrast", min: -100, max: 100, group: "Light" },
  { key: "highlights", label: "Highlights", min: -100, max: 100, group: "Light" },
  { key: "shadows", label: "Shadows", min: -100, max: 100, group: "Light" },
  { key: "fade", label: "Fade", min: 0, max: 100, group: "Light" },
  { key: "temperature", label: "Temperature", min: -100, max: 100, group: "Color" },
  { key: "tint", label: "Tint", min: -100, max: 100, group: "Color" },
  { key: "hue", label: "Hue", min: -100, max: 100, group: "Color" },
  { key: "saturation", label: "Saturation", min: -100, max: 100, group: "Color" },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100, group: "Color" },
  { key: "splitAmount", label: "Strength", min: 0, max: 100, group: "Split tone" },
  { key: "splitShadowHue", label: "Shadow hue", min: 0, max: 360, group: "Split tone" },
  { key: "splitHighlightHue", label: "Highlight hue", min: 0, max: 360, group: "Split tone" },
  { key: "sharpness", label: "Sharpness", min: 0, max: 100, group: "Effects" },
  { key: "grain", label: "Film grain", min: 0, max: 100, group: "Effects" },
  { key: "vignette", label: "Vignette", min: 0, max: 100, group: "Effects" },
  { key: "solarize", label: "Solarize", min: 0, max: 100, group: "Effects" },
  { key: "invert", label: "Invert", min: 0, max: 100, group: "Effects" },
];

export interface GradePreset {
  id: string;
  name: string;
  grade: Partial<Grade>;
}

/** The parity studio's five (Natural, Split Tone, Soft Skin, Old Lens, 16mm) plus a few classic film looks. */
export const PRESETS: GradePreset[] = [
  { id: "natural", name: "Natural", grade: { contrast: 8, vibrance: 12, highlights: -10, shadows: 8, sharpness: 15 } },
  { id: "split-tone", name: "Split Tone", grade: { contrast: 12, saturation: -10, splitAmount: 45, splitShadowHue: 200, splitHighlightHue: 32 } },
  { id: "soft-skin", name: "Soft Skin", grade: { exposure: 6, contrast: -14, highlights: -18, temperature: 10, tint: 6, saturation: -6, fade: 12 } },
  { id: "old-lens", name: "Old Lens", grade: { contrast: -10, temperature: 18, saturation: -22, fade: 25, vignette: 55, grain: 25, sharpness: 0 } },
  { id: "16mm", name: "16mm", grade: { contrast: 18, temperature: 12, saturation: -14, fade: 18, grain: 65, vignette: 35, splitAmount: 20, splitShadowHue: 170, splitHighlightHue: 40 } },
  { id: "teal-orange", name: "Teal & Orange", grade: { contrast: 20, saturation: 8, splitAmount: 60, splitShadowHue: 190, splitHighlightHue: 28, highlights: -10 } },
  { id: "portra", name: "Portra 400", grade: { exposure: 8, contrast: -8, temperature: 14, tint: 4, saturation: -8, vibrance: 10, fade: 10, grain: 20 } },
  { id: "noir", name: "Noir", grade: { contrast: 45, saturation: -100, shadows: -20, vignette: 45, grain: 35 } },
  { id: "faded", name: "Faded Film", grade: { contrast: -25, fade: 40, saturation: -18, temperature: 6, grain: 15 } },
  { id: "golden-hour", name: "Golden Hour", grade: { exposure: 5, temperature: 38, tint: 8, vibrance: 18, highlights: -12, vignette: 20 } },
  { id: "cold-steel", name: "Cold Steel", grade: { contrast: 22, temperature: -40, saturation: -25, shadows: -10, splitAmount: 25, splitShadowHue: 215, splitHighlightHue: 200 } },
  { id: "pop", name: "Pop", grade: { contrast: 25, saturation: 30, vibrance: 25, sharpness: 30 } },
  // Fuobe Soul's post-only looks (Invertethereal, Surreal solarization): a curve, no LoRA.
  { id: "invert", name: "Invert", grade: { invert: 100, saturation: -15, fade: 10 } },
  { id: "solarize", name: "Solarize", grade: { solarize: 100, contrast: 12, saturation: 10 } },
  // Fuobe DoP's colour-grade effects: a clip animated without a LoRA, then graded (Fuobe's own values).
  { id: "film-colors", name: "Film Colors", grade: { contrast: -6, highlights: -12, temperature: 10, saturation: 6, fade: 8, grain: 22 } },
  { id: "black-gloss", name: "Black Gloss", grade: { contrast: 30, highlights: 8, shadows: -30, saturation: -10, sharpness: 25, vignette: 25 } },
  { id: "candy-pink", name: "Candy Pink", grade: { exposure: 6, temperature: 8, tint: 30, saturation: 10, fade: 15, splitAmount: 40, splitShadowHue: 330, splitHighlightHue: 345 } },
  { id: "lime-jam", name: "Lime Jam", grade: { contrast: 18, tint: -30, saturation: 20, splitAmount: 35, splitShadowHue: 95, splitHighlightHue: 75 } },
  { id: "nostalgic-blue", name: "Nostalgic Blue", grade: { temperature: -25, saturation: -15, fade: 25, grain: 20, splitAmount: 30, splitShadowHue: 215, splitHighlightHue: 200 } },
  { id: "soft-palette", name: "Soft Palette", grade: { contrast: -20, highlights: -10, shadows: 12, saturation: -18, fade: 22 } },
  { id: "overtime", name: "Overtime", grade: { contrast: 10, shadows: -10, temperature: -10, tint: -18, saturation: -20, grain: 18 } },
  { id: "crimson-vigil", name: "Crimson Vigil", grade: { contrast: 28, shadows: -15, temperature: 10, saturation: -10, vignette: 40, splitAmount: 55, splitShadowHue: 355, splitHighlightHue: 10 } },
  { id: "bleach-bypass", name: "Bleach Bypass", grade: { contrast: 40, highlights: 10, shadows: -12, saturation: -55, sharpness: 20, grain: 15 } },
  { id: "bleached-warm", name: "Bleached Warm", grade: { contrast: 28, temperature: 22, saturation: -40, fade: 8, grain: 12 } },
  { id: "classic-bw", name: "Classic B&W", grade: { contrast: 20, saturation: -100, grain: 20, vignette: 15 } },
  { id: "hyper-neon", name: "Hyper Neon", grade: { contrast: 25, shadows: -10, saturation: 45, vibrance: 30, splitAmount: 55, splitShadowHue: 285, splitHighlightHue: 185 } },
  { id: "naturalistic-clean", name: "Naturalistic Clean", grade: { contrast: 5, highlights: -8, shadows: 6, vibrance: 8, sharpness: 10 } },
  { id: "sodium-decay", name: "Sodium Decay", grade: { contrast: 18, shadows: -18, temperature: 45, tint: 6, saturation: -20, grain: 25, splitAmount: 35, splitShadowHue: 30, splitHighlightHue: 38 } },
];

export function applyPreset(p: GradePreset): Grade {
  return { ...NEUTRAL, ...p.grade };
}

/** True when nothing visible changes (split-tone hues don't matter at zero strength). */
export function isNeutral(g: Grade): boolean {
  return CONTROLS.every((c) => (c.group === "Split tone" && c.key !== "splitAmount") || g[c.key] === NEUTRAL[c.key]);
}

export const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_temperature, u_tint, u_hue, u_saturation, u_vibrance, u_fade, u_sharpness, u_grain, u_vignette, u_seed;
uniform vec3 u_splitShadow, u_splitHighlight;
uniform float u_splitAmount;
uniform float u_invert, u_solarize;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453); }

vec3 hueRotate(vec3 c, float a) {
  // Rotate around the grey axis (YIQ).
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + a;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return vec3(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q);
}

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  if (u_sharpness > 0.0) {
    vec3 blur = (texture2D(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb + texture2D(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb +
                 texture2D(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb + texture2D(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb) * 0.25;
    c += (c - blur) * u_sharpness * 2.0;
  }
  c *= pow(2.0, u_exposure * 1.5);
  // White balance: warm/cool along blue–amber, tint along green–magenta.
  c *= vec3(1.0 + u_temperature * 0.18, 1.0 - u_tint * 0.12, 1.0 - u_temperature * 0.18);
  c.rb *= 1.0 + u_tint * 0.06;
  float l = luma(c);
  c += u_highlights * 0.35 * smoothstep(0.45, 1.0, l) * (u_highlights < 0.0 ? l : 1.0 - l);
  c += u_shadows * 0.35 * (1.0 - smoothstep(0.0, 0.55, l)) * (u_shadows > 0.0 ? 1.0 - l : l);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c = hueRotate(c, u_hue * 3.14159);
  l = luma(c);
  float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = mix(vec3(l), c, 1.0 + u_saturation + u_vibrance * (1.0 - sat));
  if (u_splitAmount > 0.0) {
    l = clamp(luma(c), 0.0, 1.0);
    vec3 tone = mix(u_splitShadow, u_splitHighlight, smoothstep(0.2, 0.8, l)) - 0.5;
    c += tone * u_splitAmount * 0.35;
  }
  c = mix(c, vec3(0.08) + c * 0.84, u_fade);
  if (u_vignette > 0.0) {
    vec2 d = v_uv - 0.5;
    c *= 1.0 - u_vignette * smoothstep(0.25, 0.85, length(d) * 1.25);
  }
  // Sabattier-style solarise (a tent curve: mid-tones brightest, highlights fold back to dark), then a negative.
  if (u_solarize > 0.0) {
    vec3 s = clamp(c, 0.0, 1.0);
    c = mix(c, 1.0 - abs(2.0 * s - 1.0), u_solarize);
  }
  if (u_invert > 0.0) c = mix(c, 1.0 - clamp(c, 0.0, 1.0), u_invert);
  if (u_grain > 0.0) c += (hash(v_uv / u_texel) - 0.5) * u_grain * 0.22;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Uniform values for a grade (sliders normalised to -1…1 / 0…1). */
export function uniforms(g: Grade): Record<string, number | [number, number, number]> {
  const n = (v: number) => v / 100;
  return {
    u_exposure: n(g.exposure),
    u_contrast: n(g.contrast) * 0.8,
    u_highlights: n(g.highlights),
    u_shadows: n(g.shadows),
    u_temperature: n(g.temperature),
    u_tint: n(g.tint),
    u_hue: n(g.hue) * 0.5,
    u_saturation: n(g.saturation),
    u_vibrance: n(g.vibrance) * 0.8,
    u_fade: n(g.fade) * 0.5,
    u_sharpness: n(g.sharpness),
    u_grain: n(g.grain) * 0.6,
    u_vignette: n(g.vignette) * 0.8,
    u_splitAmount: n(g.splitAmount),
    u_splitShadow: hueToRgb(g.splitShadowHue),
    u_splitHighlight: hueToRgb(g.splitHighlightHue),
    u_invert: n(g.invert),
    u_solarize: n(g.solarize),
  };
}

/** Short description stored as the library prompt, e.g. "Color grade · 16mm · grain 65". */
export function describeGrade(g: Grade, presetName?: string): string {
  const changed = CONTROLS.filter((c) => g[c.key] !== NEUTRAL[c.key] && !(c.group === "Split tone" && c.key !== "splitAmount"))
    .slice(0, 4)
    .map((c) => `${c.label.toLowerCase()} ${g[c.key] > 0 && c.min < 0 ? "+" : ""}${g[c.key]}`);
  return ["Color grade", presetName, ...changed].filter(Boolean).join(" · ");
}
