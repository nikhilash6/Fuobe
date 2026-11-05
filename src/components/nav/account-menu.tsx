"use client";

import { Cpu, LogIn, LogOut, Moon, Settings2, Sun, UserPlus, UserRound } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense } from "react";
import { PlaceholdersOnChip } from "@/components/demo-mode";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { signInHref, signOut, useEngineMode, useViewer } from "@/lib/api";
import type { ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { ConnectedAccounts } from "./connected-accounts";
import { ExploreProgress } from "./explore-progress";
import { useViewerKind } from "./nav-ui";
import { keepHighlight, MENU_HEADING, MENU_ROW_1, NavMenuItem, SHEET_HEADING, SHEET_ROW as SHEET_ROW_BASE } from "./nav-row";
import { avatarDot, OwnerStatus, usePlaceholdersOn, useShownStatus, VisitorGpu } from "./status-chips";

/*
 * The account menu (the avatar at the bar's right end) and the phone's You sheet: who is signed in, the GPU and its
 * status as the sidebar's footer said it, how much of Fuobe this browser has explored, then Settings and the theme.
 * Thanks & licences, the owner's Models & licences and the source on GitHub are in Settings → About. What each viewer
 * sees:
 *   guest   Sign up free, Log in · Your GPU (sign up first) · explore · Settings, theme
 *   account Signed in as <email> · balance or their own GPU · its connected accounts (its own keys' balances, or Add a
 *           key) · explore · Settings, Your GPU, theme · Sign out
 *   owner   Your setup · cloud models, ComfyUI, mode, the owner's GPU · connected accounts (the studio's keys'
 *           balances) · Placeholders on · explore · Settings, theme
 * The owner's status words exist only in the owner's branch: a guest's or an account's menu never says them.
 */

type Variant = "menu" | "sheet";

/** This page with its query, for Sign up and Log in to come back to (inside Suspense: the query is runtime data). */
function useHere(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search ? `${pathname}?${search}` : pathname;
}

/** The You sheet's rows: the sheet's 48 px row, an 18 px icon on the gutter. */
const SHEET_ROW = cn(SHEET_ROW_BASE, "text-[15px] [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground");
/** The account menu's rows: the menus' 40 px one-line row, a 16 px icon on the icon column. */
const MENU_ROW = cn(MENU_ROW_1, "[&_svg]:size-4 [&_svg]:text-muted-foreground");

function GuestIdentity({ variant, here }: { variant: Variant; here: string }) {
  if (variant === "menu")
    return (
      <DropdownMenuGroup className="flex flex-col gap-1 p-1">
        <DropdownMenuItem asChild onPointerLeave={keepHighlight} className="nav-focus-out h-10 justify-center gap-2 rounded-[10px] bg-primary text-[13.5px] font-semibold text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground active:bg-primary/85 [&_svg]:text-primary-foreground">
          <a href={signInHref("signup", here)}>
            <UserPlus aria-hidden /> Sign up free
          </a>
        </DropdownMenuItem>
        <NavMenuItem asChild className="h-10 justify-center gap-2 border font-medium">
          <a href={signInHref("login", here)}>
            <LogIn aria-hidden className="size-4" /> Log in
          </a>
        </NavMenuItem>
      </DropdownMenuGroup>
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={signInHref("signup", here)}
        className="nav-focus-out flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground nav-hover:bg-primary/90 active:bg-primary/85"
      >
        <UserPlus aria-hidden className="size-[18px]" /> Sign up free
      </a>
      <a
        href={signInHref("login", here)}
        className="nav-row flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-medium"
      >
        <LogIn aria-hidden className="size-[18px]" /> Log in
      </a>
    </div>
  );
}

function GuestIdentityHere({ variant }: { variant: Variant }) {
  return <GuestIdentity variant={variant} here={useHere()} />;
}

function Identity({ kind, variant }: { kind: ViewerKind | undefined; variant: Variant }) {
  const email = useViewer().data?.account?.email;
  if (kind === "guest")
    return (
      <Suspense fallback={<GuestIdentity variant={variant} here="/" />}>
        <GuestIdentityHere variant={variant} />
      </Suspense>
    );
  if (kind === "account" && email)
    return variant === "menu" ? (
      <DropdownMenuLabel className="flex flex-col px-2.5 font-normal">
        <span className="text-[11px] text-muted-foreground">Signed in as</span>
        <span className="text-[13px] [overflow-wrap:anywhere] text-foreground">{email}</span>
      </DropdownMenuLabel>
    ) : (
      <div className="flex flex-col">
        <span className="text-[12px] text-muted-foreground">Signed in as</span>
        <span className="text-[15px] font-medium [overflow-wrap:anywhere]">{email}</span>
      </div>
    );
  if (kind === "owner")
    return variant === "menu" ? (
      <DropdownMenuLabel className={MENU_HEADING}>Your setup</DropdownMenuLabel>
    ) : (
      <p className={SHEET_HEADING}>Your setup</p>
    );
  return null;
}

/** The status block: an owner's install status, a visitor's own GPU or balance (as the sidebar footer showed them). */
function GpuSection({ kind, variant }: { kind: ViewerKind | undefined; variant: Variant }) {
  const placeholders = usePlaceholdersOn(kind);
  const item = variant === "menu";
  if (kind === "owner")
    return (
      <div className={cn("flex flex-col", item ? "gap-0.5" : "gap-1")}>
        <OwnerStatus item={item} />
        <ConnectedAccounts kind={kind} item={item} />
        {placeholders &&
          (item ? (
            // From xl the bar shows this pill itself, so the menu leaves it out.
            <DropdownMenuLabel className="px-2.5 py-1 font-normal xl:hidden">
              <PlaceholdersOnChip />
            </DropdownMenuLabel>
          ) : (
            <div className="py-1">
              <PlaceholdersOnChip />
            </div>
          ))}
      </div>
    );
  if (kind === "account")
    return (
      <>
        <VisitorGpu item={item} />
        <ConnectedAccounts kind={kind} item={item} />
      </>
    );
  if (kind === "guest") return <VisitorGpu item={item} />;
  return null;
}

function ThemeToggle({ variant }: { variant: Variant }) {
  const { resolvedTheme, setTheme } = useTheme();
  const flip = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");
  // The label follows the page's class (dark:), so the server's HTML and the first client render agree.
  const inner = (
    <>
      <Sun aria-hidden className="hidden dark:block" />
      <Moon aria-hidden className="dark:hidden" />
      <span className="hidden dark:inline">Light mode</span>
      <span className="dark:hidden">Dark mode</span>
    </>
  );
  return variant === "menu" ? (
    <NavMenuItem
      className={MENU_ROW}
      onSelect={(e) => {
        // The menu stays open: the change shows on it at once.
        e.preventDefault();
        flip();
      }}
    >
      {inner}
    </NavMenuItem>
  ) : (
    <button type="button" className={SHEET_ROW} onClick={flip}>
      {inner}
    </button>
  );
}

/** One link of the Links section, as a menu item or a sheet row; the open page's row carries the current mark. */
function LinkRow({ variant, href, children }: { variant: Variant; href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href;
  const link = (
    <IntentLink href={href} aria-current={current ? "page" : undefined} className={cn(variant === "sheet" && SHEET_ROW, current && "font-semibold")}>
      {children}
    </IntentLink>
  );
  return variant === "menu" ? (
    <NavMenuItem asChild className={MENU_ROW}>
      {link}
    </NavMenuItem>
  ) : (
    link
  );
}

function Links({ kind, variant }: { kind: ViewerKind | undefined; variant: Variant }) {
  return (
    <>
      {/* Everyone's: a guest's Settings offers a GPU of its own and About (Thanks & licences, the source on GitHub). */}
      {kind && (
        <LinkRow variant={variant} href="/settings">
          <Settings2 aria-hidden /> Settings
        </LinkRow>
      )}
      {kind === "account" && (
        <LinkRow variant={variant} href="/connect">
          <Cpu aria-hidden /> Your GPU
        </LinkRow>
      )}
      <ThemeToggle variant={variant} />
    </>
  );
}

function SignOut({ variant }: { variant: Variant }) {
  return variant === "menu" ? (
    <NavMenuItem className={MENU_ROW} onSelect={() => void signOut()}>
      <LogOut aria-hidden /> Sign out
    </NavMenuItem>
  ) : (
    <button type="button" className={SHEET_ROW} onClick={() => void signOut()}>
      <LogOut aria-hidden /> Sign out
    </button>
  );
}

function Sep({ variant }: { variant: Variant }) {
  return variant === "menu" ? <DropdownMenuSeparator className="mx-2.5 my-1.5" /> : <hr className="my-2 border-border" />;
}

/**
 * The menu's sections for this viewer. `menu`: inside DropdownMenuContent (links and actions are items, so arrow keys
 * reach them; words are labels). `sheet`: the phone's You sheet, 48 px rows; `onNavigate` runs when a link is followed
 * (the sheet closes). Until the viewer is known it shows only what anyone may see.
 */
export function AccountSections({ variant, onNavigate }: { variant: Variant; onNavigate?: () => void }) {
  const kind = useViewerKind();
  const body = (
    <>
      <Identity kind={kind} variant={variant} />
      {/* The owner's heading introduces the status under it: no rule between them. */}
      {kind && kind !== "owner" && <Sep variant={variant} />}
      <GpuSection kind={kind} variant={variant} />
      <ExploreProgress variant={variant} />
      <Sep variant={variant} />
      <Links kind={kind} variant={variant} />
      {kind === "account" && (
        <>
          <Sep variant={variant} />
          <SignOut variant={variant} />
        </>
      )}
    </>
  );
  if (variant === "menu") return body;
  return (
    <div
      className="flex flex-col"
      onClick={(e) => {
        if ((e.target as Element).closest("a[href]")) onNavigate?.();
      }}
    >
      {body}
    </div>
  );
}

/**
 * The avatar and its menu (owner and accounts; guests get the same menu from a plain round button beside Sign up). The
 * owner's avatar carries a dot for the install's status (green, or amber when a key or ComfyUI is missing for the
 * engine mode); an account's only a green one, when its own GPU answers.
 */
export function AccountMenu({ kind }: { kind: ViewerKind }) {
  const email = useViewer().data?.account?.email;
  const dot = avatarDot(kind, useShownStatus(), useEngineMode());
  const label = kind === "guest" ? "Menu" : kind === "account" && email ? `Account: ${email}` : `Account and settings${dot === "warn" ? ", something needs a look" : ""}`;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          "nav-focus relative grid size-10 shrink-0 place-items-center rounded-full [@media(pointer:coarse)]:size-11 text-[13px] font-semibold motion-safe:transition-colors",
          kind === "guest"
            ? "border border-sidebar-border text-muted-foreground nav-hover:bg-[var(--nav-hi)] nav-hover:text-foreground active:bg-[var(--nav-press)] data-[state=open]:border-border-strong data-[state=open]:text-foreground"
            : "bg-brand-faint text-brand-text nav-hover:[background-image:linear-gradient(var(--nav-hi),var(--nav-hi))] active:[background-image:linear-gradient(var(--nav-press),var(--nav-press))]",
        )}
      >
        {kind === "account" && email ? <span aria-hidden>{email.charAt(0).toUpperCase()}</span> : <UserRound aria-hidden className="size-[18px]" />}
        {dot && <span aria-hidden data-dot={dot} className={cn("absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-sidebar", dot === "ok" ? "bg-success" : "bg-warning")} />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} collisionPadding={12} className="w-80 max-h-[calc(100dvh-5rem)] p-1.5">
        <AccountSections variant="menu" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
