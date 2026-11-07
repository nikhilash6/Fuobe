"use client";

import { Check, ImagePlus, Loader2, Package, Sparkle, Upload, UserRound, X, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { chipBase, chipIdle, chipOn } from "@/components/studio/chip";
import { LibraryGrid } from "@/components/studio/media-slot";
import { ResponsivePanel } from "@/components/studio/responsive-panel";
import { VoicePicker } from "@/components/studio/audio-controls";
import type { SlotValue } from "@/components/studio/media-slot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddFromLink, priceText, ProductThumb } from "@/components/brand/products";
import { uploadImages } from "@/components/brand/image-list";
import { useElements } from "@/lib/api";
import { UGC_HOOKS, UGC_SETTINGS, type Product } from "@/lib/catalog/marketing";
import type { ModelDef } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "./model-info";
import { useProducts } from "./hooks";
import { pictureSource, stillLine } from "@/lib/clip-thumb";
import { ClipMark, ElementThumb } from "@/components/element-thumb";
import { useElementPictures } from "@/components/element-picture";
import { UNAVAILABLE_OPTION, UnavailableNote, useUnavailableNote } from "@/components/ui/unavailable";

/** The product a run uses: a saved product, or a one-off photo. */
export interface ProductChoice {
  productId?: string;
  name?: string;
  images: string[];
}

export const productChoice = (p: Product): ProductChoice => ({ productId: p.id, name: p.name, images: p.images });

const tile = "relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** "Add your product": paste a link, upload a photo, or choose a saved product. */
export function ProductSlot({ value, onChange, required, brandId, pulse }: { value: ProductChoice | null; onChange: (v: ProductChoice | null) => void; required?: boolean; brandId?: string | null; pulse?: boolean }) {
  const [open, setOpen] = useState(false);
  const products = useProducts();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = [...(products.data ?? [])].sort((a, b) => Number(b.brandId === brandId) - Number(a.brandId === brandId));
  const choose = (v: ProductChoice) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <div className="relative shrink-0">
      <ResponsivePanel
        open={open}
        onOpenChange={setOpen}
        title="Add your product"
        description="Choose a product image or add a link."
        tooltip={value ? (value.name ?? "Product photo") : `Product${required ? " · Required" : " · Optional"}`}
        trigger={
          <button type="button" data-slot-key="product" className={cn(tile, value ? "bg-muted" : "border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:text-brand-text", pulse && "animate-pulse ring-2 ring-primary")} aria-label={value ? `Product: ${value.name ?? "photo"}. Change product` : "Add product"}>
            {value?.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.images[0]} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-0.5 text-[10px] font-medium">
                <Package className="size-4" />
                Product
              </span>
            )}
          </button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">Paste a link</p>
            <AddFromLink brandId={brandId} limit={1} onAdded={(ps) => ps[0] && choose(productChoice(ps[0]))} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">Upload a photo</p>
            <button type="button" onClick={() => input.current?.click()} className={cn(chipBase, chipIdle)}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload a photo
            </button>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (e) => {
                const f = [...(e.target.files ?? [])];
                e.target.value = "";
                if (!f.length) return;
                setBusy(true);
                const urls = await uploadImages(f);
                setBusy(false);
                if (urls.length) choose({ images: urls, name: f[0].name.replace(/\.\w+$/, "") });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">Your products</p>
            {products.isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : list.length ? (
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {list.map((p) => (
                  <button key={p.id} type="button" disabled={!p.images.length} onClick={() => choose(productChoice(p))} className={cn("min-w-0 rounded-lg p-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", value?.productId === p.id && "bg-brand-faint")} title={p.images.length ? p.name : `${p.name} has no images`}>
                    <ProductThumb product={p} className="aspect-square rounded-md" />
                    <span className="mt-1 block truncate text-[11px] font-medium">{p.name}</span>
                    {priceText(p) && <span className="block truncate text-[10px] text-muted-foreground">{priceText(p)}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No products yet — paste a link above, or add them in Ads Studio.</p>
            )}
          </div>
        </div>
      </ResponsivePanel>
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="Remove product" className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-soft hover:text-foreground">
          <X className="size-3" />
        </button>
      )}
      {required && !value && <span className="pointer-events-none absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-background px-1 text-[9px] font-semibold text-brand-text">Required</span>}
    </div>
  );
}

/** "Choose avatar": one of your characters (Elements), a photo, or your library. */
export function AvatarSlot({ value, onChange, pulse }: { value: SlotValue | null; onChange: (v: SlotValue | null) => void; pulse?: boolean }) {
  const [open, setOpen] = useState(false);
  const elements = useElements();
  // Every character with a photo or a clip: one with only a clip gives a still of it (made when picked).
  const people = (elements.data ?? []).filter((e) => e.kind === "character" && pictureSource(e.references));
  const pics = useElementPictures(people);
  const note = useUnavailableNote(people.map((e) => ({ value: e.id, unavailable: pics.unavailable(e) })));
  // The character whose clip's still is the avatar (said under the characters and on the slot).
  const [still, setStill] = useState<{ ref: string; id: string; name: string } | null>(null);
  const usingStill = still && value?.ref === still.ref ? still : null;
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const choose = (v: SlotValue) => {
    onChange(v);
    setOpen(false);
  };
  const pickPerson = async (e: (typeof people)[number]) => {
    const p = await pics.pick(e);
    if (p === "unreadable") return note.press({ value: e.id, unavailable: pics.reasonFor(e) }, () => {});
    if (!p) return;
    setStill(p.still ? { ref: p.url, id: e.id, name: e.name } : null);
    choose({ ref: p.url, preview: p.url, kind: "image", name: e.name });
  };
  return (
    <div className="relative shrink-0">
      <ResponsivePanel
        open={open}
        onOpenChange={setOpen}
        title="Choose avatar"
        description="Who presents or wears the product. Leave it empty and a model is made for you."
        tooltip={value ? (usingStill ? stillLine(usingStill.name) : (value.name ?? "Avatar")) : "Avatar · Optional"}
        trigger={
          <button type="button" data-slot-key="avatar" className={cn(tile, value ? "bg-muted" : "border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:text-brand-text", pulse && "animate-pulse ring-2 ring-primary")} aria-label={value ? `Avatar: ${usingStill ? stillLine(usingStill.name) : (value.name ?? "photo")}. Replace avatar` : "Add avatar"}>
            {value ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={value.preview} alt="" className="size-full object-cover" />
                {usingStill && <ClipMark size="xs" className="absolute right-1 bottom-1" />}
              </>
            ) : (
              <span className="flex flex-col items-center gap-0.5 text-[10px] font-medium">
                <UserRound className="size-4" />
                Avatar
              </span>
            )}
          </button>
        }
      >
        <div className="space-y-4">
          <button type="button" onClick={() => input.current?.click()} className={cn(chipBase, chipIdle)}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} Upload a photo
          </button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(true);
              const [url] = await uploadImages([f]);
              setBusy(false);
              if (url) choose({ ref: url, preview: url, kind: "image", name: f.name });
            }}
          />
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">Your characters</p>
            {people.length ? (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {people.map((e) => {
                    const src = pictureSource(e.references)!;
                    const photo = "photo" in src ? src.photo : undefined;
                    const opt = { value: e.id, unavailable: pics.unavailable(e) };
                    const off = note.isUnavailable(opt);
                    const on = !off && (photo ? value?.ref === photo : usingStill?.id === e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => note.press(opt, () => void pickPerson(e))}
                        {...note.optionProps(opt)}
                        aria-busy={pics.busy === e.id || undefined}
                        className={cn("min-w-0 rounded-lg p-1", !off && "hover:bg-accent", on && "bg-brand-faint", off && UNAVAILABLE_OPTION)}
                      >
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt="" className="aspect-square w-full rounded-md object-cover" />
                        ) : (
                          <span className="relative block">
                            <ElementThumb src={"clip" in src ? src.clip : ""} mark="small" className="aspect-square w-full rounded-md object-cover" />
                            {pics.busy === e.id && (
                              <span className="absolute inset-0 grid place-items-center rounded-md bg-background/60">
                                <Loader2 className="size-4 animate-spin" />
                              </span>
                            )}
                          </span>
                        )}
                        <span className="mt-1 block truncate text-[11px]">{e.name}</span>
                      </button>
                    );
                  })}
                </div>
                <UnavailableNote {...note.noteProps} />
                {usingStill && <p className="text-[12px] text-muted-foreground">{stillLine(usingStill.name)}</p>}
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Save people you reuse as characters in Elements.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground">From your library</p>
            {open && <LibraryGrid kinds={["image"]} onPick={choose} />}
          </div>
        </div>
      </ResponsivePanel>
      {pics.dialog}
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="Remove avatar" className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-soft hover:text-foreground">
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function ListPicker<T extends { id: string; name: string; type: string; prompt: string }>({
  label,
  icon: Icon,
  items,
  value,
  onChange,
  noneLabel,
  groups,
}: {
  label: string;
  icon: typeof Zap;
  items: T[];
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel: string;
  groups: { type: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const current = items.find((i) => i.id === value);
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title={`See all ${label.toLowerCase()}s`}
      trigger={
        <button type="button" className={cn(chipBase, current ? chipOn : chipIdle)} aria-label={current ? `${label}: ${current.name}` : `${label}: none`}>
          <Icon className="size-3.5" />
          {current ? current.name : `No ${label.toLowerCase()}`}
        </button>
      }
    >
      <div className="space-y-3">
        <button type="button" onClick={() => (onChange(null), setOpen(false))} className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-accent", !value && "bg-brand-faint text-brand-text")}>
          {noneLabel} {!value && <Check className="size-3.5" />}
        </button>
        {groups.map((g) => (
          <div key={g.type}>
            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.title}</p>
            {items
              .filter((i) => i.type === g.type)
              .map((i) => (
                <button key={i.id} type="button" onClick={() => (onChange(i.id), setOpen(false))} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent", i.id === value && "bg-brand-faint")}>
                  <span className={cn("flex items-center justify-between text-[13px] font-medium", i.id === value && "text-brand-text")}>
                    {i.name} {i.id === value && <Check className="size-3.5" />}
                  </span>
                  <span className="line-clamp-2 text-[12px] text-muted-foreground">{i.prompt}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </ResponsivePanel>
  );
}

export const HookPicker = ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
  <ListPicker label="Hook" icon={Zap} items={UGC_HOOKS} value={value} onChange={onChange} noneLabel="No hook" groups={[{ type: "stunt", title: "Stunts" }, { type: "subtle", title: "Subtle" }]} />
);

export const SettingPicker = ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
  <ListPicker label="Setting" icon={Sparkle} items={UGC_SETTINGS} value={value} onChange={onChange} noneLabel="No setting" groups={[{ type: "realistic", title: "Realistic" }, { type: "unrealistic", title: "Unrealistic" }]} />
);

/** The voiceover: a premade cloud voice, or (open source) a sample to clone. */
export function VoiceControl({ engine, models, voice, sample, onVoice, onSample }: { engine: "cloud" | "open"; models: Record<string, ModelInfo>; voice?: string; sample: SlotValue | null; onVoice: (id?: string) => void; onSample: (v: SlotValue | null) => void }) {
  const info = models[engine === "open" ? "oss-chatterbox" : "elevenlabs-v4"];
  if (!info) return null;
  const model = { id: info.id, name: info.name, options: { voices: info.voices, voiceClone: engine === "open" ? true : info.voiceClone } } as unknown as ModelDef;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <VoicePicker
            model={model}
            voice={voice}
            sample={sample}
            label="Voice"
            onChange={(c) => {
              if (!c) return;
              if (c.kind === "preset") {
                onVoice(c.id);
                onSample(null);
              } else onSample(c.value);
            }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{engine === "open" ? "Open-source voices are cloned from a short sample (Chatterbox)" : `Voiceover by ${info.name}`}</TooltipContent>
    </Tooltip>
  );
}

export function requireToast(msg: string) {
  toast(msg, { id: "marketing-blocker" });
}
