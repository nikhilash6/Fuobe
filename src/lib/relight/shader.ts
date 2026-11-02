/**
 * The Relight tool's instant preview and Intensity blend: one WebGL1 program (as Color grading's), redrawn once per
 * change, never in a loop. Pure: the GLSL and the uniforms it takes; src/components/relight/relight-renderer.ts draws.
 *
 * Before Generate (mode 0) it paints the placed lights onto the photo in linear light: a lights-only estimate
 * (the photo's own texture times ambient plus each light's falloff, wrapped diffuse and rim) mixed with the photo by
 * Intensity. A light's marker says the direction it comes from: it sits that way round the subject, at a gap its
 * distance band sets, so even a light placed at the frame's edge reaches the subject. With a scene read, surfaces
 * face where the depth map says and "behind" lights rim the cut-out's edge; without one, a soft guess from the photo's
 * shading. After Generate (mode 1) it blends the original with the relit picture, lined up by the alignment fit: a
 * plain mix, or light transfer (the original's detail, the new light), its ratio read from low-passed copies of both
 * pictures (uPhotoLo, uRelitLo) so strong contours leave no echo.
 */
import { hexToRgb, MAX_LIGHTS, srgbToLinear, strengthValueOf, type Distance, type Light, type Softness } from "./lights";
import type { BlendMode } from "./engine";

export const VERTEX = `
attribute vec2 a_pos;
varying vec2 vUv;
void main() {
  vUv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uPhotoLo;
uniform sampler2D uDepth;
uniform sampler2D uMatte;
uniform sampler2D uRelit;
uniform sampler2D uRelitLo;
uniform float uAspect;
uniform vec2 uTexel;
uniform vec2 uDepthTexel;
uniform float uHasScene;
uniform float uSubjectZ;
uniform float uMode;
uniform float uIntensity;
uniform float uAmbient;
uniform float uGlow;
uniform float uOriginal;
uniform float uBlend;
uniform float uBlur;
uniform vec4 uAlign;
uniform int uCount;
uniform vec3 uPos[${MAX_LIGHTS}];
uniform vec2 uMark[${MAX_LIGHTS}];
uniform vec3 uColor[${MAX_LIGHTS}];
uniform vec4 uParams[${MAX_LIGHTS}];

const float Z = 0.6;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 knee(vec3 c) {
  float k = 0.8;
  vec3 over = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}
vec2 aligned(vec2 uv) { return vec2(uAlign.x * uv.x + uAlign.y, uAlign.z * uv.y + uAlign.w); }
vec3 photo(vec2 uv) { return toLin(texture2D(uPhoto, uv).rgb); }
vec3 photoLo(vec2 uv) { return toLin(texture2D(uPhotoLo, uv).rgb); }
vec3 relit(vec2 uv) { return toLin(texture2D(uRelit, aligned(uv)).rgb); }
vec3 relitLo(vec2 uv) { return toLin(texture2D(uRelitLo, aligned(uv)).rgb); }
float depthAt(vec2 uv) { return texture2D(uDepth, uv).r; }
float matteAt(vec2 uv) { return texture2D(uMatte, uv).r; }

// About a Gaussian of uBlur: nine taps over the low-passed copy, so no tap skips detail between them.
vec3 blurPhoto(vec2 uv) {
  vec2 r = vec2(uBlur / uAspect, uBlur);
  vec3 s = photoLo(uv) * 0.25;
  s += (photoLo(uv + vec2(r.x, 0.0)) + photoLo(uv - vec2(r.x, 0.0)) + photoLo(uv + vec2(0.0, r.y)) + photoLo(uv - vec2(0.0, r.y))) * 0.125;
  s += (photoLo(uv + r) + photoLo(uv - r) + photoLo(uv + vec2(r.x, -r.y)) + photoLo(uv - vec2(r.x, -r.y))) * 0.0625;
  return s;
}
vec3 blurRelit(vec2 uv) {
  vec2 r = vec2(uBlur / uAspect, uBlur);
  vec3 s = relitLo(uv) * 0.25;
  s += (relitLo(uv + vec2(r.x, 0.0)) + relitLo(uv - vec2(r.x, 0.0)) + relitLo(uv + vec2(0.0, r.y)) + relitLo(uv - vec2(0.0, r.y))) * 0.125;
  s += (relitLo(uv + r) + relitLo(uv - r) + relitLo(uv + vec2(r.x, -r.y)) + relitLo(uv - vec2(r.x, -r.y))) * 0.0625;
  return s;
}

// Each light's glow, where it was placed on the photo.
vec3 glow(vec3 base, vec2 p) {
  vec3 o = base;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uMark[i];
    float h = exp(-dot(d, d) / 0.0036) * 0.55 + exp(-dot(d, d) / 0.04) * 0.18;
    vec3 c = toSrgb(uColor[i]) * h;
    o = 1.0 - (1.0 - o) * (1.0 - clamp(c, 0.0, 1.0));
  }
  return o;
}

void main() {
  vec2 uv = vUv;
  vec3 P = photo(uv);
  if (uOriginal > 0.5) { gl_FragColor = vec4(toSrgb(P), 1.0); return; }
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec3 outc;
  if (uMode > 0.5) {
    // The result: at Intensity 0 the photo, and (plain) at 100 % the relit picture, untouched.
    float t = uIntensity;
    if (uBlend > 0.5) {
      vec3 ratio = clamp(blurRelit(uv) / max(blurPhoto(uv), vec3(0.004)), 0.0, 8.0);
      outc = P * mix(vec3(1.0), ratio, t);
    } else {
      outc = mix(P, relit(uv), t);
    }
  } else {
    // The photo's own texture: its colour over its local brightness, so skin and fabric keep their detail.
    vec2 r = vec2(uBlur / uAspect, uBlur) * 1.5;
    float lb = luma(photoLo(uv));
    float l1 = luma(photoLo(uv + vec2(r.x, 0.0)));
    float l2 = luma(photoLo(uv - vec2(r.x, 0.0)));
    float l3 = luma(photoLo(uv + vec2(0.0, r.y)));
    float l4 = luma(photoLo(uv - vec2(0.0, r.y)));
    vec3 albedo = P * pow(0.25 / (lb + 0.05), 0.5);
    float d = uHasScene > 0.5 ? depthAt(uv) : 0.5;
    vec3 N;
    if (uHasScene > 0.5) {
      vec2 e = uDepthTexel * 1.5;
      float dx = (depthAt(uv + vec2(e.x, 0.0)) - depthAt(uv - vec2(e.x, 0.0))) * Z / (2.0 * e.x * uAspect);
      float dy = (depthAt(uv + vec2(0.0, e.y)) - depthAt(uv - vec2(0.0, e.y))) * Z / (2.0 * e.y);
      N = normalize(vec3(-dx, -dy, 1.0));
    } else {
      N = normalize(vec3(-(l1 - l2) * 3.0, -(l3 - l4) * 3.0, 1.0));
    }
    N = normalize(mix(N, vec3(0.0, 0.0, 1.0), 0.3));
    float m = uHasScene > 0.5 ? matteAt(uv) : 1.0;
    vec2 em = uDepthTexel * 2.0;
    vec2 gm = vec2(matteAt(uv + vec2(em.x, 0.0)) - matteAt(uv - vec2(em.x, 0.0)), matteAt(uv + vec2(0.0, em.y)) - matteAt(uv - vec2(0.0, em.y)));
    float edge = clamp(length(gm) * 2.5, 0.0, 1.0);
    vec3 S = vec3(p, d * Z);
    vec3 C = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uCount) break;
      vec3 Ld = uPos[i] - S;
      float r2 = uParams[i].y * uParams[i].y;
      float fall = 1.0 / (1.0 + dot(Ld.xy, Ld.xy) / r2);
      vec3 L = normalize(Ld);
      float w = uParams[i].z;
      float diffuse = clamp((dot(N, L) + w) / (1.0 + w), 0.0, 1.0);
      float k;
      if (uParams[i].w > 0.5) {
        float fallRim = 1.0 / (1.0 + dot(Ld.xy, Ld.xy) / (r2 * 2.5));
        if (uHasScene > 0.5) {
          vec2 outward = length(gm) > 1e-4 ? -normalize(gm) : vec2(0.0);
          float facing = 0.4 + 0.6 * clamp(dot(outward, normalize(Ld.xy + vec2(1e-5))), 0.0, 1.0);
          k = edge * facing * fallRim * 2.2 + pow(1.0 - N.z, 3.0) * fallRim * m;
        } else {
          k = fallRim * 0.35;
        }
      } else {
        // The far wall stays darker than the subject when the light is close: off the subject, falloff counts its depth too.
        float fall3 = 1.0 / (1.0 + dot(Ld, Ld) / r2);
        k = mix(fall3, fall, m) * diffuse;
      }
      C += uColor[i] * uParams[i].x * k;
    }
    // The highlight knee is the preview's own (its lights can overshoot); a result is never compressed.
    outc = mix(P, knee(albedo * (uAmbient + C)), uIntensity);
  }
  vec3 o = toSrgb(outc);
  if (uGlow > 0.5) o = glow(o, p);
  gl_FragColor = vec4(o, 1.0);
}`;

/** The gap between the subject's edge and a light, per distance band, in picture heights. */
const GAP: Record<Distance, number> = { close: 0.1, mid: 0.35, far: 0.8 };
/** How far each light reaches, as a share of its distance to the subject's centre (harder light falls off sooner). */
const REACH: Record<Softness, number> = { hard: 0.9, soft: 1.1, diffuse: 1.3 };
const WRAP: Record<Softness, number> = { hard: 0, soft: 0.35, diffuse: 0.7 };
/** How far in front of the subject a light sits, as a share of its distance (about 40° off the camera's axis). */
const LIFT = 0.8;
/** Closer than this to the subject's centre (picture heights), a marker brings its light round to the front. */
const NEAR = 0.12;
const Z = 0.6;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Where the subject is: its centre (x 0 left … 1 right, y 0 top … 1 bottom) and its radius in picture heights. */
export interface Subject {
  x: number;
  y: number;
  r: number;
}

/** Without a scene read: a subject a little above the middle, as most portraits frame one. */
export const FLAT_SUBJECT: Subject = { x: 0.5, y: 0.45, r: 0.22 };

export interface SceneInfo {
  /** A depth map and matte are loaded. */
  hasScene: boolean;
  /** The subject's median depth (0 far … 1 near); 0.5 without a scene. */
  subjectDepth: number;
  /** Where the matte says the subject is (FLAT_SUBJECT without one). */
  subject?: Subject;
}

/** Where the relit picture's pixels sit: relit uv = (sx·x + tx, sy·y + ty), in uv units. Identity = no shift. */
export interface AlignFit {
  sx: number;
  tx: number;
  sy: number;
  ty: number;
}

export const IDENTITY_FIT: AlignFit = { sx: 1, tx: 0, sy: 1, ty: 0 };

export interface StageState {
  lights: readonly Light[];
  intensity: number;
  /** The width / height of the photo. */
  aspect: number;
  scene: SceneInfo;
  /** 1 when a relit picture is shown. */
  mode: "preview" | "result";
  blend: BlendMode;
  glow: boolean;
  original: boolean;
  align?: AlignFit;
  ambient: number;
  /** The photo's size in pixels (texel sizes). */
  width: number;
  height: number;
  depthWidth?: number;
  depthHeight?: number;
}

export interface Uniforms {
  scalars: Record<string, number>;
  ints: Record<string, number>;
  vec2: Record<string, [number, number]>;
  vec4: Record<string, [number, number, number, number]>;
  arrays: { uPos: number[]; uMark: number[]; uColor: number[]; uParams: number[] };
}

export interface PackedLight {
  /** Where the light is, in the shader's units: x·aspect, y from the top, z toward the camera. */
  pos: [number, number, number];
  /** Where its marker sits on the photo (its glow), same units. */
  mark: [number, number];
  /** Linear colour. */
  color: [number, number, number];
  /** Power, reach, wrap, behind. */
  params: [number, number, number, number];
}

/**
 * One light's packed values. Its marker is a direction from the subject: the light sits that way round it, the gap
 * set by its distance band (a behind light just behind the outline), raised toward the camera.
 */
export function packLight(l: Light, aspect: number, subjectDepth: number, subject: Subject = FLAT_SUBJECT): PackedLight {
  const a = clamp(aspect, 0.1, 10);
  const cx = clamp(subject.x, 0, 1) * a;
  const cy = clamp(subject.y, 0, 1);
  const mark: [number, number] = [clamp(l.x, 0, 1) * a, 1 - clamp(l.y, 0, 1)];
  const gap = (GAP[l.distance] ?? GAP.mid) * (l.behind ? 0.25 : 1);
  const reach = clamp(subject.r, 0.05, 1) + gap;
  const dx = mark[0] - cx;
  const dy = mark[1] - cy;
  const k = reach / Math.max(Math.hypot(dx, dy), NEAR);
  const z0 = clamp(subjectDepth, 0, 1) * Z;
  const power = clamp(strengthValueOf(l) * 1.5, 0, 2);
  const [r, g, b] = hexToRgb(l.color).map(srgbToLinear);
  return {
    pos: [cx + dx * k, cy + dy * k, l.behind ? z0 - 0.25 : z0 + reach * LIFT],
    mark,
    color: [r, g, b],
    params: [power, clamp(reach * (REACH[l.softness] ?? REACH.soft), 0.05, 2), WRAP[l.softness] ?? WRAP.soft, l.behind ? 1 : 0],
  };
}

/**
 * A front light's share of its power at a point, as the preview's GLSL works it out (falloff × wrapped diffuse, on the
 * subject): the tests' reference. `at` and `normal` in the shader's units.
 */
export function reachAt(p: PackedLight, at: readonly [number, number, number], normal: readonly [number, number, number] = [0, 0, 1]): number {
  const d = [p.pos[0] - at[0], p.pos[1] - at[1], p.pos[2] - at[2]];
  const fall = 1 / (1 + (d[0] ** 2 + d[1] ** 2) / p.params[1] ** 2);
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const w = p.params[2];
  const diffuse = clamp(((normal[0] * d[0] + normal[1] * d[1] + normal[2] * d[2]) / len + w) / (1 + w), 0, 1);
  return fall * diffuse;
}

/** Every uniform for one draw, clamped; at most MAX_LIGHTS lights are packed. */
export function uniforms(s: StageState): Uniforms {
  const aspect = clamp(s.aspect, 0.1, 10);
  const subject = s.scene.hasScene ? clamp(s.scene.subjectDepth, 0, 1) : 0.5;
  const where = (s.scene.hasScene && s.scene.subject) || FLAT_SUBJECT;
  const lights = s.lights.slice(0, MAX_LIGHTS);
  const pos: number[] = [];
  const mark: number[] = [];
  const color: number[] = [];
  const params: number[] = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = lights[i];
    const p = l ? packLight(l, aspect, subject, where) : { pos: [0, 0, 0], mark: [0, 0], color: [0, 0, 0], params: [0, 1, 0, 0] };
    pos.push(...p.pos);
    mark.push(...p.mark);
    color.push(...p.color);
    params.push(...p.params);
  }
  const fit = s.align ?? IDENTITY_FIT;
  const short = Math.max(1, Math.min(s.width, s.height));
  return {
    scalars: {
      uAspect: aspect,
      uHasScene: s.scene.hasScene ? 1 : 0,
      uSubjectZ: subject,
      uMode: s.mode === "result" ? 1 : 0,
      uIntensity: clamp(s.intensity, 0, 1),
      uAmbient: clamp(s.ambient, 0, 0.5),
      uGlow: s.glow ? 1 : 0,
      uOriginal: s.original ? 1 : 0,
      uBlend: s.blend === "transfer" ? 1 : 0,
      // σ ≈ 1.2 % of the short side, as a fraction of the height.
      uBlur: clamp((0.012 * short) / Math.max(1, s.height), 0.002, 0.05),
    },
    ints: { uCount: lights.length },
    vec2: {
      uTexel: [1 / Math.max(1, s.width), 1 / Math.max(1, s.height)],
      uDepthTexel: [1 / Math.max(1, s.depthWidth ?? 512), 1 / Math.max(1, s.depthHeight ?? 512)],
    },
    vec4: { uAlign: [clamp(fit.sx, 0.8, 1.25), clamp(fit.tx, -0.25, 0.25), clamp(fit.sy, 0.8, 1.25), clamp(fit.ty, -0.25, 0.25)] },
    arrays: { uPos: pos, uMark: mark, uColor: color, uParams: params },
  };
}

/** The subject's median depth from a depth map and its matte (both one value per pixel, 0..255). */
export function subjectDepthOf(depth: ArrayLike<number>, matte: ArrayLike<number> | null): number {
  const n = depth.length;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (matte && matte[i] < 153) continue;
    hist[depth[i] & 255]++;
    count++;
  }
  if (!count) return 0.5;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= count / 2) return v / 255;
  }
  return 0.5;
}

/**
 * Where the subject is, from its matte (w × h, one value per pixel, 0..255): the cut-out's centre and the radius of a
 * disc of its area, in picture heights. `aspect` is the picture's (a matte read back at another shape keeps it).
 * Null when the cut-out is too small to say.
 */
export function subjectOf(matte: ArrayLike<number>, w: number, h: number, aspect = w / h): Subject | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (matte[y * w + x] < 128) continue;
      sx += x + 0.5;
      sy += y + 0.5;
      n++;
    }
  if (n < w * h * 0.01) return null;
  const area = (n / (w * h)) * aspect;
  return { x: sx / n / w, y: sy / n / h, r: clamp(Math.sqrt(area / Math.PI), 0.08, 0.6) };
}

/** The low-passed copy's short side, in pixels: one texel is about the light-transfer blur (σ 1.2 % of the short side). */
export const LOW_SHORT = 80;
