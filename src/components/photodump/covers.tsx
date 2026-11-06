"use client";

import { CoverImg } from "@/components/template-cover";
import { hueOf, type CoverTone } from "@/lib/catalog/packs";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/** A fine noise layer (film grain) drawn by the browser, no image file. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * A drawn cover's background for a look: its hue under the look's treatment, `k` (0–3) shifting the
 * light a little for the tiles of a contact sheet.
 */
export function drawnCover(hue: number, tone: CoverTone, k = 0): { background: string; grain: boolean } {
  const h = (d: number) => (hue + d + 360) % 360;
  const l = [0, 0.06, -0.05, 0.03][k % 4];
  switch (tone) {
    case "mono":
      return { background: `radial-gradient(90% 70% at 35% 25%, oklch(${0.86 + l} 0 0), transparent 65%), linear-gradient(${160 + k * 30}deg, oklch(${0.58 + l} 0 0), oklch(${0.2 + l / 2} 0 0))`, grain: true };
    case "flash":
      return { background: `radial-gradient(40% 32% at 50% 38%, oklch(0.98 0.02 ${h(0)}), oklch(${0.72 + l} 0.12 ${h(0)}) 45%, oklch(0.2 0.04 ${h(40)}) 100%)`, grain: false };
    case "gel":
      return { background: `radial-gradient(70% 60% at 50% 60%, oklch(0.25 0.03 280 / 0.6), transparent), linear-gradient(${105 + k * 20}deg, oklch(${0.55 + l} 0.22 25), oklch(0.3 0.08 300) 50%, oklch(${0.52 + l} 0.19 255))`, grain: false };
    case "pastel":
      return { background: `linear-gradient(${150 + k * 35}deg, oklch(${0.93 + l / 2} 0.05 ${h(0)}), oklch(${0.86 + l / 2} 0.07 ${h(70)}))`, grain: false };
    case "film":
      return { background: `radial-gradient(120% 100% at 50% 40%, transparent 55%, oklch(0.2 0.03 ${h(20)} / 0.55)), linear-gradient(${150 + k * 35}deg, oklch(${0.78 + l} 0.09 ${h(0)}), oklch(${0.5 + l} 0.08 ${h(35)}))`, grain: true };
    case "spot":
      return { background: `radial-gradient(38% 46% at 50% 42%, oklch(${0.72 + l} 0.12 ${h(0)}), oklch(0.32 0.08 ${h(20)}) 55%, oklch(0.12 0.02 ${h(30)}) 100%)`, grain: false };
    default:
      return { background: `radial-gradient(120% 90% at 20% 15%, oklch(${0.86 + l / 2} 0.09 ${h(0)}), transparent 60%), linear-gradient(${150 + k * 35}deg, oklch(${0.64 + l} 0.14 ${h(30)}), oklch(0.32 0.08 ${h(70)}))`, grain: false };
  }
}

/** One drawn tile (decorative: the card around it carries the name): the background plus film grain when the treatment has it. */
export function DrawnTile({ hue, tone, k = 0, className, children }: { hue: number; tone: CoverTone; k?: number; className?: string; children?: React.ReactNode }) {
  const c = drawnCover(hue, tone, k);
  return (
    <span aria-hidden className={cn("relative block overflow-hidden", className)} style={{ background: c.background }}>
      {c.grain && <span aria-hidden className="absolute inset-0 opacity-35 mix-blend-overlay" style={{ backgroundImage: GRAIN }} />}
      {children}
    </span>
  );
}

/**
 * A drawn pack cover (Fuobe ships no copies of the parity studio's sample photos): a 2×2 contact sheet in the
 * pack's own hue and treatment (flash, film, gels…), its name and photo count. A built-in pack with a
 * real cover (templateCover) shows its frames in the cells instead, and user packs their reference photos.
 */
export function PackCover({
  id,
  name,
  count,
  className,
  refs,
  bare,
  hue,
  tone = "plain",
}: {
  id: string;
  name: string;
  count: number;
  className?: string;
  refs?: string[];
  bare?: boolean;
  hue?: number;
  tone?: CoverTone;
}) {
  const h = hue ?? hueOf(id);
  const cells = refs ? undefined : templateCover("photodump", id)?.frames;
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      <span className="grid size-full grid-cols-2 grid-rows-2 gap-0.5">
        {[0, 1, 2, 3].map((i) =>
          refs?.[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={refs[i]} alt="" loading="lazy" className="size-full object-cover" />
          ) : cells?.[i] ? (
            <CoverImg key={i} frame={cells[i]} sizes={bare ? "28px" : "(max-width: 640px) 25vw, 110px"} />
          ) : (
            <DrawnTile key={i} hue={(h + [0, 18, -16, 34][i] + 360) % 360} tone={tone} k={i} className="size-full" />
          ),
        )}
      </span>
      {!bare && (
        <>
          <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <span className="absolute inset-x-2.5 bottom-2.5 text-white">
            <span className="block font-heading text-[19px] leading-tight drop-shadow-sm">{name}</span>
            <span className="text-[11.5px] font-medium opacity-90">{count} photos</span>
          </span>
        </>
      )}
    </span>
  );
}
