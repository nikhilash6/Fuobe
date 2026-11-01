"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DOOR_GAP, STAIR_STEPS, aspectOf, cameraAt, lensVFov, primAt, primSpeed, type BlockoutPrim, type BlockoutScene, type Vec3 } from "@/lib/blockout";
import { encodeFrames } from "./video-encode";

/**
 * The blockout builder's renderer (three.js, loaded only when the builder opens): grey boxes, planes, a doorway, stairs,
 * a door on its hinge, a mannequin that walks between its keys and GLB meshes; an orbit view to build in with a move /
 * turn gizmo, the shot camera along its keys (eased, with handheld shake), and the render of the grey box and its depth
 * (near = bright, as Depth Anything draws it) frame by frame into video.
 */

const GREY = 0xb4b4b4;
const FIGURE = 0x8e8e8e;
const BACKGROUND = 0x404040;
const DEG = Math.PI / 180;

export type ViewMode = "edit" | "shot";

export interface EngineEvents {
  onSelect?: (id: string | null) => void;
  /** A primitive moved or turned with the gizmo (at the playhead: the builder decides whether that is a key). */
  onMove?: (id: string, position: Vec3, rotation: number) => void;
}

const depthVertex = /* glsl */ `
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const depthFragment = /* glsl */ `
uniform float uNear;
uniform float uFar;
varying float vDepth;
void main() {
  // Inverse depth between near and far: near = white, far = black (Depth Anything's convention, which VACE was trained on).
  float d = max(vDepth, uNear);
  float v = (1.0 / d - 1.0 / uFar) / (1.0 / uNear - 1.0 / uFar);
  gl_FragColor = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}`;

/** A box `size` standing on y = 0 (its bottom centre at the origin). */
function standing(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)).translate(0, h / 2, 0);
}

function meshOf(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

interface Figure {
  root: THREE.Group;
  arms: [THREE.Object3D, THREE.Object3D];
  legs: [THREE.Object3D, THREE.Object3D];
}

/** A plain mannequin 1.75 m tall facing −Z (towards the default camera when turned 180°): torso, head, arms and legs on pivots. */
function mannequin(mat: THREE.Material): Figure {
  const root = new THREE.Group();
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
  const torso = meshOf(capsule(0.17, 0.42), mat);
  torso.position.y = 1.18;
  const head = meshOf(new THREE.SphereGeometry(0.12, 16, 12), mat);
  head.position.y = 1.62;
  root.add(torso, head);
  const limb = (x: number, y: number, r: number, len: number): THREE.Object3D => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = meshOf(capsule(r, len), mat);
    m.position.y = -(len / 2 + r);
    pivot.add(m);
    root.add(pivot);
    return pivot;
  };
  const arms: [THREE.Object3D, THREE.Object3D] = [limb(-0.24, 1.42, 0.055, 0.52), limb(0.24, 1.42, 0.055, 0.52)];
  const legs: [THREE.Object3D, THREE.Object3D] = [limb(-0.1, 0.86, 0.075, 0.68), limb(0.1, 0.86, 0.075, 0.68)];
  return { root, arms, legs };
}

/** The object a primitive draws as (its pose is set per frame). */
function build(p: BlockoutPrim, mat: THREE.Material, figureMat: THREE.Material, loader: GLTFLoader, dirty: () => void): { obj: THREE.Object3D; figure?: Figure } {
  const [w, h, d] = p.size;
  const group = new THREE.Group();
  switch (p.kind) {
    case "doorway": {
      const gw = Math.min(DOOR_GAP.width, w - 0.1);
      const gh = Math.min(DOOR_GAP.height, h - 0.1);
      const side = (w - gw) / 2;
      const left = meshOf(standing(side, h, d), mat);
      left.position.x = -(gw / 2 + side / 2);
      const right = meshOf(standing(side, h, d), mat);
      right.position.x = gw / 2 + side / 2;
      const top = meshOf(standing(gw, h - gh, d), mat);
      top.position.y = gh;
      group.add(left, right, top);
      break;
    }
    case "stairs": {
      for (let i = 0; i < STAIR_STEPS; i++) {
        const step = meshOf(standing(w, (h * (i + 1)) / STAIR_STEPS, d / STAIR_STEPS), mat);
        step.position.z = d / 2 - ((i + 0.5) * d) / STAIR_STEPS;
        group.add(step);
      }
      break;
    }
    case "door": {
      // Hinged on its left edge: the group's origin is the hinge.
      const door = meshOf(standing(w, h, d).translate(w / 2, 0, 0), mat);
      group.add(door);
      break;
    }
    case "mannequin": {
      const f = mannequin(figureMat);
      f.root.scale.setScalar(h / 1.75);
      group.add(f.root);
      return { obj: group, figure: f };
    }
    case "mesh": {
      const holder = meshOf(standing(w, h, d), new THREE.MeshBasicMaterial({ color: GREY, wireframe: true }));
      group.add(holder);
      if (p.url) {
        loader.load(
          p.url,
          (gltf) => {
            const model = gltf.scene;
            model.traverse((o) => {
              const m = o as THREE.Mesh;
              if (m.isMesh) {
                m.material = mat;
                m.castShadow = true;
                m.receiveShadow = true;
              }
            });
            // Fit the model in the primitive's box, standing on its floor.
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const k = Math.min(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
            model.scale.setScalar(k);
            const fit = new THREE.Box3().setFromObject(model);
            const c = fit.getCenter(new THREE.Vector3());
            model.position.set(-c.x, -fit.min.y, -c.z);
            group.remove(holder);
            holder.geometry.dispose();
            group.add(model);
            dirty();
          },
          undefined,
          () => {},
        );
      }
      break;
    }
    default:
      group.add(meshOf(standing(w, h, d), mat));
  }
  return { obj: group };
}

export class BlockoutEngine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene3 = new THREE.Scene();
  private readonly props = new THREE.Group();
  private readonly helpers = new THREE.Group();
  private readonly view: THREE.PerspectiveCamera;
  private readonly shot: THREE.PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly mat = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.95, metalness: 0 });
  private readonly figureMat = new THREE.MeshStandardMaterial({ color: FIGURE, roughness: 0.9, metalness: 0 });
  private readonly depthMat = new THREE.ShaderMaterial({ vertexShader: depthVertex, fragmentShader: depthFragment, uniforms: { uNear: { value: 0.3 }, uFar: { value: 40 } } });
  private readonly loader = new GLTFLoader();
  private readonly objects = new Map<string, { obj: THREE.Object3D; figure?: Figure; prim: BlockoutPrim }>();
  private readonly path: THREE.Line;
  private readonly frustum = new THREE.Group();
  private outline: THREE.BoxHelper | null = null;
  private data: BlockoutScene | null = null;
  private time = 0;
  private mode: ViewMode = "edit";
  private selected: string | null = null;
  private raf = 0;
  private dirty = true;
  private disposed = false;
  private rendering = false;
  private size = { w: 1, h: 1 };
  private down: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: EngineEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene3.background = new THREE.Color(BACKGROUND);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(4, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 40 });
    this.scene3.add(hemi, sun, this.props, this.helpers);
    const grid = new THREE.GridHelper(40, 40, 0x6b6b6b, 0x535353);
    grid.position.y = 0.001;
    this.helpers.add(grid);
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffc04d }));
    this.helpers.add(this.path, this.frustum);
    this.view = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    this.view.position.set(6, 5, 8);
    this.shot = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 400);
    this.orbit = new OrbitControls(this.view, canvas);
    this.orbit.target.set(0, 1, -4);
    this.orbit.enableDamping = false;
    // The arrow keys move the view while the canvas has focus (the Camera tab's fields frame it exactly).
    this.orbit.listenToKeyEvents(canvas);
    this.orbit.addEventListener("change", () => (this.dirty = true));
    this.gizmo = new TransformControls(this.view, canvas);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) this.reportMove();
    });
    this.gizmo.addEventListener("change", () => {
      this.outline?.update();
      this.dirty = true;
    });
    this.helpers.add(this.gizmo.getHelper());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointerup", this.onUp);
    this.loop();
  }

  private readonly onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  /** A click (not a drag) picks the primitive under it in the edit view, or clears the pick. */
  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || this.mode !== "edit" || this.gizmo.dragging || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.view);
    const hit = ray.intersectObjects(this.props.children, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.primId) o = o.parent;
    const id = (o?.userData.primId as string | undefined) ?? null;
    this.select(id);
    this.events.onSelect?.(id);
  };

  private reportMove() {
    const id = this.selected;
    const entry = id ? this.objects.get(id) : undefined;
    if (!id || !entry) return;
    const p = entry.obj.position;
    this.events.onMove?.(id, [round(p.x), round(p.y), round(p.z)], round(entry.obj.rotation.y / DEG));
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty || this.rendering) return;
    this.dirty = false;
    this.draw();
  };

  /** The whole scene, rebuilt where a primitive changed (same id and same shape: only its pose moves). */
  setScene(s: BlockoutScene) {
    const prev = this.data;
    this.data = s;
    const keep = new Set(s.prims.map((p) => p.id));
    for (const [id, e] of this.objects) {
      if (!keep.has(id)) {
        this.props.remove(e.obj);
        dispose(e.obj, [this.mat, this.figureMat]);
        this.objects.delete(id);
      }
    }
    for (const p of s.prims) {
      const had = this.objects.get(p.id);
      if (had && sameShape(had.prim, p)) {
        had.prim = p;
        continue;
      }
      if (had) {
        this.props.remove(had.obj);
        dispose(had.obj, [this.mat, this.figureMat]);
      }
      const made = build(p, this.mat, this.figureMat, this.loader, () => (this.dirty = true));
      made.obj.userData.primId = p.id;
      this.props.add(made.obj);
      this.objects.set(p.id, { ...made, prim: p });
    }
    if (this.selected && !keep.has(this.selected)) this.select(null);
    if (!prev || prev.camera !== s.camera || prev.duration !== s.duration) this.drawPath();
    this.pose(this.time);
    if (this.selected) this.attach(this.selected);
    this.dirty = true;
  }

  /** The camera's path over the length (a line), and a small frustum where the shot camera is now. */
  private drawPath() {
    const s = this.data;
    if (!s) return;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const c = cameraAt(s.camera, (i / 60) * s.duration);
      pts.push(new THREE.Vector3(...c.position));
    }
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  private placeFrustum(position: Vec3, target: Vec3) {
    this.frustum.clear();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc04d, wireframe: true }));
    cone.rotation.x = -Math.PI / 2;
    cone.rotation.y = Math.PI / 4;
    const g = new THREE.Group();
    g.add(cone);
    g.position.set(...position);
    g.lookAt(new THREE.Vector3(...target));
    this.frustum.add(g);
  }

  /** Every primitive and the shot camera at time t. */
  private pose(t: number) {
    const s = this.data;
    if (!s) return;
    for (const { obj, figure, prim } of this.objects.values()) {
      // The picked primitive stays where the gizmo holds it while it is dragged.
      if (this.gizmo.dragging && prim.id === this.selected) continue;
      const at = primAt(prim, t);
      obj.position.set(...at.position);
      obj.rotation.set(0, at.rotation * DEG, 0);
      if (figure) {
        const speed = primSpeed(prim, t);
        const k = Math.min(1, speed / 1.4) * 0.55;
        const swing = Math.sin(2 * Math.PI * 1.7 * t) * k;
        figure.legs[0].rotation.x = swing;
        figure.legs[1].rotation.x = -swing;
        figure.arms[0].rotation.x = -swing * 0.8;
        figure.arms[1].rotation.x = swing * 0.8;
      }
    }
    const c = cameraAt(s.camera, t);
    this.shot.position.set(...c.position);
    this.shot.fov = lensVFov(c.lens, aspectOf(s.aspect));
    this.shot.lookAt(new THREE.Vector3(...c.target));
    this.shot.updateProjectionMatrix();
    this.placeFrustum(c.position, c.target);
    this.outline?.update();
  }

  setTime(t: number) {
    this.time = t;
    this.pose(t);
    this.dirty = true;
  }

  setMode(m: ViewMode) {
    this.mode = m;
    this.gizmo.enabled = m === "edit";
    this.gizmo.getHelper().visible = m === "edit" && !!this.selected;
    this.dirty = true;
  }

  /** "move" or "rotate" (about the vertical only). */
  setGizmo(kind: "translate" | "rotate") {
    this.gizmo.setMode(kind);
    this.gizmo.showX = kind === "translate";
    this.gizmo.showZ = kind === "translate";
    this.gizmo.showY = true;
    this.dirty = true;
  }

  select(id: string | null) {
    this.selected = id;
    if (this.outline) {
      this.helpers.remove(this.outline);
      this.outline.dispose();
      this.outline = null;
    }
    this.gizmo.detach();
    if (id) this.attach(id);
    this.dirty = true;
  }

  private attach(id: string) {
    const e = this.objects.get(id);
    if (!e) return;
    this.gizmo.attach(e.obj);
    this.gizmo.getHelper().visible = this.mode === "edit";
    if (!this.outline) {
      this.outline = new THREE.BoxHelper(e.obj, 0x6aa8ff);
      this.helpers.add(this.outline);
    } else this.outline.setFromObject(e.obj);
  }

  /** Where the edit view is now, as a camera key (what "Set camera here" keeps). */
  viewPose(): { position: Vec3; target: Vec3 } {
    const p = this.view.position;
    const t = this.orbit.target;
    return { position: [round(p.x), round(p.y), round(p.z)], target: [round(t.x), round(t.y), round(t.z)] };
  }

  /** Put the edit view where the shot camera is at time t (to adjust a key from there). */
  viewFromShot(t: number) {
    if (!this.data) return;
    const c = cameraAt(this.data.camera.map((k) => ({ ...k, shake: 0 })), t);
    this.view.position.set(...c.position);
    this.orbit.target.set(...c.target);
    this.orbit.update();
    this.dirty = true;
  }

  resize(w: number, h: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.view.aspect = this.size.w / this.size.h;
    this.view.updateProjectionMatrix();
    this.dirty = true;
  }

  /** The frame the shot camera sees, inside the canvas (letterboxed to the blockout's shape). */
  frameRect(): { x: number; y: number; w: number; h: number } {
    const a = aspectOf(this.data?.aspect ?? "16:9");
    const { w, h } = this.size;
    const fw = Math.min(w, h * a);
    const fh = fw / a;
    return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
  }

  private draw() {
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    if (this.mode === "edit") {
      this.helpers.visible = true;
      r.render(this.scene3, this.view);
      return;
    }
    // The shot camera, letterboxed.
    this.helpers.visible = false;
    r.setClearColor(0x000000, 1);
    r.clear();
    const f = this.frameRect();
    r.setScissorTest(true);
    r.setScissor(f.x, f.y, f.w, f.h);
    r.setViewport(f.x, f.y, f.w, f.h);
    this.shot.aspect = f.w / f.h;
    this.shot.updateProjectionMatrix();
    r.render(this.scene3, this.shot);
    r.setScissorTest(false);
  }

  /** The nearest and furthest the shot camera sees anything over the whole blockout (the depth video's fixed range). */
  private depthRange(): { near: number; far: number } {
    const s = this.data!;
    const box = new THREE.Box3().setFromObject(this.props);
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let far = 1;
    for (let i = 0; i <= 24; i++) {
      const c = new THREE.Vector3(...cameraAt(s.camera, (i / 24) * s.duration).position);
      for (const k of corners) far = Math.max(far, c.distanceTo(k));
    }
    return { near: 0.3, far: Math.min(200, far) };
  }

  /**
   * Render the blockout through the shot camera at `fps`, `width` × `height`: the grey box ("grey") or its depth ("depth",
   * near = bright), every frame, into a video (MP4 where the browser can, for the cloud; WebM otherwise). Also returns
   * frame 0 as a PNG for the grey box (the open engine's first frame is drawn from it).
   */
  async render(o: { kind: "grey" | "depth"; fps: number; width: number; height: number; preferMp4?: boolean; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<{ video: Blob; type: string; first?: Blob; frames: number }> {
    const s = this.data;
    if (!s) throw new Error("Nothing to render yet");
    const { width, height, fps } = o;
    const frames = Math.max(1, Math.floor(s.duration * fps + 1e-6));
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    const buf = new Uint8Array(width * height * 4);
    const img = new ImageData(width, height);
    const cam = new THREE.PerspectiveCamera(40, width / height, 0.05, 400);
    const depth = o.kind === "depth";
    const range = depth ? this.depthRange() : null;
    if (range) {
      this.depthMat.uniforms.uNear.value = range.near;
      this.depthMat.uniforms.uFar.value = range.far;
    }
    let first: Blob | undefined;
    const r = this.renderer;
    this.rendering = true;
    this.helpers.visible = false;
    const bg = this.scene3.background;
    if (depth) {
      this.scene3.overrideMaterial = this.depthMat;
      this.scene3.background = new THREE.Color(0x000000);
    }
    const draw = (i: number) => {
      if (o.signal?.aborted || this.disposed) throw new DOMException("Stopped", "AbortError");
      const t = i / fps;
      this.pose(t);
      const c = cameraAt(s.camera, t);
      cam.position.set(...c.position);
      cam.fov = lensVFov(c.lens, width / height);
      cam.lookAt(new THREE.Vector3(...c.target));
      cam.updateProjectionMatrix();
      r.setRenderTarget(target);
      r.setScissorTest(false);
      r.setViewport(0, 0, width, height);
      r.render(this.scene3, cam);
      r.readRenderTargetPixels(target, 0, 0, width, height, buf);
      for (let y = 0; y < height; y++) img.data.set(buf.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      o.onProgress?.((i + 1) / frames);
      return img;
    };
    try {
      if (!depth) first = await pngOf(draw(0));
      const out = await encodeFrames(frames, width, height, fps, draw, !!o.preferMp4);
      return { video: out.blob, type: out.type, first, frames };
    } finally {
      this.scene3.overrideMaterial = null;
      this.scene3.background = bg;
      r.setRenderTarget(null);
      target.dispose();
      this.rendering = false;
      this.helpers.visible = true;
      this.pose(this.time);
      this.dirty = true;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    for (const e of this.objects.values()) dispose(e.obj, []);
    this.mat.dispose();
    this.figureMat.dispose();
    this.depthMat.dispose();
    this.path.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000 + 0;

function sameShape(a: BlockoutPrim, b: BlockoutPrim): boolean {
  return a.kind === b.kind && a.url === b.url && a.size.every((n, i) => n === b.size[i]);
}

/** Free an object's geometry (and materials other than the shared ones). */
function dispose(o: THREE.Object3D, shared: THREE.Material[]) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[]) if (!shared.includes(mat)) mat.dispose();
  });
}

async function pngOf(img: ImageData): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the first frame"))), "image/png"));
}
