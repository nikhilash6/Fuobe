/**
 * The lit sphere fal's H3 Max relight reads as its target light (reference_image_url: "Sphere render showing the target
 * lighting"). Fuobe draws it from a light preset: a matte grey ball on a dark ground, lit by one to three lights (direction,
 * colour, strength, softness) over a little ambient light. Pure: the browser puts the pixels on a canvas and uploads them
 * (src/components/studio/light-sphere-chip.tsx); tests read them directly.
 */

/** The sphere picture's side in pixels: square, enough for the API to read the light's direction and colour. */
export const SPHERE_SIZE = 512;

export interface SphereLight {
  /** Where the light comes from, seen from the camera: x right, y up, z toward the viewer (normalised when drawn). */
  dir: [number, number, number];
  /** Linear 0-1 RGB. */
  color: [number, number, number];
  /** How bright, 0-1.5. */
  strength: number;
  /** 0 = a hard edge between light and shadow, 1 = a very soft wrap. */
  softness: number;
}

export interface LightPreset {
  id: string;
  label: string;
  /** What the light is, for the run's prompt-free summary and the picker's tooltip. */
  hint: string;
  ambient: [number, number, number];
  lights: SphereLight[];
}

export const LIGHT_PRESETS: LightPreset[] = [
  {
    id: "golden-left",
    label: "Golden hour",
    hint: "Warm, low sun from the left, long soft shadows",
    ambient: [0.08, 0.07, 0.09],
    lights: [{ dir: [-0.85, 0.25, 0.45], color: [1, 0.66, 0.32], strength: 1.15, softness: 0.35 }],
  },
  {
    id: "noon",
    label: "Midday sun",
    hint: "Hard white sun from above",
    ambient: [0.1, 0.11, 0.13],
    lights: [{ dir: [0.15, 0.95, 0.25], color: [1, 0.97, 0.92], strength: 1.2, softness: 0.05 }],
  },
  {
    id: "overcast",
    label: "Overcast",
    hint: "Soft, even daylight from a cloudy sky",
    ambient: [0.22, 0.23, 0.25],
    lights: [{ dir: [0, 0.8, 0.6], color: [0.85, 0.88, 0.92], strength: 0.8, softness: 1 }],
  },
  {
    id: "window",
    label: "Window light",
    hint: "One cold window to the right, a dark room",
    ambient: [0.02, 0.02, 0.03],
    lights: [{ dir: [0.9, 0.2, 0.35], color: [0.72, 0.84, 1], strength: 1.1, softness: 0.45 }],
  },
  {
    id: "studio",
    label: "Studio key",
    hint: "A soft key light from the front right, a little fill",
    ambient: [0.06, 0.06, 0.06],
    lights: [
      { dir: [0.55, 0.45, 0.7], color: [1, 0.98, 0.95], strength: 1, softness: 0.6 },
      { dir: [-0.7, 0.1, 0.7], color: [0.9, 0.92, 1], strength: 0.3, softness: 0.8 },
    ],
  },
  {
    id: "neon",
    label: "Neon street",
    hint: "Pink from the left, blue from the right",
    ambient: [0.03, 0.02, 0.05],
    lights: [
      { dir: [-0.9, 0.1, 0.4], color: [1, 0.25, 0.7], strength: 1.1, softness: 0.3 },
      { dir: [0.9, 0.05, 0.4], color: [0.2, 0.55, 1], strength: 1.1, softness: 0.3 },
    ],
  },
  {
    id: "campfire",
    label: "Campfire",
    hint: "Flickering orange light from below",
    ambient: [0.02, 0.015, 0.02],
    lights: [{ dir: [0.1, -0.85, 0.5], color: [1, 0.45, 0.12], strength: 1.2, softness: 0.4 }],
  },
  {
    id: "rim",
    label: "Rim light",
    hint: "A bright edge from behind, the front in shadow",
    ambient: [0.04, 0.04, 0.05],
    lights: [{ dir: [0.35, 0.3, -0.88], color: [1, 0.96, 0.9], strength: 1.4, softness: 0.25 }],
  },
];

export function lightPreset(id: string | undefined): LightPreset | undefined {
  return LIGHT_PRESETS.find((p) => p.id === id);
}

/** The ground around the sphere: a dark neutral grey, so the API reads the ball's shading and not the frame. */
const BACKGROUND: [number, number, number] = [0.05, 0.05, 0.05];
/** The ball's matte grey (an 18% card's albedo, lifted a little so a dim light still shows). */
const ALBEDO = 0.6;

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const toByte = (linear: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, linear)), 1 / 2.2));

/**
 * The preset's sphere as RGBA pixels, `size` × `size`, row by row from the top: a ball filling 80% of the frame, each light
 * a wrapped Lambert term (softness widens the wrap) plus a small specular highlight, edges antialiased against the ground.
 */
export function spherePixels(preset: LightPreset, size = SPHERE_SIZE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const r = size * 0.4;
  const c = (size - 1) / 2;
  const lights = preset.lights.map((l) => ({ ...l, d: norm(l.dir) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - c) / r;
      const ny = (c - y) / r;
      const rr = nx * nx + ny * ny;
      // Coverage for a smooth edge: one pixel's worth of falloff at the rim.
      const edge = Math.min(1, Math.max(0, (1 - Math.sqrt(rr)) * r + 0.5));
      let col: [number, number, number] = [...BACKGROUND];
      if (edge > 0) {
        const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, rr)));
        const shade: [number, number, number] = [preset.ambient[0] * ALBEDO, preset.ambient[1] * ALBEDO, preset.ambient[2] * ALBEDO];
        for (const l of lights) {
          const ndl = nx * l.d[0] + ny * l.d[1] + nz * l.d[2];
          const w = l.softness * 0.9;
          const diffuse = Math.max(0, (ndl + w) / (1 + w));
          // Blinn-Phong toward a viewer on +z, sharper for a harder light.
          const h = norm([l.d[0], l.d[1], l.d[2] + 1]);
          const spec = Math.pow(Math.max(0, nx * h[0] + ny * h[1] + nz * h[2]), 12 + 60 * (1 - l.softness)) * 0.25 * (ndl > 0 ? 1 : 0);
          for (let i = 0; i < 3; i++) shade[i] += l.strength * l.color[i] * (ALBEDO * diffuse + spec);
        }
        col = [0, 1, 2].map((i) => BACKGROUND[i] * (1 - edge) + shade[i] * edge) as [number, number, number];
      }
      const o = (y * size + x) * 4;
      out[o] = toByte(col[0]);
      out[o + 1] = toByte(col[1]);
      out[o + 2] = toByte(col[2]);
      out[o + 3] = 255;
    }
  }
  return out;
}
