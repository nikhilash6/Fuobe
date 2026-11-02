/**
 * The Relight tool's instant preview and Intensity blend: one WebGL1 program (as Color grading's), redrawn once per
 * change, never in a loop. Pure: the GLSL and the uniforms it takes; src/components/relight/relight-renderer.ts draws.
 *
 * Before Generate (mode 0) it paints the placed lights onto the photo in linear light: a lights-only estimate
 * (the photo's own texture times ambient plus each light's falloff, wrapped diffuse and rim) mixed with the photo by
 * Intensity. With a scene read, surfaces face where the depth map says and "behind" lights rim the cut-out's edge;
 * without one, a soft guess from the photo's shading. After Generate (mode 1) it blends the original with the relit
 * picture, lined up by the alignment fit: a plain mix, or light transfer (the original's detail, the new light).
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
uniform sampler2D uDepth;
uniform sampler2D uMatte;
uniform sampler2D uRelit;
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
uniform vec3 uColor[${MAX_LIGHTS}];
uniform vec4 uParams[${MAX_LIGHTS}];

const float Z = 0.6;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 knee(vec3 c) {
  float k = 0.8;
  vec3 over = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}
vec3 photo(vec2 uv) { return toLin(texture2D(uPhoto, uv).rgb); }
vec3 relit(vec2 uv) { return toLin(texture2D(uRelit, vec2(uAlign.x * uv.x + uAlign.y, uAlign.z * uv.y + uAlign.w)).rgb); }
float depthAt(vec2 uv) { return texture2D(uDepth, uv).r; }
float matteAt(vec2 uv) { return texture2D(uMatte, uv).r; }

vec3 blurPhoto(vec2 uv) {
  vec2 r = vec2(uBlur / uAspect, uBlur);
  vec3 s = photo(uv) * 0.25;
  s += (photo(uv + vec2(r.x, 0.0)) + photo(uv - vec2(r.x, 0.0)) + photo(uv + vec2(0.0, r.y)) + photo(uv - vec2(0.0, r.y))) * 0.125;
  s += (photo(uv + r) + photo(uv - r) + photo(uv + vec2(r.x, -r.y)) + photo(uv - vec2(r.x, -r.y))) * 0.0625;
  return s;
}
vec3 blurRelit(vec2 uv) {
  vec2 r = vec2(uBlur / uAspect, uBlur);
  vec3 s = relit(uv) * 0.25;
  s += (relit(uv + vec2(r.x, 0.0)) + relit(uv - vec2(r.x, 0.0)) + relit(uv + vec2(0.0, r.y)) + relit(uv - vec2(0.0, r.y))) * 0.125;
  s += (relit(uv + r) + relit(uv - r) + relit(uv + vec2(r.x, -r.y)) + relit(uv - vec2(r.x, -r.y))) * 0.0625;
  return s;
}

vec3 glow(vec3 base, vec2 p) {
  vec3 o = base;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uPos[i].xy;
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
    float lc = luma(P);
    float l1 = luma(photo(uv + vec2(r.x, 0.0)));
    float l2 = luma(photo(uv - vec2(r.x, 0.0)));
    float l3 = luma(photo(uv + vec2(0.0, r.y)));
    float l4 = luma(photo(uv - vec2(0.0, r.y)));
    float lb = (lc * 2.0 + l1 + l2 + l3 + l4) / 6.0;
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
      float radius = uParams[i].y;
      float fall = exp(-dot(Ld.xy, Ld.xy) / (radius * radius));
      vec3 L = normalize(Ld);
      float w = uParams[i].z;
      float diffuse = clamp((dot(N, L) + w) / (1.0 + w), 0.0, 1.0);
      float k;
      if (uParams[i].w > 0.5) {
        float fallRim = exp(-dot(Ld.xy, Ld.xy) / (radius * radius * 2.5));
        if (uHasScene > 0.5) {
          vec2 outward = length(gm) > 1e-4 ? -normalize(gm) : vec2(0.0);
          float facing = 0.4 + 0.6 * clamp(dot(outward, normalize(Ld.xy + vec2(1e-5))), 0.0, 1.0);
          k = edge * facing * fallRim * 2.2 + pow(1.0 - N.z, 3.0) * fallRim * m;
        } else {
          k = fallRim * 0.35;
        }
      } else {
        // The far wall stays darker than the subject when the light is close: off the subject, falloff counts its depth too.
        float fall3 = exp(-dot(Ld, Ld) / (radius * radius));
        k = mix(fall3, fall, m) * diffuse;
      }
      C += uColor[i] * uParams[i].x * k;
    }
    vec3 lit = albedo * (uAmbient + C);
    outc = mix(P, lit, uIntensity);
  }
  vec3 o = toSrgb(knee(outc));
  if (uGlow > 0.5) o = glow(o, p);
  gl_FragColor = vec4(o, 1.0);
}`;

/** How far each distance band reaches, in picture heights. */
const RADIUS: Record<Distance, number> = { close: 0.28, mid: 0.5, far: 0.95 };
/** Toward the camera from the subject; behind lights sit behind it. */
const Z_OFFSET: Record<Distance, number> = { close: 0.15, mid: 0.4, far: 1.0 };
const SOFT_VALUE: Record<Softness, number> = { hard: 0, soft: 0.5, diffuse: 1 };
const WRAP: Record<Softness, number> = { hard: 0, soft: 0.35, diffuse: 0.7 };
const Z = 0.6;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export interface SceneInfo {
  /** A depth map and matte are loaded. */
  hasScene: boolean;
  /** The subject's median depth (0 far … 1 near); 0.5 without a scene. */
  subjectDepth: number;
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
  arrays: { uPos: number[]; uColor: number[]; uParams: number[] };
}

/** One light's packed values: position (x·aspect, 1−y, z), linear colour × nothing, and power, radius, wrap, behind. */
export function packLight(l: Light, aspect: number, subjectDepth: number) {
  const a = clamp(aspect, 0.1, 10);
  const soft = SOFT_VALUE[l.softness] ?? 0.5;
  const radius = clamp(RADIUS[l.distance] * (0.7 + 0.6 * soft), 0.05, 2);
  const z = clamp(subjectDepth, 0, 1) * Z + (l.behind ? -0.25 : Z_OFFSET[l.distance]);
  const power = clamp(strengthValueOf(l) * 1.5, 0, 2);
  const [r, g, b] = hexToRgb(l.color).map(srgbToLinear);
  return {
    pos: [clamp(l.x, 0, 1) * a, 1 - clamp(l.y, 0, 1), z] as [number, number, number],
    color: [r, g, b] as [number, number, number],
    params: [power, radius, WRAP[l.softness] ?? 0.35, l.behind ? 1 : 0] as [number, number, number, number],
  };
}

/** Every uniform for one draw, clamped; at most MAX_LIGHTS lights are packed. */
export function uniforms(s: StageState): Uniforms {
  const aspect = clamp(s.aspect, 0.1, 10);
  const subject = s.scene.hasScene ? clamp(s.scene.subjectDepth, 0, 1) : 0.5;
  const lights = s.lights.slice(0, MAX_LIGHTS);
  const pos: number[] = [];
  const color: number[] = [];
  const params: number[] = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = lights[i];
    const p = l ? packLight(l, aspect, subject) : { pos: [0, 0, 0], color: [0, 0, 0], params: [0, 1, 0, 0] };
    pos.push(...p.pos);
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
    arrays: { uPos: pos, uColor: color, uParams: params },
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
