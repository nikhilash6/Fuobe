"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ConnectChoice } from "@/components/gpu/connect-choice";
import type { FindReason } from "@/components/gpu/computer-runner";
import { takeGpuRetry } from "@/hooks/use-gpu";
import { KeyInstead } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONNECT_GPU_EVENT, GUEST_PROMPT_EVENT, refusalCard, signInHref, useStatus, useViewer, watchGuestRefusals, type RefusalAction, type RefusalCard, type RefusalDetail } from "@/lib/api";
import { CLOUD_KEY } from "@/lib/your-keys";

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
  const [action, setAction] = useState<RefusalAction>("run");
  const [retry, setRetry] = useState<{ retry: () => void; kind?: string } | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setRetry(null);
  }, []);
  const viewer = useStatus().data?.viewer;
  const qc = useQueryClient();
  // Who this page was for, for the refusal that comes when that sign-in ended elsewhere: "owner", "account", or null.
  const who = useViewer().data;
  const was = useRef<"owner" | "account" | null>(null);
  useEffect(() => {
    was.current = who?.signedIn ? (who.owner ? "owner" : "account") : null;
  }, [who]);
  const [signedOut, setSignedOut] = useState<"owner" | "account" | null>(null);
  useEffect(() => {
    watchGuestRefusals();
    const show = (kind: RefusalCard["kind"]) => {
      const next = refusalCard(kind, window.location);
      if (!next) return false;
      setCard(next);
      setOpen(true);
      return true;
    };
    // A bare Event (the sidebar's "Connect your GPU") has no detail: a run.
    const detail = (e: Event) => (e as CustomEvent<(RefusalDetail & { reason?: FindReason }) | null>).detail ?? {};
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
      const { action: refused = "run", reason: why } = detail(e);
      // The run that was refused (the composer leaves its retry as it sends): kept until the GPU is connected.
      const r = refused === "run" ? takeGpuRetry() : null;
      if (!show("gpu")) return;
      setRetry(r);
      setReason(why);
      setAction(refused);
    };
    window.addEventListener(GUEST_PROMPT_EVENT, guest);
    window.addEventListener(CONNECT_GPU_EVENT, gpu);
    return () => {
      window.removeEventListener(GUEST_PROMPT_EVENT, guest);
      window.removeEventListener(CONNECT_GPU_EVENT, gpu);
    };
  }, [qc]);
  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigation close={close} />
      </Suspense>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className={card?.kind === "gpu" ? "max-h-[90svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl" : "sm:max-w-sm"}>
          {card?.kind === "gpu" ? (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Cpu className="size-5" />
                </div>
                <DialogTitle>{TITLES[reason ?? action]}</DialogTitle>
                <DialogDescription>
                  {!reason && action === "upload" ? (
                    "A free account keeps its files for runs on its own ComfyUI or its own fal.ai or Replicate key."
                  ) : (
                    <>Fuobe runs this on the ComfyUI on your computer. It&apos;s free and private.</>
                  )}
                </DialogDescription>
                {/* Paid models run on the account's own key instead (Your keys), when the studio allows them. */}
                {viewer?.kind === "account" && viewer.paidAllowed !== false && !!viewer.keys?.length && (
                  <p className="text-[13px] text-muted-foreground">{`Or switch to Cloud to use your ${viewer.keys.map((k) => CLOUD_KEY[k].label).join(" or ")} key.`}</p>
                )}
              </DialogHeader>
              {/* No key yet: "Add a key" opens here, over the studio (this card makes room). */}
              <KeyInstead onOpen={close} />
              <ConnectChoice
                fromRun={!!retry}
                kind={retry?.kind}
                reason={reason}
                onStart={() => {
                  const r = retry;
                  close();
                  r?.retry();
                }}
                onNotNow={() => setRetry(null)}
              />
            </>
          ) : signedOut ? (
            <>
              <DialogHeader>
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <LogIn className="size-5" />
                </div>
                <DialogTitle>You were signed out</DialogTitle>
                <DialogDescription>This browser isn&apos;t signed in any more, for example because the password was changed in another browser. Log in again to go on.</DialogDescription>
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

const TITLES: Record<FindReason | RefusalAction, string> = {
  run: "Connect your GPU to run this",
  upload: "Connect your GPU or add a key to use your own files",
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
