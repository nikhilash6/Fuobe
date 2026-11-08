"use client";

import { Camera, Circle, Film, Loader2, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createHmr, type Hmr, N_VERTS } from "@/lib/body-double/hmr";
import { cn } from "@/lib/utils";

/** A clip anyone can try Live on before turning on their camera. */
export const LIVE_SAMPLES = [
  { src: "/previews/presets/app-dance.mp4", label: "Ballroom dance" },
  { src: "/previews/presets/motion-catwalk.mp4", label: "Runway walk" },
] as const;

/** A finished Body Double, played on the stage until Live starts. */
const LIVE_PREVIEW = "/previews/presets/app-body-double.mp4";

export type LiveLook = "chrome" | "iris" | "holo" | "wire";
export const LIVE_LOOKS: { value: LiveLook; label: string }[] = [
  { value: "chrome", label: "Chrome" },
  { value: "iris", label: "Iridescent" },
  { value: "holo", label: "Hologram" },
  { value: "wire", label: "Wireframe" },
];

function holoMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float fr = pow(1. - abs(dot(normalize(vN), vV)), 2.2);
        vec3 c = mix(vec3(.72,.55,1.), vec3(.35,.95,1.), .5 + .5*sin(vY*3. + uTime*.8));
        float scan = .75 + .25*sin(vY*220. - uTime*6.);
        gl_FragColor = vec4(c*(.18 + 1.4*fr)*scan, .9); }`,
  });
}

function lookMaterial(look: LiveLook, envMap: THREE.Texture): THREE.Material {
  if (look === "holo") return holoMaterial();
  if (look === "wire") return new THREE.MeshBasicMaterial({ color: 0xece4ff, wireframe: true, transparent: true, opacity: 0.55 });
  if (look === "iris")
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.85,
      roughness: 0.14,
      envMap,
      envMapIntensity: 1.25,
      iridescence: 1,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [220, 820],
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
  return new THREE.MeshPhysicalMaterial({ color: 0xf3f0ff, metalness: 1, roughness: 0.07, envMap, envMapIntensity: 1.35, clearcoat: 1, clearcoatRoughness: 0.04 });
}

type Scenes = {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  overlay: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; mesh: THREE.Mesh; env: THREE.Texture };
  orbit: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; mesh: THREE.Mesh; env: THREE.Texture; body: THREE.Group; floor: THREE.Object3D[]; controls: OrbitControls };
  dispose(): void;
};

function makeScenes(overlayCanvas: HTMLCanvasElement, orbitCanvas: HTMLCanvasElement, look: LiveLook): Scenes {
  const renderer = (canvas: HTMLCanvasElement) => {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  };
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(N_VERTS * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));

  const or = renderer(overlayCanvas);
  const oEnv = new THREE.PMREMGenerator(or).fromScene(new RoomEnvironment(), 0.04).texture;
  const oScene = new THREE.Scene();
  const oCam = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 100);
  const oMesh = new THREE.Mesh(geometry, lookMaterial(look, oEnv));
  oMesh.visible = false;
  oScene.add(oMesh);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-1, 2, 1);
  oScene.add(key);

  const rr = renderer(orbitCanvas);
  const rEnv = new THREE.PMREMGenerator(rr).fromScene(new RoomEnvironment(), 0.04).texture;
  const rScene = new THREE.Scene();
  const rCam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  rCam.position.set(0, 0.25, 4.2);
  const controls = new OrbitControls(rCam, orbitCanvas);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.4;
  const body = new THREE.Group();
  const rMesh = new THREE.Mesh(geometry, lookMaterial(look, rEnv));
  body.add(rMesh);
  rScene.add(body);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 64), new THREE.MeshBasicMaterial({ color: 0xb9a8ff, transparent: true, opacity: 0.08 }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.9, 96), new THREE.MeshBasicMaterial({ color: 0xd9c7ff, transparent: true, opacity: 0.35 }));
  for (const m of [disc, ring]) {
    m.rotation.x = -Math.PI / 2;
    rScene.add(m);
  }
  const key2 = new THREE.DirectionalLight(0xffffff, 1.4);
  key2.position.set(1, 2, 2);
  rScene.add(key2);

  return {
    geometry,
    positions,
    overlay: { r: or, scene: oScene, cam: oCam, mesh: oMesh, env: oEnv },
    orbit: { r: rr, scene: rScene, cam: rCam, mesh: rMesh, env: rEnv, body, floor: [disc, ring], controls },
    dispose() {
      controls.dispose();
      geometry.dispose();
      for (const m of [oMesh, rMesh]) (m.material as THREE.Material).dispose();
      oEnv.dispose();
      rEnv.dispose();
      or.dispose();
      rr.dispose();
    },
  };
}

/** The body into both views: over the picture through the camera's own lens, and centred on the disc. */
function drawBody(s: Scenes, verts: Float32Array, cam: Float32Array, f: number, W: number, H: number, t: number) {
  const p = s.positions;
  let minY = Infinity, sx = 0, sy = 0, sz = 0;
  // Camera frame (x right, y down, z forward) → three.js (y up, looking down −z).
  for (let i = 0; i < N_VERTS; i++) {
    const x = verts[3 * i] + cam[0], y = -(verts[3 * i + 1] + cam[1]), z = -(verts[3 * i + 2] + cam[2]);
    p[3 * i] = x;
    p[3 * i + 1] = y;
    p[3 * i + 2] = z;
    sx += x;
    sy += y;
    sz += z;
    if (y < minY) minY = y;
  }
  s.geometry.attributes.position.needsUpdate = true;
  s.geometry.computeVertexNormals();
  s.geometry.computeBoundingSphere();
  s.overlay.cam.fov = (2 * Math.atan(H / (2 * f)) * 180) / Math.PI;
  s.overlay.cam.aspect = W / H;
  s.overlay.cam.updateProjectionMatrix();
  s.overlay.mesh.visible = true;
  sx /= N_VERTS;
  sy /= N_VERTS;
  sz /= N_VERTS;
  s.orbit.body.position.set(-sx, -sy, -sz);
  for (const m of s.orbit.floor) m.position.y = minY - sy - 0.002;
  for (const m of [s.overlay.mesh, s.orbit.mesh]) {
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    if (u?.uTime) u.uTime.value = t;
  }
  s.orbit.controls.update();
  s.overlay.r.render(s.overlay.scene, s.overlay.cam);
  s.orbit.r.render(s.orbit.scene, s.orbit.cam);
}

type Source = { kind: "camera" } | { kind: "sample"; src: string };

/**
 * Body Double Live: the camera (or a sample clip) in, a 3D body on the person and in a turning view beside it, at the
 * browser's frame rate. Nothing leaves the device: InstantHMR runs on the visitor's own GPU (WebGPU) or CPU. One person
 * at a time. Record keeps the picture with the body on it as a WebM.
 */
export function LiveView() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const orbitRef = useRef<HTMLCanvasElement>(null);
  const scenes = useRef<Scenes | null>(null);
  const hmr = useRef<Hmr | null>(null);
  const run = useRef({ on: false, busy: false, lastTime: -1, fps: [] as number[] });
  const tickRef = useRef<() => void>(() => {});
  const rec = useRef<{ recorder: MediaRecorder; canvas: HTMLCanvasElement; chunks: Blob[] } | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [look, setLook] = useState<LiveLook>("chrome");
  const [mirror, setMirror] = useState(true);
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "live" | "error"; text?: string; share?: number }>({ kind: "idle" });
  const [stats, setStats] = useState<{ fps: number; ms: number; engine: string } | null>(null);
  const [recording, setRecording] = useState(false);

  // The scenes live as long as the view.
  useEffect(() => {
    if (!overlayRef.current || !orbitRef.current) return;
    const s = makeScenes(overlayRef.current, orbitRef.current, "chrome");
    scenes.current = s;
    const r = run.current;
    let frame = 0;
    const idle = () => {
      if (!r.busy) {
        s.orbit.controls.update();
        s.orbit.r.render(s.orbit.scene, s.orbit.cam);
      }
      frame = requestAnimationFrame(idle);
    };
    frame = requestAnimationFrame(idle);
    return () => {
      cancelAnimationFrame(frame);
      r.on = false;
      s.dispose();
      scenes.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = orbitRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(([e]) => {
      const s = scenes.current;
      const { width, height } = e.contentRect;
      if (!s || !width || !height) return;
      s.orbit.r.setSize(width, height, false);
      s.orbit.cam.aspect = width / height;
      s.orbit.cam.updateProjectionMatrix();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const s = scenes.current;
    if (!s) return;
    for (const [m, env] of [
      [s.overlay.mesh, s.overlay.env],
      [s.orbit.mesh, s.orbit.env],
    ] as const) {
      (m.material as THREE.Material).dispose();
      m.material = lookMaterial(look, env);
    }
  }, [look]);

  const size = useCallback((W: number, H: number) => {
    const s = scenes.current, stage = stageRef.current, orbit = orbitRef.current;
    if (!s || !stage || !orbit) return;
    stage.style.aspectRatio = `${W} / ${H}`;
    const r = stage.getBoundingClientRect();
    s.overlay.r.setSize(r.width, r.height, false);
    const o = orbit.getBoundingClientRect();
    s.orbit.r.setSize(o.width, o.height, false);
    s.orbit.cam.aspect = o.width / Math.max(1, o.height);
    s.orbit.cam.updateProjectionMatrix();
  }, []);

  const tick = useCallback(async () => {
    const r = run.current, video = videoRef.current, engine = hmr.current;
    if (!r.on || !video || !engine) return;
    const W = video.videoWidth, H = video.videoHeight;
    if (W && H && !r.busy && video.currentTime !== r.lastTime) {
      r.lastTime = video.currentTime;
      r.busy = true;
      const stage = stageRef.current;
      if (stage && stage.dataset.size !== `${W}x${H}`) {
        size(W, H);
        stage.dataset.size = `${W}x${H}`;
      }
      const now = performance.now();
      try {
        const res = await engine.step(video, W, H, now / 1000);
        if (scenes.current) drawBody(scenes.current, res.verts, res.cam, res.f, W, H, now / 1000);
        if (rec.current) composite(rec.current.canvas, video, overlayRef.current, mirror && source?.kind === "camera");
        r.fps.push(now);
        while (r.fps.length > 30) r.fps.shift();
        if (r.fps.length % 10 === 0) {
          const fps = r.fps.length > 1 ? (1000 * (r.fps.length - 1)) / (r.fps[r.fps.length - 1] - r.fps[0]) : 0;
          setStats({ fps, ms: res.ms.prep + res.ms.network + res.ms.body, engine: engine.engine });
        }
      } catch (e) {
        r.on = false;
        setStatus({ kind: "error", text: e instanceof Error ? e.message : "Live stopped" });
      }
      r.busy = false;
    }
    requestAnimationFrame(() => tickRef.current());
  }, [size, mirror, source]);
  useEffect(() => {
    tickRef.current = () => void tick();
  }, [tick]);

  const start = useCallback(
    async (next: Source) => {
      const video = videoRef.current;
      if (!video) return;
      run.current.on = false;
      const old = video.srcObject as MediaStream | null;
      old?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      try {
        if (next.kind === "camera") {
          video.removeAttribute("src");
          video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } else {
          video.src = next.src;
          video.loop = true;
        }
        await video.play();
      } catch {
        setStatus({ kind: "error", text: next.kind === "camera" ? "The camera didn't open. Allow it in the browser, or try a sample clip." : "That clip didn't play." });
        return;
      }
      setSource(next);
      if (!hmr.current) {
        setStatus({ kind: "loading", share: 0 });
        try {
          const engine = await createHmr((share) => setStatus({ kind: "loading", share }));
          scenes.current?.geometry.setIndex(new THREE.BufferAttribute(engine.faces, 1));
          hmr.current = engine;
        } catch (e) {
          setStatus({ kind: "error", text: e instanceof Error ? e.message : "Live didn't start" });
          return;
        }
      }
      hmr.current.resetTrack();
      setStatus({ kind: "live" });
      run.current.on = true;
      run.current.lastTime = -1;
      tickRef.current();
    },
    [],
  );

  // Stop the camera and the loop when the view goes.
  useEffect(() => {
    const video = videoRef.current;
    const r = run.current;
    return () => {
      r.on = false;
      (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleRecord = () => {
    if (rec.current) {
      rec.current.recorder.stop();
      return;
    }
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = Object.assign(document.createElement("canvas"), { width: video.videoWidth, height: video.videoHeight });
    const type = ["video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return void toast("This browser can't record the view.");
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      rec.current = null;
      setRecording(false);
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(chunks, { type: "video/webm" })), download: "body-double-live.webm" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };
    rec.current = { recorder, canvas, chunks };
    recorder.start(250);
    setRecording(true);
  };

  const flipped = mirror && source?.kind === "camera";
  const live = status.kind === "live";
  // Before Live starts, the stage plays a finished Body Double and the turning view stays out of the page.
  return (
    <div className={cn("grid gap-3", live ? "lg:grid-cols-[minmax(0,1fr)_300px]" : "mx-auto w-full max-w-[860px]")}>
      <div ref={stageRef} className="relative overflow-hidden rounded-2xl bg-media" style={{ aspectRatio: "4 / 3" }}>
        <video ref={videoRef} muted playsInline className={cn("absolute inset-0 size-full object-contain", flipped && "-scale-x-100")} />
        <canvas ref={overlayRef} className={cn("pointer-events-none absolute inset-0 size-full", flipped && "-scale-x-100")} aria-hidden />
        {!live && <video src={LIVE_PREVIEW} autoPlay muted loop playsInline aria-hidden className="absolute inset-0 size-full object-cover" />}
        {status.kind !== "live" && (
          <div className={cn("absolute inset-0 grid p-4 text-center", status.kind === "loading" ? "place-items-center bg-black/35" : "items-end justify-items-center bg-gradient-to-t from-black/75 via-black/10 to-transparent pb-6")}>
            {status.kind === "loading" ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-white" role="status">
                <Loader2 className="size-3.5 animate-spin" /> Getting the body model ready{status.share ? ` · ${Math.round(status.share * 100)}%` : "…"}
              </p>
            ) : (
              <div className="max-w-sm space-y-3">
                {status.kind === "error" && (
                  <p className="rounded-xl bg-black/60 px-3 py-2 text-[13px] text-white" role="alert">
                    {status.text}
                  </p>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="lg" className="rounded-full" onClick={() => void start({ kind: "camera" })}>
                    <Camera className="size-4" /> Use my camera
                  </Button>
                  {LIVE_SAMPLES.map((s) => (
                    <Button key={s.src} size="lg" variant="secondary" className="rounded-full" onClick={() => void start({ kind: "sample", src: s.src })}>
                      <Film className="size-4" /> {s.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[12px] text-white/80">Runs in this browser. Your camera stays on this device.</p>
              </div>
            )}
          </div>
        )}
        {status.kind === "live" && (
          <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            <span className={cn("size-1.5 rounded-full", recording ? "animate-pulse bg-red-500" : "bg-emerald-400")} aria-hidden />
            {recording ? "Recording" : "Live"}
            {stats && ` · ${Math.round(stats.fps)} fps · ${stats.engine}`}
          </span>
        )}
      </div>
      <div className={cn("space-y-3", !live && "hidden")}>
        <div className="overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_top,#2a2340,#0d0c12)]">
          <canvas ref={orbitRef} className="block aspect-square w-full touch-none" aria-label="Your 3D body, turning" />
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Look">
            {LIVE_LOOKS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={look === l.value}
                onClick={() => setLook(l.value)}
                className={cn(
                  "h-8 rounded-full border px-3 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                  look === l.value ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          {status.kind === "live" && (
            <div className="flex flex-wrap gap-1.5">
              <Button variant={recording ? "destructive" : "outline"} size="sm" className="rounded-full" onClick={toggleRecord}>
                {recording ? <Square className="size-3.5" /> : <Circle className="size-3.5" />} {recording ? "Stop and save" : "Record"}
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => hmr.current?.resetTrack()}>
                <RefreshCw className="size-3.5" /> Find me again
              </Button>
              {source?.kind === "camera" ? (
                <Button variant="outline" size="sm" className="rounded-full" aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>
                  Mirror
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => void start({ kind: "camera" })}>
                  <Camera className="size-3.5" /> Use my camera
                </Button>
              )}
            </div>
          )}
          <p className="text-[12px] text-muted-foreground">One person at a time, best in full view. For everyone in a shot, or a file to animate with, use Photo or Clip.</p>
        </div>
      </div>
    </div>
  );
}

/** The picture with the body on it, into the recording's canvas. */
function composite(canvas: HTMLCanvasElement, video: HTMLVideoElement, overlay: HTMLCanvasElement | null, flip: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  if (flip) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (overlay) ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}
