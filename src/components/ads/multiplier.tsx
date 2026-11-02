"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, FileVideo, ImagePlus, Library, Loader2, Minus, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { areaCls } from "@/components/brand/fields";
import { uploadImages } from "@/components/brand/image-list";
import { ExampleRow } from "@/components/studio/example-row";
import { fileToSlot, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { VideoTrimmer } from "@/components/studio/video-trimmer";
import { initialClip, mentionedImages, MULTIPLIER, MULTIPLIER_MODELS, multiplierResolution, type ClipRange as Range, type MarketingRun, type RunEstimate } from "@/lib/catalog/marketing";
import { formatCost } from "@/lib/format";
import { probeBlob, probeUrl } from "@/lib/media-probe";
import { useAskBeforeUpload, useModelAccess } from "@/lib/api";
import { keepOffered, offered } from "@/lib/model-access";
import type { StudioExampleRow } from "@/lib/studio-examples";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { addRuns, send, useEstimate } from "@/components/marketing/hooks";
import type { ModelInfo } from "@/components/marketing/model-info";
import { RunsList } from "@/components/marketing/runs";
import { EmptyIcon, MarketingHeader, useMarketingEngine } from "@/components/marketing/shell";
import { uploadFrame } from "./frames";

type Quality = (typeof MULTIPLIER.qualities)[number];

const Seg = <T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-muted p-0.5">
    {options.map((o) => (
      <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.title} onClick={() => onChange(o.id)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", value === o.id && "bg-background text-foreground shadow-soft")}>
        {o.label}
      </button>
    ))}
  </div>
);

/** The reference ad: drop, upload or pick a clip (4–30 s). */
function ReferenceDrop({ onFile, onPick }: { onFile: (f: File) => void; onPick: (v: SlotValue) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [lib, setLib] = useState(false);
  // A guest, or an account with neither its own GPU nor its own key, gets its card instead of the file chooser.
  const askFirst = useAskBeforeUpload();
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !askFirst()) onFile(f);
      }}
      className={cn("flex aspect-[4/3] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border-strong p-6 text-center transition-colors sm:aspect-video", over && "border-primary bg-brand-faint")}
    >
      <EmptyIcon icon={FileVideo} />
      <p className="mt-4 text-[15px] font-medium">Upload the ad you want more of</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        MP4, MOV or WebM · {MULTIPLIER.minSeconds}–{MULTIPLIER.maxSeconds} seconds (longer? trim it first)
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={() => askFirst() || input.current?.click()}>
          <Upload /> Upload video
        </Button>
        <Popover open={lib} onOpenChange={setLib}>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <Library /> From library
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" collisionPadding={12}>
            <p className="px-1 pb-2 text-[13px] font-medium">Your videos</p>
            {lib && <LibraryGrid kinds={["video"]} onPick={(v) => (onPick(v), setLib(false))} />}
          </PopoverContent>
        </Popover>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Up to 20 pictures, each named @image_N; tap one to mention it in the prompt. */
function MentionImages({ value, onChange, onMention, max }: { value: string[]; onChange: (v: string[]) => void; onMention?: (n: number) => void; max: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [lib, setLib] = useState(false);
  // A guest, or an account with neither its own GPU nor its own key, gets its card instead of the file chooser.
  const askFirst = useAskBeforeUpload();
  const add = async (files: File[]) => {
    if (!files.length || askFirst()) return;
    const room = max - value.length;
    if (room <= 0) return void toast(`Up to ${max} images`);
    setBusy(Math.min(room, files.length));
    const urls = await uploadImages(files.slice(0, room));
    setBusy(0);
    if (urls.length) onChange([...value, ...urls].slice(0, max));
  };
  return (
    <div
      className="flex flex-wrap gap-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add([...e.dataTransfer.files]);
      }}
    >
      {value.map((src, i) => (
        <div key={src} className="group/img relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
          <button type="button" onClick={() => onMention?.(i + 1)} disabled={!onMention} className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={onMention ? `Mention @image_${i + 1} in the prompt` : `Image ${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center font-mono text-[10px] text-white">@image_{i + 1}</span>
          </button>
          <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => onChange(value.filter((x) => x !== src))} className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100">
            <X className="size-3" />
          </button>
        </div>
      ))}
      {Array.from({ length: busy }, (_, i) => (
        <div key={`b${i}`} className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ))}
      {value.length + busy < max && (
        <div className="relative flex size-16 shrink-0 flex-col overflow-hidden rounded-xl border border-dashed border-border-strong">
          <button type="button" onClick={() => askFirst() || input.current?.click()} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground hover:bg-brand-faint hover:text-brand-text" aria-label="Add images">
            <ImagePlus className="size-4" />
            Add
          </button>
          <Popover open={lib} onOpenChange={setLib}>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-5 items-center justify-center border-t border-dashed border-border-strong text-muted-foreground hover:bg-brand-faint hover:text-brand-text" aria-label="Choose images from your library">
                <Library className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="start" collisionPadding={12}>
              <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
              {lib && (
                <LibraryGrid
                  kinds={["image"]}
                  onPick={(v) => {
                    if (!value.includes(v.ref)) onChange([...value, v.ref].slice(0, max));
                    setLib(false);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Ad Multiplier: a reference ad (4–30 s) → new versions: recreated from a prompt, or with a new hook / CTA.
 * examples: "See what it makes" (studioExamples("ads"), from the page), under the empty list of versions.
 */
export function AdMultiplier({ models, examples }: { models: Record<string, ModelInfo>; examples?: StudioExampleRow }) {
  const qc = useQueryClient();
  const { engine, setEngine } = useMarketingEngine();
  const access = useModelAccess();
  const [video, setVideo] = useState<SlotValue | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [hookOn, setHookOn] = useState(false);
  const [ctaOn, setCtaOn] = useState(false);
  const [hook, setHook] = useState("");
  const [cta, setCta] = useState("");
  const [quality, setQuality] = useState<Quality>("720p");
  const [picked, setPicked] = useState<string | null>(null);
  const [versions, setVersions] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const sections = hookOn || ctaOn;
  // Models switched off in Settings → Models & licences leave the menu, and the pick falls back to one that is on.
  const choices = useMemo(() => keepOffered(MULTIPLIER_MODELS[engine], (c) => offered(access, c.id, engine)), [access, engine]);
  const modelId = picked && choices.some((c) => c.id === picked) ? picked : choices[0].id;
  const model = models[modelId];
  const maxImages = engine === "open" ? 1 : (model?.maxImages ?? 0);
  const cut = range ?? (duration ? initialClip(duration) : null);
  const length = cut ? cut.end - cut.start : 0;
  const ready = !!video && !video.uploading && !!video.ref && duration != null && !!cut;

  // Which reference is current (a late answer about an older clip is ignored), whether its length is
  // known, and whether its header has been read already (once per clip).
  const clip = useRef(0);
  const known = useRef(false);
  const probed = useRef(0);
  /** A new reference (a library pick, or an upload that reports its preview first, then its server URL). */
  const startVideo = () => {
    clip.current += 1;
    known.current = false;
    setDuration(null);
    setRange(null);
    return clip.current;
  };
  /**
   * The length from the file's own header, for clips this browser can't play (e.g. H.264 without the
   * codec): the dropped file itself, else the server's copy with Range requests (only its header and
   * moov box are read, never the whole clip). Unknown containers: the player is the only other source.
   */
  const probe = async (source: Blob | string, token: number) => {
    if (probed.current === token) return;
    probed.current = token;
    const d = (typeof source === "string" ? await probeUrl(source) : await probeBlob(source))?.duration;
    if (d && token === clip.current && !known.current) onDuration(d);
  };
  const onFile = (f: File) => {
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(f.name)) return void toast("Video only — drop a clip here");
    const token = startVideo();
    void fileToSlot(f, setVideo, "video");
    void probe(f, token);
  };
  const onDuration = (d: number) => {
    const first = !known.current;
    known.current = true;
    setDuration(d);
    setRange((r) => r ?? initialClip(d));
    if (!first) return;
    if (d > MULTIPLIER.maxSeconds + 0.05) toast(`Using the first ${MULTIPLIER.maxSeconds} s — slide the selection to pick another part`, { id: "mult-trim" });
    if (d < MULTIPLIER.minSeconds - 0.05) toast.error(`That clip is ${d.toFixed(1)} s — the reference needs ${MULTIPLIER.minSeconds}–${MULTIPLIER.maxSeconds} s`, { id: "mult-trim" });
  };

  const body = useMemo(() => {
    if (!ready || !video || !cut || duration == null) return null;
    return {
      engine,
      video: video.ref,
      duration,
      start: cut.start,
      end: cut.end,
      images: images.length ? images : undefined,
      mode: sections ? "sections" : "prompt",
      prompt: sections ? undefined : prompt.trim() || undefined,
      hook: hookOn ? hook : null,
      cta: ctaOn ? cta : null,
      quality,
      modelId: sections ? undefined : modelId,
      versions,
    };
  }, [ready, video, cut, duration, engine, images, sections, prompt, hookOn, hook, ctaOn, cta, quality, modelId, versions]);
  // Prices are quoted as if the in/out frames were read here (they're grabbed when you press Generate).
  const estBody = useMemo(() => (body && sections ? { ...body, firstFrame: hookOn ? body.video : undefined, lastFrame: ctaOn ? body.video : undefined } : body), [body, sections, hookOn, ctaOn]);
  const est = useEstimate<RunEstimate>("/api/ads/multiplier/estimate", estBody);
  const blocker = !video ? "Upload a reference video" : video.uploading ? "Uploading the video…" : duration == null ? "Reading the video…" : length < MULTIPLIER.minSeconds - 0.05 || length > MULTIPLIER.maxSeconds + 0.05 ? "Video duration: 4-30 seconds" : est.data?.blocker;
  const cost = est.data && !est.data.blocker ? (est.data.demo ? "Placeholder · free" : est.data.costUsd == null ? "" : `≈ ${formatCost(est.data.costUsd)}`) : "";

  const mention = (n: number) => {
    const tag = `@image_${n}`;
    const el = box.current;
    const at = el?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, at);
    const after = prompt.slice(el?.selectionEnd ?? at);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${tag} ${after}`.slice(0, MULTIPLIER.maxChars);
    setPrompt(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (before + pad + tag + " ").length;
      el?.setSelectionRange(pos, pos);
    });
  };
  const used = mentionedImages(prompt).filter((n) => n <= images.length);
  const missing = mentionedImages(prompt).filter((n) => n > images.length);

  const generate = async () => {
    if (blocker || !body || !video || !cut) return void toast(blocker ?? "Upload a reference video", { id: "mult-blocker" });
    setBusy(sections ? "Reading the frames…" : "Starting…");
    try {
      const firstFrame = sections && hookOn ? await uploadFrame(video.ref, cut.start + 0.04, "hook-frame") : undefined;
      const lastFrame = sections && ctaOn ? await uploadFrame(video.ref, cut.end - 0.08, "cta-frame") : undefined;
      setBusy("Starting…");
      const r = await send<{ runs: MarketingRun[] }>("/api/ads/multiplier", "POST", { ...body, firstFrame, lastFrame });
      addRuns(qc, "ad-multiplier", r.runs);
      toast.success(r.runs.length > 1 ? `Making ${r.runs.length} versions` : "Making your new version", { duration: 1600 });
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <MarketingHeader title="Ad Multiplier" active="multiplier" engine={engine} onEngine={setEngine} />
      <div className="mx-auto w-full min-w-0 max-w-[1180px] flex-1 px-3 pt-6 pb-20 sm:px-6 sm:pt-10">
        <div className="pb-6 text-center">
          <h2 className="font-heading text-display text-balance">Turn one winning ad into many</h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted-foreground">Upload an ad that works. Recreate it with new people, products or places — or keep it and try a new hook or call to action.</p>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section className="min-w-0 rounded-2xl border bg-background p-4 sm:p-5" aria-label="Reference ad">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold">Reference ad</h3>
              {video && (
                <Button variant="ghost" size="sm" onClick={() => (setVideo(null), startVideo())}>
                  <RefreshCw /> Replace
                </Button>
              )}
            </div>
            {!video ? (
              <ReferenceDrop onFile={onFile} onPick={(v) => (startVideo(), setVideo(v))} />
            ) : (
              <div className="relative">
                {/* A new reference mounts a new trimmer (Replace goes back to the drop zone); a finished upload only moves its preview to the server. */}
                <VideoTrimmer
                  src={video.preview}
                  value={range && { startTime: range.start, endTime: range.end }}
                  onChange={(r) => setRange({ start: r.startTime, end: r.endTime })}
                  min={MULTIPLIER.minSeconds}
                  max={MULTIPLIER.maxSeconds}
                  duration={duration ?? undefined}
                  label="Part of the reference ad"
                  onMeta={(m) => m.duration > 0 && onDuration(m.duration)}
                  onUnreadable={() => {
                    if (!known.current) void probe(video.ref || video.preview, clip.current);
                  }}
                />
                {video.uploading && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Uploading…
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="min-w-0 space-y-5 rounded-2xl border bg-background p-4 sm:p-5" aria-label="What to change">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold">Images</h3>
                <span className="text-[12px] text-muted-foreground">
                  {images.length}/{MULTIPLIER.maxImages}
                </span>
              </div>
              <MentionImages value={images} onChange={setImages} onMention={sections ? undefined : mention} max={MULTIPLIER.maxImages} />
              <p className="mt-2 text-[12px] text-muted-foreground">
                {sections
                  ? "Used when the clip's own frames can't be read."
                  : engine === "open"
                    ? "The first image you @mention takes over the performance."
                    : maxImages
                      ? `People, products or places to swap in. Tap one to mention it — ${model?.name ?? "this model"} uses up to ${maxImages}.`
                      : `${model?.name ?? "This model"} edits from the prompt alone — pick Kling O3 to use your images.`}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <Switch checked={hookOn} onCheckedChange={setHookOn} aria-label="Change hook" /> Change hook
                </label>
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <Switch checked={ctaOn} onCheckedChange={setCtaOn} aria-label="Change CTA" /> Change CTA
                </label>
              </div>
              {sections ? (
                <div className="space-y-2.5">
                  {hookOn && (
                    <label className="block space-y-1">
                      <span className="text-[12px] font-medium text-muted-foreground">New opening line (optional)</span>
                      <textarea value={hook} onChange={(e) => setHook(e.target.value.slice(0, MULTIPLIER.maxChars))} rows={2} className={areaCls} placeholder="Stop scrolling — this changed my mornings" />
                    </label>
                  )}
                  {ctaOn && (
                    <label className="block space-y-1">
                      <span className="text-[12px] font-medium text-muted-foreground">New call to action (optional)</span>
                      <textarea value={cta} onChange={(e) => setCta(e.target.value.slice(0, MULTIPLIER.maxChars))} rows={2} className={areaCls} placeholder="Tap the link and get 20% off today" />
                    </label>
                  )}
                  <p className="text-[12px] text-muted-foreground">A new clip is made from the {hookOn && ctaOn ? "first and last frames" : hookOn ? "first frame" : "last frame"} and joined {hookOn && ctaOn ? "around" : hookOn ? "before" : "after"} your ad. The prompt is off while these are on.</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="mult-prompt" className="mb-1 block text-[12px] font-medium text-muted-foreground">
                    Prompt
                  </label>
                  <textarea
                    id="mult-prompt"
                    ref={box}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, MULTIPLIER.maxChars))}
                    rows={4}
                    className={areaCls}
                    placeholder={`${MULTIPLIER.defaultPrompt} Or: swap the presenter for @image_1 and set it in a sunny kitchen.`}
                  />
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{missing.length ? <span className="text-destructive">No image {missing.map((n) => `@image_${n}`).join(", ")} — add it or remove the mention</span> : used.length ? `Mentions: ${used.map((n) => `@image_${n}`).join(", ")}` : "Leave it empty to recreate the ad as it is."}</span>
                    <span className="font-mono tabular-nums">
                      {prompt.length}/{MULTIPLIER.maxChars}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {!sections && (
                <div className="min-w-0">
                  <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Model</p>
                  <Select value={modelId} onValueChange={setPicked}>
                    <SelectTrigger className="h-9 w-full" aria-label="Model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {models[c.id]?.name ?? c.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{choices.find((c) => c.id === modelId)?.note}</p>
                </div>
              )}
              <div className="min-w-0">
                <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Quality</p>
                <Seg
                  label="Quality"
                  value={quality}
                  onChange={setQuality}
                  options={MULTIPLIER.qualities.map((q) => ({ id: q, label: q, title: engine === "open" && q === "1080p" ? "Made at 720p here" : undefined }))}
                />
                {engine === "open" && quality === "1080p" && <p className="mt-1 text-[11px] text-muted-foreground">Made at {multiplierResolution(quality, engine)} on open-source models</p>}
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Versions</p>
                <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5" role="group" aria-label="Versions">
                  <button type="button" onClick={() => setVersions((v) => Math.max(1, v - 1))} disabled={versions <= 1} className="grid size-7 place-items-center rounded-full hover:bg-background disabled:opacity-40" aria-label="Fewer versions">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-6 text-center font-mono text-[13px] tabular-nums" aria-live="polite">
                    {versions}
                  </span>
                  <button type="button" onClick={() => setVersions((v) => Math.min(4, v + 1))} disabled={versions >= 4} className="grid size-7 place-items-center rounded-full hover:bg-background disabled:opacity-40" aria-label="More versions">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {est.data?.notes.length ? (
              <ul className="space-y-1 rounded-xl bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
                {est.data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
              <p className="mr-auto text-[12px] text-muted-foreground">{est.data?.steps.length ? est.data.steps.map((s) => s.label).join(" → ") : "New versions keep the reference's length and framing"}</p>
              {cost && <span className="font-mono text-[13px] text-muted-foreground">{cost}</span>}
              <Button size="lg" onClick={() => void generate()} aria-disabled={!!blocker || !!busy} className={cn(blocker && "bg-muted text-muted-foreground hover:bg-muted")} title={blocker}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ?? (versions > 1 ? `Generate ${versions} versions` : "Generate")}
              </Button>
            </div>
            {blocker && video && <p className="-mt-3 text-right text-[12px] text-muted-foreground">{blocker}</p>}
          </section>
        </div>

        <div ref={resultsRef} className="scroll-mt-28 pt-10">
          <h2 className="mb-4 font-heading text-[24px]">Your versions</h2>
          <RunsList
            feature="ad-multiplier"
            empty={
              <>
                <div className="rounded-2xl border border-dashed py-12 text-center">
                  <EmptyIcon icon={Copy} />
                  <p className="mt-4 text-[14px] text-muted-foreground">{video ? "Pick what to change and press Generate." : "Start with an ad that already works."}</p>
                </div>
                {examples && <ExampleRow row={examples} className="mt-10" />}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
