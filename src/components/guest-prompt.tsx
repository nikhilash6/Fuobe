"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, ExternalLink, KeyRound, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ConnectChoice } from "@/components/gpu/connect-choice";
import type { FindReason } from "@/components/gpu/computer-runner";
import { takeGpuRetry } from "@/hooks/use-gpu";
import { KeyInstead } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CONNECT_GPU_EVENT,
  GUEST_PROMPT_EVENT,
  refusalCard,
  signInHref,
  useStatus,
  useViewer,
  watchGuestRefusals,
  type ConnectGpuDetail as ConnectDetail,
  type ConnectNeeds,
  type RefusalAction,
  type RefusalCard,
} from "@/lib/api";
import { ConnectField, useSettings } from "@/components/connect-field";
import { FAL_KEYS_URL } from "@/lib/connections";
import { CLOUD_KEY } from "@/lib/your-keys";
import { RUNS_CHANGED_EVENT } from "@/lib/guest-access";
import { refreshPriceChecks } from "@/lib/hosted";

/**
 * The cards a public studio shows when something is refused (watchGuestRefusals): "Create a free
 * account to run this" for a guest (public sign-up, signed out) who tries to generate or change
 * anything, and "Connect your GPU to run this" for an account (accounts run on their own ComfyUI,
 * or their own fal.ai or Replicate key, never the owner's keys or GPU), with "No GPU? Add a key"
 * when it has no key yet. A refused upload, or a file chooser that asks first (useAskBeforeUpload),
 * says "add your own files" instead. Mounted once, in the app's providers, so it outlives the page:
 * a card closes when the page changes (its own Sign up or Log in, Back), and never opens on the
 * sign-in page (refusalCard). Opened by a run that was refused, "Connect your GPU" keeps that run
 * and starts it by itself once the GPU is connected. Refused as a guest while this page still had
 * someone signed in (the password changed in another browser), it says "You were signed out" instead.
 */
export function GuestPrompt() {
  // The last card stays while the dialog animates out.
  const [card, setCard] = useState<RefusalCard | null>(null);
  const [open, setOpen] = useState(false);
  // Opened by the runner's note: ComfyUI needs Fuobe's setting again, find ComfyUI, or let this browser reach it.
  const [reason, setReason] = useState<FindReason | undefined>(undefined);
  // What was refused: a run (or any other change), or a file of the visitor's own.
  const [action, setAction] = useState<RefusalAction | "connect">("run");
  const [retry, setRetry] = useState<{ retry: () => void; kind?: string } | null>(null);
  // Opened by a button that said "Use the ComfyUI on this computer": the finder looks at once.
  const [look, setLook] = useState(false);
  // The owner's refused run (Demo mode off, nothing connected): what would run it. A GPU when not said.
  const [needs, setNeeds] = useState<ConnectNeeds>("gpu");
  // Opened by a tool only a GPU runs: no key offers on this card.
  const [gpuOnly, setGpuOnly] = useState(false);
  const [requirement, setRequirement] = useState<string | undefined>(undefined);
  const close = useCallback(() => {
    setOpen(false);
    setRetry(null);
  }, []);
  const viewer = useStatus().data?.viewer;
  // A studio that runs open-source models only takes no keys: its cards offer the GPU alone.
  const keysAllowed = (viewer?.kind !== "account" || viewer.paidAllowed !== false) && !gpuOnly;
  const qc = useQueryClient();
  // Who this page was for, for the refusal that comes when that sign-in ended elsewhere: "owner", "account", or null.
  const who = useViewer().data;
  const was = useRef<"owner" | "account" | null>(null);
  useEffect(() => {
    was.current = who?.signedIn ? (who.owner ? "owner" : "account") : null;
  }, [who]);
  const [signedOut, setSignedOut] = useState<"owner" | "account" | null>(null);
  // The owner's own refused run (never an account's: theirs has "Add your key" of its own).
  const ownerRun = !!who?.owner && action === "run" && !reason;
  const keyOnly = ownerRun && needs === "key";
  const start = () => {
    const r = retry;
    close();
    r?.retry();
  };
  useEffect(() => {
    watchGuestRefusals();
    const show = (kind: RefusalCard["kind"]) => {
      const next = refusalCard(kind, window.location);
      if (!next) return false;
      setCard(next);
      setOpen(true);
      return true;
    };
    // A button that only opens the card sends no action (and a bare Event no detail at all): no run waits.
    const detail = (e: Event) => (e as CustomEvent<ConnectDetail | null>).detail ?? {};
    const guest = (e: Event) => {
      // Signed in a moment ago: not an offer to sign up, but to log in again; and the page asks who is looking.
      const out = was.current;
      if (show("guest")) {
        setSignedOut(out);
        setAction(detail(e).action ?? "run");
      }
      if (out) {
        was.current = null;
        void qc.invalidateQueries({ queryKey: ["viewer"] });
        void qc.invalidateQueries({ queryKey: ["status"] });
      }
    };
    const gpu = (e: Event) => {
      const d = detail(e);
      // Only a refused run carries its retry (watchGuestRefusals says "run"): a button that just opens this card never
      // starts the last run again.
      const r = d.action === "run" ? takeGpuRetry() : null;
      if (!show("gpu")) return;
      setRetry(r);
      setReason(d.reason);
      setAction(d.action ?? "connect");
      setLook(!!d.look);
      setNeeds(d.needs ?? "gpu");
      setGpuOnly(!!d.gpuOnly);
      setRequirement(typeof d.requirement === "string" && d.requirement ? d.requirement : undefined);
    };
    window.addEventListener(GUEST_PROMPT_EVENT, guest);
    // A run started from a toast (not a page's own button): the lists show it.
    const runs = () => {
      for (const key of ["generations", "library", "library-facets"]) void qc.invalidateQueries({ queryKey: [key] });
      refreshPriceChecks(qc);
    };
    window.addEventListener(CONNECT_GPU_EVENT, gpu);
    window.addEventListener(RUNS_CHANGED_EVENT, runs);
    return () => {
      window.removeEventListener(GUEST_PROMPT_EVENT, guest);
      window.removeEventListener(CONNECT_GPU_EVENT, gpu);
      window.removeEventListener(RUNS_CHANGED_EVENT, runs);
    };
  }, [qc]);
  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigation close={close} />
      </Suspense>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent
          className={card?.kind === "gpu" ? "max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl" : "sm:max-w-sm"}
          // "Connect your GPU" starts on the card itself, not in an address field (a phone's keyboard would cover it).
          onOpenAutoFocus={(e) => {
            if (card?.kind !== "gpu") return;
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus?.();
          }}
        >
          {card?.kind === "gpu" ? (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  {keyOnly ? <KeyRound className="size-5" /> : <Cpu className="size-5" />}
                </div>
                <DialogTitle>
                  {reason ? TITLES[reason] : keyOnly ? "Add an API key to run this" : action === "upload" && !keysAllowed ? "Connect your GPU to add your own files" : TITLES[action]}
                </DialogTitle>
                <DialogDescription>
                  {keyOnly ? (
                    "This model runs in the cloud with your own fal.ai or Replicate key. Runs are billed to your account with them."
                  ) : !reason && action === "upload" ? (
                    keysAllowed ? (
                      "Your files are kept for your own runs, on your own ComfyUI or with your own fal.ai or Replicate key."
                    ) : (
                      "Your files are kept for your own runs on your own ComfyUI."
                    )
                  ) : (
                    <>{action === "connect" && !reason ? "Your runs go to the ComfyUI on your computer. It's free and private." : "Fuobe runs this on the ComfyUI on your computer. It's free and private."}</>
                  )}
                </DialogDescription>
                {/* What the item asked for needs (its own-setup label). */}
                {requirement && <p className="text-[13px] font-medium text-brand-text">{requirement}</p>}
                {/* Paid models run on the account's own key instead (Your keys), when the studio allows them. */}
                {viewer?.kind === "account" && keysAllowed && !!viewer.keys?.length && (
                  <p className="text-[13px] text-muted-foreground">{`Or switch to Cloud to use your ${viewer.keys.map((k) => CLOUD_KEY[k].label).join(" or ")} key.`}</p>
                )}
              </DialogHeader>
              {/* No key yet: "Add a key" opens here, over the studio (this card makes room). */}
              {keysAllowed && <KeyInstead onOpen={close} />}
              {!keyOnly && <ConnectChoice fromRun={!!retry} kind={retry?.kind} reason={reason} look={look} onStart={start} onNotNow={() => setRetry(null)} />}
              {/* The owner's refused run a fal.ai or Replicate key would run: the key right here, and the run starts once it's saved. */}
              {ownerRun && needs !== "gpu" && <OwnerKey alone={keyOnly} onConnected={start} />}
            </>
          ) : signedOut ? (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <LogIn className="size-5" />
                </div>
                <DialogTitle>You were signed out</DialogTitle>
                <DialogDescription>Your password changed in another browser. Log in again to carry on.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:justify-start">
                <Button asChild>
                  <Link href={logInAgain(signedOut, card?.here)} onClick={close}>
                    Log in
                  </Link>
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Sparkles className="size-5" />
                </div>
                <DialogTitle>{action === "upload" ? "Create a free account to add your own files" : "Create a free account to run this"}</DialogTitle>
                <DialogDescription>You&apos;re browsing as a guest. Sign up with an email and a password to generate, upload and keep your work.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:justify-start">
                <Button asChild>
                  <Link href={signInHref("signup", card?.here)} onClick={close}>
                    Sign up free
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={signInHref("login", card?.here)} onClick={close}>
                    Log in
                  </Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Log in again, coming back here: the owner to the studio's own sign-in. */
function logInAgain(who: "owner" | "account", here?: string): string {
  const href = signInHref("login", here);
  if (who !== "owner") return href;
  return `${href}${href.includes("?") ? "&" : "?"}owner=1`;
}

const TITLES: Record<FindReason | RefusalAction | "connect", string> = {
  run: "Connect your GPU to run this",
  upload: "Connect your GPU or add a key to add your own files",
  // Opened with no run waiting (the setup guide, the account menu's Connect).
  connect: "Connect your GPU",
  setting: "Your ComfyUI needs Fuobe's setting again",
  find: "Find your ComfyUI",
  browser: "Run your GPU jobs from this browser",
};

/** Closes the card when the page changes. Reads the path (runtime data), so it sits under Suspense: routes still prerender. */
function CloseOnNavigation({ close }: { close: () => void }) {
  const pathname = usePathname();
  useEffect(() => close(), [pathname, close]);
  return null;
}

/**
 * The owner's fal.ai key, right in the card a refused run opened (Demo mode off, nothing connected): a green test saves
 * it and the run starts. `alone`: the key is the only way (a cloud model); otherwise it is the second way, under the GPU.
 */
function OwnerKey({ alone, onConnected }: { alone: boolean; onConnected: () => void }) {
  const setting = useSettings().data?.find((s) => s.name === "falKey");
  return (
    <div className={alone ? "space-y-2" : "space-y-2 rounded-2xl border border-dashed p-4"}>
      {!alone && <p className="text-[13px] font-medium">Or add an API key</p>}
      <ConnectField
        name="falKey"
        setting={setting}
        provider="fal"
        label="fal.ai API key"
        placeholder="key_id:key_secret"
        onConnected={onConnected}
        hint={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={FAL_KEYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline">
              Get a key at fal.ai <ExternalLink className="size-3" />
            </a>
            <Link href="/settings#cloud" className="text-brand-text underline-offset-2 hover:underline">
              A Replicate token instead
            </Link>
          </span>
        }
      />
    </div>
  );
}
