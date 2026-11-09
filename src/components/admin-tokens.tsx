"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { READ_ONLY_SCOPES } from "@/lib/admin-scopes";
import { copyWithToast } from "@/lib/clipboard";
import { timeAgo } from "@/lib/format";
import { responseError, toastError } from "@/lib/refusals";

/** An admin token as GET /api/admin/tokens lists it (src/server/admin-tokens.ts): never its value. */
export interface AdminTokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}
interface AdminTokensAnswer {
  tokens: AdminTokenRow[];
  scopes: { id: string; label: string }[];
}
interface AuditRow {
  id: number;
  at: number;
  actor: "owner" | "token" | "system";
  token: { id: string; name: string } | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  status: number;
}

/** The preset that only reads: no emails, no prompts and no results. */
const READ_ONLY: readonly string[] = READ_ONLY_SCOPES;

const EXPIRY = [
  { value: "never", label: "Never expires" },
  { value: "30", label: "Expires in 30 days" },
  { value: "90", label: "Expires in 90 days" },
  { value: "365", label: "Expires in a year" },
];

/** What each logged action did, in a few words. */
const ACTION_WORDS: Record<string, string> = {
  "account.disable": "Switched an account off",
  "account.enable": "Switched an account on",
  "account.signout": "Signed an account out",
  "account.password": "Set an account's password",
  "account.email": "Changed an account's email",
  "account.delete": "Deleted an account",
  "run.delete": "Deleted a run",
  "outputs.hide": "Hid results",
  "outputs.unhide": "Showed results again",
  "outputs.remove": "Removed results",
  "worker.add": "Added a worker",
  "worker.change": "Changed a worker",
  "worker.rotate": "Gave a worker a new token",
  "worker.revoke": "Revoked a worker",
  "worker.revoke_all": "Revoked every worker",
  "worker.alert": "A worker's token was used from somewhere new",
  "runs.waiting": "Runs waited over 5 minutes for the billing or moderation service",
  "queue.settings": "Changed the queue's settings",
  "settings.comfy_where": "Changed where ComfyUI runs",
  "runs.content": "Read an account's prompts and results",
  "token.create": "Made an admin token",
  "token.revoke": "Revoked an admin token",
  "token.revoke_all": "Revoked every admin token",
  "accounts.list": "Read the accounts",
  "accounts.csv": "Downloaded the accounts",
  "account.read": "Read an account",
  "runs.list": "Read accounts' runs",
  "reports.list": "Read the reports",
  "audit.read": "Read this log",
  "file.view": "Opened a file",
  "scope.denied": "Refused: not allowed",
  "rate.limited": "Refused: too many requests",
};

export const ADMIN_TOKENS_KEY = ["admin-tokens"];

/** What a log row was about, in short: a name the action kept, the results it named, or its target. */
function rowSubject(r: AuditRow): string | null {
  const d = r.detail ?? {};
  if (typeof d.name === "string" && d.name) return d.name;
  if (typeof d.count === "number") return String(d.count);
  if (Array.isArray(d.ids) && d.ids.length) {
    const ids = d.ids.filter((x): x is string => typeof x === "string");
    return ids.length > 3 ? `${ids.slice(0, 3).join(", ")} +${ids.length - 3}` : ids.join(", ");
  }
  return r.target;
}

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, j.error ?? "Something went wrong. Please try again.");
  return j;
}

export const fetchAdminTokens = () => call<AdminTokensAnswer>("/api/admin/tokens");

/** Expired: it no longer works (it stays listed until revoked). */
export const isExpired = (t: Pick<AdminTokenRow, "expiresAt">, now = Date.now()) => t.expiresAt !== null && t.expiresAt <= now;

function expiryText(t: AdminTokenRow, now = Date.now()): string {
  if (t.expiresAt === null) return "never expires";
  if (t.expiresAt <= now) return "expired";
  const days = Math.ceil((t.expiresAt - now) / 86_400_000);
  return days <= 1 ? "expires within a day" : `expires in ${days} days`;
}

function CreateForm({ scopes, onMade, onCancel }: { scopes: AdminTokensAnswer["scopes"]; onMade: (made: { id: string; token: string }) => void; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(READ_ONLY));
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const all = scopes.map((s) => s.id);
  const same = (ids: readonly string[]) => ids.length === picked.size && ids.every((s) => picked.has(s));
  const create = async () => {
    setBusy(true);
    try {
      const r = await call<{ token: string; info: { id: string } }>("/api/admin/tokens", "POST", { name: name.trim(), scopes: [...picked], expiresInDays: expiry === "never" ? null : Number(expiry) });
      setName("");
      onMade({ id: r.info.id, token: r.token });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border p-3 sm:w-[36rem] sm:max-w-full">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`} className="text-[13px]">Name</Label>
        <Input id={`${id}-name`} placeholder="What it's for, e.g. “Moderation script”" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div role="group" aria-labelledby={`${id}-scopes`} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p id={`${id}-scopes`} className="flex-1 text-[13px] font-medium">
            What it may do
          </p>
          <Button size="sm" variant={same(READ_ONLY) ? "secondary" : "ghost"} className="h-7" onClick={() => setPicked(new Set(READ_ONLY))}>
            Read only
          </Button>
          <Button size="sm" variant={same(all) ? "secondary" : "ghost"} className="h-7" onClick={() => setPicked(new Set(all))}>
            Full admin
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {scopes.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <Checkbox
                id={`${id}-${s.id}`}
                className="mt-0.5"
                checked={picked.has(s.id)}
                onCheckedChange={(on) =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (on) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  })
                }
              />
              <Label htmlFor={`${id}-${s.id}`} className="block text-[13px] leading-snug font-normal">
                {s.label}
                <span className="block font-mono text-[11px] text-muted-foreground">{s.id}</span>
              </Label>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={expiry} onValueChange={setExpiry}>
          <SelectTrigger aria-label="Expiry" className="h-9 w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-9" disabled={busy || !name.trim() || picked.size === 0} onClick={() => void create()}>
          {busy && <Loader2 className="animate-spin" />}
          Create admin token
        </Button>
        <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TokenItem({ t, onRevoke }: { t: AdminTokenRow; onRevoke: () => void }) {
  const expired = isExpired(t);
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">
          {t.name}
          {expired && <span className="ml-2 text-[11px] font-normal text-muted-foreground">Expired</span>}
        </p>
        <p className="font-mono text-[11px] break-words text-muted-foreground">
          {t.prefix}… · created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"} · {expiryText(t)}
        </p>
        <p className="mt-1 flex flex-wrap gap-1">
          {t.scopes.map((s) => (
            <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              {s}
            </span>
          ))}
        </p>
      </div>
      <Button size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Revoke ${t.name}`} onClick={onRevoke}>
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/** The admin log, newest first: what the admin API changed, and what tokens read. */
function AdminLog() {
  const [changes, setChanges] = useState(true);
  const q = useInfiniteQuery({
    queryKey: ["admin-audit", changes],
    initialPageParam: "",
    queryFn: ({ pageParam }) => call<{ items: AuditRow[]; next: string | null }>(`/api/admin/audit?limit=20${changes ? "&changes=1" : ""}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-1.5 sm:w-[36rem] sm:max-w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex-1 text-[12px] font-medium">Admin log</h4>
        <div role="group" aria-label="Show" className="flex gap-1">
          <Button size="sm" variant={changes ? "secondary" : "ghost"} className="h-7" aria-pressed={changes} onClick={() => setChanges(true)}>
            Changes
          </Button>
          <Button size="sm" variant={changes ? "ghost" : "secondary"} className="h-7" aria-pressed={!changes} onClick={() => setChanges(false)}>
            Everything
          </Button>
        </div>
      </div>
      {q.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : q.isError ? (
        <p className="text-[12px] text-muted-foreground">{q.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{changes ? "No changes yet. What the admin API changes shows here." : "Nothing yet. Changes made through the admin API, and what tokens read, show here."}</p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border text-[12px]">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  {ACTION_WORDS[r.action] ?? r.action}
                  {rowSubject(r) && <span className="ml-1.5 font-mono text-[11px] break-all text-muted-foreground">{rowSubject(r)}</span>}
                  {r.status >= 400 && <span className="ml-1.5 text-[11px] text-destructive">{r.status}</span>}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {r.actor === "token" ? (r.token?.name ?? "A token") : r.actor === "system" ? "The studio" : "You"} · {timeAgo(r.at)}
                </span>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <Button size="sm" variant="ghost" className="h-7" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage && <Loader2 className="animate-spin" />}
              Show older
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Settings → Security → Admin tokens (the owner's signed-in browser only): tokens for your own tools to manage this
 * install through the admin API, each with only the rights ticked. The value is shown once.
 */
export function AdminTokens() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ADMIN_TOKENS_KEY, queryFn: fetchAdminTokens });
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [making, setMaking] = useState(false);
  const [revoking, setRevoking] = useState<AdminTokenRow | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ADMIN_TOKENS_KEY });
    void qc.invalidateQueries({ queryKey: ["admin-audit"] });
  };
  if (q.isError) return null;
  const revoke = async (t: AdminTokenRow) => {
    try {
      await call(`/api/admin/tokens?id=${encodeURIComponent(t.id)}`, "DELETE");
      // A token shown once and revoked since is no use to copy.
      setFresh((f) => (f?.id === t.id ? null : f));
      toast.success(`Revoked ${t.name}`);
    } catch (e) {
      toastError(e);
    }
    refresh();
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1 sm:w-[36rem] sm:max-w-full">
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-[13px] font-medium">Admin tokens</h3>
          {!making && q.data && (
            <Button size="sm" variant="secondary" className="h-8" onClick={() => setMaking(true)}>
              New admin token
            </Button>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          An admin token lets your own tools manage this install&apos;s accounts, runs and workers through the admin API. It only works on{" "}
          <code className="font-mono">/api/admin</code>, and only for the rights you tick.
        </p>
      </div>
      {fresh && (
        <div className="rounded-xl border border-primary/40 bg-brand-faint p-3 sm:w-[36rem] sm:max-w-full">
          <p className="text-[12px] font-medium">Copy this token now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code aria-label="New admin token" className="ph-no-capture min-w-0 flex-1 rounded-md bg-background px-2 py-1.5 font-mono text-[12px] break-all select-all">
              {fresh.token}
            </code>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void copyWithToast(fresh.token)}>
              <Copy /> Copy
            </Button>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {making && q.data && (
        <CreateForm
          scopes={q.data.scopes}
          onCancel={() => setMaking(false)}
          onMade={(made) => {
            setFresh(made);
            setMaking(false);
            refresh();
          }}
        />
      )}
      {!q.data ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        q.data.tokens.length > 0 && (
          <ul className="divide-y rounded-xl border sm:w-[36rem] sm:max-w-full">
            {q.data.tokens.map((t) => (
              <TokenItem key={t.id} t={t} onRevoke={() => setRevoking(t)} />
            ))}
          </ul>
        )
      )}
      {q.data && <AdminLog />}
      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It stops working at once. Tools that use it need a new token.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (revoking) void revoke(revoking);
                setRevoking(null);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
