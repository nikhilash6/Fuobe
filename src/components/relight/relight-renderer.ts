"use client";

import { FRAGMENT, uniforms, VERTEX, type StageState } from "@/lib/relight/shader";

export type Pic = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const sizeOf = (p: Pic): [number, number] => (p instanceof HTMLImageElement ? [p.naturalWidth, p.naturalHeight] : [p.width, p.height]);

/** A picture no larger than `max` on its long side (the same picture when it already is). */
export function fit(p: Pic, max: number): Pic {
  const [w, h] = sizeOf(p);
  const s = Math.min(1, max / Math.max(1, w, h));
  if (s >= 1) return p;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d")!.drawImage(p, 0, 0, c.width, c.height);
  return c;
}

export function picSize(p: Pic): [number, number] {
  return sizeOf(p);
}

const UNITS = { uPhoto: 0, uDepth: 1, uMatte: 2, uRelit: 3 } as const;
type Unit = keyof typeof UNITS;

/**
 * One WebGL context that draws the Relight stage (src/lib/relight/shader.ts): the photo, its scene read, the relit
 * picture and the lights. One draw per change; nothing runs while idle.
 */
export class RelightRenderer {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  tex = {} as Record<Unit, WebGLTexture>;
  loc = new Map<string, WebGLUniformLocation | null>();
  size: [number, number] = [1, 1];
  depthSize: [number, number] = [1, 1];

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error("WebGL isn't available in this browser");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    for (const unit of Object.keys(UNITS) as Unit[]) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + UNITS[unit]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      ])
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      // A 1×1 black texture until a picture comes.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
      gl.uniform1i(gl.getUniformLocation(prog, unit), UNITS[unit]);
      this.tex[unit] = t;
    }
  }

  get maxSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name)!;
  }

  set(unit: Unit, p: Pic | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNITS[unit]);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
    if (p) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, p);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
    if (unit === "uPhoto" && p) this.size = sizeOf(p);
    if (unit === "uDepth") this.depthSize = p ? sizeOf(p) : [1, 1];
  }

  /** Draw at `width` × `height` (the canvas takes that size). */
  draw(state: Omit<StageState, "width" | "height" | "depthWidth" | "depthHeight">, width: number, height: number) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const u = uniforms({ ...state, width: this.size[0], height: this.size[1], depthWidth: this.depthSize[0], depthHeight: this.depthSize[1] });
    for (const [k, v] of Object.entries(u.scalars)) gl.uniform1f(this.u(k), v);
    for (const [k, v] of Object.entries(u.ints)) gl.uniform1i(this.u(k), v);
    for (const [k, v] of Object.entries(u.vec2)) gl.uniform2f(this.u(k), v[0], v[1]);
    for (const [k, v] of Object.entries(u.vec4)) gl.uniform4f(this.u(k), v[0], v[1], v[2], v[3]);
    gl.uniform3fv(this.u("uPos[0]") ?? this.u("uPos"), u.arrays.uPos);
    gl.uniform3fv(this.u("uColor[0]") ?? this.u("uColor"), u.arrays.uColor);
    gl.uniform4fv(this.u("uParams[0]") ?? this.u("uParams"), u.arrays.uParams);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    try {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
  }
}

/** Load a picture (same origin, or a blob: address). */
export function loadPic(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That picture didn't load"));
    img.src = url;
  });
}

/** A picture's grey values at w × h (0..255, one per pixel). */
export function greyOf(p: Pic, w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(p, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

/** A picture's RGBA pixels at w × h. */
export function pixelsOf(p: Pic, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(p, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}
