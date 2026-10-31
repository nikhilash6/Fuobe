"use client";

import { Eye, EyeOff, Info, KeyRound, Loader2, LogOut, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInHref, signOut, useHydrated, useViewer } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Settings' line under its title: what this viewer finds on the page. Nothing until the viewer is known (as below). */
export function SettingsIntro() {
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner)
    return "Choose open source, paid APIs or both, connect providers, point Fuobe at your ComfyUI server, and choose how prompts get enhanced. Keys stay on this server.";
  return v.account ? "Your account, your GPU and your own keys. The studio's own settings are its owner's." : "Create a free account and connect your own GPU.";
}

/**
 * The install's settings, for its owner only. A guest (public sign-up) is offered an account, which
 * connects its own GPU here; an account sees Your GPU (AccountGpuSection) and its account, nothing of the install's.
 * Both can read the licences.
 */
export function OwnerSettings({ children }: { children: React.ReactNode }) {
  // The server renders nothing here (it doesn't know the viewer), so hydration must too, even when the browser's
  // viewer query has already answered (a component outside this page's boundary asked first).
  const hydrated = useHydrated();
  const v = useViewer().data;
  if (!hydrated || !v) return null;
  if (v.owner) return <>{children}</>;
  return (
    <>
      {v.account ? (
        <AccountSection email={v.account.email} />
      ) : (
        <section className="space-y-3 border-b py-8">
          <h2 className="text-[15px] font-semibold">Run Fuobe on your own GPU</h2>
          <p className="max-w-xl text-[13px] text-muted-foreground">
            Create a free account, then connect your own ComfyUI: your runs go to your GPU. It must be reachable from the internet, for example through a Cloudflare Tunnel or ngrok.
          </p>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={signInHref("signup", "/settings#your-gpu")}>Sign up free</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={signInHref("login", "/settings#your-gpu")}>Log in</Link>
            </Button>
          </div>
        </section>
      )}
      <Licences />
    </>
  );
}

const linkCard = "inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors hover:bg-accent";

/** The licence pages, which everyone may read (the owner finds them in the settings form). */
function Licences() {
  return (
    <section aria-labelledby="licences-title" className="grid grid-cols-[minmax(0,1fr)] gap-4 py-8 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="licences-title" className="text-[15px] font-semibold">
          Licences
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Every model&apos;s licence, Fuobe&apos;s own, and the notices the open models ask for.</p>
      </div>
      <div className="flex flex-wrap content-start gap-2">
        <Link href="/settings/models" className={linkCard}>
          <Scale className="size-4 text-muted-foreground" /> Models &amp; licences
        </Link>
        <Link href="/settings/about" className={linkCard}>
          <Info className="size-4 text-muted-foreground" /> About &amp; licences
        </Link>
      </div>
    </section>
  );
}

/**
 * An account's own: changing its password, signing out, and deleting it (its password again, DELETE /api/auth/me),
 * which takes its runs, files and GPU with it.
 */
function AccountSection({ email }: { email: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.status === 204) {
        // A full load: the page and every cached answer were the account's.
        window.location.replace(window.location.origin);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `The account wasn't deleted (${res.status})`);
    } catch {
      setError("The account wasn't deleted: the studio didn't answer. Try again.");
    }
    setBusy(false);
  };
  return (
    <section id="account" aria-labelledby="account-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-4 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="account-title" className="text-[15px] font-semibold">
          Account
        </h2>
        <p className="mt-1 text-[13px] [overflow-wrap:anywhere] text-muted-foreground">{email}</p>
      </div>
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
            <KeyRound /> Change password
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
        <div className="space-y-2">
          <p className="max-w-xl text-[13px] text-pretty text-muted-foreground">
            Deleting your account removes your uploads, your runs and their files, your GPU connection and your saved fal.ai and Replicate keys, and signs you out. It can&apos;t
            be undone.
          </p>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
            <Trash2 /> Delete account
          </Button>
        </div>
      </div>
      <ChangePassword open={changing} onOpenChange={setChanging} />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          setPassword("");
          setError("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={remove} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                {email} and everything you made with it go for good. Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-password`} className="text-[13px]">
                Password
              </Label>
              <Input
                id={`${id}-password`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                autoFocus
              />
              {error && (
                <p id={`${id}-error`} role="alert" className="text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={busy || !password}>
                {busy && <Loader2 className="animate-spin" />}
                Delete account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** A password field with a button that shows what was typed (as on the sign-in page). */
function PasswordInput({ id, shown, onShow, ...props }: React.ComponentProps<typeof Input> & { id: string; shown: boolean; onShow: () => void }) {
  return (
    <div className="relative">
      <Input id={id} type={shown ? "text" : "password"} className="pr-10" {...props} />
      <button
        type="button"
        onClick={onShow}
        aria-label="Show password"
        aria-pressed={shown}
        aria-controls={id}
        className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Settings → Account → Change password (PATCH /api/auth/me): the current password, then the new one. Every other
 * browser signed in to the account is signed out; this one stays signed in.
 */
function ChangePassword({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const short = next.length > 0 && next.length < 8;
  const reset = () => {
    setCurrent("");
    setNext("");
    setShown(false);
    setError("");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
      if (res.ok) {
        toast.success("Password changed", { description: "You're still signed in here. Any other browser signed in to your account is signed out." });
        reset();
        onOpenChange(false);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `The password wasn't changed (${res.status})`);
      }
    } catch {
      setError("The password wasn't changed: the studio didn't answer. Try again.");
    }
    setBusy(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
        reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>Any other browser signed in to your account is signed out. You stay signed in here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-current`} className="text-[13px]">
              Current password
            </Label>
            <PasswordInput
              id={`${id}-current`}
              shown={shown}
              onShow={() => setShown((s) => !s)}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new`} className="text-[13px]">
              New password
            </Label>
            <PasswordInput
              id={`${id}-new`}
              shown={shown}
              onShow={() => setShown((s) => !s)}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={short}
              aria-describedby={`${id}-hint`}
            />
            <p id={`${id}-hint`} className={cn("text-[12px]", short ? "text-destructive" : "text-muted-foreground")}>
              {short ? `At least 8 characters (${8 - next.length} more)` : "At least 8 characters"}
            </p>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !current || next.length < 8}>
              {busy && <Loader2 className="animate-spin" />}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
