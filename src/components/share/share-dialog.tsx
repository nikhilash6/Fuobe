"use client";

import { Check, Copy, ExternalLink, Link2, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useShareActions, useShares } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { copyWithToast } from "@/lib/clipboard";
import { EXPIRY_CHOICES, expiryLabel, type ShareCreated, type ShareInfo } from "@/lib/share";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { PublishWizard } from "./publish-wizard";
import { rememberLink, shareUrl, type ShareTarget } from "./share-provider";

const NOUN: Record<ShareTarget["kind"], string> = { result: "this result", folder: "this folder", cinema: "this project" };

/** What the provider has open: the Share dialog (a target, then its new link), a link to show, or the Publish wizard. */
export type ShareOpen = { target: ShareTarget } | { made: ShareCreated } | { publish: Generation[] };

/** The dialogs behind useShare(), loaded the first time one opens (ShareProvider in share-provider.tsx). */
export function ShareDialogs({ open, onOpen, onClose }: { open: ShareOpen; onOpen: (o: ShareOpen) => void; onClose: () => void }) {
  const made = (c: ShareCreated) => {
    rememberLink(c.share.id, c.token);
    onOpen({ made: c });
  };
  if ("publish" in open) return <PublishWizard items={open.publish} onClose={onClose} onPublished={made} />;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-[480px]">
        {"made" in open ? <LinkResult created={open.made} onDone={onClose} /> : <ShareForm target={open.target} onMade={made} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareForm({ target, onMade }: { target: ShareTarget; onMade: (c: ShareCreated) => void }) {
  const actions = useShareActions();
  const shares = useShares();
  const [showPrompts, setShowPrompts] = useState(false);
  // Untouched, the title follows the switch: a prompt-made one would show the prompt on a page that hides it.
  const [typed, setTyped] = useState<string | null>(null);
  const title = typed ?? (showPrompts && target.promptTitle ? target.promptTitle : target.title);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const existing = (shares.data?.items ?? []).filter((s) => s.kind === target.kind && s.targetId === target.id).length;
  const create = async () => {
    setBusy(true);
    try {
      onMade(await actions.create({ kind: target.kind, targetId: target.id, title, showPrompts, expiresInDays: days }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void create();
      }}
    >
      <DialogHeader>
        <DialogTitle>Share {NOUN[target.kind]}</DialogTitle>
        <DialogDescription>
          Anyone with the link can view {target.kind === "result" ? "it" : "what's in it"} — no sign-in, nothing they can change, nothing else of your studio.
          {target.kind !== "result" && " Results you add later show up too."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="share-title">Title on the page</Label>
        <Input id="share-title" value={title} maxLength={120} onChange={(e) => setTyped(e.target.value)} placeholder="Untitled" />
      </div>
      <PromptsSwitch value={showPrompts} onChange={setShowPrompts} />
      <ExpiryPicker value={days} onChange={setDays} />
      {existing > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {existing === 1 ? "There's already a link" : `There are already ${existing} links`} to {NOUN[target.kind]}.{" "}
          <Link href="/library?tab=shared" className="text-brand-text underline underline-offset-2">
            Manage links
          </Link>
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create link
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PromptsSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
      <div className="min-w-0">
        <Label htmlFor="share-prompts">Show prompts</Label>
        <p id="share-prompts-hint" className="mt-0.5 text-[12px] text-muted-foreground">
          {value ? "Viewers see each prompt and can copy it with Recreate in your Fuobe." : "Viewers see the results and the model names only."}
        </p>
      </div>
      <Switch id="share-prompts" checked={value} onCheckedChange={onChange} aria-describedby="share-prompts-hint" />
    </div>
  );
}

/** Always / 1 day / 7 days / 30 days, as a segmented radio row. */
export function ExpiryPicker({ value, onChange }: { value: number | null; onChange: (days: number | null) => void }) {
  return (
    <div className="grid gap-1.5">
      <p id="share-expiry" className="text-sm leading-none font-medium">
        Link works for
      </p>
      <div role="radiogroup" aria-labelledby="share-expiry" onKeyDown={radioKeys} className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {EXPIRY_CHOICES.map((c) => {
          const on = c.days === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={radioTab(on)}
              onClick={() => onChange(c.days)}
              className={cn(
                "h-7 flex-1 rounded-lg px-2.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.days === null ? "Always" : c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

/** The link just made: copy or open it, what it shows, and what to check before sending it. */
export function LinkResult({ created, onDone }: { created: ShareCreated; onDone: () => void }) {
  const shares = useShares();
  const url = shareUrl(created.token);
  const [copied, setCopied] = useState(false);
  const s: ShareInfo = created.share;
  const local = typeof window !== "undefined" && LOCAL.test(window.location.hostname);
  const signIn = shares.data?.signIn;
  return (
    <div className="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle>Your link is ready</DialogTitle>
        <DialogDescription>
          {s.showPrompts ? "Prompts shown" : "Prompts hidden"} · {expiryLabel(s.expiresAt).toLowerCase()}. Turn it off any time in{" "}
          <Link href="/library?tab=shared" onClick={onDone} className="text-brand-text underline underline-offset-2">
            Library → Shared
          </Link>
          .
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 gap-1.5">
        <Input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-[12px]" />
        <Button
          type="button"
          onClick={() =>
            void copyWithToast(url, "Link copied").then((ok) => {
              if (ok) setCopied(true);
            })
          }
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {(local || signIn === false) && (
        <div className="grid gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-relaxed">
          {local && (
            <p className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>This address is this computer only (localhost). To share outside it, open Fuobe at an address others can reach, then copy the link there.</span>
            </p>
          )}
          {signIn === false && (
            <p className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Sign-in is off: anyone who can reach this address can use your whole studio, not just this page.{" "}
                <Link href="/settings#security" onClick={onDone} className="text-brand-text underline underline-offset-2">
                  Set a password
                </Link>{" "}
                before you send links outside your network.
              </span>
            </p>
          )}
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">Only this browser can copy the link again later. Elsewhere, Library → Shared can make a new one.</p>
      <DialogFooter>
        <Button type="button" variant="outline" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Open page
          </a>
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
