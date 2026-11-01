"use client";

import { Check, Link2, Loader2, MoreHorizontal, Package, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MAX_SELLING_POINTS, type Product } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";
import { refusalShown, toastError } from "@/lib/refusals";
import { normalizeWebsite } from "@/lib/website";
import { useProductActions, type ProductInput } from "@/components/marketing/hooks";
import { areaCls, FieldRow, inputCls, TagInput } from "./fields";
import { ImageList } from "./image-list";

export const priceText = (p: Pick<Product, "price" | "currency">) =>
  p.price == null ? "" : `${p.currency && p.currency.length === 3 && p.currency !== "USD" ? `${p.currency} ` : "$"}${p.price % 1 ? p.price.toFixed(2) : p.price}`;

/** Add (or edit) a product: name required; up to five selling points; pictures. */
export function ProductDialog({ open, onOpenChange, brandId, product, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; brandId?: string | null; product?: Product | null; onSaved?: (p: Product) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {/* The form mounts with the dialog, so every opening starts from the product as saved. */}
        <ProductForm key={product?.id ?? "new"} onOpenChange={onOpenChange} brandId={brandId} product={product} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

const BLANK_PRODUCT: ProductInput = { name: "", description: "", audience: "", sellingPoints: [], images: [], url: "", price: null };

function ProductForm({ onOpenChange, brandId, product, onSaved }: { onOpenChange: (o: boolean) => void; brandId?: string | null; product?: Product | null; onSaved?: (p: Product) => void }) {
  const { create, update } = useProductActions();
  const id = useId();
  const [draft, setDraft] = useState<ProductInput>(() => (product ? { ...product } : BLANK_PRODUCT));
  const [priceText_, setPriceText] = useState(() => (product?.price != null ? String(product.price) : ""));
  const [dup, setDup] = useState<string | null>(null);
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const price = priceText_.trim() ? Number(priceText_.replace(",", ".")) : null;
  const priceError = price != null && (!Number.isFinite(price) || price < 0) ? "Price cannot be negative." : null;
  const busy = create.isPending || update.isPending;
  const save = (force = false) => {
    if (!draft.name?.trim()) return void toast("Give the product a name");
    if (priceError) return void toast(priceError);
    const body = { ...draft, name: draft.name.trim(), price, brandId: product ? draft.brandId : (brandId ?? null) };
    const done = (p: Product) => {
      toast.success(product ? "Saved" : "Product added", { duration: 1500 });
      onSaved?.(p);
      onOpenChange(false);
    };
    if (product) update.mutate({ ...body, id: product.id }, { onSuccess: done, onError: (e) => toastError(e) });
    else
      create.mutate(
        { ...body, force },
        {
          onSuccess: done,
          onError: (e) => ((e as { status?: number }).status === 409 ? setDup((e as Error).message) : toastError(e)),
        },
      );
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{product ? "Edit product" : "Upload product"}</DialogTitle>
        <DialogDescription>Products are shared by Marketing Studio, Ads Studio and Click to Ad.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <FieldRow label="Pictures" hint="The first picture is the one models see first.">
          <ImageList value={draft.images ?? []} onChange={(v) => set("images", v)} heroLabel="Main" />
        </FieldRow>
        <FieldRow label="Product name" htmlFor={`${id}-n`}>
          <input id={`${id}-n`} value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Acme Product" className={inputCls} required aria-required />
        </FieldRow>
        <FieldRow label="Description" htmlFor={`${id}-d`}>
          <textarea id={`${id}-d`} value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="What the product is and who it is for" rows={3} className={areaCls} />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <FieldRow label="Price" htmlFor={`${id}-p`}>
            <input id={`${id}-p`} inputMode="decimal" value={priceText_} onChange={(e) => setPriceText(e.target.value)} placeholder="29.90" aria-invalid={!!priceError} className={inputCls} />
            {priceError && <p className="text-[11px] text-destructive">{priceError}</p>}
          </FieldRow>
          <FieldRow label="Link" htmlFor={`${id}-u`}>
            <input id={`${id}-u`} value={draft.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://yourshop.com/products/…" className={inputCls} />
          </FieldRow>
        </div>
        <FieldRow label="Audience" htmlFor={`${id}-a`}>
          <input id={`${id}-a`} value={draft.audience ?? ""} onChange={(e) => set("audience", e.target.value)} placeholder="People 30+ with dry, sensitive skin who avoid retinol" className={inputCls} />
        </FieldRow>
        <FieldRow label="Selling points" hint="Add up to five selling points.">
          <TagInput label="Selling points" value={draft.sellingPoints ?? []} onChange={(v) => set("sellingPoints", v)} max={MAX_SELLING_POINTS} placeholder="e.g. Keeps drinks cold for 24 hours" />
        </FieldRow>
        {dup && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-highlight/20 px-3 py-2 text-[13px]">
            <span>{dup}</span>
            <Button size="sm" variant="outline" onClick={() => save(true)}>
              Create anyway
            </Button>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => save()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {product ? "Save" : "Add product"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Refusals that say what this visitor can't do here (a tool, the owner's library, a GPU first): not worth a retry. */
const REFUSED = new Set(["own-gpu-tool", "library", "connect-gpu"]);

/** "Add product from link": reads the page, adds what it finds. disabled: a visitor, who can't save a product here. */
export function AddFromLink({
  brandId,
  onAdded,
  limit = 3,
  withBrand,
  className,
  placeholder = "Paste a product link",
  disabled,
}: {
  brandId?: string | null;
  onAdded?: (ps: Product[], extra: { brand?: { logo?: string; colors: string[]; name?: string } }) => void;
  limit?: number;
  withBrand?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { read } = useProductActions();
  const [url, setUrl] = useState("");
  const [slow, setSlow] = useState(false);
  const go = () => {
    if (disabled) return;
    // The server's own rule (it would refuse the link anyway), before the "Reading…" and the kit animation start.
    const link = normalizeWebsite(url);
    if (!link) return void toast("Use a valid product link.");
    const host = new URL(link).hostname;
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 12_000);
    const id = toast.loading(`Reading ${host}`);
    read.mutate(
      { url: url.trim(), brandId, limit, withBrand },
      {
        onSuccess: (r) => {
          if (r.duplicate) toast(r.message ?? `«${r.duplicate.name}» is already among this brand's products.`, { id });
          else if (r.message) toast.success(r.message, { id, duration: 5000 });
          else toast.success(r.products.length === 1 ? `Added ${r.products[0].name}` : `Added ${r.products.length} products`, { id, duration: 2000 });
          setUrl("");
          onAdded?.(r.duplicate ? [r.duplicate] : r.products, { brand: r.brand });
        },
        // A refusal that opened its own card (sign up, connect your GPU): the card alone, no "try again" toast on top. One
        // that says what isn't open to this visitor gets no "try again" either: trying again wouldn't change it.
        onError: (e) =>
          refusalShown(e)
            ? toast.dismiss(id)
            : toast.error((e as Error).message, { id, description: REFUSED.has((e as { code?: string }).code ?? "") ? undefined : "Try again, or add it by hand." }),
        onSettled: () => clearTimeout(t),
      },
    );
  };
  return (
    <form
      className={cn("flex min-w-0 gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Link2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} aria-label="Product link" disabled={disabled} className={cn(inputCls, "pl-8 disabled:opacity-60")} />
      </div>
      <Button type="submit" variant="outline" disabled={read.isPending || disabled}>
        {read.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
      </Button>
      {read.isPending && slow && <span className="sr-only">This is taking longer than usual</span>}
    </form>
  );
}

export function ProductThumb({ product, className }: { product: Pick<Product, "images" | "name">; className?: string }) {
  return (
    <div className={cn("grid place-items-center overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {product.images[0] ? <img src={product.images[0]} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-5 text-muted-foreground" />}
    </div>
  );
}

/** A product card: picture, name, price; select (Ads Studio) or open to edit. */
export function ProductCard({ product, selected, onToggle, onEdit, onDelete, disabled }: { product: Product; selected?: boolean; onToggle?: () => void; onEdit?: () => void; onDelete?: () => void; disabled?: boolean }) {
  const selectable = !!onToggle;
  return (
    <div className={cn("group/pc relative min-w-0 rounded-xl border bg-background p-2 transition-shadow", selected && "border-primary ring-4 ring-brand-faint", disabled && !selected && "opacity-60")}>
      <button type="button" onClick={selectable ? onToggle : onEdit} disabled={disabled && !selected} aria-pressed={selectable ? selected : undefined} className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        <ProductThumb product={product} className="aspect-square rounded-lg" />
        <p className="mt-2 truncate text-[13px] font-medium">{product.name}</p>
        <p className="truncate text-[12px] text-muted-foreground">{[priceText(product), product.images.length ? `${product.images.length} picture${product.images.length === 1 ? "" : "s"}` : "No pictures"].filter(Boolean).join(" · ")}</p>
      </button>
      {selectable && (
        <span className={cn("pointer-events-none absolute top-3.5 left-3.5 grid size-5 place-items-center rounded-full border-2 border-white bg-black/30 text-white shadow", selected && "border-primary bg-primary")}>
          {selected && <Check className="size-3" />}
        </span>
      )}
      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="absolute top-3.5 right-3.5 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur sm:opacity-0 sm:group-hover/pc:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`${product.name} actions`}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** The "Upload product" button with its dialog. disabled: a visitor, who can't save a product here. */
export function UploadProductButton({ brandId, onSaved, variant = "outline", disabled }: { brandId?: string | null; onSaved?: (p: Product) => void; variant?: "outline" | "ghost" | "secondary"; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={disabled}>
        <Upload /> Upload product
      </Button>
      <ProductDialog open={open} onOpenChange={setOpen} brandId={brandId} onSaved={onSaved} />
    </>
  );
}
