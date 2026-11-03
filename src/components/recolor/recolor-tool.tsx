"use client";

import { Check, ChevronRight, ImagePlus, Library, Loader2, Palette, Upload, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/faceless/controls";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { FrameStage, type Frame } from "@/components/remove-object/frame-stage";
import { fileToSlot, kindOfFile, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { RunPlaceChip, useOpenRunPlace } from "@/components/studio/run-place-chip";
import { getModel } from "@/lib/catalog";
import { askToSignUp, useAskBeforeUpload, useCreateGeneration, useGenerations, useIsGuest } from "@/lib/api";
import { colourChip, ITEMS, normaliseHex, RECOLOR, recolorRequest, SWATCHES } from "@/lib/catalog/recolor";
import type { GenerationRequest, PixelPoint } from "@/lib/catalog/types";
import { toastError } from "@/lib/refusals";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { RecolorResult } from "./recolor-result";

const SUBTITLE = "Tap the dress, the jacket or the bag, then pick a colour. Folds, texture and shine stay exactly as they are, and nothing else in the photo changes.";
/** A photo anyone can tap before adding their own (a run sends it as the visitor's own upload). */
const EXAMPLE = "/samples/recolor-example.jpg";
const TAP_WORDS = { positive: "recolour", negative: "leave out", ask: "Tap what to recolour", frame: "Your photo" };

/** The picture's own size, read by the browser once it loads (the taps are in its pixels). */
function useFrame(url: string | undefined): Frame | null {
  const [frame, setFrame] = useState<Frame | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setFrame({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return frame && frame.url === url ? frame : null;
}

/** ?image=/api/files/… from a Library result's "Recolor", read once after hydration. */
function useHandoff(take: (s: SlotValue) => void) {
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("image");
    if (url?.startsWith("/api/files/")) take({ ref: url, preview: url, kind: "image", name: decodeURIComponent(url.split("/").pop() ?? "") });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function AddPhoto({ onPick }: { onPick: (v: SlotValue | null) => void }) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const askFirst = useAskBeforeUpload();
  const inputId = useId();
  const take = (f: File | undefined) => {
    if (!f || askFirst()) return;
    if (kindOfFile(f) !== "image") return void toast("Photos only. Drop a picture here.");
    void fileToSlot(f, onPick, "image");
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-10 text-center transition-colors",
        over && "border-primary bg-brand-faint",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{over ? <Upload className="size-5" /> : <ImagePlus className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">Add a photo</p>
        <p className="mt-1 text-[13px] text-muted-foreground">A look, a product, a room: anything with a colour to change</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="lg" className="rounded-full" onClick={() => askFirst() || document.getElementById(inputId)?.click()}>
          <Upload className="size-4" /> Upload
        </Button>
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="lg" className="rounded-full">
              <Library className="size-4" /> From your Library
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
            <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
            {picking && (
              <LibraryGrid
                kinds={["image"]}
                onPick={(v) => {
                  onPick(v);
                  setPicking(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      <button
        type="button"
        onClick={() => onPick({ ref: "", preview: EXAMPLE, kind: "image", name: "recolor-example.jpg" })}
        className="mt-1 flex items-center gap-3 rounded-xl border bg-card p-1.5 pr-4 text-left outline-none transition hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={EXAMPLE} alt="" width={64} height={48} className="h-12 w-16 rounded-lg object-cover" />
        <span>
          <span className="block text-[13px] font-medium">Try it on this photo</span>
          <span className="block text-[12px] text-muted-foreground">Tap the dress, then pick a colour</span>
        </span>
      </button>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Step({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** One round swatch (a toggle): its colour, its name under it, a check when picked. */
function SwatchButton({ hex, label, on, onClick, children }: { hex: string; label: string; on: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className="group flex w-14 flex-col items-center gap-1 rounded-xl py-1 text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn("relative grid size-11 place-items-center rounded-full border border-black/10 shadow-soft transition", on ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "group-hover:scale-105")}
        style={{ background: hex }}
      >
        {on && <Check className="size-4 text-white mix-blend-difference" aria-hidden />}
        {children}
      </span>
      <span className={cn("max-w-full truncate", on && "font-medium text-foreground")}>{label}</span>
    </button>
  );
}

function ColourPicker({ picked, onPicked, custom, onCustom }: { picked: string[]; onPicked: (v: string[]) => void; custom: string; onCustom: (hex: string) => void }) {
  const [text, setText] = useState(custom);
  const pickerId = useId();
  const customOn = picked.includes(custom);
  const toggle = (v: string) => {
    if (picked.includes(v)) return onPicked(picked.filter((x) => x !== v));
    if (picked.length >= RECOLOR.maxColours) return void toast(`Up to ${RECOLOR.maxColours} colours at a time`);
    onPicked([...picked, v]);
  };
  const setCustom = (hex: string) => {
    const h = normaliseHex(hex);
    if (!h) return;
    setText(h);
    // The custom colour stays picked as it changes.
    onPicked(picked.includes(custom) ? picked.map((x) => (x === custom ? h : x)) : picked.length < RECOLOR.maxColours ? [...picked, h] : picked);
    onCustom(h);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-1 gap-y-2" role="group" aria-label="Colours">
        {SWATCHES.map((s) => (
          <SwatchButton key={s.value} hex={s.hex} label={s.label} on={picked.includes(s.value)} onClick={() => toggle(s.value)} />
        ))}
        <SwatchButton hex={custom} label="Custom" on={customOn} onClick={() => (customOn ? toggle(custom) : document.getElementById(pickerId)?.click())}>
          {!customOn && <Palette className="size-4 text-white mix-blend-difference" aria-hidden />}
        </SwatchButton>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={pickerId} className="text-[12px] text-muted-foreground">
          Custom
        </label>
        <input id={pickerId} type="color" value={custom.toLowerCase()} onChange={(e) => setCustom(e.target.value)} className="h-8 w-10 cursor-pointer rounded-md border bg-background p-0.5" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => (normaliseHex(text) ? setCustom(text) : setText(custom))}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Custom colour code"
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          className="h-8 w-24 rounded-md border bg-background px-2 font-mono text-[13px] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {customOn && <span className="truncate text-[12px] text-muted-foreground">{colourChip(custom)?.label}</span>}
      </div>
    </div>
  );
}

/**
 * Tap to Recolor: a photo, taps on the piece to recolour (FrameStage: green adds, grey leaves out), what it is, and up
 * to four colours. Each colour is its own run on the open engine (the taps go as params.points in the photo's pixels);
 * the results stack under it with a press-and-hold before/after.
 */
export function RecolorTool({ app }: { app: { name: string; description: string } }) {
  const [photo, setPhoto] = useState<SlotValue | null>(null);
  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [mark, setMark] = useState<"positive" | "negative">("positive");
  const [item, setItem] = useState("auto");
  const [colours, setColours] = useState<string[]>(["emerald"]);
  const [custom, setCustom] = useState("#C98B93");
  const [sending, setSending] = useState(false);
  const create = useCreateGeneration();
  const askFirst = useAskBeforeUpload();
  const guest = useIsGuest();
  const frame = useFrame(photo?.preview);

  const current = useRef<SlotValue | null>(null);
  const take = useCallback((v: SlotValue | null) => {
    const cur = current.current;
    // An upload settling (the same file, now on the server) keeps the taps; a new photo starts over.
    if (!(v && cur?.uploading && v.name === cur.name)) setPoints([]);
    current.current = v;
    setPhoto(v);
  }, []);
  useHandoff(take);

  const example = photo?.preview === EXAMPLE && !photo.ref;
  const ready = photo && !photo.uploading && (photo.ref || example) ? photo : null;
  const taps = points.filter((p) => p.label !== "negative").length;
  const blocker = !ready ? "Add a photo" : !taps ? "Tap the piece you want in a new colour." : !colours.length ? "Pick a colour" : null;
  // Where it runs and its price, as the studios say it (one run per colour).
  let quoteReq: GenerationRequest | null = null;
  try {
    if (!blocker && ready?.ref && frame) quoteReq = recolorRequest({ image: ready.ref, points, frame, colour: colours[0], item });
  } catch {
    // A colour that can't be read yet: nothing to price.
  }
  const place = useOpenRunPlace([getModel(RECOLOR.modelId)?.name ?? "Qwen Image"], quoteReq, { count: colours.length });
  const runLabel = colours.length > 1 ? `Recolor in ${colours.length} colours` : "Recolor";

  const go = async () => {
    if (blocker || !ready || !frame) return void toast(blocker ?? "Add a photo");
    // The example photo goes up as the visitor's own picture the first time it runs. A guest is asked to sign up for
    // the run itself (they added no file of their own); an account that can't add pictures gets the usual card.
    if (example && guest) return askToSignUp("run");
    if (example && askFirst()) return;
    setSending(true);
    try {
      let image = ready.ref;
      if (!image) {
        const blob = await (await fetch(EXAMPLE)).blob();
        image = (await postFile(new File([blob], "recolor-example.jpg", { type: blob.type || "image/jpeg" }))).url;
        const sent: SlotValue = { ref: image, preview: EXAMPLE, kind: "image", name: "recolor-example.jpg" };
        current.current = sent;
        setPhoto(sent);
      }
      for (const colour of colours) await create.mutateAsync(recolorRequest({ image, points, frame, colour, item }));
      toast.success(colours.length > 1 ? `Recolouring in ${colours.length} colours` : "Recolouring");
      document.getElementById("recolor-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toastError(e, "That didn't start. Please try again.");
    } finally {
      setSending(false);
    }
  };
  const more = (url: string) => {
    take({ ref: url, preview: url, kind: "image", name: "Recolored" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <ToolShell
      title="Apps"
      engineSwitch={false}
      header={
        <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[13px] text-muted-foreground sm:flex">
          <Link href="/apps" className="hover:text-foreground">
            Apps
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">{app.name}</span>
        </nav>
      }
    >
      {!photo && <ToolHero title={app.name} subtitle={SUBTITLE} />}
      {!photo ? (
        <div className="mx-auto mt-6 max-w-[640px]">
          <AddPhoto onPick={take} />
        </div>
      ) : (
        <div className="mx-auto grid max-w-[1040px] gap-3 pt-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <Panel
            title="Tap what to recolour"
            aside={
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove the photo" onClick={() => take(null)}>
                <X className="size-4" />
              </Button>
            }
          >
            {frame ? (
              <FrameStage frame={frame} points={points} onPoints={setPoints} pointLabel={mark} clickable maxPoints={RECOLOR.maxPoints} words={TAP_WORDS} />
            ) : (
              <div className="grid aspect-[4/5] max-h-[46vh] place-items-center rounded-xl bg-media">
                <Loader2 className="size-5 animate-spin text-white/70" />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Segmented
                label="What a tap does"
                value={mark}
                onChange={setMark}
                options={[
                  { value: "positive", label: "Add to it" },
                  { value: "negative", label: "Leave out" },
                ]}
              />
              {points.length > 0 && (
                <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setPoints([])}>
                  Clear
                </Button>
              )}
              <p className="w-full text-[12px] text-muted-foreground" aria-live="polite">
                {photo.uploading ? "Uploading…" : !taps ? "Tap the piece you want in a new colour." : mark === "negative" ? "Tap what should keep its colour." : "Tap again to take in more of it."}
              </p>
            </div>
          </Panel>
          <Panel className="space-y-5">
            <Step title="What is it?">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What is it?">
                {ITEMS.map((i) => (
                  <button
                    key={i.value}
                    type="button"
                    role="radio"
                    aria-checked={item === i.value}
                    onClick={() => setItem(i.value)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-[13px] transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      item === i.value ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </Step>
            <Step title="Colour" hint={`Pick up to ${RECOLOR.maxColours}. Each one is its own photo.`}>
              <ColourPicker picked={colours} onPicked={setColours} custom={custom} onCustom={setCustom} />
            </Step>
            <div className="space-y-2">
              <div className="flex justify-center">
                <RunPlaceChip place={place} />
              </div>
              <Button
                size="lg"
                className="h-11 w-full rounded-full text-[15px]"
                onClick={go}
                disabled={sending || !ready || !frame}
                aria-describedby="recolor-blocker"
                title={place?.send ? `${runLabel} · ${place.send}` : undefined}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Palette className="size-4" />}
                {runLabel}
              </Button>
              {blocker && ready && (
                <p id="recolor-blocker" className="text-center text-[12px] text-muted-foreground" aria-live="polite">
                  {blocker}
                </p>
              )}
            </div>
          </Panel>
        </div>
      )}
      <Results onMore={more} />
    </ToolShell>
  );
}

/** The recolours so far, newest first. */
function Results({ onMore }: { onMore: (url: string) => void }) {
  const runs = useGenerations({ features: [RECOLOR.feature], limit: 24 });
  const items = runs.data ?? [];
  if (!items.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-[1040px]" aria-labelledby="recolor-results">
      <h3 id="recolor-results" className="mb-3 scroll-mt-20 font-heading text-[22px]">
        Your colours
      </h3>
      <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {items.map((g) => (
          <li key={g.id}>
            <RecolorResult g={g} onMore={onMore} />
          </li>
        ))}
      </ul>
    </section>
  );
}
