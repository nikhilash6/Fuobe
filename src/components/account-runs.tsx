"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ExternalLink, Filter, Loader2, MoreHorizontal, Trash2, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { adminCall, OffBadge, runsHref, Stat, useAdminAccounts, useAdminAction, type AccountRow } from "@/components/accounts-admin";
import { StatusCover } from "@/components/library/asset-card";
import { PageHeader } from "@/components/page-shell";
import { GallerySkeleton } from "@/components/skeletons";
import { MediaThumb } from "@/components/studio/result-media";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewer } from "@/lib/api";
import { OPERATION_LABELS, type Generation, type MediaKind, type OutputFile } from "@/lib/catalog/types";
import { storageSize, timeAgo } from "@/lib/format";
import { editOnlyFormat, modelPreview, shownOutputs } from "@/lib/output-actions";
import { cn } from "@/lib/utils";

/** An account's run as GET /api/admin/generations lists it, with whose it is (null email: the account was deleted). */
type AdminRun = Generation & { account: { id: string; email: string | null } };
type Status = "all" | "finished" | "running" | "failed";
type Kind = "all" | MediaKind;

const STATUSES: [Status, string][] = [
  ["all", "Any status"],
  ["finished", "Finished"],
  ["running", "Running"],
  ["failed", "Failed"],
];
const KINDS: [Kind, string][] = [
  ["all", "All kinds"],
  ["image", "Images"],
  ["video", "Videos"],
  ["audio", "Audio"],
  ["model3d", "3D"],
  ["text", "Text"],
];
const STATUS_LABELS: Record<Generation["status"], string> = { succeeded: "Finished", queued: "Queued", running: "Running", failed: "Failed", canceled: "Canceled" };
const PAGE = 30;

const featureName = (f: string) => f.charAt(0).toUpperCase() + f.slice(1).replaceAll("-", " ");

/** The filters in the page's address (?status=failed&kind=video), so a reload, Back or a shared link keeps them. */
export function runFilters(sp: Pick<URLSearchParams, "get">): { status: Status; kind: Kind } {
  return {
    status: STATUSES.find(([v]) => v === sp.get("status"))?.[0] ?? "all",
    kind: KINDS.find(([v]) => v === sp.get("kind"))?.[0] ?? "all",
  };
}

/** A run's files, one "Open file" each: what its tile can show (a 3D model's turntable is the model's preview, not a file of its own). */
export function runFiles(g: Pick<Generation, "kind" | "outputs">): { index: number; url: string; label: string }[] {
  const shown = shownOutputs(g);
  return shown.map((index, n) => ({ index, url: g.outputs[index].url, label: shown.length > 1 ? `Open file ${n + 1} of ${shown.length}` : "Open file" }));
}

/** Whether a tile plays a clip (a video the browser plays, or a 3D model's turntable): its box then plays and pauses on a tap or a key. */
export function playsClip(g: Pick<Generation, "outputs" | "op" | "request">, out?: OutputFile): boolean {
  if (out?.kind === "video") return !editOnlyFormat(g, out);
  return out?.kind === "model3d" && !!modelPreview(g, out).video;
}

/**
 * Settings → Accounts' runs (the owner only): what accounts made on their own GPUs, newest first, one account's or every
 * account's, with their results, prompts and errors. Its own queries only: the Library's Viewer and result actions act
 * on the owner's library (their delete would move an account's run to the owner's Trash).
 */
export function AccountRunsView() {
  const viewer = useViewer();
  const owner = !!viewer.data?.owner;
  const router = useRouter();
  const sp = useSearchParams();
  const account = sp.get("account") ?? "";
  const { status, kind } = runFilters(sp);
  const accounts = useAdminAccounts(owner);
  const act = useAdminAction();
  const rows = accounts.data?.items;
  const me = rows?.find((a) => a.id === account);
  const gone = !!account && !!rows && !me;
  const runs = useInfiniteQuery({
    queryKey: ["admin-runs", { account, status, kind }],
    enabled: owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (account) q.set("account", account);
      if (status !== "all") q.set("status", status);
      if (kind !== "all") q.set("kind", kind);
      if (pageParam) q.set("before", pageParam);
      return adminCall<{ items: AdminRun[]; next: string | null }>(`/api/admin/generations?${q}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
    // While a run is going, its progress and result come in every 10 seconds.
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some((g) => g.status === "queued" || g.status === "running")) ? 10_000 : false),
  });

  if (viewer.isPending) return <GallerySkeleton cards={8} />;
  if (!owner) return <PageHeader title="Accounts' runs" description="Only the studio's owner sees accounts' runs." />;

  // Another account is another page (Back returns to this one); a filter changes this one.
  const show = (to: { account?: string; status?: Status; kind?: Kind }) => {
    const href = runsHref({ account, status, kind, ...to });
    if ("account" in to) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };
  const switchAccount = (a: Pick<AccountRow, "id" | "email" | "disabled">) => {
    if (!a.disabled && !window.confirm(`Switch ${a.email} off? They're signed out at once and can't log in until you switch them on again.`)) return;
    void act(() => adminCall(`/api/admin/accounts/${a.id}`, "PATCH", { disabled: !a.disabled }), a.disabled ? "Switched on" : "Switched off");
  };
  const deleteRun = (g: AdminRun) => {
    if (!window.confirm(`Delete this run by ${g.account.email ?? "a deleted account"} and its files? This can't be undone.`)) return;
    void act(() => adminCall(`/api/admin/generations/${g.id}`, "DELETE"), "Run deleted");
  };
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = status !== "all" || kind !== "all";
  // Whose runs: the account's row, else the email its runs carry (while the accounts load, or when they couldn't).
  const email = me?.email ?? items.find((g) => g.account.id === account)?.account.email ?? undefined;

  return (
    <>
      {!account ? (
        <PageHeader title="Accounts' runs" description="What people who signed up made on their own GPUs, newest first. Your own runs are in your Library." />
      ) : gone ? (
        <PageHeader title="Deleted account" description="This account no longer exists. Runs it left behind are listed until the next clean-up." />
      ) : email ? (
        <PageHeader title={email} description="This account's runs, newest first." />
      ) : accounts.isPending || runs.isPending ? (
        <div className="pb-6" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="mt-2 h-4 w-52 max-w-full" />
        </div>
      ) : (
        <PageHeader title="Accounts' runs" description="This account's runs, newest first." />
      )}

      {accounts.isError && !rows && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-destructive">
            Couldn&apos;t load {account ? "the account" : "the accounts"}. {accounts.error.message}
          </p>
          <Button size="sm" variant="secondary" disabled={accounts.isFetching} onClick={() => void accounts.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {me && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <Stat label="Runs">{me.runs}</Stat>
            <Stat label="In 7 days">{me.runsWeek}</Stat>
            <Stat label="Failed in 7 days" className={cn(me.failedWeek > 0 && "text-destructive")}>
              {me.failedWeek}
            </Stat>
            <Stat label="Running now">{me.running}</Stat>
            <Stat label="Last run">{me.lastRunAt ? timeAgo(me.lastRunAt) : "—"}</Stat>
            <Stat label="Files" className={cn(me.bytes >= 0.9 * me.capBytes && "text-warning")}>
              {storageSize(me.bytes)} of {storageSize(me.capBytes)}
            </Stat>
            <Stat label="GPU">{me.gpu ? "Connected" : "Not connected"}</Stat>
          </dl>
          {me.disabled && <OffBadge />}
          <Button size="sm" variant="secondary" onClick={() => switchAccount(me)}>
            {me.disabled ? <UserCheck /> : <UserX />} {me.disabled ? "Switch on" : "Switch off"}
          </Button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select value={account || "all"} onValueChange={(id) => show({ account: id === "all" ? undefined : id })}>
          <SelectTrigger className="col-span-2 w-full sm:col-span-1 sm:w-auto sm:max-w-80 sm:min-w-44" aria-label="Account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every account</SelectItem>
            {rows?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.email}
                {a.disabled ? " (off)" : ""}
              </SelectItem>
            ))}
            {account && !me && <SelectItem value={account}>{gone ? "Deleted account" : (email ?? "This account")}</SelectItem>}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => show({ status: v as Status })}>
          <SelectTrigger className="w-full sm:w-auto sm:min-w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => show({ kind: v as Kind })}>
          <SelectTrigger className="w-full sm:w-auto sm:min-w-44" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {runs.isFetching && !runs.isFetchingNextPage && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {runs.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square rounded-xl" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : runs.isError && !runs.data ? (
        <div className="space-y-2">
          <p className="text-[13px] text-destructive">Couldn&apos;t load the runs. {runs.error.message}</p>
          <Button size="sm" variant="secondary" onClick={() => void runs.refetch()}>
            Try again
          </Button>
        </div>
      ) : !items.length ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-[13px] text-muted-foreground">
          {filtered ? (
            <>
              <p>No runs match these filters.</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => show({ status: "all", kind: "all" })}>
                Clear filters
              </Button>
            </>
          ) : account ? (
            <p>This account hasn&apos;t run anything yet.</p>
          ) : (
            <p>No runs yet. When someone who signed up runs something on their GPU, it shows here.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((g) => (
            <RunCard
              key={g.id}
              g={g}
              one={!!account}
              href={runsHref({ account: g.account.id, status, kind })}
              row={rows?.find((a) => a.id === g.account.id)}
              onSwitch={switchAccount}
              onDelete={deleteRun}
            />
          ))}
        </div>
      )}

      {runs.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" size="sm" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
            {runs.isFetchingNextPage ? (
              <>
                <Loader2 className="animate-spin" /> Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * One run: its result (a picture opens full size, a clip plays on hover, a tap or Enter, sound has its player; the
 * count steps through a run's files), what made it, the prompt, its status and when. `one`: the page shows one account,
 * so the email is left out; `href`: this account's runs, with the filters; `row`: the account's row (its off state),
 * absent when the account is gone.
 */
function RunCard({
  g,
  one,
  href,
  row,
  onSwitch,
  onDelete,
}: {
  g: AdminRun;
  one: boolean;
  href: string;
  row?: AccountRow;
  onSwitch: (a: AccountRow) => void;
  onDelete: (g: AdminRun) => void;
}) {
  const files = runFiles(g);
  const [at, setAt] = useState(0);
  const n = files.length ? at % files.length : 0;
  const out = g.status === "succeeded" && files.length ? g.outputs[files[n].index] : undefined;
  const clip = playsClip(g, out);
  // Whether the clip was paused when the press began: a tap's emulated hover starts it just before the click.
  const paused = useRef(true);
  const toggle = (v: HTMLVideoElement | null, wasPaused: boolean) => {
    if (!v) return;
    if (wasPaused) void v.play().catch(() => {});
    else v.pause();
  };
  return (
    <div className="min-w-0">
      <div className="relative">
        <div
          className={cn("aspect-square overflow-hidden rounded-xl border bg-muted", clip && "outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          role={clip ? "button" : undefined}
          tabIndex={clip ? 0 : undefined}
          aria-label={clip ? "Play or pause the clip" : undefined}
          onPointerDown={(e) => {
            paused.current = e.currentTarget.querySelector("video")?.paused ?? true;
          }}
          onClick={(e) => toggle(e.currentTarget.querySelector("video"), paused.current)}
          onKeyDown={(e) => {
            if (!clip || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            const v = e.currentTarget.querySelector("video");
            toggle(v, v?.paused ?? true);
          }}
        >
          {!out ? (
            <StatusCover g={g} />
          ) : out.kind === "image" ? (
            <a href={out.url} target="_blank" rel="noreferrer" aria-label="Open the picture" className="block size-full">
              <MediaThumb key={out.url} output={out} g={g} />
            </a>
          ) : (
            <MediaThumb key={out.url} output={out} g={g} />
          )}
        </div>
        {out && files.length > 1 && (
          <button
            type="button"
            className="absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular-nums hover:bg-black/75"
            aria-label={`File ${n + 1} of ${files.length}: show the next`}
            onClick={() => setAt(n + 1)}
          >
            {n + 1}/{files.length}
          </button>
        )}
      </div>
      <div className="relative mt-2 min-w-0 space-y-0.5 pr-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="absolute -top-1 right-0 size-7 text-muted-foreground" aria-label="Run actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {files.map((f) => (
              <DropdownMenuItem key={f.index} asChild>
                <a href={f.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> {f.label}
                </a>
              </DropdownMenuItem>
            ))}
            {!one && (
              <DropdownMenuItem asChild>
                <Link href={href}>
                  <Filter /> Only this account
                </Link>
              </DropdownMenuItem>
            )}
            {row && (
              <DropdownMenuItem onClick={() => onSwitch(row)}>
                {row.disabled ? <UserCheck /> : <UserX />} {row.disabled ? "Switch account on" : "Switch account off"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(g)}>
              <Trash2 /> Delete run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!one && (
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium">
            {g.account.email ? (
              <Link href={href} className="truncate underline-offset-2 hover:underline">
                {g.account.email}
              </Link>
            ) : (
              <span className="truncate text-muted-foreground">Deleted account</span>
            )}
            {row?.disabled && <OffBadge />}
          </div>
        )}
        <p className="truncate text-[13px] font-medium">{g.presetName ?? featureName(g.feature)}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {g.modelName ?? g.modelId} · {OPERATION_LABELS[g.op] ?? g.op}
        </p>
        <RunWords g={g} />
        <p className="truncate text-[12px] text-muted-foreground">
          <span className={cn(g.status === "failed" ? "text-destructive" : (g.status === "queued" || g.status === "running") && "text-foreground")}>
            {STATUS_LABELS[g.status]}
            {g.status === "running" && g.progress != null ? ` · ${Math.round(g.progress * 100)}%` : ""}
          </span>
          {" · "}
          <span title={new Date(g.createdAt).toLocaleString()}>{timeAgo(g.createdAt)}</span>
        </p>
      </div>
    </div>
  );
}

/** The prompt, two lines until "More" opens it whole, with a failed run's whole error. */
function RunWords({ g }: { g: AdminRun }) {
  const [open, setOpen] = useState(false);
  const prompt = g.request.prompt?.trim() || g.prompt?.trim();
  const error = g.status === "failed" ? g.error : null;
  return (
    <div className="text-[12px]">
      {prompt ? <p className={cn("break-words", open ? "whitespace-pre-wrap" : "line-clamp-2")}>{prompt}</p> : <p className="text-muted-foreground italic">No prompt</p>}
      {open && error && <p className="mt-1 break-words whitespace-pre-wrap text-destructive">{error}</p>}
      {((prompt?.length ?? 0) > 120 || error) && (
        <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
