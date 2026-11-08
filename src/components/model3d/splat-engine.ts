"use client";

import { dyno, SparkRenderer, SplatFileType, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { homeView, subjectBounds, type SplatBounds, type SplatPose } from "@/lib/av/splat-view";

/**
 * The splat viewer's three.js side (idol-4): Spark (@sparkjsdev/spark 2.3.1, MIT, World Labs) draws the Gaussians
 * inside a plain three.js scene with OrbitControls. Loaded only through a dynamic import from splat-viewer.tsx, so
 * no page pays for it until a splat opens. It renders on demand (a drag, a slider, Spark's sort finishing), not in
 * a loop, so an idle viewer costs nothing.
 */

const FILE_TYPES: Record<string, SplatFileType> = { ply: SplatFileType.PLY, spz: SplatFileType.SPZ, ksplat: SplatFileType.KSPLAT, splat: SplatFileType.SPLAT };

export interface SplatLoadInfo {
  splats: number;
  bytes: number;
}

export class SplatEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  private controls: OrbitControls;
  private spark: SparkRenderer;
  private mesh: SplatMesh | null = null;
  private cutoff = dyno.dynoFloat(0);
  private home = { position: new THREE.Vector3(0, 0, 3), target: new THREE.Vector3() };
  /** A sample of the splat's centres and opacities in its own frame, to frame it again after a turn. */
  private sample: { centers: Float32Array; opacities: Float32Array } | null = null;
  private bounds: SplatBounds | null = null;
  /** The yaw the subject faces (splatPose): where the camera starts. */
  private frontYaw = 0;
  /** The stage's size and the bar's height over its foot, in CSS px. */
  private view = { width: 0, height: 0, inset: 0 };
  /** The camera is where Reset view puts it: a resize frames the splat again for the stage's new shape. */
  private atHome = true;
  private frame = 0;
  /** Keep drawing until then (performance.now()): Spark builds, sorts and uploads over a few frames after a change. */
  private until = 0;
  private disposed = false;
  /** The last frame's CPU time in milliseconds (renderer.render), for the numbers in docs/research/idol-9.md. */
  lastFrameMs = 0;

  private onLost = (e: Event) => {
    e.preventDefault();
    if (!this.disposed) this.onContextLost?.();
  };

  /**
   * onContextLost: the browser took the WebGL context away (too many open, a GPU reset) while this was showing.
   * coarse: a phone or tablet, which draws each Gaussian a little tighter (less overdraw in every frame).
   */
  constructor(
    private canvas: HTMLCanvasElement,
    private onContextLost?: () => void,
    { coarse = false }: { coarse?: boolean } = {},
  ) {
    canvas.addEventListener("webglcontextlost", this.onLost);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.spark = new SparkRenderer({ renderer: this.renderer, onDirty: () => this.requestRender(), ...(coarse ? { maxStdDev: Math.sqrt(6) } : {}) });
    this.scene.add(this.spark);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = false;
    // One finger turns it; two pinch to zoom and drag to move it.
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => this.requestRender());
    this.controls.addEventListener("start", () => void (this.atHome = false));
  }

  /** Fetch the file (abortable, its size checked against maxBytes first), then build the splat. */
  async load(
    url: string,
    format: string,
    { signal, maxBytes, onProgress, pose }: { signal?: AbortSignal; maxBytes?: number; onProgress?: (p: number) => void; pose?: SplatPose } = {},
  ): Promise<SplatLoadInfo> {
    const bytes = await fetchSplat(url, { signal, maxBytes, onProgress });
    if (this.disposed || signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const mesh = await buildSplatMesh(bytes, format, this.cutoff);
    if (this.disposed || signal?.aborted) {
      mesh.dispose();
      throw new DOMException("Aborted", "AbortError");
    }
    // A y-down file (splatPose): half a turn about x stands it upright.
    if (pose?.yDown) mesh.quaternion.set(1, 0, 0, 0);
    this.frontYaw = pose?.frontYaw ?? 0;
    this.mesh = mesh;
    this.sample = sampleSplats(mesh);
    this.scene.add(mesh);
    this.frameSubject();
    this.requestRender(1500);
    return { splats: mesh.packedSplats?.numSplats ?? 0, bytes: bytes.byteLength };
  }

  /** Measure the splat as it stands now (its turn included), then look at it from the front. */
  private frameSubject() {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    let bounds: SplatBounds | null = null;
    if (this.sample) {
      const { centers, opacities } = this.sample;
      const world = new Float32Array(centers.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < centers.length; i += 3) {
        v.set(centers[i], centers[i + 1], centers[i + 2]).applyMatrix4(mesh.matrixWorld);
        world[i] = v.x;
        world[i + 1] = v.y;
        world[i + 2] = v.z;
      }
      bounds = subjectBounds(world, opacities);
    }
    if (!bounds) {
      const box = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
      bounds = box.isEmpty() ? { min: [-1, -1, -1], max: [1, 1, 1] } : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    }
    this.bounds = bounds;
    this.placeHome();
    this.reset();
  }

  /** Where Reset view goes for the stage's current shape. */
  private placeHome() {
    if (!this.bounds) return;
    const { height, inset } = this.view;
    // With the bar's offset on, the subject fits the part of the taller frame above the bar.
    const room = this.camera.view?.enabled ? (height - inset) / (height + inset) : 1;
    const view = homeView(this.bounds, this.camera.fov, this.camera.aspect, { frontYaw: this.frontYaw, room });
    this.home.target.fromArray(view.target);
    this.home.position.fromArray(view.position);
    this.camera.near = Math.max(view.distance / 200, 0.001);
    this.camera.far = view.distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = view.size * 0.15;
    this.controls.maxDistance = view.distance * 6;
  }

  reset() {
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    // Without damping for this one update: a glide left over from a drag would carry the camera off home.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.atHome = true;
    this.requestRender();
  }

  /** Turn the splat over (a file saved the other way up shows upside down), and frame it again. */
  flip() {
    if (!this.mesh) return;
    this.mesh.rotateX(Math.PI);
    this.frameSubject();
  }

  /** Orbit by angles in radians (the arrow keys), around the target. */
  orbit(azimuth: number, polar: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta -= azimuth;
    s.phi = THREE.MathUtils.clamp(s.phi - polar, 0.05, Math.PI - 0.05);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    this.atHome = false;
    this.controls.update();
    this.requestRender();
  }

  /** Move closer (factor < 1) or further (> 1), within the controls' limits (the + and - keys). */
  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const d = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(d));
    this.atHome = false;
    this.controls.update();
    this.requestRender();
  }

  setCutoff(value: number) {
    this.cutoff.value = value;
    this.mesh?.updateVersion();
    this.requestRender(500);
  }

  setBackground(color: string) {
    this.scene.background = new THREE.Color(color);
    this.requestRender();
  }

  resize(width: number, height: number, dpr: number) {
    if (!width || !height) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.view.width = width;
    this.view.height = height;
    this.applyView();
  }

  /**
   * The height (CSS px) the controls bar covers at the stage's foot: the view centres the subject in the space above
   * it, so the bar never sits on the subject at home (it still draws behind the bar, the stage stays whole).
   */
  setBottomInset(px: number) {
    const inset = Math.max(0, Math.round(px));
    if (inset === this.view.inset) return;
    this.view.inset = inset;
    this.applyView();
  }

  /** The projection for the stage and the bar: a taller frame whose top `inset` px are off the stage. */
  private applyView() {
    const { width, height, inset } = this.view;
    if (!width || !height) return;
    // A drag the stage's height turns the splat once round; a small stage (a card on a phone) turns it slower.
    this.controls.rotateSpeed = Math.min(1, Math.max(0.5, height / 520));
    if (inset > 0 && inset < height / 2) {
      this.camera.aspect = width / (height + inset);
      this.camera.setViewOffset(width, height + inset, 0, inset, width, height);
    } else {
      this.camera.aspect = width / height;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    // Reset view fits the new shape, and a view nobody has moved yet follows it (the stage settling, a phone turning).
    this.placeHome();
    if (this.atHome && this.bounds) this.reset();
    this.requestRender();
  }

  /** The current view as a PNG, at the canvas's own size (rendered and read in the same task). */
  capture(): Promise<Blob> {
    // The still has no bar over it: the subject at the centre of the whole frame.
    const offset = this.camera.view?.enabled;
    if (offset) {
      this.camera.clearViewOffset();
      this.camera.aspect = this.view.width / this.view.height;
      this.camera.updateProjectionMatrix();
    }
    this.render();
    const still = new Promise<Blob>((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the still"))), "image/png"));
    if (offset) {
      const { width, height, inset } = this.view;
      this.camera.aspect = width / (height + inset);
      this.camera.setViewOffset(width, height + inset, 0, inset, width, height);
      this.camera.updateProjectionMatrix();
      this.requestRender();
    }
    return still;
  }

  /** Draw on the next frame, and keep drawing for `settleMs` (Spark finishing its work), or while the camera glides. */
  private requestRender(settleMs = 150) {
    this.until = Math.max(this.until, performance.now() + settleMs);
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
      // Damping keeps the camera gliding after a drag: keep drawing until it settles.
      const gliding = this.controls.update();
      if (gliding || performance.now() < this.until) this.requestRender(0);
    });
  }

  private render() {
    if (this.disposed) return;
    const t = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.lastFrameMs = performance.now() - t;
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.mesh?.dispose();
    this.spark.dispose();
    this.renderer.dispose();
    // Give the context back now rather than at garbage collection: browsers keep only about 16 live, and a feed
    // of cards that open and close the viewer would otherwise push out the one that is showing.
    this.renderer.forceContextLoss();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
  }
}

/** At most this many Gaussians are measured to frame a splat: enough for its outline, quick on a phone. */
const SAMPLE_MAX = 65_536;

/** Every k-th Gaussian's centre and opacity, in the splat's own frame (at most SAMPLE_MAX of them). */
function sampleSplats(mesh: SplatMesh): { centers: Float32Array; opacities: Float32Array } | null {
  const splats = mesh.packedSplats;
  const total = splats?.numSplats ?? 0;
  if (!splats || !total) return null;
  const step = Math.max(1, Math.ceil(total / SAMPLE_MAX));
  const n = Math.ceil(total / step);
  const centers = new Float32Array(n * 3);
  const opacities = new Float32Array(n);
  let k = 0;
  try {
    splats.forEachSplat((i, center, _scales, _quaternion, opacity) => {
      if (i % step || k >= n) return;
      centers[k * 3] = center.x;
      centers[k * 3 + 1] = center.y;
      centers[k * 3 + 2] = center.z;
      opacities[k] = opacity;
      k++;
    });
  } catch {
    return null;
  }
  return k ? { centers: centers.subarray(0, k * 3), opacities: opacities.subarray(0, k) } : null;
}

/** Fetch a splat file (abortable; refused past maxBytes, by its length or as it streams). */
export async function fetchSplat(url: string, { signal, maxBytes, onProgress }: { signal?: AbortSignal; maxBytes?: number; onProgress?: (p: number) => void } = {}): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`The splat didn't load (${res.status})`);
  const length = Number(res.headers.get("content-length")) || 0;
  if (maxBytes && length > maxBytes) throw new SplatTooBigError(length);
  return readAll(res, length, maxBytes, onProgress);
}

/** A splat built from its file, with the haze cut-off: a Gaussian fainter than `cutoff`'s value isn't drawn (its opacity goes to 0). */
export async function buildSplatMesh(bytes: Uint8Array, format: string, cutoff: dyno.DynoFloat<string>): Promise<SplatMesh> {
  const mesh = new SplatMesh({ fileBytes: bytes, fileType: FILE_TYPES[format], fileName: `splat.${format}` });
  await mesh.initialized;
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error("no splat");
    const { opacity } = dyno.splitGsplat(gsplat).outputs;
    return { gsplat: dyno.combineGsplat({ gsplat, opacity: dyno.select(dyno.lessThan(opacity, cutoff), dyno.dynoConst("float", 0), opacity) }) };
  });
  mesh.updateGenerator();
  return mesh;
}

/**
 * Splats inside another engine's three.js scene: Cinema Studio's 3D scene props (idol-9). One SparkRenderer draws
 * every prop in the scene's own render pass, depth-tested against the MoGe mesh or point cloud and sorted with it.
 * Unlike the viewer's, it writes depth: the scene's post pass reads depth to tell a surface from a hole (what the path
 * render leaves transparent for Uni3C), so a splat that wrote none would vanish from the render. Spark sorts back to
 * front, so writing depth hides nothing behind a nearer Gaussian; the faintest edges (under minAlpha) are dropped so
 * they don't mark a hole as seen. Each prop sits in a group whose scale is its longest side (the splat is centred and
 * fitted to 1 inside), so the scene sets a prop's place, turn and size on the group.
 */
export class SceneSplats {
  readonly root = new THREE.Group();
  private spark: SparkRenderer;
  private props = new Map<string, { group: THREE.Group; mesh: SplatMesh; cutoff: dyno.DynoFloat<string> }>();
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, onDirty: () => void) {
    this.spark = new SparkRenderer({ renderer, onDirty, depthWrite: true, minAlpha: 1 / 16 });
    this.root.add(this.spark);
  }

  /** Load a prop's splat into a new group under `root`; resolves with the group (its transform is the scene's to set). */
  async add(id: string, url: string, format: string, o: { cutoff: number; signal?: AbortSignal; maxBytes?: number }): Promise<{ group: THREE.Group; splats: number }> {
    const bytes = await fetchSplat(url, { signal: o.signal, maxBytes: o.maxBytes });
    if (this.disposed || o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const cutoff = dyno.dynoFloat(o.cutoff);
    const mesh = await buildSplatMesh(bytes, format, cutoff);
    if (this.disposed || o.signal?.aborted) {
      mesh.dispose();
      throw new DOMException("Aborted", "AbortError");
    }
    const box = mesh.getBoundingBox(true);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const longest = box.isEmpty() ? 1 : Math.max(...box.getSize(new THREE.Vector3()).toArray(), 1e-3);
    const fit = new THREE.Group();
    fit.scale.setScalar(1 / longest);
    mesh.position.copy(center).multiplyScalar(-1);
    fit.add(mesh);
    const group = new THREE.Group();
    group.name = `prop:${id}`;
    group.add(fit);
    this.remove(id);
    this.props.set(id, { group, mesh, cutoff });
    this.root.add(group);
    return { group, splats: mesh.packedSplats?.numSplats ?? 0 };
  }

  setCutoff(id: string, value: number) {
    const p = this.props.get(id);
    if (!p || p.cutoff.value === value) return;
    p.cutoff.value = value;
    p.mesh.updateVersion();
  }

  remove(id: string) {
    const p = this.props.get(id);
    if (!p) return;
    this.props.delete(id);
    p.group.removeFromParent();
    p.mesh.dispose();
  }

  get size() {
    return this.props.size;
  }

  /**
   * Bring the splats up to date for `camera` and wait for their sort (a path render draws each frame once, so the
   * order must be this frame's, not the last one's). Spark sorts on a worker: wait out a sort already running first.
   */
  async settle(scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.props.size) return;
    for (let i = 0; this.spark.sorting && i < 200; i++) await new Promise((r) => setTimeout(r, 5));
    await this.spark.update({ scene, camera });
    for (let i = 0; this.spark.sorting && i < 200; i++) await new Promise((r) => setTimeout(r, 5));
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.props.keys()]) this.remove(id);
    this.root.removeFromParent();
    this.spark.dispose();
  }
}

export class SplatTooBigError extends Error {
  constructor(readonly bytes: number) {
    super("This splat is too big to open on this device");
  }
}

/** Read a response body, reporting progress and stopping once it passes maxBytes (a server that sent no length). */
async function readAll(res: Response, length: number, maxBytes: number | undefined, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (maxBytes && got > maxBytes) {
      void reader.cancel();
      throw new SplatTooBigError(got);
    }
    if (length) onProgress?.(Math.min(1, got / length));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
