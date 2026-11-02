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
import { NAV_MENU_ITEM } from "./create-menu";
import { ExploreProgress } from "./explore-progress";
import { useViewerKind } from "./nav-ui";
import { avatarDot, OwnerStatus, usePlaceholdersOn, useShownStatus, VisitorGpu } from "./status-chips";

/*
 * The account menu (the avatar at the bar's right end) and the phone's You sheet: who is signed in, the GPU and its
 * status as the sidebar's footer said it, how much of Fuobe this browser has explored, then Settings and the theme.
 * Thanks & licences, the owner's Models & licences and the source on GitHub are in Settings → About. What each viewer
 * sees:
 *   guest   Sign up free, Log in · Your GPU (sign up first) · explore · Settings, theme
 *   account Signed in as <email> · balance or their own GPU · explore · Settings, Your GPU, theme · Sign out
 *   owner   Your setup · cloud models, ComfyUI, mode, the owner's GPU, Placeholders on · explore · Settings, theme
 * The owner's status words exist only in the owner's branch: a guest's or an account's menu never says them.
 */

type Variant = "menu" | "sheet";

/** This page with its query, for Sign up and Log in to come back to (inside Suspense: the query is runtime data). */
function useHere(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search ? `${pathname}?${search}` : pathname;
}

const SHEET_ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const MENU_ROW = `h-9 gap-2.5 rounded-md px-2 text-[13.5px] [&_svg]:text-muted-foreground ${NAV_MENU_ITEM}`;

function GuestIdentity({ variant, here }: { variant: Variant; here: string }) {
  if (variant === "menu")
    return (
      <DropdownMenuGroup className="flex flex-col gap-1 p-1">
        <DropdownMenuItem asChild className="h-9 justify-center gap-2 rounded-lg bg-primary text-[13.5px] font-semibold text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground [&_svg]:text-primary-foreground">
          <a href={signInHref("signup", here)}>
            <UserPlus aria-hidden /> Sign up free
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="h-9 justify-center gap-2 rounded-lg border text-[13.5px]">
          <a href={signInHref("login", here)}>
            <LogIn aria-hidden /> Log in
          </a>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={signInHref("signup", here)}
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <UserPlus aria-hidden className="size-[18px]" /> Sign up free
      </a>
      <a
        href={signInHref("login", here)}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
      <DropdownMenuLabel className="flex flex-col font-normal">
        <span className="text-[11px] text-muted-foreground">Signed in as</span>
        <span className="text-[13px] [overflow-wrap:anywhere] text-foreground">{email}</span>
      </DropdownMenuLabel>
    ) : (
      <div className="flex flex-col px-1">
        <span className="text-[12px] text-muted-foreground">Signed in as</span>
        <span className="text-[15px] font-medium [overflow-wrap:anywhere]">{email}</span>
      </div>
    );
  if (kind === "owner")
    return variant === "menu" ? (
      <DropdownMenuLabel className="pt-2 pb-1 text-[11px] font-semibold tracking-[.08em] text-brand-text uppercase">Your setup</DropdownMenuLabel>
    ) : (
      <p className="px-1 text-[11px] font-semibold tracking-[.08em] text-brand-text uppercase">Your setup</p>
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
        {placeholders &&
          (item ? (
            // From xl the bar shows this pill itself, so the menu leaves it out.
            <DropdownMenuLabel className="py-1 font-normal xl:hidden">
              <PlaceholdersOnChip />
            </DropdownMenuLabel>
          ) : (
            <div className="px-2 py-1">
              <PlaceholdersOnChip />
            </div>
          ))}
      </div>
    );
  if (kind === "guest" || kind === "account") return <VisitorGpu item={item} />;
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
    <DropdownMenuItem
      className={MENU_ROW}
      onSelect={(e) => {
        // The menu stays open: the change shows on it at once.
        e.preventDefault();
        flip();
      }}
    >
      {inner}
    </DropdownMenuItem>
  ) : (
    <button type="button" className={SHEET_ROW} onClick={flip}>
      {inner}
    </button>
  );
}

/** One link of the Links section, as a menu item or a sheet row. */
function LinkRow({ variant, href, children }: { variant: Variant; href: string; children: React.ReactNode }) {
  const link = (
    <IntentLink href={href} className={variant === "sheet" ? SHEET_ROW : undefined}>
      {children}
    </IntentLink>
  );
  return variant === "menu" ? (
    <DropdownMenuItem asChild className={MENU_ROW}>
      {link}
    </DropdownMenuItem>
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
    <DropdownMenuItem className={MENU_ROW} onSelect={() => void signOut()}>
      <LogOut aria-hidden /> Sign out
    </DropdownMenuItem>
  ) : (
    <button type="button" className={SHEET_ROW} onClick={() => void signOut()}>
      <LogOut aria-hidden /> Sign out
    </button>
  );
}

function Sep({ variant }: { variant: Variant }) {
  return variant === "menu" ? <DropdownMenuSeparator className="my-1.5" /> : <hr className="my-1 border-border" />;
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
      {kind && <Sep variant={variant} />}
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
      className="flex flex-col gap-2"
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
          "relative grid size-9 shrink-0 place-items-center rounded-full [@media(pointer:coarse)]:size-11 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
          kind === "guest" ? "border border-sidebar-border text-muted-foreground hover:bg-accent data-[state=open]:bg-accent" : "bg-brand-faint text-brand-text hover:bg-brand-faint-hover data-[state=open]:bg-brand-faint-hover",
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
