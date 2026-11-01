"use client";

import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Globe, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MediaThumb } from "@/components/studio/result-media";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useShareActions } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { userTitle } from "@/lib/library";
import { shownOutputs } from "@/lib/output-actions";
import { MAX_PUBLISH_ITEMS, MAX_TAGS, moveItem, parseTags, pieces, PUBLISH_LAYOUTS, type ShareCreated, type ShareLayout } from "@/lib/share";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { ExpiryPicker } from "./share-dialog";

const STEPS = ["Details", "Assets", "Cover", "Access"] as const;
type Step = (typeof STEPS)[number];

/** A publishable piece: finished, with something to show. */
const publishable = (g: Generation) => g.status === "succeeded" && g.outputs.length > 0 && !g.deletedAt && g.feature !== "upload";

/** The thumbnail of a piece: its first shown output. */
const firstShown = (g: Generation) => shownOutputs(g)[0] ?? 0;

/**
 * Publish a selection as a portfolio page (Higgsfield's Publish wizard, made a share link):
 * Details (title, description, tags) → Assets (Feature, Series or Carousel, in your order) →
 * Cover → Access (with prompts or prompts hidden, and when the link stops working).
 */
export function PublishWizard({ items, onClose, onPublished }: { items: Generation[]; onClose: () => void; onPublished: (c: ShareCreated) => void }) {
  const finished = useMemo(() => items.filter(publishable), [items]);
  const ready = useMemo(() => finished.slice(0, MAX_PUBLISH_ITEMS), [finished]);
  const unfinished = items.length - finished.length;
  const over = finished.length - ready.length;
  const [step, setStep] = useState<Step>("Details");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [layout, setLayout] = useState<Exclude<ShareLayout, "grid">>("feature");
  const [order, setOrder] = useState<Generation[]>(ready);
  const [cover, setCover] = useState<{ generationId: string; index: number } | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = useShareActions();
  const at = STEPS.indexOf(step);
  const blocker = !title.trim() ? "Give the page a title" : !order.length ? "Keep at least one result" : null;
  // Without a pick, the first piece (as the Cover step shows it), whatever it is.
  const coverOf = cover && order.some((g) => g.id === cover.generationId) ? cover : order[0] ? { generationId: order[0].id, index: firstShown(order[0]) } : null;

  const publish = async () => {
    setBusy(true);
    try {
      onPublished(
        await actions.create({ kind: "publish", items: order.map((g) => g.id), title, description, tags, layout, cover: coverOf, showPrompts, expiresInDays: days }),
      );
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    if (step === "Details" && !title.trim()) return toast.error("Give the page a title first");
    if (at < STEPS.length - 1) setStep(STEPS[at + 1]);
    else if (!blocker && !busy) void publish();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Publish {pieces(order.length)}</DialogTitle>
          <DialogDescription>
            A read-only page anyone with the link can open.
            {unfinished > 0 && ` ${unfinished} of your selection ${unfinished === 1 ? "isn't" : "aren't"} finished, so ${unfinished === 1 ? "it stays" : "they stay"} out.`}
            {over > 0 && ` A page holds up to ${MAX_PUBLISH_ITEMS}, so the last ${over === 1 ? "one stays" : `${over} stay`} out.`}
          </DialogDescription>
          <ol className="mt-1 grid grid-cols-4 gap-1" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => (i <= at || !blocker ? setStep(s) : undefined)}
                  disabled={i > at && (!title.trim() || !order.length)}
                  aria-current={s === step ? "step" : undefined}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 rounded-lg px-1 pt-1 pb-1.5 text-left text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    s === step ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className={cn("h-1 w-full rounded-full", i <= at ? "bg-primary" : "bg-muted")} />
                  <span className="truncate">
                    <span className="max-sm:hidden">{i + 1}. </span>
                    {s}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </DialogHeader>

        <form
          id="publish-form"
          className="-mx-4 min-h-0 overflow-y-auto px-4 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          {step === "Details" && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="publish-title">Title</Label>
                <Input id="publish-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Night city, a series" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="publish-description">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea id="publish-description" value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="What it is, how you made it" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="publish-tags">
                  Tags <span className="font-normal text-muted-foreground">(optional, up to {MAX_TAGS})</span>
                </Label>
                <Input id="publish-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cinematic, neon, portrait" aria-describedby="publish-tags-shown" />
                <ul id="publish-tags-shown" className="flex min-h-5 flex-wrap gap-1" aria-label="Tags on the page">
                  {parseTags(tags).map((t) => (
                    <li key={t} className="rounded-full bg-brand-faint px-2 py-0.5 text-[11px] font-medium text-brand-text">
                      #{t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === "Assets" && (
            <div className="grid gap-4">
              <div role="radiogroup" aria-label="Layout" onKeyDown={radioKeys} className="grid gap-2 sm:grid-cols-3">
                {PUBLISH_LAYOUTS.map((l) => {
                  const on = layout === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={radioTab(on)}
                      onClick={() => setLayout(l.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:gap-2",
                        on ? "border-primary bg-brand-faint" : "hover:bg-muted/60",
                      )}
                    >
                      <LayoutGlyph layout={l.id} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{l.label}</span>
                        <span className="block text-[12px] leading-snug text-muted-foreground">{l.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div>
                <p className="mb-1.5 text-[12px] text-muted-foreground">{layout === "series" ? "Episodes, in this order." : layout === "feature" ? "The cover's piece goes on top; the rest follow in this order." : "Slides, in this order."}</p>
                <ol className="grid gap-1" aria-label="Order">
                  {order.map((g, i) => (
                    <li key={g.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-1.5">
                      <span className="w-5 shrink-0 text-center font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                      <MediaThumb output={g.outputs[firstShown(g)]} g={g} className="size-10 shrink-0 overflow-hidden rounded-md" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{userTitle(g)}</span>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => setOrder((o) => moveItem(o, i, i - 1))} aria-label={`Move ${i + 1} up`}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={i === order.length - 1} onClick={() => setOrder((o) => moveItem(o, i, i + 1))} aria-label={`Move ${i + 1} down`}>
                        <ArrowDown />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={order.length === 1} onClick={() => setOrder((o) => o.filter((x) => x.id !== g.id))} aria-label={`Leave ${i + 1} out`}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {step === "Cover" && (
            <div className="grid gap-2">
              <p className="text-[12px] text-muted-foreground">
                The picture link previews show. {PUBLISH_LAYOUTS.find((l) => l.id === layout)?.cover}. Without a pick, it&apos;s the first piece.
              </p>
              <div role="radiogroup" aria-label="Cover" onKeyDown={radioKeys} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {order.map((g, i) => {
                  const index = firstShown(g);
                  const on = coverOf ? coverOf.generationId === g.id : i === 0;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${i + 1}: ${userTitle(g)}`}
                      tabIndex={radioTab(on)}
                      onClick={() => setCover({ generationId: g.id, index })}
                      className={cn("relative aspect-square overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "opacity-80 hover:opacity-100")}
                    >
                      <MediaThumb output={g.outputs[index]} g={g} className="size-full" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === "Access" && (
            <div className="grid gap-4">
              <div role="radiogroup" aria-label="Access" onKeyDown={radioKeys} className="grid gap-2 sm:grid-cols-2">
                {[
                  { on: true, icon: Eye, label: "With prompts", hint: "Viewers see each prompt and can copy it with Recreate in your Fuobe." },
                  { on: false, icon: EyeOff, label: "Prompts hidden", hint: "Only the results and the model names. No Recreate." },
                ].map((o) => {
                  const picked = showPrompts === o.on;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      tabIndex={radioTab(picked)}
                      onClick={() => setShowPrompts(o.on)}
                      className={cn("flex items-start gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", picked ? "border-primary bg-brand-faint" : "hover:bg-muted/60")}
                    >
                      <o.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>
                        <span className="block text-[13px] font-medium">{o.label}</span>
                        <span className="block text-[12px] leading-snug text-muted-foreground">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <ExpiryPicker value={days} onChange={setDays} />
              <p className="rounded-xl bg-muted/60 p-3 text-[12px] text-muted-foreground">
                “{title.trim() || "Untitled"}”: a {PUBLISH_LAYOUTS.find((l) => l.id === layout)?.label.toLowerCase()} page of {pieces(order.length)}, {showPrompts ? "with prompts" : "prompts hidden"}. You can turn it off any
                time in Library → Shared.
              </p>
            </div>
          )}
        </form>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => (at === 0 ? onClose() : setStep(STEPS[at - 1]))}>
            {at === 0 ? "Cancel" : "Back"}
          </Button>
          <Button type="submit" form="publish-form" disabled={busy || (step === "Access" && !!blocker)}>
            {step === "Access" ? (
              <>
                {busy ? <Loader2 className="animate-spin" /> : <Globe />} Publish
              </>
            ) : (
              "Next"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A small drawing of each layout. */
function LayoutGlyph({ layout }: { layout: Exclude<ShareLayout, "grid"> }) {
  const box = "rounded-[3px] bg-current opacity-35";
  return (
    <span aria-hidden className="grid h-10 w-14 shrink-0 place-items-stretch text-primary">
      {layout === "feature" ? (
        <span className="grid grid-rows-[1.6fr_1fr] gap-0.5">
          <span className={box} />
          <span className="grid grid-cols-3 gap-0.5">
            <span className={box} />
            <span className={box} />
            <span className={box} />
          </span>
        </span>
      ) : layout === "series" ? (
        <span className="grid grid-rows-3 gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="grid grid-cols-[0.5fr_2fr] gap-0.5">
              <span className={cn(box, "opacity-60")} />
              <span className={box} />
            </span>
          ))}
        </span>
      ) : (
        <span className="grid grid-cols-[0.3fr_2fr_0.3fr] items-center gap-0.5">
          <span className={cn(box, "h-2/3")} />
          <span className={cn(box, "h-full")} />
          <span className={cn(box, "h-2/3")} />
        </span>
      )}
    </span>
  );
}
