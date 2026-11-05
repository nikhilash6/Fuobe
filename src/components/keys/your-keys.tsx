"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CreditCard, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { BILLING_URL } from "@/lib/diagnose";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADD_KEY_EVENT, preferEngine, useHydrated, useStatus, useViewer } from "@/lib/api";
import { settingProblem } from "@/lib/connections";
import { CLOUD_KEY, CLOUD_PROVIDERS, type CloudProvider, type KeyInfo, type YourKeys } from "@/lib/your-keys";
import { cn } from "@/lib/utils";

/**
 * "Your keys" (public sign-up): an account's own fal.ai key and Replicate token, so it runs paid models billed to its
 * own account with that provider, never to this studio. The server checks a key with the provider, stores it encrypted
 * and only ever shows its last 4 characters (src/app/api/account/keys). Settings shows the section; "Add your key" opens
 * from a dimmed model, a run the server refused (x-fuobe-add-key) or a link (openAddKey).
 */

/** After a key is saved from the dialog: { provider, modelId? }, so the picker can pick the model it was opened for. */
export const KEY_ADDED_EVENT = "fuobe:key-added";

/** Open "Add your key" for a provider (and the model it is for, picked once the key is saved). */
export function openAddKey(provider: CloudProvider, modelId?: string): void {
  window.dispatchEvent(new CustomEvent(ADD_KEY_EVENT, { detail: { provider, modelId } }));
}

class KeyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: { code?: string; count?: number },
  ) {
    super(message);
  }
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; count?: number };
  if (!res.ok) throw new KeyError(j.error ?? "Something went wrong. Please try again.", res.status, j);
  return j;
}

export function useYourKeys(enabled = true) {
  return useQuery({ queryKey: ["account-keys"], queryFn: () => call<YourKeys>("/api/account/keys", "GET"), enabled });
}

/** What changes once a key is added or removed: the pickers, the engine switch, the prices. */
function useKeysChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["account-keys"] });
    void qc.invalidateQueries({ queryKey: ["status"] });
    void qc.invalidateQueries({ queryKey: ["models"] });
  };
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "2 runs are using this key now…": stop them and go on, or keep the key. */
function RunsGoing({ message, action, busy, onGo, onKeep }: { message: string; action: string; busy: boolean; onGo: () => void; onKeep: () => void }) {
  return (
    <div role="alert" className="grid gap-2 rounded-lg bg-highlight/20 p-3 text-[13px]">
      <p>{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" onClick={onGo} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {action}
        </Button>
        <Button size="sm" variant="secondary" onClick={onKeep} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/**
 * The field that takes a key: "Get a key ↗", a gentle hint when it doesn't look like one (the provider has the last
 * word), "Check and save". Replacing a key runs are going on asks first.
 */
function KeyForm({ provider, replacing, onSaved, onCancel, autoFocus }: { provider: CloudProvider; replacing?: boolean; onSaved: (info: KeyInfo) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const p = CLOUD_KEY[provider];
  const id = useId();
  const changed = useKeysChanged();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const hint = settingProblem(p.setting, key);

  const save = async (stopRuns = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<KeyInfo & { detail?: string; note?: string }>(`/api/account/keys/${provider}`, "PUT", { key, ...(stopRuns && { stopRuns: true }) });
      setKey("");
      setGoing(null);
      // The person just asked for paid models: the studios start on Cloud.
      preferEngine("cloud");
      changed();
      const who = provider === "replicate" && r.detail?.startsWith("Signed in as ") ? ` (${r.detail.replace("Signed in as ", "signed in as ")})` : "";
      // A key that works on a provider account with nothing on it yet: saved, and the next step said.
      if (r.note) toast.warning(r.note, { duration: 10_000 });
      else toast.success(`Your ${p.label} key works${who}. Paid models on ${p.label} are ready.`);
      onSaved(r);
    } catch (e) {
      const k = e as KeyError;
      if (k.body?.code === "runs-going") setGoing(k.message);
      else setError(k.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void save();
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-[13px]">
          {p.field}
        </Label>
        <a href={p.keysUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand-text hover:underline">
          {p.getKey} <ExternalLink className="size-3" />
        </a>
      </div>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={p.placeholder}
        value={key}
        readOnly={busy}
        autoFocus={autoFocus}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          setKey(e.target.value);
          setError(null);
        }}
      />
      <div id={`${id}-help`} className="grid gap-1 text-[12px]" aria-live="polite">
        {hint && !error && <p className="text-muted-foreground">{hint}</p>}
        {error && <p className="text-destructive">{error}</p>}
      </div>
      {going ? (
        <RunsGoing message={going} action="Stop runs and replace" busy={busy} onGo={() => void save(true)} onKeep={() => setGoing(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !key.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {busy ? "Checking…" : replacing ? "Check and replace" : "Check and save"}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

/** One provider in Settings → Your keys: the field, or the saved key (its last 4 characters) with Replace and Remove. */
function KeyCard({ provider, info }: { provider: CloudProvider; info: KeyInfo | null }) {
  const p = CLOUD_KEY[provider];
  const changed = useKeysChanged();
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState<null | { going?: string }>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<{ words: string; details?: string } | null>(null);
  // Check again: the saved key asked of its provider again (free, nothing runs). A refusal or an empty balance noted on a
  // run is cleared when the provider says the key works now.
  const checkAgain = async () => {
    setChecking(true);
    setCheckNote(null);
    try {
      const r = await fetch(`/api/account/keys/${provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recheck: true }) });
      const j = (await r.json().catch(() => ({}))) as KeyInfo & { error?: string; details?: string };
      changed();
      if (r.ok) toast.success(j.balanceEmptyAt ? `Your ${p.label} key works, but its balance is empty. Add credit, then run.` : `Your ${p.label} key works.`);
      else setCheckNote({ words: j.error ?? "We couldn't check your key. Try again in a minute.", ...(j.details && { details: j.details }) });
    } catch {
      setCheckNote({ words: "We couldn't check your key. Check this computer's internet, then try again." });
    } finally {
      setChecking(false);
    }
  };
  const empty = !!info?.readable && !info.rejectedAt && !!info.balanceEmptyAt;

  const remove = async (stopRuns: boolean) => {
    setBusy(true);
    try {
      await call(`/api/account/keys/${provider}`, "DELETE", stopRuns ? { stopRuns: true } : {});
      setConfirm(null);
      changed();
      toast.success(`Your ${p.label} key is removed.`);
    } catch (e) {
      const k = e as KeyError;
      if (k.body?.code === "runs-going") setConfirm({ going: k.message });
      else toast.error(k.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    // content-start: a taller card beside it (an error under its field) doesn't spread this one's rows apart.
    <div className="grid content-start gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium">{p.label}</h3>
          <p className="text-[12px] text-muted-foreground">{p.blurb}</p>
        </div>
        {info?.readable && !info.rejectedAt && !empty && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" /> Ready
          </span>
        )}
        {empty && (
          // The key works, but its provider account has no balance left: the badge is the way to add some.
          <a
            href={BILLING_URL[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-highlight px-2 py-0.5 text-[12px] font-medium text-highlight-foreground hover:opacity-90"
          >
            <CreditCard className="size-3" /> Add credit
            <ExternalLink className="size-3 opacity-60" aria-hidden />
          </a>
        )}
      </div>
      {info && !replacing ? (
        <>
          <p className="text-[13px]">
            {info.readable ? (
              <>
                <span className="font-medium">{provider === "replicate" ? "Token" : "Key"} ending in </span>
                <code className="rounded bg-muted px-1 font-mono text-[12px]">{info.last4}</code>
                <span className="text-muted-foreground"> · added {day(info.addedAt)}</span>
              </>
            ) : (
              <span className="inline-flex items-start gap-1.5 text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> This key can&apos;t be read any more. Add it again.
              </span>
            )}
          </p>
          {info.readable && info.rejectedAt && (
            <p className="inline-flex items-start gap-1.5 text-[13px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {p.label} stopped accepting this key on {day(info.rejectedAt)}. Replace it, or check it again.
            </p>
          )}
          {empty && (
            <p className="text-[13px] text-muted-foreground">
              Your {p.label} balance ran out on {day(info.balanceEmptyAt!)}. Add credit on {p.label}, then press Check again.
            </p>
          )}
          {checkNote && (
            <div aria-live="polite" className="space-y-0.5">
              <p className="text-[13px]">{checkNote.words}</p>
              {checkNote.details && <p className="font-mono text-[10.5px] text-muted-foreground/80">{checkNote.details}</p>}
            </div>
          )}
          {confirm ? (
            confirm.going ? (
              <RunsGoing message={confirm.going} action="Stop runs and remove" busy={busy} onGo={() => void remove(true)} onKeep={() => setConfirm(null)} />
            ) : (
              <div role="alert" className="grid gap-2 rounded-lg border p-3 text-[13px]">
                <p>
                  Remove your {p.label} key? Paid models on {p.label} stop working for you until you add a key again.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" onClick={() => void remove(false)} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    Remove key
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
                    Keep it
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
                {info.readable ? "Replace" : "Add again"}
              </Button>
              {info.readable && (
                <Button size="sm" variant="ghost" onClick={() => void checkAgain()} disabled={checking}>
                  {checking && <Loader2 className="animate-spin" />} Check again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConfirm({})}>
                Remove
              </Button>
            </div>
          )}
        </>
      ) : (
        <KeyForm provider={provider} replacing={!!info} onSaved={() => setReplacing(false)} onCancel={info ? () => setReplacing(false) : undefined} />
      )}
    </div>
  );
}

/** Settings → Your keys, for accounts (below Your GPU). `prices`: what the studios' paid defaults cost (starterPriceLine). */
export function AccountKeysSection({ prices }: { prices?: string }) {
  // Nothing until hydrated, as in the server's HTML, even when the viewer query has already answered.
  const hydrated = useHydrated();
  const account = useViewer().data?.account;
  const q = useYourKeys(!!account);
  // A studio with paid models off takes no keys: the section isn't shown.
  const paidOff = useStatus().data?.viewer?.paidAllowed === false || q.data?.paidAllowed === false;
  if (!hydrated || !account || paidOff) return null;
  return (
    <section id="your-keys" aria-labelledby="your-keys-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="your-keys-title" className="text-[15px] font-semibold">
          Your keys
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Add your fal.ai or Replicate key to use Nano Banana, Kling, Veo and more. You pay the provider directly. Your key is stored encrypted.
        </p>
      </div>
      <div className="grid min-w-0 gap-4">
        <ul className="grid gap-1.5 text-[13px] text-muted-foreground">
          {prices && (
            <li>
              <span className="font-medium text-foreground">What it costs:</span> {prices}. The price next to Generate is an estimate; your provider&apos;s bill is the
              final word.
            </li>
          )}
          <li>Up to 4 runs at once and 60 an hour.</li>
        </ul>
        {q.isError ? (
          <p className="text-[13px] text-muted-foreground">{q.error.message}</p>
        ) : !q.data ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {CLOUD_PROVIDERS.map((p) => (
              <KeyCard key={p} provider={p} info={q.data.keys[p]} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * "No GPU? Add your own key": for an account with no key yet, on a studio that allows paid models (nothing for anyone
 * else). The button opens "Add your fal.ai key" where the person is; `onOpen` first (a card closing to make room).
 */
export function KeyInstead({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const v = useStatus().data?.viewer;
  if (v?.kind !== "account" || v.paidAllowed === false || v.keys?.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed px-3 py-2.5 text-[13px]", className)}>
      <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 self-start text-brand-text" />
      <p className="min-w-0 flex-1 basis-56 text-muted-foreground">
        <span className="font-medium text-foreground">No GPU?</span> Add your own fal.ai or Replicate key to use paid models like Nano Banana, Kling and Veo, billed to your
        account with them.
      </p>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          onOpen?.();
          openAddKey("fal");
        }}
      >
        Add a key
      </Button>
    </div>
  );
}

/**
 * "Add your fal.ai key": opens from a dimmed model in a picker, a paid run the server refused (403 add-key), or an
 * "Add a key" link. Once the key is saved it closes, and the model it was opened for is picked (never run: the person
 * sees the price first). Mounted once, in the app's providers.
 */
export function AddKeyPrompt() {
  const [ask, setAsk] = useState<{ provider: CloudProvider; modelId?: string } | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ provider?: CloudProvider; modelId?: string }>).detail;
      if (d?.provider === "fal" || d?.provider === "replicate") setAsk({ provider: d.provider, modelId: d.modelId });
    };
    window.addEventListener(ADD_KEY_EVENT, open);
    return () => window.removeEventListener(ADD_KEY_EVENT, open);
  }, []);
  const p = ask ? CLOUD_KEY[ask.provider] : null;
  return (
    <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
      <DialogContent className="sm:max-w-md">
        {ask && p && (
          <>
            <DialogHeader>
              <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                <KeyRound className="size-5" />
              </div>
              <DialogTitle>Add your {p.label} key</DialogTitle>
              <DialogDescription>
                Runs on {p.label} are billed to your own {p.label} account. Your key is stored encrypted.
                {/* Opened for no model in particular: either provider will do. */}
                {!ask.modelId && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => setAsk({ provider: ask.provider === "fal" ? "replicate" : "fal" })}
                      className="text-brand-text underline-offset-2 hover:underline"
                    >
                      {ask.provider === "fal" ? "Have a Replicate token instead?" : "Have a fal.ai key instead?"}
                    </button>
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <KeyForm
              key={ask.provider}
              provider={ask.provider}
              autoFocus
              onSaved={() => {
                window.dispatchEvent(new CustomEvent(KEY_ADDED_EVENT, { detail: ask }));
                setAsk(null);
              }}
            />
            <DialogFooter className="sm:justify-start">
              <p className={cn("text-[12px] text-muted-foreground")}>
                Change or remove it any time in{" "}
                <Link href="/settings#your-keys" onClick={() => setAsk(null)} className="text-brand-text underline-offset-2 hover:underline">
                  Settings → Your keys
                </Link>
                .
              </p>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
