"use client";

import { ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { useId } from "react";
import { useKeyInfo, useRefreshKeyInfo } from "@/components/keys/use-key-info";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { useEngineMode } from "@/lib/api";
import { BILLING_URL } from "@/lib/diagnose";
import { menuLabel, menuValue, savedProviders, type ProviderAccount } from "@/lib/key-info";
import type { ViewerKind } from "@/lib/nav-model";
import { CLOUD_KEY, type CloudProvider } from "@/lib/your-keys";
import { cn } from "@/lib/utils";
import { MENU_HEADING, NavMenuItem, SHEET_HEADING } from "./nav-row";
import { Actionable, CHIP, DotSlot, useShownStatus } from "./status-chips";

/*
 * "Connected accounts" in the account menu and the phone's You sheet: one row per saved fal.ai key or Replicate token,
 * with its balance (or a link to the provider's billing page, where the key may not read it) and a small Refresh. The
 * owner sees the studio's keys, an account its own; a guest nothing. The rows come from the status the menu already
 * has, so they show at once: only the values at their ends wait for /api/key-info, which is asked when the menu opens
 * (this mounts with it), never on page load.
 */

const ROW = cn(CHIP, "flex-row items-center gap-3");

/** Where a key the provider didn't accept is fixed. */
const fixAt = (kind: ViewerKind) => (kind === "owner" ? "/settings#cloud" : "/settings#your-keys");

function Value({ info, loading }: { info: ProviderAccount | undefined; loading: boolean }) {
  if (loading) return <span aria-hidden className="ml-auto h-3 w-12 animate-pulse rounded bg-muted" />;
  const v = menuValue(info);
  if (v.kind === "amount") return <span className="ml-auto font-medium text-foreground tabular-nums">{v.text}</span>;
  if (v.kind === "empty") return <span className="ml-auto font-medium text-brand-text tabular-nums">{v.text}</span>;
  if (v.kind === "fix") return <span className="ml-auto font-medium text-foreground">{v.text}</span>;
  return (
    <span className="ml-auto inline-flex items-center gap-1">
      {v.text}
      <ExternalLink aria-hidden className="size-3" />
    </span>
  );
}

function ProviderRow({ p, kind, item, info, loading }: { p: CloudProvider; kind: ViewerKind; item: boolean; info: ProviderAccount | undefined; loading: boolean }) {
  const label = CLOUD_KEY[p].label;
  const body = (
    <>
      <DotSlot ok={loading || info?.state === "ok" || info?.state === "link" || !info} />
      {label}
      <Value info={info} loading={loading} />
    </>
  );
  const name = loading ? `${label} balance, loading` : menuLabel(p, info);
  return info?.state === "check-key" ? (
    <Actionable item={item} className={ROW}>
      <IntentLink href={fixAt(kind)} aria-label={name}>
        {body}
      </IntentLink>
    </Actionable>
  ) : (
    <Actionable item={item} className={ROW}>
      <a href={BILLING_URL[p]} target="_blank" rel="noreferrer" aria-label={name}>
        {body}
      </a>
    </Actionable>
  );
}

function Heading({ item, id, onRefresh, disabled, busy }: { item: boolean; id: string; onRefresh: () => void; disabled: boolean; busy: boolean }) {
  const icon = <RefreshCw aria-hidden className={cn("size-4", busy && "motion-safe:animate-spin")} />;
  return item ? (
    <div className="flex items-center justify-between gap-2 pr-1">
      <DropdownMenuLabel id={id} className={MENU_HEADING}>
        Connected accounts
      </DropdownMenuLabel>
      <NavMenuItem
        aria-label="Refresh balances"
        disabled={disabled}
        // The menu stays open: the new values show in it.
        onSelect={(e) => {
          e.preventDefault();
          onRefresh();
        }}
        className="mt-1 size-8 justify-center gap-0 px-0 text-muted-foreground data-[disabled]:opacity-50 [&_svg]:text-muted-foreground"
      >
        {icon}
      </NavMenuItem>
    </div>
  ) : (
    <div className="mt-1 flex items-center justify-between gap-2">
      <p id={id} className={cn(SHEET_HEADING, "pb-0")}>
        Connected accounts
      </p>
      <button
        type="button"
        aria-label="Refresh balances"
        disabled={disabled}
        onClick={onRefresh}
        className="nav-row -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground disabled:opacity-50"
      >
        {icon}
      </button>
    </div>
  );
}

/** An account with no key yet (on a studio with paid models on): one row to add one, as "Your GPU · Connect" is. */
function AddKeyRow({ item }: { item: boolean }) {
  return (
    <Actionable item={item} className={ROW}>
      <IntentLink href="/settings#your-keys">
        <span aria-hidden className="grid w-[var(--nav-icon,16px)] shrink-0 place-items-center">
          <KeyRound className="size-3.5" />
        </span>
        Your keys
        <span className="ml-auto font-medium text-brand-text">Add a key</span>
      </IntentLink>
    </Actionable>
  );
}

/** The menu's Connected accounts (`item`: inside the account menu; otherwise the You sheet's rows). */
export function ConnectedAccounts({ kind, item }: { kind: ViewerKind | undefined; item: boolean }) {
  const status = useShownStatus();
  const mode = useEngineMode();
  const saved = savedProviders(kind, status, mode);
  const q = useKeyInfo({ enabled: !!saved?.length });
  const { refresh, busy, cooling } = useRefreshKeyInfo(false);
  const id = useId();
  if (!saved || !kind) return null;
  if (!saved.length) return kind === "account" ? <AddKeyRow item={item} /> : null;
  // Before the first answer the values wait (a refresh keeps them and turns its icon); an answer that failed shows the
  // billing links.
  const loading = q.isPending && q.fetchStatus !== "idle";
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <Heading item={item} id={id} onRefresh={() => void refresh()} disabled={cooling || loading || busy} busy={busy} />
      {saved.map((p) => (
        <ProviderRow key={p} p={p} kind={kind} item={item} info={q.data?.providers.find((x) => x.provider === p)} loading={loading} />
      ))}
    </div>
  );
}
