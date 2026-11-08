// The preview of a 3D result, drawn on the CPU with no browser and no GPU: a still and a turntable of a GLB mesh or a
// Gaussian splat (.spz / .ply). scripts/model3d/render-preview.mjs reads the files (pictures through sharp) and
// encodes the frames with ffmpeg; this file is pure (typed arrays in, typed arrays out), so a test can run it as it is.
//
// - Meshes: a z-buffered rasterizer at 2x (each output pixel is the mean of four), shaded once per visible pixel:
//   glTF metallic-roughness with the base colour, metallic-roughness, normal and occlusion textures, lit by the studio
//   HDR the server's turntable uses (irradiance from 9 spherical harmonics, reflections from blurred copies of the
//   HDR picked by roughness, Karis' analytic split-sum term), exposure, Khronos PBR Neutral tone mapping. The
//   materials get the same roughness floors as the web GLB (scripts/model3d/finish-glb.mjs), so the still matches
//   what the viewer shows. A soft contact shadow sits under the model.
// - Splats: each Gaussian projected to a 2D ellipse (the 3DGS EWA projection), sorted back to front and blended,
//   after the pose the viewer gives it (src/lib/av/splat-view.ts splatPose: ComfyUI's splats are y down and face +x).
//
// The model turns about the vertical axis through the middle of its box; the camera and the light stay put. One turn
// is `frames` frames, so frame `frames` would be frame 0 again: the clip loops with no seam. The framing is fixed for
// the whole turn (the model fits in every frame) and centred.

// ---------------------------------------------------------------------------------------------------------------------
// Files

/** A binary glTF: its JSON, its binary chunk, and its pictures as bytes (`images[i]`: { mime, bytes }). */
export function readGlb(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a binary glTF");
  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= u8.byteLength) {
    const len = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const body = u8.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("the glTF has no JSON");
  const used = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])];
  const packed = used.find((e) => e === "KHR_draco_mesh_compression" || e === "EXT_meshopt_compression" || e === "KHR_mesh_quantization");
  if (packed && (json.extensionsRequired ?? []).includes(packed)) throw new Unsupported(`the model uses ${packed}`);
  const bufferOf = (i) => {
    const b = json.buffers?.[i];
    if (!b) throw new Error("a buffer is missing");
    if (b.uri !== undefined) {
      // Only data inside the file: a buffer named by a URI is never fetched or read from disk.
      const m = /^data:[^;,]*;base64,(.*)$/.exec(b.uri);
      if (!m) throw new Unsupported("a buffer names another file");
      return Uint8Array.from(Buffer.from(m[1], "base64"));
    }
    if (!bin) throw new Error("the glTF has no binary chunk");
    return bin;
  };
  const viewBytes = (vi) => {
    const v = json.bufferViews[vi];
    const b = bufferOf(v.buffer);
    return { bytes: b.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride: v.byteStride ?? 0 };
  };
  const images = (json.images ?? []).map((img) => {
    if (img.bufferView !== undefined) return { mime: img.mimeType ?? "", bytes: viewBytes(img.bufferView).bytes };
    const m = typeof img.uri === "string" ? /^data:([^;,]*);base64,(.*)$/.exec(img.uri) : null;
    return m ? { mime: m[1], bytes: Uint8Array.from(Buffer.from(m[2], "base64")) } : null;
  });
  return { json, viewBytes, images };
}

/** A model that this drawer can't read (a compressed or split glTF): the preview falls back. */
export class Unsupported extends Error {}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** An accessor as floats (normalized integers scaled to 0..1 / -1..1), `n` per element. */
function accessor(glb, index) {
  const a = glb.json.accessors[index];
  const n = COMPONENTS[a.type];
  const out = new Float32Array(a.count * n);
  if (a.bufferView === undefined) return { data: out, n, count: a.count };
  const { bytes, stride } = glb.viewBytes(a.bufferView);
  const size = SIZES[a.componentType];
  const step = stride || size * n;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset ?? 0), bytes.byteLength - (a.byteOffset ?? 0));
  const norm = !!a.normalized;
  for (let i = 0; i < a.count; i++) {
    const base = i * step;
    for (let k = 0; k < n; k++) {
      const o = base + k * size;
      let v;
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); if (norm) v /= 65535; break;
        case 5122: v = dv.getInt16(o, true); if (norm) v = Math.max(v / 32767, -1); break;
        case 5121: v = dv.getUint8(o); if (norm) v /= 255; break;
        default: v = dv.getInt8(o); if (norm) v = Math.max(v / 127, -1);
      }
      out[i * n + k] = v;
    }
  }
  return { data: out, n, count: a.count };
}

function indices(glb, index) {
  const a = glb.json.accessors[index];
  const { bytes, stride } = glb.viewBytes(a.bufferView);
  const size = SIZES[a.componentType];
  const dv = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset ?? 0), bytes.byteLength - (a.byteOffset ?? 0));
  const out = new Uint32Array(a.count);
  const step = stride || size;
  for (let i = 0; i < a.count; i++) out[i] = size === 4 ? dv.getUint32(i * step, true) : size === 2 ? dv.getUint16(i * step, true) : dv.getUint8(i * step);
  return out;
}

// 4x4 matrices, column-major as glTF writes them.
const mat4 = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul4(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function nodeMatrix(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return new Float64Array([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

/**
 * The triangles of a glTF in world space, merged: positions, normals, tangents (xyzw), UVs, and per triangle its
 * material. `pictures[i]` is the decoded picture i ({ width, height, data: RGBA bytes }) or null.
 */
export function meshOf(glb, pictures, { maxTriangles = 4_000_000 } = {}) {
  const { json } = glb;
  const parts = [];
  let tris = 0;
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const m = mul4(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const p of json.meshes[node.mesh].primitives) {
        if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) continue;
        if (p.extensions?.KHR_draco_mesh_compression) throw new Unsupported("the model uses Draco compression");
        const pos = accessor(glb, p.attributes.POSITION);
        const idx = p.indices !== undefined ? indices(glb, p.indices) : Uint32Array.from({ length: pos.count }, (_, i) => i);
        tris += idx.length / 3;
        if (tris > maxTriangles) throw new Unsupported("the model has too many triangles to draw");
        parts.push({ m, pos, idx, nrm: p.attributes.NORMAL !== undefined ? accessor(glb, p.attributes.NORMAL) : null, tan: p.attributes.TANGENT !== undefined ? accessor(glb, p.attributes.TANGENT) : null, uv: p.attributes.TEXCOORD_0 !== undefined ? accessor(glb, p.attributes.TEXCOORD_0) : null, material: p.material ?? -1 });
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i).filter((i) => !(json.nodes ?? []).some((n) => n.children?.includes(i)));
  for (const r of roots) visit(r, mat4());
  if (!parts.length) throw new Unsupported("the model has no triangles");

  const vCount = parts.reduce((s, p) => s + p.pos.count, 0);
  const P = new Float32Array(vCount * 3);
  const N = new Float32Array(vCount * 3);
  const T = new Float32Array(vCount * 4);
  const UV = new Float32Array(vCount * 2);
  const I = new Uint32Array(tris * 3);
  const triMat = new Int16Array(tris);
  const hasTangent = new Uint8Array(tris);
  const materials = (json.materials ?? []).map((mt) => materialOf(json, mt, pictures));
  let vo = 0;
  let to = 0;
  for (const part of parts) {
    const { m } = part;
    // The normal matrix: the inverse transpose of the upper 3x3.
    const nm = normalMatrix(m);
    for (let i = 0; i < part.pos.count; i++) {
      const x = part.pos.data[i * 3], y = part.pos.data[i * 3 + 1], z = part.pos.data[i * 3 + 2];
      const o = (vo + i) * 3;
      P[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
      P[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      P[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (part.nrm) {
        const a = part.nrm.data[i * 3], b = part.nrm.data[i * 3 + 1], c = part.nrm.data[i * 3 + 2];
        N[o] = nm[0] * a + nm[3] * b + nm[6] * c;
        N[o + 1] = nm[1] * a + nm[4] * b + nm[7] * c;
        N[o + 2] = nm[2] * a + nm[5] * b + nm[8] * c;
        norm3(N, o);
      }
      if (part.tan) {
        const a = part.tan.data[i * 4], b = part.tan.data[i * 4 + 1], c = part.tan.data[i * 4 + 2];
        const q = (vo + i) * 4;
        T[q] = m[0] * a + m[4] * b + m[8] * c;
        T[q + 1] = m[1] * a + m[5] * b + m[9] * c;
        T[q + 2] = m[2] * a + m[6] * b + m[10] * c;
        const l = Math.hypot(T[q], T[q + 1], T[q + 2]) || 1;
        T[q] /= l; T[q + 1] /= l; T[q + 2] /= l;
        T[q + 3] = part.tan.data[i * 4 + 3] < 0 ? -1 : 1;
      }
      if (part.uv) {
        UV[(vo + i) * 2] = part.uv.data[i * 2];
        UV[(vo + i) * 2 + 1] = part.uv.data[i * 2 + 1];
      }
    }
    for (let t = 0; t < part.idx.length / 3; t++) {
      I[(to + t) * 3] = part.idx[t * 3] + vo;
      I[(to + t) * 3 + 1] = part.idx[t * 3 + 1] + vo;
      I[(to + t) * 3 + 2] = part.idx[t * 3 + 2] + vo;
      triMat[to + t] = part.material;
      hasTangent[to + t] = part.tan ? 1 : 0;
    }
    if (!part.nrm) flatNormals(P, N, I, to, part.idx.length / 3);
    vo += part.pos.count;
    to += part.idx.length / 3;
  }
  return { P, N, T, UV, I, triMat, hasTangent, materials, triangles: tris, vertices: vCount };
}

function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // Inverse transpose, row-major 3x3 as used above: n' = M * n with M[r*3+c]... kept column-major like m.
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}
function norm3(a, o) {
  const l = Math.hypot(a[o], a[o + 1], a[o + 2]) || 1;
  a[o] /= l; a[o + 1] /= l; a[o + 2] /= l;
}
/** Area-weighted vertex normals for a part that came without them. */
function flatNormals(P, N, I, from, count) {
  for (let t = from; t < from + count; t++) {
    const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let t = from; t < from + count; t++) for (let k = 0; k < 3; k++) norm3(N, I[t * 3 + k] * 3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials and pictures

const SRGB = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });

function textureOf(json, info, pictures) {
  if (!info) return null;
  const tex = json.textures?.[info.index];
  const src = tex?.source ?? tex?.extensions?.EXT_texture_webp?.source;
  const pic = src !== undefined ? pictures[src] : null;
  return pic && pic.width && pic.height ? pic : null;
}

/**
 * A material as the drawer uses it, with the web GLB's roughness floors (finish-glb.mjs): mostly metal keeps its
 * metal; almost none is matte (roughness >= 0.8, no metal); anything else "mixed" (roughness >= 0.45 off the metal).
 * A material still at the glTF defaults with no metallic-roughness picture is a matte dielectric.
 */
function materialOf(json, mt, pictures) {
  const pbr = mt.pbrMetallicRoughness ?? {};
  const base = textureOf(json, pbr.baseColorTexture, pictures);
  const mr = textureOf(json, pbr.metallicRoughnessTexture, pictures);
  const normal = textureOf(json, mt.normalTexture, pictures);
  const occ = textureOf(json, mt.occlusionTexture, pictures);
  let metallic = pbr.metallicFactor ?? 1;
  let roughness = pbr.roughnessFactor ?? 1;
  let kind = "mixed";
  if (mr) {
    let metalTexels = 0, sum = 0;
    const n = mr.width * mr.height;
    for (let i = 0; i < n; i += 7) { const b = (mr.data[i * 4 + 2] / 255) * metallic; sum += b; if (b >= 0.5) metalTexels++; }
    const samples = Math.ceil(n / 7);
    const frac = metalTexels / samples;
    kind = frac >= 0.25 ? "metal" : frac < 0.02 && sum / samples < 0.05 ? "matte" : "mixed";
  } else if (metallic === 1 && roughness === 1) {
    metallic = 0;
    roughness = 0.8;
    kind = "plain";
  }
  return {
    color: pbr.baseColorFactor ?? [1, 1, 1, 1],
    base, mr, normal, occ,
    normalScale: mt.normalTexture?.scale ?? 1,
    occStrength: mt.occlusionTexture?.strength ?? 1,
    metallic, roughness, kind,
    emissive: mt.emissiveFactor ?? [0, 0, 0],
    emissiveTex: textureOf(json, mt.emissiveTexture, pictures),
    doubleSided: !!mt.doubleSided,
    blend: mt.alphaMode === "MASK" ? "mask" : "opaque",
    cutoff: mt.alphaCutoff ?? 0.5,
  };
}

/** Bilinear lookup of a picture (wrapping), into out[0..3] as 0..1. */
function sample(pic, u, v, out) {
  const w = pic.width, h = pic.height, d = pic.data;
  let x = (u - Math.floor(u)) * w - 0.5;
  let y = (v - Math.floor(v)) * h - 0.5;
  if (x < 0) x += w;
  if (y < 0) y += h;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
  const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, e = (y1 * w + x1) * 4;
  for (let k = 0; k < 4; k++) out[k] = ((d[a + k] * (1 - fx) + d[b + k] * fx) * (1 - fy) + (d[c + k] * (1 - fx) + d[e + k] * fx) * fy) / 255;
}
/** Same, with each colour channel from sRGB to linear. */
function sampleSrgb(pic, u, v, out) {
  const w = pic.width, h = pic.height, d = pic.data;
  let x = (u - Math.floor(u)) * w - 0.5;
  let y = (v - Math.floor(v)) * h - 0.5;
  if (x < 0) x += w;
  if (y < 0) y += h;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
  const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, e = (y1 * w + x1) * 4;
  for (let k = 0; k < 3; k++) out[k] = (SRGB[d[a + k]] * (1 - fx) + SRGB[d[b + k]] * fx) * (1 - fy) + (SRGB[d[c + k]] * (1 - fx) + SRGB[d[e + k]] * fx) * fy;
  out[3] = ((d[a + 3] * (1 - fx) + d[b + 3] * fx) * (1 - fy) + (d[c + 3] * (1 - fx) + d[e + 3] * fx) * fy) / 255;
}

// ---------------------------------------------------------------------------------------------------------------------
// The studio light: a Radiance HDR, its irradiance (9 spherical harmonics) and blurred copies for reflections.

/** A Radiance .hdr (RGBE, flat or run-length encoded) as linear RGB floats. */
export function readHdr(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let at = 0;
  const line = () => { let s = ""; while (at < u8.length && u8[at] !== 10) s += String.fromCharCode(u8[at++]); at++; return s; };
  if (!line().startsWith("#?")) throw new Error("not a Radiance HDR");
  for (let l = line(); l !== ""; l = line()) if (at >= u8.length) throw new Error("HDR header has no end");
  const m = /-Y (\d+) \+X (\d+)/.exec(line());
  if (!m) throw new Error("HDR size line not understood");
  const h = Number(m[1]), w = Number(m[2]);
  const data = new Float32Array(w * h * 3);
  const row = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 32768 && u8[at] === 2 && u8[at + 1] === 2 && ((u8[at + 2] << 8) | u8[at + 3]) === w) {
      at += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < w; ) {
          let n = u8[at++];
          if (n > 128) { n -= 128; const v = u8[at++]; while (n--) row[(x++) * 4 + c] = v; }
          else while (n--) row[(x++) * 4 + c] = u8[at++];
        }
      }
    } else {
      row.set(u8.subarray(at, at + w * 4));
      at += w * 4;
    }
    for (let x = 0; x < w; x++) {
      const e = row[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      data[o] = row[x * 4] * f; data[o + 1] = row[x * 4 + 1] * f; data[o + 2] = row[x * 4 + 2] * f;
    }
  }
  return { width: w, height: h, data };
}

/** Direction (y up) of an equirect texel centre: u across from -z through +x, v from the top. */
function dirOf(u, v, out) {
  const phi = u * 2 * Math.PI - Math.PI;
  const th = v * Math.PI;
  out[0] = Math.sin(th) * Math.sin(phi);
  out[1] = Math.cos(th);
  out[2] = -Math.sin(th) * Math.cos(phi);
}
function uvOf(x, y, z) {
  const u = (Math.atan2(x, -z) + Math.PI) / (2 * Math.PI);
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  return [u, v];
}

function downsample(env, w, h) {
  const out = new Float32Array(w * h * 3);
  const sx = env.width / w, sy = env.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = Math.floor(y * sy); j < Math.floor((y + 1) * sy); j++) for (let i = Math.floor(x * sx); i < Math.floor((x + 1) * sx); i++) {
      const o = (j * env.width + i) * 3; r += env.data[o]; g += env.data[o + 1]; b += env.data[o + 2]; n++;
    }
    const o = (y * w + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return { width: w, height: h, data: out };
}

/**
 * The light from an HDR: `sh` (9 x RGB irradiance coefficients) and `levels`: copies blurred for roughness 0, 0.2,
 * 0.4, 0.6, 0.8 and 1 (a cosine-power lobe, wider as it gets rougher). `yaw` turns the light about the vertical axis.
 */
export function studioLight(hdr, { yaw = 0 } = {}) {
  const src = downsample(hdr, 128, 64);
  const d = [0, 0, 0];
  // Each texel's solid angle and direction.
  const n = src.width * src.height;
  const dirs = new Float32Array(n * 3);
  const area = new Float32Array(n);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = y * src.width + x;
    dirOf((x + 0.5) / src.width + yaw / (2 * Math.PI), (y + 0.5) / src.height, d);
    dirs[i * 3] = d[0]; dirs[i * 3 + 1] = d[1]; dirs[i * 3 + 2] = d[2];
    area[i] = (2 * Math.PI / src.width) * (Math.PI / src.height) * Math.sin(((y + 0.5) / src.height) * Math.PI);
  }
  // Irradiance SH (Ramamoorthi & Hanrahan).
  const sh = new Float64Array(27);
  for (let i = 0; i < n; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const basis = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
    for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) sh[k * 3 + c] += src.data[i * 3 + c] * basis[k] * area[i];
  }
  const band = [Math.PI, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];
  for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) sh[k * 3 + c] *= band[k];
  // Reflection copies.
  const roughs = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const levels = roughs.map((r) => {
    if (r === 0) return { ...hdr, yaw };
    const W = r < 0.3 ? 64 : 32, H = W / 2;
    const out = new Float32Array(W * H * 3);
    const power = 2 / Math.pow(Math.max(r, 0.05), 4) - 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      dirOf((x + 0.5) / W + yaw / (2 * Math.PI), (y + 0.5) / H, d);
      let rr = 0, gg = 0, bb = 0, ww = 0;
      for (let i = 0; i < n; i++) {
        const c = d[0] * dirs[i * 3] + d[1] * dirs[i * 3 + 1] + d[2] * dirs[i * 3 + 2];
        if (c <= 0) continue;
        const wgt = Math.pow(c, power) * area[i];
        if (wgt < 1e-7) continue;
        rr += src.data[i * 3] * wgt; gg += src.data[i * 3 + 1] * wgt; bb += src.data[i * 3 + 2] * wgt; ww += wgt;
      }
      const o = (y * W + x) * 3;
      out[o] = rr / ww; out[o + 1] = gg / ww; out[o + 2] = bb / ww;
    }
    return { width: W, height: H, data: out, yaw };
  });
  return { sh, levels, roughs };
}

function envLookup(level, x, y, z, out) {
  let [u, v] = uvOf(x, y, z);
  u -= level.yaw / (2 * Math.PI);
  const w = level.width, h = level.height, d = level.data;
  let fx = (u - Math.floor(u)) * w - 0.5;
  const fy = Math.min(h - 1, Math.max(0, v * h - 0.5));
  if (fx < 0) fx += w;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const x1 = (x0 + 1) % w, y1 = Math.min(h - 1, y0 + 1);
  const a = (y0 * w + x0) * 3, b = (y0 * w + x1) * 3, c = (y1 * w + x0) * 3, e = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++) out[k] = (d[a + k] * (1 - ax) + d[b + k] * ax) * (1 - ay) + (d[c + k] * (1 - ax) + d[e + k] * ax) * ay;
}

// ---------------------------------------------------------------------------------------------------------------------
// The camera and the framing

/**
 * Where the camera stands to keep a turning subject in frame for the whole turn: the subject's cylinder (radius `r`
 * about the axis, from `y0` to `y1`) seen from `elevation` degrees above, through a lens of `fov` degrees, filling
 * `fill` of the frame at most. Returns the distance and the height the camera looks at (the cylinder centred).
 */
export function frameCylinder({ r, y0, y1 }, { fov = 24, elevation = 14, fill = 0.82, aspect = 1 } = {}) {
  const t = Math.tan((fov * Math.PI) / 360);
  const el = (elevation * Math.PI) / 180;
  const pts = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * 2 * Math.PI;
    pts.push([r * Math.cos(a), y0, r * Math.sin(a)], [r * Math.cos(a), y1, r * Math.sin(a)]);
  }
  const project = (dist, lookY) => {
    // Camera on +z, raised by `el`, looking at (0, lookY, 0).
    const cy = lookY + dist * Math.sin(el), cz = dist * Math.cos(el);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y, z] of pts) {
      const dy = y - cy, dz = z - cz;
      // View axes: forward f = (0, -sin el, -cos el), up u = (0, cos el, -sin el).
      const depth = -dy * Math.sin(el) - dz * Math.cos(el);
      const vy = dy * Math.cos(el) - dz * Math.sin(el);
      const sx = x / (depth * t * aspect), sy = vy / (depth * t);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  };
  let lookY = (y0 + y1) / 2;
  let lo = r * 0.5 + 1e-6, hi = (Math.max(r, y1 - y0) * 40) / t + 1;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    const p = project(mid, lookY);
    if (Math.max(p.maxX, -p.minX, p.maxY, -p.minY) <= fill) hi = mid;
    else lo = mid;
    // Centred vertically as the distance settles.
    const q = project(hi, lookY);
    lookY += ((q.maxY + q.minY) / 2) * hi * t * 0.5;
  }
  return { distance: hi, lookY, fov, elevation };
}

// ---------------------------------------------------------------------------------------------------------------------
// Meshes

const PBR_NEUTRAL = (c) => {
  // Khronos PBR Neutral tone mapping, per pixel on [r, g, b].
  const startCompression = 0.8 - 0.04, desaturation = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c[0] -= offset; c[1] -= offset; c[2] -= offset;
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak < startCompression) return;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  for (let k = 0; k < 3; k++) c[k] *= newPeak / peak;
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  for (let k = 0; k < 3; k++) c[k] = c[k] * (1 - g) + newPeak * g;
};
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const SRGB_OUT = new Uint8Array(4096).map((_, i) => Math.round(Math.max(0, Math.min(1, toSrgb(i / 4095))) * 255));
const enc = (v) => SRGB_OUT[v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095) | 0];

/** The subject's turning axis and size from a mesh: the box's middle (x, z), and the cylinder it turns in. */
export function meshCylinder(mesh) {
  const { P } = mesh;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) minX = P[i]; if (P[i] > maxX) maxX = P[i];
    if (P[i + 1] < minY) minY = P[i + 1]; if (P[i + 1] > maxY) maxY = P[i + 1];
    if (P[i + 2] < minZ) minZ = P[i + 2]; if (P[i + 2] > maxZ) maxZ = P[i + 2];
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  let r2 = 0;
  for (let i = 0; i < P.length; i += 3) { const dx = P[i] - cx, dz = P[i + 2] - cz; const d = dx * dx + dz * dz; if (d > r2) r2 = d; }
  return { cx, cz, r: Math.sqrt(r2), y0: minY, y1: maxY };
}

/**
 * A mesh turned `angle` radians (about its axis, plus `frontYaw` degrees so the first frame faces its front), drawn at
 * `size` x `size` (`ss` x supersampled), as straight RGBA bytes: the model opaque, its contact shadow as black with
 * alpha, nothing else.
 */
export function drawMesh(mesh, light, view, angle, { size = 720, ss = 2, exposure = 1.15, shadow = 0.5 } = {}) {
  const S = size * ss;
  const { P, N, T, UV, I, triMat, hasTangent, materials } = mesh;
  const { cx, cz, y0 } = view.cyl;
  const t = Math.tan((view.frame.fov * Math.PI) / 360);
  const el = (view.frame.elevation * Math.PI) / 180;
  const ce = Math.cos(el), se = Math.sin(el);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const camY = view.frame.lookY + view.frame.distance * se, camZ = view.frame.distance * ce;
  const vCount = P.length / 3;
  // Per vertex: screen x, y (pixels), 1/depth; world position after the turn (for the view vector), normal, tangent.
  const sx = new Float32Array(vCount), sy = new Float32Array(vCount), iw = new Float32Array(vCount);
  const wn = new Float32Array(vCount * 3), wt = new Float32Array(vCount * 3), wp = new Float32Array(vCount * 3);
  const half = S / 2, f = half / t;
  for (let i = 0; i < vCount; i++) {
    const x = P[i * 3] - cx, y = P[i * 3 + 1], z = P[i * 3 + 2] - cz;
    const rx = ca * x + sa * z, rz = -sa * x + ca * z;
    wp[i * 3] = rx; wp[i * 3 + 1] = y; wp[i * 3 + 2] = rz;
    const dy = y - camY, dz = rz - camZ;
    const depth = -dy * se - dz * ce;
    const vy = dy * ce - dz * se;
    iw[i] = 1 / depth;
    sx[i] = half + (rx * f) / depth;
    sy[i] = half - (vy * f) / depth;
    const nx = N[i * 3], nz = N[i * 3 + 2];
    wn[i * 3] = ca * nx + sa * nz; wn[i * 3 + 1] = N[i * 3 + 1]; wn[i * 3 + 2] = -sa * nx + ca * nz;
    const tx = T[i * 4], tz = T[i * 4 + 2];
    wt[i * 3] = ca * tx + sa * tz; wt[i * 3 + 1] = T[i * 4 + 1]; wt[i * 3 + 2] = -sa * tx + ca * tz;
  }
  // Visibility: the nearest triangle per pixel (largest 1/depth), with its perspective-correct barycentrics.
  const zb = new Float32Array(S * S);
  const tri = new Int32Array(S * S).fill(-1);
  const bA = new Float32Array(S * S), bB = new Float32Array(S * S);
  const triCount = I.length / 3;
  const sampleOut = [0, 0, 0, 0];
  for (let k = 0; k < triCount; k++) {
    const a = I[k * 3], b = I[k * 3 + 1], c = I[k * 3 + 2];
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cxv = sx[c], cy = sy[c];
    if (iw[a] <= 0 || iw[b] <= 0 || iw[c] <= 0) continue;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cxv - ax);
    if (area === 0) continue;
    const mat = materials[triMat[k]];
    // Single-sided materials: only the faces toward the camera (screen y runs down, so front faces have area < 0).
    if (area > 0 && mat && !mat.doubleSided) continue;
    let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cxv))), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cxv)));
    let y0p = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1p = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0p > y1p) continue;
    const inv = 1 / area;
    for (let py = y0p; py <= y1p; py++) {
      const qy = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cxv - qx)) * inv;
        const w1 = ((cxv - qx) * (ay - qy) - (cy - qy) * (ax - qx)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * iw[a] + w1 * iw[b] + w2 * iw[c];
        const p = py * S + px;
        if (z <= zb[p]) continue;
        // Alpha-masked materials: the cut-out parts let what is behind through.
        if (mat && mat.blend === "mask") {
          const pb = (w1 * iw[b]) / z, pc = (w2 * iw[c]) / z, pa = 1 - pb - pc;
          let alpha = mat.color[3];
          if (mat.base) { sample(mat.base, pa * UV[a * 2] + pb * UV[b * 2] + pc * UV[c * 2], pa * UV[a * 2 + 1] + pb * UV[b * 2 + 1] + pc * UV[c * 2 + 1], sampleOut); alpha *= sampleOut[3]; }
          if (alpha < mat.cutoff) continue;
        }
        zb[p] = z;
        tri[p] = k;
        bA[p] = (w1 * iw[b]) / z;
        bB[p] = (w2 * iw[c]) / z;
      }
    }
  }
  // Shading, once per covered pixel.
  const out = new Uint8ClampedArray(size * size * 4);
  const acc = new Float32Array(size * size * 4);
  const col = [0, 0, 0, 0], mr = [0, 0, 0, 0], nm = [0, 0, 0, 0], oc = [0, 0, 0, 0], em = [0, 0, 0, 0];
  const env = [0, 0, 0], env2 = [0, 0, 0];
  const { sh, levels, roughs } = light;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const p = py * S + px;
      const k = tri[p];
      if (k < 0) continue;
      const pb = bA[p], pc = bB[p], pa = 1 - pb - pc;
      const a = I[k * 3], b = I[k * 3 + 1], c = I[k * 3 + 2];
      const mat = materials[triMat[k]] ?? DEFAULT_MATERIAL;
      const u = pa * UV[a * 2] + pb * UV[b * 2] + pc * UV[c * 2];
      const v = pa * UV[a * 2 + 1] + pb * UV[b * 2 + 1] + pc * UV[c * 2 + 1];
      let nx = pa * wn[a * 3] + pb * wn[b * 3] + pc * wn[c * 3];
      let ny = pa * wn[a * 3 + 1] + pb * wn[b * 3 + 1] + pc * wn[c * 3 + 1];
      let nz = pa * wn[a * 3 + 2] + pb * wn[b * 3 + 2] + pc * wn[c * 3 + 2];
      let l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const px3 = pa * wp[a * 3] + pb * wp[b * 3] + pc * wp[c * 3];
      const py3 = pa * wp[a * 3 + 1] + pb * wp[b * 3 + 1] + pc * wp[c * 3 + 1];
      const pz3 = pa * wp[a * 3 + 2] + pb * wp[b * 3 + 2] + pc * wp[c * 3 + 2];
      let vx = -px3, vy = camY - py3, vz = camZ - pz3;
      l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      // A back face of a double-sided material: its normal turned to the camera.
      let flip = nx * vx + ny * vy + nz * vz < 0 ? -1 : 1;
      if (mat.normal && hasTangent[k]) {
        sample(mat.normal, u, v, nm);
        const tx0 = pa * wt[a * 3] + pb * wt[b * 3] + pc * wt[c * 3];
        const ty0 = pa * wt[a * 3 + 1] + pb * wt[b * 3 + 1] + pc * wt[c * 3 + 1];
        const tz0 = pa * wt[a * 3 + 2] + pb * wt[b * 3 + 2] + pc * wt[c * 3 + 2];
        const sign = T[a * 4 + 3];
        const bx = (ny * tz0 - nz * ty0) * sign, by2 = (nz * tx0 - nx * tz0) * sign, bz = (nx * ty0 - ny * tx0) * sign;
        const mx = (nm[0] * 2 - 1) * mat.normalScale, my = (nm[1] * 2 - 1) * mat.normalScale, mz = nm[2] * 2 - 1;
        const qx = tx0 * mx + bx * my + nx * mz, qy = ty0 * mx + by2 * my + ny * mz, qz = tz0 * mx + bz * my + nz * mz;
        l = Math.hypot(qx, qy, qz);
        if (l > 1e-6) { nx = qx / l; ny = qy / l; nz = qz / l; }
      }
      nx *= flip; ny *= flip; nz *= flip;
      let ndv = nx * vx + ny * vy + nz * vz;
      if (ndv < 1e-3) {
        // A normal map that points away: bend it back toward the camera.
        nx += vx * (1e-3 - ndv); ny += vy * (1e-3 - ndv); nz += vz * (1e-3 - ndv);
        l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        ndv = Math.max(1e-3, nx * vx + ny * vy + nz * vz);
      }
      // Material.
      let r = mat.color[0], g = mat.color[1], bl = mat.color[2];
      if (mat.base) { sampleSrgb(mat.base, u, v, col); r *= col[0]; g *= col[1]; bl *= col[2]; }
      let metal = mat.metallic, rough = mat.roughness;
      if (mat.mr) { sample(mat.mr, u, v, mr); metal *= mr[2]; rough *= mr[1]; }
      if (mat.kind === "matte") { metal = 0; rough = Math.max(rough, 0.8); }
      else if (mat.kind === "mixed" && metal < 0.5) rough = Math.max(rough, 0.45);
      rough = Math.min(1, Math.max(0.04, rough));
      let ao = 1;
      if (mat.occ) { sample(mat.occ, u, v, oc); ao = 1 + mat.occStrength * (oc[0] - 1); }
      // Diffuse: irradiance from the harmonics.
      const B = [0.282095, 0.488603 * ny, 0.488603 * nz, 0.488603 * nx, 1.092548 * nx * ny, 1.092548 * ny * nz, 0.315392 * (3 * nz * nz - 1), 1.092548 * nx * nz, 0.546274 * (nx * nx - ny * ny)];
      let er = 0, eg = 0, eb = 0;
      for (let q = 0; q < 9; q++) { er += sh[q * 3] * B[q]; eg += sh[q * 3 + 1] * B[q]; eb += sh[q * 3 + 2] * B[q]; }
      er = Math.max(0, er) / Math.PI; eg = Math.max(0, eg) / Math.PI; eb = Math.max(0, eb) / Math.PI;
      // Reflection: the HDR copy for this roughness, along the mirrored view.
      const rx = 2 * ndv * nx - vx, ry = 2 * ndv * ny - vy, rz = 2 * ndv * nz - vz;
      const lv = rough * (roughs.length - 1);
      const l0 = Math.min(roughs.length - 1, Math.floor(lv)), l1 = Math.min(roughs.length - 1, l0 + 1), lf = lv - l0;
      envLookup(levels[l0], rx, ry, rz, env);
      if (lf > 0) { envLookup(levels[l1], rx, ry, rz, env2); for (let q = 0; q < 3; q++) env[q] = env[q] * (1 - lf) + env2[q] * lf; }
      // Karis' analytic environment BRDF.
      const c0x = -1, c0y = -0.0275, c0z = -0.572, c0w = 0.022, c1x = 1, c1y = 0.0425, c1z = 1.04, c1w = -0.04;
      const rrx = rough * c0x + c1x, rry = rough * c0y + c1y, rrz = rough * c0z + c1z, rrw = rough * c0w + c1w;
      const a004 = Math.min(rrx * rrx, Math.pow(2, -9.28 * ndv)) * rrx + rry;
      const A = a004 * -1.04 + rrz, Bb = a004 * 1.04 + rrw;
      const f0r = 0.04 * (1 - metal) + r * metal, f0g = 0.04 * (1 - metal) + g * metal, f0b = 0.04 * (1 - metal) + bl * metal;
      const so = Math.min(1, ao + 0.15);
      col[0] = (r * (1 - metal) * er * ao + env[0] * (f0r * A + Bb) * so) * exposure;
      col[1] = (g * (1 - metal) * eg * ao + env[1] * (f0g * A + Bb) * so) * exposure;
      col[2] = (bl * (1 - metal) * eb * ao + env[2] * (f0b * A + Bb) * so) * exposure;
      if (mat.emissiveTex || mat.emissive[0] || mat.emissive[1] || mat.emissive[2]) {
        let e0 = mat.emissive[0], e1 = mat.emissive[1], e2 = mat.emissive[2];
        if (mat.emissiveTex) { sampleSrgb(mat.emissiveTex, u, v, em); e0 *= em[0]; e1 *= em[1]; e2 *= em[2]; }
        col[0] += e0; col[1] += e1; col[2] += e2;
      }
      PBR_NEUTRAL(col);
      const o = ((py / ss) | 0) * size + ((px / ss) | 0);
      acc[o * 4] += enc(col[0]); acc[o * 4 + 1] += enc(col[1]); acc[o * 4 + 2] += enc(col[2]); acc[o * 4 + 3] += 1;
    }
  }
  const per = ss * ss;
  for (let i = 0; i < size * size; i++) {
    const n = acc[i * 4 + 3];
    if (!n) continue;
    out[i * 4] = acc[i * 4] / n; out[i * 4 + 1] = acc[i * 4 + 1] / n; out[i * 4 + 2] = acc[i * 4 + 2] / n;
    out[i * 4 + 3] = Math.round((255 * n) / per);
  }
  if (shadow > 0) {
    // The contact shadow: the model seen from straight above, blurred, laid on the floor under it.
    const G = 160;
    const ext = view.cyl.r * 1.5;
    const top = new Float32Array(G * G);
    for (let i = 0; i < vCount; i++) {
      const h = (wp[i * 3 + 1] - y0) / Math.max(1e-6, view.cyl.y1 - y0);
      if (h > 0.6) continue;
      const gx = Math.floor(((wp[i * 3] / ext) * 0.5 + 0.5) * G), gz = Math.floor(((wp[i * 3 + 2] / ext) * 0.5 + 0.5) * G);
      if (gx >= 0 && gx < G && gz >= 0 && gz < G) top[gz * G + gx] = Math.max(top[gz * G + gx], 1 - h / 0.6);
    }
    let soft = blur(blur(blur(top, G, 3), G, 3), G, 3);
    let peak = 0;
    for (const x of soft) if (x > peak) peak = x;
    if (peak > 0) for (let i = 0; i < soft.length; i++) soft[i] = Math.min(1, (soft[i] / peak) * 1.4);
    drawFloor(out, size, soft, G, ext, { camY, camZ, ce, se, t, floorY: y0, strength: shadow });
  }
  return out;
}

const DEFAULT_MATERIAL = { color: [0.8, 0.8, 0.8, 1], base: null, mr: null, normal: null, occ: null, normalScale: 1, occStrength: 1, metallic: 0, roughness: 0.8, kind: "plain", emissive: [0, 0, 0], emissiveTex: null, doubleSided: true, blend: "opaque", cutoff: 0.5 };

function blur(src, G, r) {
  const tmp = new Float32Array(G * G), out = new Float32Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < G) { s += src[y * G + xx]; n++; } } tmp[y * G + x] = s / n; }
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < G) { s += tmp[yy * G + x]; n++; } } out[y * G + x] = s / n; }
  return out;
}

/** Lay a floor shadow map (G x G over +-ext around the axis) under what is drawn: black with alpha where nothing is. */
function drawFloor(out, size, map, G, ext, { camY, camZ, ce, se, t, floorY, strength }) {
  const half = size / 2, f = half / t;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      if (out[o + 3] === 255) continue;
      // The view ray through this pixel, from the camera, in world space.
      const vx = (px + 0.5 - half) / f, vyv = -(py + 0.5 - half) / f;
      const dx = vx, dy = -se + vyv * ce, dz = -ce - vyv * se;
      if (dy >= -1e-6) continue;
      const k = (floorY - camY) / dy;
      const wx = dx * k, wz = camZ + dz * k;
      const gx = (wx / ext) * 0.5 + 0.5, gz = (wz / ext) * 0.5 + 0.5;
      if (gx <= 0 || gx >= 1 || gz <= 0 || gz >= 1) continue;
      const s = map[Math.floor(gz * G) * G + Math.floor(gx * G)] * strength;
      if (s <= 0.004) continue;
      // Under a partly covered edge pixel the shadow shows through the rest.
      const a = out[o + 3] / 255;
      const sa = s * (1 - a);
      const na = a + sa;
      out[o] = (out[o] * a) / na; out[o + 1] = (out[o + 1] * a) / na; out[o + 2] = (out[o + 2] * a) / na;
      out[o + 3] = Math.round(na * 255);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Gaussian splats

const SH_C0 = 0.28209479177387814;

/** A .spz (Niantic's packed splats, versions 2 and 3) as centres, scales, rotations (x y z w), opacities and colours. */
export function readSpz(raw, gunzip) {
  const b = gunzip(raw);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x5053474e) throw new Error("not a .spz");
  const version = dv.getUint32(4, true);
  const n = dv.getUint32(8, true);
  const shDegree = b[12];
  const fractional = b[13];
  if (version < 2 || version > 3) throw new Unsupported(`.spz version ${version}`);
  let at = 16;
  const pos = new Float32Array(n * 3);
  const scale = 1 / (1 << fractional);
  for (let i = 0; i < n * 3; i++) {
    let v = b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
    if (v & 0x800000) v |= ~0xffffff;
    pos[i] = v * scale;
    at += 3;
  }
  const opacity = new Float32Array(n);
  for (let i = 0; i < n; i++) opacity[i] = b[at++] / 255;
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) color[i] = Math.min(1, Math.max(0, 0.5 + SH_C0 * ((b[at++] / 255 - 0.5) / 0.15)));
  const scales = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) scales[i] = Math.exp(b[at++] / 16 - 10);
  const rot = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (version >= 3) {
      // Smallest three: 2 bits for the largest's index, then three 10-bit signed values of the others.
      const word = b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);
      at += 4;
      const largest = word >>> 30;
      let rest = word;
      const q = [0, 0, 0, 0];
      let sum = 0;
      for (let k = 3; k >= 0; k--) {
        if (k === largest) continue;
        const mag = rest & 0x1ff, neg = (rest >>> 9) & 1;
        rest >>>= 10;
        q[k] = (Math.SQRT1_2 * mag) / 511 * (neg ? -1 : 1);
        sum += q[k] * q[k];
      }
      q[largest] = Math.sqrt(Math.max(0, 1 - sum));
      rot.set(q, i * 4);
    } else {
      const x = b[at] / 127.5 - 1, y = b[at + 1] / 127.5 - 1, z = b[at + 2] / 127.5 - 1;
      at += 3;
      rot[i * 4] = x; rot[i * 4 + 1] = y; rot[i * 4 + 2] = z; rot[i * 4 + 3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    }
  }
  void shDegree;
  return { n, pos, scales, rot, opacity, color };
}

/** A 3DGS .ply (binary little-endian: x y z, f_dc_0..2, opacity as a logit, scale_0..2 as logs, rot_0..3 as w x y z). */
export function readPly(raw) {
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const headEnd = Buffer.from(u8.subarray(0, Math.min(u8.length, 65536))).indexOf("end_header\n");
  if (headEnd < 0) throw new Error("not a .ply");
  const head = new TextDecoder().decode(u8.subarray(0, headEnd)).split("\n");
  if (!head.some((l) => l.startsWith("format binary_little_endian"))) throw new Unsupported("only binary little-endian .ply");
  let n = 0;
  const props = [];
  let inVertex = false;
  for (const l of head) {
    const w = l.trim().split(/\s+/);
    if (w[0] === "element") { inVertex = w[1] === "vertex"; if (inVertex) n = Number(w[2]); }
    else if (w[0] === "property" && inVertex) props.push({ type: w[1], name: w[2] });
  }
  const SZ = { float: 4, float32: 4, double: 8, uchar: 1, uint8: 1, int: 4, uint: 4, short: 2, ushort: 2 };
  let stride = 0;
  const off = {};
  for (const p of props) { off[p.name] = { at: stride, type: p.type }; stride += SZ[p.type] ?? 4; }
  for (const k of ["x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]) if (!off[k]) throw new Unsupported(`the .ply has no ${k}`);
  const base = headEnd + "end_header\n".length;
  const dv = new DataView(u8.buffer, u8.byteOffset + base, n * stride);
  const get = (i, k) => { const o = off[k]; const at = i * stride + o.at; return o.type === "double" ? dv.getFloat64(at, true) : o.type === "uchar" || o.type === "uint8" ? dv.getUint8(at) / 255 : dv.getFloat32(at, true); };
  const pos = new Float32Array(n * 3), scales = new Float32Array(n * 3), rot = new Float32Array(n * 4), opacity = new Float32Array(n), color = new Float32Array(n * 3);
  const hasDc = !!off.f_dc_0, hasRgb = !!off.red;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = get(i, "x"); pos[i * 3 + 1] = get(i, "y"); pos[i * 3 + 2] = get(i, "z");
    opacity[i] = 1 / (1 + Math.exp(-get(i, "opacity")));
    for (let k = 0; k < 3; k++) scales[i * 3 + k] = Math.exp(get(i, `scale_${k}`));
    const w = get(i, "rot_0"), x = get(i, "rot_1"), y = get(i, "rot_2"), z = get(i, "rot_3");
    const l = Math.hypot(w, x, y, z) || 1;
    rot[i * 4] = x / l; rot[i * 4 + 1] = y / l; rot[i * 4 + 2] = z / l; rot[i * 4 + 3] = w / l;
    for (let k = 0; k < 3; k++) color[i * 3 + k] = hasDc ? Math.min(1, Math.max(0, 0.5 + SH_C0 * get(i, `f_dc_${k}`))) : hasRgb ? get(i, ["red", "green", "blue"][k]) : 0.7;
  }
  return { n, pos, scales, rot, opacity, color };
}

/**
 * A splat made ready to draw: stood upright (y down: half a turn about x, as the viewer does), the haze under `cutoff`
 * and the strays far outside the subject's box left out, each Gaussian's 3D covariance worked out once.
 */
export function prepareSplat(s, { yDown = false, cutoff = 0, frontYaw = 0 } = {}) {
  const keep = [];
  for (let i = 0; i < s.n; i++) if (s.opacity[i] > Math.max(cutoff, 1 / 255)) keep.push(i);
  // The subject's box from the solid Gaussians (src/lib/av/splat-view.ts subjectBounds), trimmed of 0.5 % each end.
  const solid = keep.filter((i) => s.opacity[i] >= 0.1);
  const use = solid.length >= Math.max(8, keep.length * 0.02) ? solid : keep;
  const ys = yDown ? -1 : 1;
  const axis = (a, sign) => Float64Array.from(use, (i) => s.pos[i * 3 + a] * sign).sort();
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const X = axis(0, 1), Y = axis(1, ys), Z = axis(2, ys);
  const box = { min: [q(X, 0.005), q(Y, 0.005), q(Z, 0.005)], max: [q(X, 0.995), q(Y, 0.995), q(Z, 0.995)] };
  const pad = [0, 1, 2].map((k) => (box.max[k] - box.min[k]) * 0.25);
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const inside = keep.filter((i) => {
    const p = [s.pos[i * 3], s.pos[i * 3 + 1] * ys, s.pos[i * 3 + 2] * ys];
    return p.every((v, k) => v >= box.min[k] - pad[k] && v <= box.max[k] + pad[k]);
  });
  const n = inside.length;
  const pos = new Float32Array(n * 3), cov = new Float32Array(n * 6), opacity = new Float32Array(n), color = new Float32Array(n * 3);
  // The subject's front faces the camera at the first frame: turn it by -frontYaw about y.
  const fy = (-frontYaw * Math.PI) / 180, cf = Math.cos(fy), sf = Math.sin(fy);
  let r2 = 0;
  inside.forEach((i, j) => {
    const x0 = s.pos[i * 3] - cx, y = s.pos[i * 3 + 1] * ys, z0 = s.pos[i * 3 + 2] * ys - cz;
    const x = cf * x0 + sf * z0, z = -sf * x0 + cf * z0;
    pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
    if (s.opacity[i] >= 0.1) r2 = Math.max(r2, x * x + z * z);
    opacity[j] = s.opacity[i];
    color.set(s.color.subarray(i * 3, i * 3 + 3), j * 3);
    // R from the quaternion; y down turns it half a turn about x: R' = Fx R Fx with Fx = diag(1, -1, -1).
    let qx = s.rot[i * 4], qy = s.rot[i * 4 + 1], qz = s.rot[i * 4 + 2], qw = s.rot[i * 4 + 3];
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= l; qy /= l; qz /= l; qw /= l;
    const R = [
      1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
      2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
      2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
    ];
    if (yDown) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] *= (r === 0 ? 1 : -1) * (c === 0 ? 1 : -1);
    // The front turn: Ry R.
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const Ry = [cf, 0, sf, 0, 1, 0, -sf, 0, cf];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r * 3 + c] = Ry[r * 3] * R[c] + Ry[r * 3 + 1] * R[3 + c] + Ry[r * 3 + 2] * R[6 + c];
    const sx = s.scales[i * 3], sy = s.scales[i * 3 + 1], sz = s.scales[i * 3 + 2];
    // Sigma = M S S M^T
    const m = (r, c) => M[r * 3 + c];
    const sig = (r, c) => m(r, 0) * m(c, 0) * sx * sx + m(r, 1) * m(c, 1) * sy * sy + m(r, 2) * m(c, 2) * sz * sz;
    cov[j * 6] = sig(0, 0); cov[j * 6 + 1] = sig(0, 1); cov[j * 6 + 2] = sig(0, 2); cov[j * 6 + 3] = sig(1, 1); cov[j * 6 + 4] = sig(1, 2); cov[j * 6 + 5] = sig(2, 2);
  });
  return { n, pos, cov, opacity, color, cyl: { cx: 0, cz: 0, r: Math.sqrt(r2), y0: box.min[1], y1: box.max[1] } };
}

/** A prepared splat turned `angle` radians, as straight RGBA bytes (the subject over nothing, with a soft floor shadow). */
export function drawSplat(sp, view, angle, { size = 720, shadow = 0.35 } = {}) {
  const t = Math.tan((view.frame.fov * Math.PI) / 360);
  const el = (view.frame.elevation * Math.PI) / 180;
  const ce = Math.cos(el), se = Math.sin(el);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const camY = view.frame.lookY + view.frame.distance * se, camZ = view.frame.distance * ce;
  const half = size / 2, f = half / t;
  const { n, pos, cov, opacity, color } = sp;
  const depth = new Float32Array(n);
  const order = new Uint32Array(n);
  const proj = new Float32Array(n * 5); // x, y, conic a, b, c
  const rad = new Float32Array(n);
  // W: the view (rows right, up, back; the camera looks along -back) times the turn Ry(angle).
  const W = [ca, 0, sa, se * sa, ce, -se * ca, -ce * sa, se, ce * ca];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1] - camY, z = pos[i * 3 + 2];
    // In camera space: turn the subject, then view (camera at (0, camY, camZ) after the turn: subtract before viewing).
    const rx = ca * x + sa * z, rz = -sa * x + ca * z - camZ;
    const vx = rx, vy = ce * y - se * rz, vz = se * y + ce * rz; // vz < 0 in front
    const d = -vz;
    if (d <= 0.01) continue;
    // Sigma in camera space: W Sigma W^T.
    const s00 = cov[i * 6], s01 = cov[i * 6 + 1], s02 = cov[i * 6 + 2], s11 = cov[i * 6 + 3], s12 = cov[i * 6 + 4], s22 = cov[i * 6 + 5];
    const Sm = [s00, s01, s02, s01, s11, s12, s02, s12, s22];
    const WS = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) WS[r * 3 + c] = W[r * 3] * Sm[c] + W[r * 3 + 1] * Sm[3 + c] + W[r * 3 + 2] * Sm[6 + c];
    const C = (r, c) => WS[r * 3] * W[c * 3] + WS[r * 3 + 1] * W[c * 3 + 1] + WS[r * 3 + 2] * W[c * 3 + 2];
    // Jacobian of the projection (screen y down).
    const j00 = f / d, j02 = (f * vx) / (d * d), j11 = -f / d, j12 = (-f * vy) / (d * d);
    // J for (vx, vy, vz) with d = -vz: dx/dvz = f vx / d^2, dy/dvz = -f vy / d^2.
    const c00 = C(0, 0), c01 = C(0, 1), c02 = C(0, 2), c11 = C(1, 1), c12 = C(1, 2), c22 = C(2, 2);
    const a = j00 * j00 * c00 + 2 * j00 * j02 * c02 + j02 * j02 * c22 + 0.3;
    const b = j00 * j11 * c01 + j00 * j12 * c02 + j02 * j11 * c12 + j02 * j12 * c22;
    const c = j11 * j11 * c11 + 2 * j11 * j12 * c12 + j12 * j12 * c22 + 0.3;
    const det = a * c - b * b;
    if (det <= 0) continue;
    const mid = (a + c) / 2;
    const lam = mid + Math.sqrt(Math.max(0.1, mid * mid - det));
    const r = Math.ceil(3 * Math.sqrt(lam));
    const sxp = half + (vx * f) / d, syp = half - (vy * f) / d;
    if (sxp + r < 0 || sxp - r >= size || syp + r < 0 || syp - r >= size) continue;
    proj[i * 5] = sxp; proj[i * 5 + 1] = syp;
    proj[i * 5 + 2] = c / det; proj[i * 5 + 3] = -b / det; proj[i * 5 + 4] = a / det;
    rad[i] = Math.min(r, size / 3);
    depth[i] = d;
    order[m++] = i;
  }
  const idx = order.subarray(0, m);
  // Back to front.
  const sorted = Array.from(idx).sort((p, q) => depth[q] - depth[p]);
  const rgb = new Float32Array(size * size * 3);
  const alpha = new Float32Array(size * size);
  for (const i of sorted) {
    const x = proj[i * 5], y = proj[i * 5 + 1], A = proj[i * 5 + 2], B = proj[i * 5 + 3], Cc = proj[i * 5 + 4];
    const r = rad[i];
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(size - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(size - 1, Math.ceil(y + r));
    const op = opacity[i], cr = color[i * 3], cg = color[i * 3 + 1], cb = color[i * 3 + 2];
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - y;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - x;
        const power = -0.5 * (A * dx * dx + Cc * dy * dy) - B * dx * dy;
        if (power > 0 || power < -4.5) continue;
        const al = Math.min(0.99, op * Math.exp(power));
        if (al < 1 / 255) continue;
        const p = py * size + px;
        // "Over", back to front.
        rgb[p * 3] = cr * al + rgb[p * 3] * (1 - al);
        rgb[p * 3 + 1] = cg * al + rgb[p * 3 + 1] * (1 - al);
        rgb[p * 3 + 2] = cb * al + rgb[p * 3 + 2] * (1 - al);
        alpha[p] = al + alpha[p] * (1 - al);
      }
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const a = alpha[p];
    if (a <= 0) continue;
    out[p * 4] = (rgb[p * 3] / a) * 255; out[p * 4 + 1] = (rgb[p * 3 + 1] / a) * 255; out[p * 4 + 2] = (rgb[p * 3 + 2] / a) * 255;
    out[p * 4 + 3] = a * 255;
  }
  if (shadow > 0) {
    const G = 128;
    const ext = sp.cyl.r * 1.5;
    const top = new Float32Array(G * G);
    const span = Math.max(1e-6, sp.cyl.y1 - sp.cyl.y0);
    for (let i = 0; i < n; i++) {
      if (opacity[i] < 0.3) continue;
      const h = (pos[i * 3 + 1] - sp.cyl.y0) / span;
      if (h > 0.3) continue;
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const rx = ca * x + sa * z, rz = -sa * x + ca * z;
      const gx = Math.floor(((rx / ext) * 0.5 + 0.5) * G), gz = Math.floor(((rz / ext) * 0.5 + 0.5) * G);
      if (gx >= 0 && gx < G && gz >= 0 && gz < G) top[gz * G + gx] = Math.max(top[gz * G + gx], 1 - h / 0.3);
    }
    const soft = blur(blur(blur(top, G, 3), G, 3), G, 3);
    let peak = 0;
    for (const x of soft) if (x > peak) peak = x;
    if (peak > 0) for (let i = 0; i < soft.length; i++) soft[i] = Math.min(1, (soft[i] / peak) * 1.3);
    drawFloor(out, size, soft, G, ext, { camY, camZ, ce, se, t, floorY: sp.cyl.y0, strength: shadow });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Backdrops

/** The studio backdrops behind a preview: a soft sweep, light (the light theme) or dark (the dark theme), RGB bytes. */
export function backdrop(size, tone) {
  const [c0, c1] = tone === "dark" ? [[44, 44, 48], [20, 20, 23]] : [[246, 245, 243], [218, 216, 212]];
  const px = new Uint8Array(size * size * 3);
  const cx = size / 2, cy = size * 0.42, r = size * 0.78;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tt = Math.pow(Math.min(1, Math.hypot(x - cx, (y - cy) * 1.15) / r), 1.5);
    const o = (y * size + x) * 3;
    for (let k = 0; k < 3; k++) px[o + k] = c0[k] + (c1[k] - c0[k]) * tt;
  }
  return px;
}

/** Straight RGBA over an RGB backdrop, into RGB bytes. */
export function over(rgba, plate) {
  const n = plate.length / 3;
  const out = new Uint8Array(plate.length);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = rgba[i * 4 + k] * a + plate[i * 3 + k] * (1 - a);
  }
  return out;
}
