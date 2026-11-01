"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Clapperboard, Loader2, MousePointerClick, PenLine, RefreshCw, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { themeFrom } from "@/components/ads/layout";
import { LogoField } from "@/components/brand/brand-kit-form";
import { areaCls, ColorList, inputCls } from "@/components/brand/fields";
import { ImageList } from "@/components/brand/image-list";
import { AddFromLink, priceText, ProductThumb, UploadProductButton } from "@/components/brand/products";
import { SelfHostNote } from "@/components/self-host-note";
import type { SlotValue } from "@/components/studio/media-slot";
import { uploadFile, useLikelyVisitor } from "@/lib/api";
import { AD_STYLES, END_CARD, KIT_LABELS, type BrandKit, type MarketingRun, type Product, type RunEstimate } from "@/lib/catalog/marketing";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { endCardPng, renderEndCard, siteLabel, type EndCardInput } from "./end-card";
import { addRuns, send, useBrand, useEstimate, useProductActions, useProducts, useReadingProduct, useUpdateBrand } from "./hooks";
import type { ModelInfo } from "./model-info";
import { AvatarSlot, VoiceControl } from "./pickers";
import { RunsList } from "./runs";
import { EmptyIcon, MarketingHeader, useMarketingEngine } from "./shell";
import { TemplatePreview } from "./template-preview";

function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-background p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold", done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{done ? <Check className="size-3.5" /> : n}</span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** "Building your product kit": the six labels, stepped while the link is read. */
function KitProgress() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(KIT_LABELS.length - 1, x + 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" className="mt-4 rounded-xl bg-muted/60 p-4">
      <p className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Building your product kit</p>
      <ol className="mt-2 grid gap-1 sm:grid-cols-2">
        {KIT_LABELS.map((l, k) => (
          <li key={l} className={cn("flex items-center gap-2 text-[13px]", k > i && "text-muted-foreground")}>
            {k < i ? <Check className="size-3.5 text-success" /> : k === i ? <Loader2 className="size-3.5 animate-spin text-brand-text" /> : <span className="size-3.5" />}
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}

const styleScene = (presenter: boolean, dark?: boolean) => (presenter ? "selfie" : dark ? "noir" : "orbit");

/** The end card as the ad will end on it, drawn small (the same drawing as the full-size PNG). */
function EndCardPreview({ input, className }: { input: EndCardInput; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    // The logo and fonts load at their own pace: only the latest look is drawn.
    let live = true;
    if (ref.current) void renderEndCard(ref.current, JSON.parse(key) as EndCardInput, 0.3, () => live);
    return () => {
      live = false;
    };
  }, [key]);
  const words = [input.content.brand, input.content.product, input.content.cta].filter(Boolean).join(", ");
  return <canvas ref={ref} role="img" aria-label={`End card preview: ${words}`} className={cn("aspect-[9/16] rounded-lg border bg-muted", className)} />;
}

/**
 * The product kit's logo and colours, kept in the product's brand kit (made from the page when the link
 * was read) so they stay after a reload and reach the video prompts. Edits save to that kit.
 */
function KitBrand({ brand }: { brand: BrandKit }) {
  const update = useUpdateBrand(brand.id);
  const [colors, setColors] = useState(brand.colors);
  const [shown, setShown] = useState(brand.colors);
  if (shown !== brand.colors) {
    setShown(brand.colors);
    setColors(brand.colors);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const save = (patch: Partial<Pick<BrandKit, "logo" | "colors">>) => update.mutate(patch, { onError: (e) => toastError(e) });
  // Colours typed just before leaving the step still get saved.
  useEffect(() => {
    const t = timer;
    const p = pending;
    return () => {
      if (t.current) clearTimeout(t.current);
      p.current?.();
    };
  }, []);
  return (
    <div className="space-y-2.5 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">Logo and colours</p>
        <span className="text-[11px] text-muted-foreground">{update.isPending ? "Saving…" : `In the ${brand.name} brand kit`}</span>
      </div>
      <LogoField value={brand.logo} onChange={(v) => save({ logo: v ?? "" })} />
      <ColorList
        value={colors}
        max={6}
        onChange={(v) => {
          setColors(v);
          if (timer.current) clearTimeout(timer.current);
          pending.current = () => save({ colors: v });
          timer.current = setTimeout(() => {
            pending.current?.();
            pending.current = null;
          }, 500);
        }}
      />
      <p className="text-[11px] text-muted-foreground">Used in the video&apos;s look. Ads Studio and Marketing Studio use this kit too.</p>
    </div>
  );
}

/** Click to Ad: product link → product kit → style → a 9:16 ad of up to 12 s with voiceover and captions. */
export function ClickToAd({ models }: { models: Record<string, ModelInfo> }) {
  const qc = useQueryClient();
  const { engine, setEngine } = useMarketingEngine();
  const products = useProducts();
  const { update } = useProductActions();
  // The link is read by AddFromLink's own mutation: follow it by its key.
  const reading = useReadingProduct();
  const [productId, setProductId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [brandBits, setBrandBits] = useState<{ logo?: string; colors: string[] } | null>(null);
  const [styleId, setStyleId] = useState(AD_STYLES[0].id);
  const [presenter, setPresenter] = useState<boolean | null>(null);
  const [voice, setVoice] = useState<string | undefined>();
  const [sample, setSample] = useState<SlotValue | null>(null);
  const [avatar, setAvatar] = useState<SlotValue | null>(null);
  const [quality, setQuality] = useState<"480p" | "720p">("480p");
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [instructions, setInstructions] = useState("");
  const [script, setScript] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  // A product is saved to the studio's library and an ad doesn't run on an account's own GPU or key yet: a guest or an
  // account is told so up front, and can't add a product or start one.
  const visitor = useLikelyVisitor();
  const resultsRef = useRef<HTMLDivElement>(null);
  const product = products.data?.find((p) => p.id === productId) ?? null;
  const brand = useBrand(product?.brandId).data?.brand;
  const style = AD_STYLES.find((s) => s.id === styleId)!;
  const withPresenter = presenter ?? style.presenter;
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  // The logo end card: on by default when the kit has a logo (null = follow that), with its call to action.
  const [endCardOn, setEndCardOn] = useState<boolean | null>(null);
  const [cta, setCta] = useState<string>(END_CARD.cta);
  const logo = brand?.logo || brandBits?.logo || null;
  const withEndCard = endCardOn ?? !!logo;
  const card = useMemo<EndCardInput>(
    () => ({
      theme: themeFrom(brand ?? (brandBits ? { colors: brandBits.colors } : null)),
      content: { brand: brand?.name ?? "", product: name.trim() || product?.name || "", cta: cta.trim() || undefined, website: siteLabel(brand?.website ?? product?.url) },
      logo,
    }),
    [brand, brandBits, name, product, cta, logo],
  );
  // The drawn card is uploaded once per look (a second Generate with the same card reuses it).
  const uploadedCard = useRef<{ key: string; url: string } | null>(null);
  const cardUrl = async () => {
    const key = JSON.stringify(card);
    if (uploadedCard.current?.key === key) return uploadedCard.current.url;
    const blob = await endCardPng(card);
    const { url } = await uploadFile(new File([blob], "end-card.png", { type: "image/png" }));
    uploadedCard.current = { key, url };
    return url;
  };

  const choose = (p: Product, bits?: { logo?: string; colors: string[] }) => {
    setProductId(p.id);
    setPicked(p.images.slice(0, 3));
    setName(p.name);
    setDesc(p.description ?? "");
    setScript(null);
    if (bits) setBrandBits(bits);
  };
  const saveField = (patch: { name?: string; description?: string }) => {
    if (!product) return;
    if (patch.name !== undefined && !patch.name.trim()) return void toast("Give the product a name");
    update.mutate({ id: product.id, ...patch });
  };
  const body = useMemo(
    () =>
      productId
        ? {
            engine,
            productId,
            styleId,
            images: picked.length ? picked : undefined,
            presenter: withPresenter,
            script: script ?? undefined,
            instructions: mode === "custom" ? instructions || undefined : undefined,
            quality,
            voice,
            voiceSample: sample?.ref,
            avatar: withPresenter ? avatar?.ref : undefined,
            // Priced with a stand-in; the card itself is drawn and uploaded when you generate.
            endCard: withEndCard ? { image: "/api/files/placeholder.png" } : undefined,
          }
        : null,
    [engine, productId, styleId, picked, withPresenter, script, mode, instructions, quality, voice, sample, avatar, withEndCard],
  );
  const est = useEstimate<RunEstimate>("/api/marketing/click-to-ad/estimate", body);
  const blocker = !product ? "Select a product or enter a product URL" : !product.images.length ? `${product.name} has no images` : !desc.trim() ? "Add a description" : est.data?.blocker;
  const cost = est.data && !est.data.blocker ? (visitor && (est.data.demo || est.data.costUsd === 0) ? "Not available here" : est.data.demo ? "Placeholder · free" : est.data.costUsd == null ? "" : `≈ ${formatCost(est.data.costUsd)}`) : "";

  const writeScript = async () => {
    if (!productId) return;
    setWriting(true);
    try {
      const r = await send<{ script: string; by: "llm" | "rules" }>("/api/marketing/script", "POST", { engine, productId, styleId, presenter: withPresenter, instructions: mode === "custom" ? instructions : undefined });
      setScript(r.script);
      if (r.by === "rules") toast("Written from your product's facts — connect Claude or a local model (Ollama, LM Studio or Unsloth Studio) in Settings for livelier scripts", { duration: 4000 });
    } catch (e) {
      toastError(e);
    } finally {
      setWriting(false);
    }
  };
  const generate = async () => {
    if (visitor) return;
    if (blocker) return void toast(blocker, { id: "c2a-blocker" });
    setBusy(true);
    try {
      const endCard = withEndCard ? { image: await cardUrl() } : undefined;
      const r = await send<{ run: MarketingRun; script: string }>("/api/marketing/click-to-ad", "POST", { ...body, endCard });
      addRuns(qc, "click-to-ad", [r.run]);
      setScript(r.script);
      toast.success("Creating your video", { duration: 1600 });
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <MarketingHeader title="Click to Ad" active="click" engine={engine} onEngine={setEngine} selfHostedOnly />
      <div className="mx-auto w-full min-w-0 max-w-[980px] flex-1 space-y-5 px-3 pt-6 pb-20 sm:px-6 sm:pt-10">
        <div className="pb-2 text-center">
          <h2 className="font-heading text-display text-balance">Make a video ad in one click</h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted-foreground">Drop a product link, get a 9:16 ad with voiceover and captions — ready for TikTok, Reels and Shorts. No filming, no editing, no brief.</p>
          {visitor && <SelfHostNote className="mx-auto mt-3 max-w-xl">Click to Ad isn&apos;t available here.</SelfHostNote>}
        </div>

        <Step n={1} title="Your product" hint="Paste the product's own page, or pick one you saved." done={!!product}>
          <AddFromLink limit={1} withBrand placeholder="https://yourshop.com/products/…" onAdded={(ps, extra) => ps[0] && choose(ps[0], extra.brand)} disabled={visitor} />
          {reading && <KitProgress />}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-muted-foreground">Or select your product</p>
              <UploadProductButton variant="ghost" onSaved={(p) => choose(p)} disabled={visitor} />
            </div>
            {products.data?.length ? (
              <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {products.data.map((p) => (
                  <button key={p.id} type="button" onClick={() => choose(p)} aria-pressed={p.id === productId} className={cn("w-28 shrink-0 rounded-xl border p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", p.id === productId && "border-primary bg-brand-faint")}>
                    <ProductThumb product={p} className="aspect-square rounded-lg" />
                    <span className="mt-1 block truncate text-[12px] font-medium">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{priceText(p) || `${p.images.length} picture${p.images.length === 1 ? "" : "s"}`}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">No saved products yet.</p>
            )}
          </div>
        </Step>

        {product && (
          <Step n={2} title="Your product kit" hint="Review the details we extracted — edit anything before generating your video." done={!!desc.trim() && picked.length > 0}>
            <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-3">
                <p className="text-[12px] font-medium text-muted-foreground">{picked.length === 0 ? "Pick at least one image for your video" : picked.length === 1 ? "This image will be used in your video" : `These ${picked.length} images will be used in your video`}</p>
                <ImageList value={picked} onChange={(v) => setPicked(v.slice(0, 5))} max={5} heroLabel="First" size="sm" />
                {product.images.filter((u) => !picked.includes(u)).length > 0 && (
                  <>
                    <p className="text-[12px] text-muted-foreground">Additional images found — tap to use</p>
                    <div className="flex flex-wrap gap-2">
                      {product.images
                        .filter((u) => !picked.includes(u))
                        .map((u) => (
                          <button key={u} type="button" onClick={() => setPicked((p) => [...p, u].slice(0, 5))} className="size-14 overflow-hidden rounded-xl opacity-70 hover:opacity-100" aria-label="Use this image">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" className="size-full object-cover" />
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {brand ? (
                  <KitBrand key={brand.id} brand={brand} />
                ) : (brandBits?.logo || brandBits?.colors.length) ? (
                  // The page's bits while the product's brand kit loads.
                  <div className="flex items-center gap-3 pt-1">
                    {brandBits?.logo && (
                      <div className="checkerboard grid h-10 w-20 place-items-center overflow-hidden rounded-lg border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={brandBits.logo} alt="Logo" className="max-h-full max-w-full object-contain p-1" />
                      </div>
                    )}
                    <div className="flex gap-1">
                      {(brandBits?.colors ?? []).slice(0, 6).map((c) => (
                        <span key={c} className="size-5 rounded-full border" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground">Product name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== product.name && saveField({ name })} className={inputCls} required />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground">Description</span>
                  <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (product.description ?? "") && saveField({ description: desc })} rows={5} className={areaCls} placeholder="What the product is and who it is for" />
                </label>
              </div>
            </div>
          </Step>
        )}

        {product && (
          <Step n={3} title="Choose a style and start" hint="Pick what looks right for your product.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {AD_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === styleId}
                  onClick={() => {
                    setStyleId(s.id);
                    setPresenter(null);
                    setScript(null);
                  }}
                  className={cn("min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", s.id === styleId && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
                >
                  <div className="aspect-[9/14] overflow-hidden rounded-xl">
                    <TemplatePreview id={s.id} look={{ scene: styleScene(s.presenter, s.dark), hue: s.hue, hue2: (s.hue + 35) % 360, dark: s.dark }} video />
                  </div>
                  <p className="mt-1.5 truncate text-[13px] font-medium">{s.name}</p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">{s.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Who&apos;s in it</p>
                  <div role="radiogroup" aria-label="Presenter" className="inline-flex rounded-full bg-muted p-0.5">
                    {[true, false].map((v) => (
                      <button key={String(v)} role="radio" aria-checked={withPresenter === v} onClick={() => (setPresenter(v), setScript(null))} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", withPresenter === v && "bg-background text-foreground shadow-soft")}>
                        {v ? "A presenter" : "Product only"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {withPresenter && <AvatarSlot value={avatar} onChange={setAvatar} />}
                  <VoiceControl engine={engine} models={models} voice={voice} sample={sample} onVoice={setVoice} onSample={setSample} />
                </div>
                <div className="flex items-start gap-3 rounded-xl border p-3">
                  <EndCardPreview input={card} className={cn("w-[72px] shrink-0 transition-opacity", !withEndCard && "opacity-40")} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="c2a-end-card" className="text-[13px] font-medium">
                        End card
                      </label>
                      <Switch id="c2a-end-card" checked={withEndCard} onCheckedChange={setEndCardOn} />
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {withEndCard ? `The ad ends on your ${logo ? "logo" : "brand name"} for ${END_CARD.seconds} s, in your brand colours.` : "The ad ends on its last shot."}
                      {!logo && " Add a logo in the product kit to show it."}
                    </p>
                    {withEndCard && <input value={cta} onChange={(e) => setCta(e.target.value.slice(0, 30))} className={inputCls} aria-label="Call to action on the end card" placeholder="Call to action, e.g. Shop now" />}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Video quality</p>
                  <div role="radiogroup" aria-label="Video quality" className="inline-flex rounded-full bg-muted p-0.5">
                    {(["480p", "720p"] as const).map((q) => (
                      <button key={q} role="radio" aria-checked={quality === q} onClick={() => setQuality(q)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", quality === q && "bg-background text-foreground shadow-soft")}>
                        {q === "480p" ? "Standard" : "High"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div role="radiogroup" aria-label="Script mode" className="inline-flex rounded-full bg-muted p-0.5">
                    {(["auto", "custom"] as const).map((m) => (
                      <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", mode === m && "bg-background text-foreground shadow-soft")}>
                        {m === "auto" ? "Auto-generate" : "Custom script"}
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void writeScript()} disabled={writing}>
                    {writing ? <Loader2 className="animate-spin" /> : script ? <RefreshCw /> : <PenLine />} {script ? "Rewrite" : "Write script"}
                  </Button>
                </div>
                {mode === "custom" && (
                  <textarea value={instructions} onChange={(e) => (setInstructions(e.target.value), setScript(null))} rows={2} className={areaCls} placeholder="Add specific instructions, e.g. highlight eco-friendly materials, mention free shipping" aria-label="Script instructions" />
                )}
                {script !== null ? (
                  <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} className={areaCls} aria-label="Voiceover script" />
                ) : (
                  <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">The voiceover is written when you generate — or press Write script to read and edit it first.</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-4">
              <p className="mr-auto text-[12px] text-muted-foreground">
                9:16 · up to 12 s · voiceover and captions{withEndCard ? ` · ${END_CARD.seconds} s end card` : ""}
                {est.data?.steps.length ? ` · ${est.data.steps.length} steps` : ""}
              </p>
              {cost && <span className="font-mono text-[13px] text-muted-foreground">{cost}</span>}
              <Button size="lg" onClick={() => void generate()} disabled={visitor} aria-disabled={!!blocker || busy} className={cn(blocker && "bg-muted text-muted-foreground hover:bg-muted")} title={blocker}>
                {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate video
              </Button>
            </div>
            {blocker && product && <p className="mt-2 text-right text-[12px] text-muted-foreground">{blocker}</p>}
          </Step>
        )}

        {/* A guest or an account has no video ads here and can't make one (the note at the top says why). */}
        <div ref={resultsRef} className={cn("scroll-mt-28 pt-6", visitor && "hidden")}>
          <h2 className="mb-4 font-heading text-[24px]">Your video ads</h2>
          <RunsList
            feature="click-to-ad"
            empty={
              <div className="rounded-2xl border border-dashed py-12 text-center">
                <EmptyIcon icon={product ? Clapperboard : MousePointerClick} />
                <p className="mt-4 text-[14px] text-muted-foreground">{product ? "Pick a style and press Generate video." : "Start with a product link above."}</p>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
