"use client";

import { Images, Palette as PaletteIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Chip, ClearableChip } from "@/components/studio/chip";
import { ResponsivePanel } from "@/components/studio/responsive-panel";
import { CuratedCover } from "@/components/moodboards/cards";
import { useMoodboards } from "@/components/moodboards/hooks";
import { curatedLook, curatedPick, soulPick, toPick } from "@/components/moodboards/logic";
import { MoodboardPanel } from "@/components/moodboards/moodboard-panel";
import { cardStrip, type Signature } from "@/lib/catalog/palettes";
import type { Engine } from "@/lib/catalog/types";
import { ColorSignaturePanel, toPalettePick } from "./color-signature-panel";
import { usePalettes } from "./hooks";
import { SwatchDot } from "./palette-card";

/**
 * Hand-offs into the Image studio: /image?moodboard=<id> (or curated:<id>) and /image?palette=<id>
 * pick them once, as soon as the lists are known.
 */
function UrlSignature({ onChange }: { onChange: (update: (s: Signature | undefined) => Signature) => void }) {
  const sp = useSearchParams();
  const mb = sp.get("moodboard");
  const pal = sp.get("palette");
  const boards = useMoodboards(!!mb);
  const palettes = usePalettes(!!pal);
  const done = useRef({ mb: false, pal: false });
  useEffect(() => {
    if (mb && !done.current.mb && boards.data) {
      done.current.mb = true;
      const curated = boards.data.curated.find((c) => c.id === mb.replace(/^curated:/, ""));
      const mine = boards.data.items.find((m) => m.id === mb);
      const pick = mine ? toPick(mine) : curated ? curatedPick(curated) : mb.startsWith("curated:") ? soulPick(mb.slice(8)) : undefined;
      if (pick) onChange((s) => ({ ...s, moodboard: pick }));
    }
  }, [mb, boards.data, onChange]);
  useEffect(() => {
    if (pal && !done.current.pal && palettes.items) {
      done.current.pal = true;
      const p = palettes.items.find((x) => x.id === pal);
      if (p) onChange((s) => ({ ...s, palette: toPalettePick(p) }));
    }
  }, [pal, palettes.items, onChange]);
  return null;
}

/**
 * The Image studio's style signature chips: Color signature (a saved palette) and Moodboard. Each
 * opens a popover on desktop and a bottom sheet on phones; the choice lives in the composer's draft.
 */
export default function SignatureChips({
  value,
  onChange,
  engine,
  lockByDefault,
}: {
  value: Signature | undefined;
  onChange: (update: (s: Signature | undefined) => Signature) => void;
  engine: Engine;
  /** The model locks a picked palette unless it's turned off (Fuobe Soul's HEX on the open engine). */
  lockByDefault?: boolean;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const pal = value?.palette;
  const mb = value?.moodboard;
  return (
    <>
      <Suspense fallback={null}>
        <UrlSignature onChange={onChange} />
      </Suspense>
      <ClearableChip active={!!pal} onClear={() => onChange((s) => ({ ...s, palette: undefined }))} clearLabel="Clear color signature">
        <ResponsivePanel
          open={colorOpen}
          onOpenChange={setColorOpen}
          title="Color signature"
          tooltip="Color signature"
          className="w-[min(92vw,440px)]"
          trigger={
            <Chip icon={pal ? undefined : PaletteIcon} active={!!pal} aria-label={pal ? `Color signature: ${pal.name}` : "Color signature"}>
              {pal && <SwatchDot colors={cardStrip(pal)} />}
              <span className="max-w-32 truncate">{pal ? pal.name : "Color"}</span>
            </Chip>
          }
        >
          <ColorSignaturePanel
            value={pal}
            engine={engine}
            lockByDefault={lockByDefault}
            onPick={(p) => {
              onChange((s) => ({ ...s, palette: p }));
              // Toggling the lock keeps the panel open; picking a palette closes it.
              if (!p || p.id !== pal?.id) setColorOpen(false);
            }}
          />
        </ResponsivePanel>
      </ClearableChip>
      <ClearableChip active={!!mb} onClear={() => onChange((s) => ({ ...s, moodboard: undefined }))} clearLabel="Clear moodboard">
        <ResponsivePanel
          open={boardOpen}
          onOpenChange={setBoardOpen}
          title="Moodboard"
          tooltip="Moodboard"
          className="w-[min(92vw,460px)]"
          trigger={
            <Chip icon={mb ? undefined : Images} active={!!mb} aria-label={mb ? `Moodboard: ${mb.name}` : "Moodboard"}>
              {mb &&
                (mb.kind === "curated" ? (
                  <CuratedCover m={{ name: "", ...curatedLook(mb.id) }} className="size-4 rounded-full" sizes="16px" />
                ) : mb.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mb.cover} alt="" className="size-4 rounded-full object-cover" />
                ) : null)}
              <span className="max-w-32 truncate">{mb ? mb.name : "Moodboard"}</span>
            </Chip>
          }
        >
          <MoodboardPanel
            value={mb}
            onPick={(m) => {
              onChange((s) => ({ ...s, moodboard: m }));
              setBoardOpen(false);
            }}
          />
        </ResponsivePanel>
      </ClearableChip>
    </>
  );
}
