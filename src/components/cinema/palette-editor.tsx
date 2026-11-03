"use client";

import { ImageUp, Loader2, Plus, Shuffle, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { HARMONIES, harmonyPalette, hexToRgb, hslToHex, kmeans, rgbToHex, rgbToHsl, type Harmony, type RGB } from "./color-math";

interface Point {
  /** 0–1 across the image. */
  x: number;
  y: number;
}

interface Sampled {
  url: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const pixelAt = (img: Sampled, p: Point): RGB => {
  const x = Math.min(img.width - 1, Math.max(0, Math.round(p.x * (img.width - 1))));
  const y = Math.min(img.height - 1, Math.max(0, Math.round(p.y * (img.height - 1))));
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

async function sampleImage(file: File): Promise<Sampled> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  return { url, width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/** k-means centres, then a draggable sample point on the pixel closest to each one. */
function extract(img: Sampled, count: number): Point[] {
  const step = Math.max(1, Math.floor((img.width * img.height) / 5000));
  const px: RGB[] = [];
  const pos: Point[] = [];
  for (let i = 0; i < img.width * img.height; i += step) {
    const o = i * 4;
    px.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
    pos.push({ x: (i % img.width) / Math.max(1, img.width - 1), y: Math.floor(i / img.width) / Math.max(1, img.height - 1) });
  }
  return kmeans(px, count).map((c) => {
    let best = 0;
    let bd = Infinity;
    px.forEach((p, i) => {
      const d = (p[0] - c.rgb[0]) ** 2 + (p[1] - c.rgb[1]) ** 2 + (p[2] - c.rgb[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return pos[best];
  });
}

function FromImage({ onColors }: { onColors: (hex: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<Sampled | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const publish = (im: Sampled, ps: Point[]) => onColors(ps.map((p) => rgbToHex(pixelAt(im, p))));
  const load = async (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("Pick an image file");
    setBusy(true);
    try {
      const s = await sampleImage(f);
      const ps = extract(s, count);
      setImg(s);
      setPoints(ps);
      publish(s, ps);
    } catch {
      toast.error("Couldn't read that image. Try a PNG or JPEG.");
    } finally {
      setBusy(false);
    }
  };
  const move = (e: React.PointerEvent) => {
    if (drag === null || !img || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const p = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    const next = points.map((q, i) => (i === drag ? p : q));
    setPoints(next);
    publish(img, next);
  };

  return (
    <div className="space-y-3">
      {!img ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f);
          }}
          className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-[13px] text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
          {busy ? "Extracting colors from your image…" : "Drop an image or click to upload"}
        </button>
      ) : (
        <div
          ref={box}
          className="relative mx-auto max-h-[42vh] w-fit touch-none overflow-hidden rounded-xl"
          onPointerMove={move}
          onPointerUp={() => setDrag(null)}
          onPointerLeave={() => setDrag(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="" className="block max-h-[42vh] w-auto select-none" draggable={false} />
          {points.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Sample point ${i + 1}`}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                setDrag(i);
              }}
              className={cn("absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow-strong active:cursor-grabbing", i === points.length - 1 && "size-6 ring-2 ring-primary")}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: rgbToHex(pixelAt(img, p)) }}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[12px] text-muted-foreground">Colours</span>
        <Slider
          value={[count]}
          min={3}
          max={12}
          step={1}
          onValueChange={([v]) => setCount(v)}
          onValueCommit={([v]) => {
            if (!img) return;
            const ps = extract(img, v);
            setPoints(ps);
            publish(img, ps);
          }}
          aria-label="Number of colours"
        />
        <span className="w-5 font-mono text-[12px]">{count}</span>
        {img && (
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
            Change image
          </Button>
        )}
      </div>
      {img && <p className="text-[11.5px] text-muted-foreground">Drag the sample points to pick colours; the largest ring is the main colour.</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const WHEEL_BASE = "#c0583a";

/** Where a hue (degrees, 0 = top, clockwise) and saturation (0–1) sit on the wheel, in % of its box. */
function wheelSpot(hue: number, sat: number): { left: string; top: string } {
  const a = (hue * Math.PI) / 180;
  const r = Math.max(0, Math.min(1, sat)) * 46;
  return { left: `${50 + r * Math.sin(a)}%`, top: `${50 - r * Math.cos(a)}%` };
}

/**
 * An HSL colour wheel: drag (or use the arrow keys on) the base handle to pick hue and saturation;
 * the harmony's other hues show as markers that turn with it.
 */
function HueWheel({ base, harmony, onBase }: { base: string; harmony: Harmony; onBase: (hex: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, s, l] = rgbToHsl(hexToRgb(base));
  // Very dark or light bases pick at mid lightness, so the wheel still shows a change.
  const light = l < 0.2 || l > 0.8 ? 0.5 : l;
  const offsets = (HARMONIES.find((x) => x.id === harmony)?.offsets ?? [0]).filter((o) => o !== 0);
  const pick = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left - box.width / 2;
    const y = e.clientY - box.top - box.height / 2;
    const hue = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    const sat = Math.max(0.05, Math.min(1, Math.hypot(x, y) / ((box.width / 2) * 0.92)));
    onBase(hslToHex(hue, sat, light));
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Base colour on the wheel (arrows: left/right hue, up/down saturation)"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(h)}
      aria-valuetext={`Hue ${Math.round(h)}°, saturation ${Math.round(s * 100)}%`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) pick(e);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 5;
        const next =
          e.key === "ArrowRight" ? [h + step, s] : e.key === "ArrowLeft" ? [h - step, s] : e.key === "ArrowUp" ? [h, Math.min(1, s + 0.05)] : e.key === "ArrowDown" ? [h, Math.max(0.05, s - 0.05)] : null;
        if (!next) return;
        e.preventDefault();
        onBase(hslToHex(next[0], next[1], light));
      }}
      className="relative size-40 shrink-0 cursor-crosshair touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{
        background:
          "radial-gradient(closest-side, hsl(0 0% 55%) 0%, hsl(0 0% 55% / 0) 100%), conic-gradient(from 0deg, hsl(0 80% 55%), hsl(60 80% 55%), hsl(120 80% 55%), hsl(180 80% 55%), hsl(240 80% 55%), hsl(300 80% 55%), hsl(360 80% 55%))",
      }}
    >
      {offsets.map((o) => (
        <span
          key={o}
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-soft"
          style={{ ...wheelSpot(h + o, s), background: hslToHex(h + o, s, light) }}
        />
      ))}
      <span
        aria-hidden
        className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-strong"
        style={{ ...wheelSpot(h, s), background: base }}
      />
    </div>
  );
}

function ColorWheel({ onColors }: { onColors: (hex: string[]) => void }) {
  const [base, setBase] = useState(WHEEL_BASE);
  const [harmony, setHarmony] = useState<Harmony>("analogous");
  const [count, setCount] = useState(6);
  const update = (b = base, h = harmony, n = count) => onColors(harmonyPalette(b, h, n));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <HueWheel
        base={/^#[0-9a-f]{6}$/i.test(base) ? base : WHEEL_BASE}
        harmony={harmony}
        onBase={(hex) => {
          setBase(hex);
          update(hex);
        }}
      />
      <div className="w-full min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <input type="color" value={base} onChange={(e) => {
              setBase(e.target.value);
              update(e.target.value);
            }} className="size-10 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5" aria-label="Base colour" />
          <Input
            value={base}
            onChange={(e) => {
              const v = e.target.value.trim();
              setBase(v);
              if (/^#[0-9a-f]{6}$/i.test(v)) update(v);
            }}
            className="h-9 w-28 font-mono"
            aria-label="Base colour hex"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const b = hslToHex(Math.random() * 360, 0.35 + Math.random() * 0.45, 0.35 + Math.random() * 0.3);
              const h = HARMONIES[Math.floor(Math.random() * HARMONIES.length)].id;
              setBase(b);
              setHarmony(h);
              update(b, h);
            }}
          >
            <Shuffle /> Random
          </Button>
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Harmony">
          {HARMONIES.map((h) => (
            <button
              key={h.id}
              type="button"
              role="radio"
              aria-checked={harmony === h.id}
              onClick={() => {
                setHarmony(h.id);
                update(base, h.id);
              }}
              className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium", harmony === h.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
            >
              {h.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-[12px] text-muted-foreground">Colours</span>
          <Slider value={[count]} min={2} max={12} step={1} onValueChange={([v]) => {
              setCount(v);
              update(base, harmony, v);
            }} aria-label="Number of colours" />
          <span className="w-5 font-mono text-[12px]">{count}</span>
        </div>
      </div>
    </div>
  );
}

/** New palette
: from an image (k-means in the browser, draggable sample points) or a colour-wheel harmony. */
export function PaletteEditor({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (p: { name: string; hex: string[] }) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">{open && <EditorBody onClose={() => onOpenChange(false)} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function EditorBody({ onClose, onSave }: { onClose: () => void; onSave: (p: { name: string; hex: string[] }) => void }) {
  const [tab, setTab] = useState<"image" | "wheel">("image");
  const [hex, setHex] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const save = () => {
    if (!hex.length) return toast.error("Add some colours first");
    onSave({ name: name.trim() || `Palette ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, hex });
    toast.success("Palette saved", { duration: 1500 });
    onClose();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>New palette</DialogTitle>
        <DialogDescription>Pull colours from a frame you like, or build a harmony on the colour wheel.</DialogDescription>
      </DialogHeader>
      <TabRow className="w-fit" role="tablist" aria-label="Source" fade={false}>
        {(
          [
            ["image", "From image"],
            ["wheel", "Color wheel"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              // The wheel starts from a harmony right away; the image tab waits for a picture.
              setHex(id === "wheel" ? harmonyPalette(WHEEL_BASE, "analogous", 6) : []);
            }}
            className={TAB_PILL}
            {...onAttr(tab === id)}
          >
            {label}
          </button>
        ))}
      </TabRow>
      {tab === "image" ? <FromImage onColors={setHex} /> : <ColorWheel onColors={setHex} />}
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted-foreground">{hex.length ? "Click a colour to change it, drag to reorder." : "Your colours appear here."}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {hex.map((h, i) => (
            <span
              key={`${h}-${i}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag === null || drag === i) return;
                const next = [...hex];
                const [x] = next.splice(drag, 1);
                next.splice(i, 0, x);
                setHex(next);
                setDrag(null);
              }}
              className="group/sw relative"
            >
              <label className="block size-9 cursor-pointer rounded-lg border shadow-soft" style={{ background: h }} title={h}>
                <input
                  type="color"
                  value={h}
                  onChange={(e) => setHex(hex.map((x, j) => (j === i ? e.target.value : x)))}
                  className="sr-only"
                  aria-label={`Colour ${i + 1}`}
                />
              </label>
              <button
                type="button"
                onClick={() => setHex(hex.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-foreground text-background opacity-100 sm:opacity-0 sm:group-hover/sw:opacity-100"
                aria-label={`Remove colour ${i + 1}`}
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {hex.length > 0 && hex.length < 12 && (
            <button type="button" onClick={() => setHex([...hex, hex[hex.length - 1]])} className="grid size-9 place-items-center rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-brand-text" aria-label="Add colour">
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:items-center">
        <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Enter palette name" className="sm:max-w-60" onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button onClick={save}>Save palette</Button>
      </DialogFooter>
    </>
  );
}
