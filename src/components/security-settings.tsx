"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, LogOut, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Switch } from "@/components/ui/switch";
import { announceAuthChange, rememberViewer } from "@/lib/api";
import { copyWithToast } from "@/lib/clipboard";
import { timeAgo } from "@/lib/format";
import { responseError, toastError } from "@/lib/refusals";

interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
}
interface AuthStatus {
  enabled: boolean;
  fromEnv: boolean;
  tokens: TokenInfo[];
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, j.error ?? "Something went wrong. Please try again.");
  return j;
}

function PasswordForm({ status, onDone }: { status: AuthStatus; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const run = async (password: string | null) => {
    setBusy(true);
    try {
      await call("/api/auth/password", "POST", { current: current || undefined, password });
      toast.success(password === null ? "Password removed — the studio is open again" : status.enabled ? "Password changed" : "Password set — sign-in is now required");
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <div className="space-y-3">
      {status.enabled && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-current`} className="text-[13px]">Current password</Label>
          <Input id={`${id}-current`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="w-full max-w-72" />
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:w-[36rem] sm:max-w-full sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-new`} className="text-[13px]">{status.enabled ? "New password" : "Password"}</Label>
          <Input id={`${id}-new`} type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-repeat`} className="text-[13px]">Repeat it</Label>
          <Input id={`${id}-repeat`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        </div>
      </div>
      {mismatch && <p className="text-[12px] text-destructive">The passwords don&apos;t match</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || next.length < 8 || next !== confirm || (status.enabled && !current)} onClick={() => void run(next)}>
          {busy && <Loader2 className="animate-spin" />}
          {status.enabled ? "Change password" : "Require a password"}
        </Button>
        {status.enabled && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy || !current} onClick={() => void run(null)}>
            Remove password
          </Button>
        )}
      </div>
    </div>
  );
}

/** How to point an MCP client (Claude Code, Claude Desktop…) at this studio. */
function McpSnippet({ token, needsToken }: { token: string | null; needsToken: boolean }) {
  const [origin] = useState(() => (typeof window === "undefined" ? "http://localhost:3000" : window.location.origin));
  const auth = needsToken ? ` --header "Authorization: Bearer ${token ?? "fuobe_…"}"` : "";
  const cmd = `claude mcp add --transport http fuobe ${origin}/api/mcp${auth}`;
  return (
    <div className="space-y-1.5 sm:w-[36rem] sm:max-w-full">
      <p className="text-[12px] font-medium">Connect an agent over MCP</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
        <code tabIndex={0} aria-label="MCP command" className="min-w-0 flex-1 overflow-x-auto rounded-sm font-mono text-[11px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring">{cmd}</code>
        <button
          type="button"
          onClick={() => void copyWithToast(cmd)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Copy command"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Any MCP client works (streamable HTTP). It can search models, price a plan, generate and fetch results{needsToken ? " — create a token for it first" : ""}.
      </p>
    </div>
  );
}

function Tokens({ status, onChange }: { status: AuthStatus; onChange: () => void }) {
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const create = async () => {
    try {
      const r = await call<{ token: string }>("/api/auth/tokens", "POST", { name });
      setFresh(r.token);
      setName("");
      onChange();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-[13px] font-medium">API tokens</h3>
        <p className="text-[12px] text-muted-foreground">
          For scripts and agents (the REST API and the MCP endpoint at <code className="font-mono">/api/mcp</code>). Send as <code className="font-mono">Authorization: Bearer fuobe_…</code>. Only needed once a password is set.
        </p>
      </div>
      {fresh && (
        <div className="rounded-xl border border-primary/40 bg-brand-faint p-3">
          <p className="text-[12px] font-medium">Copy this token now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            {/* The whole token, wrapped (a phone can't show it on one line); one tap selects it all. */}
            <code aria-label="New API token" className="min-w-0 flex-1 rounded-md bg-background px-2 py-1.5 font-mono text-[12px] break-all select-all">
              {fresh}
            </code>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void copyWithToast(fresh)}>
              <Copy /> Copy
            </Button>
          </div>
        </div>
      )}
      {status.tokens.length > 0 && (
        <ul className="divide-y rounded-xl border sm:w-[36rem] sm:max-w-full">
          {status.tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{t.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {t.prefix}… · created {timeAgo(t.createdAt)}
                  {t.lastUsedAt ? ` · used ${timeAgo(t.lastUsedAt)}` : " · never used"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Revoke ${t.name}`}
                onClick={async () => {
                  await call(`/api/auth/tokens?id=${t.id}`, "DELETE").catch((e) => toastError(e));
                  onChange();
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <McpSnippet token={fresh} needsToken={status.enabled} />
      <div className="flex gap-2 sm:w-[36rem] sm:max-w-full">
        <Input
          aria-label="Token name"
          placeholder="Token name, e.g. “Claude Desktop”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()}
        />
        <Button size="sm" variant="secondary" className="h-9 shrink-0" disabled={!name.trim()} onClick={() => void create()}>
          Create token
        </Button>
      </div>
    </div>
  );
}

/**
 * A new session secret: every sign-in on every device ends (this browser's too, and every account's), and the owner
 * signs in again with the same password. It works when the password is set on the server (FUOBE_PASSWORD), which
 * Settings can't change. Optionally revokes every API token as well: offered even when the list looked empty when the
 * page loaded, since a token made since then would otherwise stay.
 */
function SignOutEveryone({ tokens }: { tokens: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [revoke, setRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const run = async () => {
    setBusy(true);
    try {
      await call("/api/auth/sessions", "POST", { tokens: revoke });
      // This browser is signed out too: its other tabs hear of it, and the next page starts as a guest's.
      rememberViewer("guest");
      announceAuthChange();
      router.replace("/login?owner=1");
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 sm:w-[36rem] sm:max-w-full">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-[13px] font-medium">Sign everyone out</h3>
        <Button size="sm" variant="secondary" className="h-8" disabled={busy} onClick={() => setOpen(true)}>
          {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Sign everyone out
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Ends every sign-in on every device: yours, this browser&apos;s and every account&apos;s. Use it if you think someone else signed in as you. Your password stays the same.
      </p>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign everyone out?</AlertDialogTitle>
            <AlertDialogDescription>Everyone has to sign in again, you too. You go to the sign-in page next.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2">
            <Checkbox id={`${id}-tokens`} className="mt-0.5" checked={revoke} onCheckedChange={(v) => setRevoke(!!v)} />
            <Label htmlFor={`${id}-tokens`} className="text-[13px] leading-snug font-normal">
              Also revoke every API token{tokens > 0 ? ` (${tokens})` : ""}. Scripts and agents that use one stop working until you give them a new one.
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void run()}>
              Sign everyone out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface PublicSignupStatus {
  setting: boolean;
  fromEnv: boolean | null;
  active: boolean;
}

/** Public sign-up: guests browse read-only, and anyone can make an account (that runs on its own GPU). */
function PublicSignup() {
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({ queryKey: ["auth", "public"], queryFn: () => call<PublicSignupStatus>("/api/auth/public", "GET") });
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const p = q.data;
  const set = async (on: boolean) => {
    setBusy(true);
    try {
      qc.setQueryData(["auth", "public"], await call<PublicSignupStatus>("/api/auth/public", "PUT", { on }));
      void qc.invalidateQueries({ queryKey: ["viewer"] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 sm:w-[36rem] sm:max-w-full">
      <div className="flex items-center gap-3">
        <Label htmlFor={`${id}-public`} className="flex-1 text-[13px] font-medium">
          Public sign-up
        </Label>
        <Switch id={`${id}-public`} checked={p.fromEnv ?? p.setting} disabled={busy || p.fromEnv !== null} onCheckedChange={(on) => void set(on)} />
      </div>
      <p className="text-[12px] text-muted-foreground">
        Guests can browse every page read-only (not your library), and anyone can sign up with an email and a password. Accounts never use your cloud keys or GPU, and
        can&apos;t change settings, keys or tokens.
        {p.fromEnv !== null && " Set by FUOBE_PUBLIC_SIGNUP on the server."}
        {p.active && !(p.fromEnv ?? p.setting) && " On for this address (fuobe.com)."}{" "}
        <a href="#accounts" className="text-brand-text underline underline-offset-2">
          See who signed up and what they make
        </a>
        .
      </p>
    </div>
  );
}

export function SecuritySettings() {
  const qc = useQueryClient();
  const router = useRouter();
  const status = useQuery({ queryKey: ["auth"], queryFn: () => call<AuthStatus>("/api/auth/password", "GET") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["auth"] });
  if (status.isError) return <p className="text-[13px] text-muted-foreground">{status.error.message} Only the studio&apos;s owner sees these settings.</p>;
  if (!status.data) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  const s = status.data;
  return (
    <div className="space-y-6">
      {s.enabled ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-brand-faint px-3 py-2.5 text-[13px]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-text" />
          <p className="flex-1">Sign-in is required for every page and API call.{s.fromEnv && " The password is set by FUOBE_PASSWORD on the server."}</p>
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 h-7"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              // This browser's other tabs stop going on as the owner, and the next page starts as a guest's.
              rememberViewer("guest");
              announceAuthChange();
              router.replace("/login");
            }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>No password: anyone who can reach this server can use your keys and GPU. Fine on your own computer — set a password before you open it to a network.</p>
        </div>
      )}
      {!s.fromEnv && <PasswordForm status={s} onDone={refresh} />}
      {s.enabled && <PublicSignup />}
      {s.enabled && <SignOutEveryone tokens={s.tokens.length} />}
      <Tokens status={s} onChange={refresh} />
    </div>
  );
}
