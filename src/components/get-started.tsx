"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AudioLines, Bot, ChevronDown, Clapperboard, Cloud, Copy, Cpu, ExternalLink, ImageIcon, Megaphone, Mic2, Video, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConnectField, useSettings } from "@/components/connect-field";
import { OwnerComputerLine, OwnerServerComfy } from "@/components/gpu/connect-choice";
import { openConnect, useComputerSupport } from "@/components/gpu/open-connect";
import { unsupportedWords } from "@/components/gpu/this-computer";
import { usePagePlace } from "@/components/gpu/use-local-comfy";
import { Skeleton } from "@/components/ui/skeleton";
import { saveSettings, useEngineMode, type StatusInfo } from "@/lib/api";
import { copyWithToast } from "@/lib/clipboard";
import { COMFY_INSTALL_COMMAND, COMFY_INSTALL_DOCS, FAL_KEYS_URL, nothingConnected } from "@/lib/connections";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";

/**
 * "What do you want to do?" — Liner's first-run question, as one tap to the right place. Image and
 * Edit switch Home's composer (Edit's Start then asks for the photo); "Animate a photo" opens Video
 * itself, where the Start frame is, since Home's Video mode would run text-to-video without one.
 */
const INTENTS = [
  { label: "Make an image", href: "/image", icon: ImageIcon, mode: "image" },
  { label: "Animate a photo", href: "/video", icon: Video },
  { label: "Edit a photo", href: "/edit", icon: Wand2, mode: "edit" },
  { label: "Advertise a product", href: "/marketing", icon: Megaphone },
  { label: "A talking avatar", href: "/lipsync", icon: Mic2 },
  { label: "A faceless video", href: "/faceless", icon: Clapperboard },
  { label: "Voice or music", href: "/audio", icon: AudioLines },
  { label: "Plan it with Assist", href: "/assist", icon: Bot },
] as const;

export type IntentMode = "image" | "video" | "edit";

/** Models per workflow, how to install ComfyUI, and its install command: the GPU card's links. */
function ComfyLinks() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href="/workflows" className="text-brand-text underline-offset-2 hover:underline">
        Models per workflow
      </Link>
      <a href={COMFY_INSTALL_DOCS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline">
        Install ComfyUI <ExternalLink className="size-3" />
      </a>
      <button
        type="button"
        onClick={() => void copyWithToast(COMFY_INSTALL_COMMAND, "Install command copied")}
        className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border hover:bg-accent"
        aria-label={`Copy the install command: ${COMFY_INSTALL_COMMAND}`}
      >
        <span className="truncate">{COMFY_INSTALL_COMMAND}</span> <Copy className="size-3 shrink-0" />
      </button>
    </span>
  );
}

/**
 * "Use your GPU" on a hosted studio (the page isn't on the server's machine, so the server's 127.0.0.1 isn't the
 * owner's): Fuobe finds the ComfyUI on this computer, in the connect dialog (it stays open through "connected" after
 * this guide goes); a ComfyUI on a server or a cloud GPU is the quieter second way. Once ComfyUI runs on the owner's
 * computer (a guide opened again), its state. On a phone, in Safari or on a plain-http page, why this browser can't, and the
 * server way open.
 */
function HostedGpuCard({ computer }: { computer: boolean }) {
  const support = useComputerSupport();
  const [server, setServer] = useState(false);
  return (
    <GuideCard icon={Cpu} title="Use your GPU" cost="Free: open-source models run on your own graphics card">
      {computer ? (
        <OwnerComputerLine />
      ) : support !== "ok" ? (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{unsupportedWords(support, true)}</p>
          <OwnerServerComfy hosted onlyAddress />
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">Fuobe finds the ComfyUI running on this computer and sends your runs to it.</p>
          <div className="space-y-1.5">
            <Button className="h-11 w-full sm:h-9 sm:w-fit" onClick={() => openConnect(true)}>
              <Cpu /> Use the ComfyUI on this computer
            </Button>
            <p className="text-[12px] text-muted-foreground">Runs while Fuobe is open in this browser.</p>
          </div>
          <div>
            <button type="button" onClick={() => setServer((v) => !v)} aria-expanded={server} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
              ComfyUI on a server or a cloud GPU? <ChevronDown className={cn("size-3.5 transition-transform", server && "rotate-180")} />
            </button>
            {server && (
              <div className="mt-3">
                <OwnerServerComfy hosted onlyAddress />
              </div>
            )}
          </div>
        </>
      )}
      <p className="text-[12px] text-muted-foreground">
        <ComfyLinks />
      </p>
    </GuideCard>
  );
}

function GuideCard({ icon: Icon, title, cost, children }: { icon: typeof Cloud; title: string; cost: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 text-left">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand-text">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium">{title}</h3>
          <p className="text-[12px] text-muted-foreground">{cost}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * The first-run guide: the ways to make things for real (a paid API key, or your own GPU), each
 * finished without leaving the page, then Liner's "What do you want to do?" chips. There is no
 * demo card: placeholder results are only for a tour, and only turned on in Settings.
 * It shows while nothing is connected and it wasn't dismissed (showFirstRun); connecting something
 * or "Hide" remembers that on the server, so it doesn't come back in another browser.
 */
export function GetStarted({
  status,
  prices,
  onHide,
  onMode,
  intents = true,
  className,
}: {
  /** Undefined while it loads (Home's static shell): the guide is drawn for this browser's engine mode. */
  status?: StatusInfo;
  /** What a first image and clip cost on the paid route (starterPriceLine on the server). */
  prices?: string;
  /** After Hide put it away (Settings closes a guide it reopened). */
  onHide?: () => void;
  /** An image / video / edit chip: Home switches its composer instead of leaving the page. */
  onMode?: (mode: IntentMode) => void;
  /** Show the "What do you want to do?" chips. */
  intents?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  // Not in Home's static shell (no status yet): a returning visitor's guide is gone once the status
  // arrives, so it shouldn't cost a settings read on every Home visit.
  const settings = useSettings(!!status).data;
  const get = (n: string) => settings?.find((s) => s.name === n);
  const [hiding, setHiding] = useState(false);
  const titleId = useId();
  const cachedMode = useEngineMode();
  const mode = status?.engineMode ?? cachedMode;
  // Where this page is: unknown in the server's HTML (Home's static shell), so the GPU card waits for it there.
  const place = usePagePlace();
  const hide = async () => {
    setHiding(true);
    try {
      await saveSettings({ onboarded: "1" });
      await qc.invalidateQueries({ queryKey: ["status"] });
      onHide?.();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setHiding(false);
    }
  };
  const connected = (what: string) => (r: { detail: string }) => toast.success(`${what} connected`, { description: r.detail });

  return (
    <section className={cn("w-full animate-fade-up rounded-2xl border bg-muted/40 p-4 text-left sm:p-5", className)} aria-labelledby={titleId}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-heading text-[24px] leading-tight">
            Get started
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {status && nothingConnected(status)
              ? "Nothing is connected yet. Connect a model to make the real thing:"
              : "The ways to make things with Fuobe. Connect another one, or check one you set up:"}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="-mt-1 -mr-2 shrink-0 text-muted-foreground" disabled={hiding} onClick={() => void hide()} aria-label="Hide the setup guide">
          <X /> <span className="hidden sm:inline">Hide</span>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {mode !== "open" && (
          <GuideCard icon={Cloud} title="Use paid models" cost={prices ? `Pay per run with your own key: ${prices}` : "Pay per run with your own key"}>
            <p className="text-[13px] leading-relaxed text-muted-foreground">The Fuobe Originals hosted on open weights, plus Nano Banana, Seedance, Kling, Veo and many more, through one fal.ai key. A Replicate token works too (Settings).</p>
            <ConnectField
              name="falKey"
              setting={get("falKey")}
              provider="fal"
              label="fal.ai API key"
              placeholder="key_id:key_secret"
              onConnected={connected("fal.ai")}
              hint={
                <a href={FAL_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline">
                  Get a key at fal.ai <ExternalLink className="size-3" />
                </a>
              }
            />
          </GuideCard>
        )}
        {mode !== "cloud" && place === null ? (
          <GuideCard icon={Cpu} title="Use your GPU" cost="Free: open-source models run on your own graphics card">
            <Skeleton className="h-[116px] w-full rounded-lg" />
          </GuideCard>
        ) : mode !== "cloud" && place === "hosted" ? (
          <HostedGpuCard computer={get("comfyWhere")?.value === "computer"} />
        ) : mode !== "cloud" && (
          <GuideCard icon={Cpu} title="Use your GPU" cost="Free: open-source models run on your machine">
            <p className="text-[13px] leading-relaxed text-muted-foreground">Point Fuobe at a running ComfyUI. Each workflow lists the model files it needs.</p>
            <ConnectField
              name="comfyUrl"
              setting={get("comfyUrl")}
              provider="comfyui"
              label="ComfyUI address"
              placeholder="http://127.0.0.1:8188"
              idleLabel="Connect"
              onConnected={connected("ComfyUI")}
              hint={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href="/workflows" className="text-brand-text underline-offset-2 hover:underline">
                    Models per workflow
                  </Link>
                  <a href={COMFY_INSTALL_DOCS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline">
                    Install ComfyUI <ExternalLink className="size-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyWithToast(COMFY_INSTALL_COMMAND, "Install command copied")}
                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border hover:bg-accent"
                    aria-label={`Copy the install command: ${COMFY_INSTALL_COMMAND}`}
                  >
                    <span className="truncate">{COMFY_INSTALL_COMMAND}</span> <Copy className="size-3 shrink-0" />
                  </button>
                </span>
              }
            />
          </GuideCard>
        )}
      </div>

      {intents && (
        <div className="mt-5">
          <h3 className="text-[13px] font-medium">What do you want to do?</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {INTENTS.map((i) => {
              const cls = "inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
              const pick = "mode" in i && onMode ? i.mode : null;
              return (
                <li key={i.label}>
                  {pick ? (
                    <button type="button" className={cls} onClick={() => onMode?.(pick)}>
                      <i.icon className="size-3.5" /> {i.label}
                    </button>
                  ) : (
                    <Link href={i.href} className={cls}>
                      <i.icon className="size-3.5" /> {i.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
