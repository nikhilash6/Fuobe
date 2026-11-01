"use client";

import { Clock, Copy, ExternalLink, Eye, EyeOff, Globe, Link2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MediaThumb } from "@/components/studio/result-media";
import { useNow } from "@/components/studio/use-now";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useShareActions, useShares } from "@/lib/api";
import { copyWithToast } from "@/lib/clipboard";
import { timeAgo } from "@/lib/format";
import { EXPIRY_CHOICES, expiryLabel, isExpired, KIND_LABELS, pieces, PUBLISH_LAYOUTS, type ShareListItem, type SharePatch } from "@/lib/share";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { forgetLink, rememberLink, shareUrl, useRememberedLinks, useShare } from "./share-provider";

/**
 * Library → Shared: every share link, live ones first, with what each shows, its access and expiry,
 * views, and Copy / Open (when this browser made it), prompts on or off, a new expiry, a new link,
 * and Revoke.
 */
export function SharedLinks() {
  const shares = useShares();
  // Tokens live in this browser's storage only.
  const known = useRememberedLinks();
  // Expiry labels and the live / not working split stay right while the list is open.
  const now = useNow(60_000);
  const items = shares.data?.items;
  if (shares.isLoading) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading links">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (shares.isError) return <p className="text-[14px] text-destructive">Couldn&apos;t load your links: {(shares.error as Error).message}</p>;
  const live = (items ?? []).filter((s) => !s.gone && !isExpired(s, now));
  const ended = (items ?? []).filter((s) => s.gone || isExpired(s, now));
  if (!live.length && !ended.length) {
    return (
      <div className="rounded-xl border border-primary/10 bg-brand-faint px-6 py-12 text-center">
        <p className="font-heading text-[22px]">Nothing shared yet</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] text-muted-foreground">
          Share a result from its ⋯ menu, a folder from its menu, a Cinema project from its header, or select results and choose Publish to make a page of them.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-7">
      {shares.data?.signIn === false && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[13px]">
          Sign-in is off, so anyone who can reach this studio can use all of it, not just the shared pages. Set a password in Settings → Security before sending links outside your network.
        </p>
      )}
      <section aria-label="Live links">
        <h2 className="mb-2.5 text-[13px] font-medium">
          Live <span className="font-mono text-[11px] font-normal text-muted-foreground">{live.length}</span>
        </h2>
        {live.length ? (
          <ul className="grid gap-2">
            {live.map((s) => (
              <Row key={s.id} s={s} token={known[s.id]} now={now} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No live links.</p>
        )}
      </section>
      {ended.length > 0 && (
        <section aria-label="Links that no longer work">
          <h2 className="mb-2.5 text-[13px] font-medium">
            Not working <span className="font-mono text-[11px] font-normal text-muted-foreground">{ended.length}</span>
          </h2>
          <ul className="grid gap-2">
            {ended.map((s) => (
              <Row key={s.id} s={s} token={known[s.id]} now={now} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ s, token, now }: { s: ShareListItem; token?: string; now: number }) {
  const actions = useShareActions();
  const share = useShare();
  const [confirm, setConfirm] = useState(false);
  const expired = isExpired(s, now);
  const dead = s.gone || expired;
  const fail = (e: Error) => toastError(e);
  const kind = s.kind === "publish" ? `${PUBLISH_LAYOUTS.find((l) => l.id === s.layout)?.label ?? "Published"} page` : KIND_LABELS[s.kind];
  // A new token (and, for an expired link, a new expiry with it): the dialog shows the link to copy.
  const renew = (patch: SharePatch = {}) =>
    void actions
      .update(s.id, { ...patch, newLink: true })
      .then((r) => {
        if (!r.token || !r.path) return;
        rememberLink(r.share.id, r.token, s.id);
        share?.showLink({ share: r.share, token: r.token, path: r.path });
      })
      .catch(fail);
  // Turning an expired link back on: this browser has its token, so the old link works again; else a new one to copy.
  const reopen = (days: number | null) =>
    token ? void actions.update(s.id, { expiresInDays: days }).then((r) => toast(expiryLabel(r.share.expiresAt))).catch(fail) : renew({ expiresInDays: days });
  return (
    <li className={cn("flex min-w-0 items-center gap-3 rounded-xl border bg-card p-2.5", dead && "opacity-75")}>
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
        {s.thumb ? <MediaThumb output={{ url: s.thumb.url, kind: s.thumb.kind, ...(s.thumb.poster && { meta: { poster: s.thumb.poster } }) }} className="size-full" /> : s.kind === "publish" ? <Globe className="size-5 text-muted-foreground" /> : <Link2 className="size-5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{s.title}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {kind} · {s.gone ? "removed from your studio" : pieces(s.count)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {s.showPrompts ? <Eye className="size-3" /> : <EyeOff className="size-3" />} {s.showPrompts ? "Prompts shown" : "Prompts hidden"}
          </span>
          <span className={cn("inline-flex items-center gap-1", expired && "text-destructive")}>
            <Clock className="size-3" /> {expiryLabel(s.expiresAt, now)}
          </span>
          <span>
            {s.views} view{s.views === 1 ? "" : "s"}
            {s.lastViewedAt ? `, last ${timeAgo(s.lastViewedAt, now)}` : ""}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {token && !dead && (
          <>
            <Button variant="outline" size="sm" className="max-sm:hidden" onClick={() => void copyWithToast(shareUrl(token), "Link copied")}>
              <Copy /> Copy link
            </Button>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={shareUrl(token)} target="_blank" rel="noreferrer" aria-label={`Open the page for ${s.title}`} title="Open page">
                <ExternalLink />
              </a>
            </Button>
          </>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Link options for ${s.title}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {token && !dead && (
              <DropdownMenuItem onSelect={() => void copyWithToast(shareUrl(token), "Link copied")}>
                <Copy /> Copy link
              </DropdownMenuItem>
            )}
            {/* An expired link comes back through "Turn back on for" (with a new expiry), not a dead new link. */}
            {!dead && (
              <DropdownMenuItem onSelect={() => renew()}>
                <RefreshCw /> {token ? "New link (the old one stops)" : "New link to copy"}
              </DropdownMenuItem>
            )}
            {!s.gone && (
              <DropdownMenuItem
                onSelect={() =>
                  void actions
                    .update(s.id, { showPrompts: !s.showPrompts })
                    // Hiding prompts also swaps a title made from the prompt (src/server/shares.ts updateShare).
                    .then((r) => toast(s.showPrompts ? "Prompts hidden on the page" : "Prompts shown on the page", r.share.title !== s.title ? { description: `Its title was the prompt, so it's now “${r.share.title}”.` } : undefined))
                    .catch(fail)
                }
              >
                {s.showPrompts ? <EyeOff /> : <Eye />} {s.showPrompts ? "Hide prompts" : "Show prompts"}
              </DropdownMenuItem>
            )}
            {!s.gone && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Clock /> {expired ? "Turn back on for" : "Stops working"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {EXPIRY_CHOICES.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onSelect={() => (expired ? reopen(c.days) : void actions.update(s.id, { expiresInDays: c.days }).then((r) => toast(expiryLabel(r.share.expiresAt))).catch(fail))}
                    >
                      {expired ? (c.days === null ? "Always" : c.label) : c.days === null ? "Never" : `In ${c.label}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(() => setConfirm(true), 0)}>
              <Trash2 /> {dead ? "Remove" : "Revoke link"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dead ? "Remove this link?" : "Revoke this link?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {dead ? "It already doesn't work; this takes it off the list." : `“${s.title}” stops opening at once for everyone who has the link. What it shows stays in your studio.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void actions
                  .revoke(s.id)
                  .then(() => {
                    forgetLink(s.id);
                    toast(dead ? "Removed" : "Link revoked");
                  })
                  .catch(fail)
              }
            >
              {dead ? "Remove" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
