"use client";

import { useQuery } from "@tanstack/react-query";
import { AudioLines, Bell, Clapperboard, Code, Cpu, Film, GraduationCap, Image as ImageIcon, KeyRound, Layers, LayoutGrid, Loader2, LogIn, Play, Plug, Plus, Scale, Server, Settings2, ShieldCheck, Sparkles, SunMoon, UserPlus, UserRound, Wand2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSkills } from "@/components/assist/hooks";
import { NAV } from "@/components/nav-items";
import { MediaThumb } from "@/components/studio/result-media";
import { CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Command as CommandPrimitive } from "cmdk";
import { signInHref, useEngineMode, useGenerations, useIsGuest, useModelAccess, useViewer, type ViewerInfo } from "@/lib/api";
import { FUOBE_REPO } from "@/lib/connections";
import type { Generation } from "@/lib/catalog/types";
import { indexEntries, KIND_LABELS, rankPalette, skillEntries, type PaletteEntry, type PaletteIndex, type PaletteKind } from "@/lib/command-search";
import { useModKey } from "@/lib/keys";
import { userTitle } from "@/lib/library";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The viewer is only needed once a recent creation is opened from the palette.
const Viewer = lazy(() => import("@/components/studio/viewer").then((m) => ({ default: m.Viewer })));

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
}

const PaletteContext = createContext<PaletteState>({ open: false, setOpen: () => {} });

/** Opens and closes the ⌘K palette from anywhere in the app frame (the sidebar's Search row, the phone header, ⌘K). */
export const useCommandPalette = () => useContext(PaletteContext);

/** What had focus when the palette opened: it gets focus back when the palette closes without going anywhere. */
const returnFocus: { current: Element | null } = { current: null };

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const setOpen = useCallback((v: boolean | ((open: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(openRef.current) : v;
    if (next && !openRef.current) returnFocus.current = document.activeElement;
    openRef.current = next;
    setOpenState(next);
  }, []);
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** Settings sections the palette jumps to (ids in settings-form.tsx). */
const SETTINGS: { id: string; label: string; icon: LucideIcon; keywords: string; href?: string }[] = [
  { id: "cloud", label: "API keys", icon: KeyRound, keywords: "fal replicate paid cloud connect" },
  { id: "comfyui", label: "ComfyUI server", icon: Server, keywords: "open source gpu url connect local" },
  { id: "engine", label: "Engine mode", icon: Cpu, keywords: "open source cloud both" },
  { id: "loras", label: "LoRAs", icon: Layers, keywords: "lora folder civitai key looks motions effects download licence" },
  { id: "training", label: "Training (AI-Toolkit)", icon: GraduationCap, keywords: "ai-toolkit aitk train lora soul id gpu url token" },
  {
    id: "models",
    label: "Models & licences",
    icon: Scale,
    keywords: "licence license commercial non-commercial switch off turn on admin providers node packs allow block",
    href: "/settings/models",
  },
  { id: "text-ai", label: "AI helper", icon: Sparkles, keywords: "claude ollama lm studio unsloth local llm model enhancer prompt enhancement context" },
  { id: "assist-connectors", label: "Assist connectors", icon: Plug, keywords: "mcp connector claude tools notion linear slack server token" },
  { id: "notifications", label: "Notifications", icon: Bell, keywords: "browser done alerts" },
  { id: "security", label: "Password and API tokens", icon: ShieldCheck, keywords: "security sign in mcp token" },
  { id: "demo", label: "Placeholder results", icon: Settings2, keywords: "demo mode placeholder tour free try" },
];

const PAGES: (PaletteEntry & { icon: LucideIcon })[] = NAV.flatMap((g) =>
  g.items.map((i) => ({ key: `page:${i.href}`, kind: "page" as const, label: i.label, hint: g.label, href: i.href, keywords: i.keywords, icon: i.icon })),
);
const SETTING_ENTRIES: (PaletteEntry & { icon: LucideIcon })[] = SETTINGS.map((s) => ({
  key: `setting:${s.id}`,
  kind: "setting",
  label: s.label,
  hint: "Settings",
  href: s.href ?? `/settings#${s.id}`,
  keywords: s.keywords,
  icon: s.icon,
}));
const visitorSetting = (key: string, label: string, href: string, icon: LucideIcon, keywords: string): PaletteEntry & { icon: LucideIcon } => ({
  key: `setting:${key}`,
  kind: "setting",
  label,
  hint: "Settings",
  href,
  keywords,
  icon,
});
const LICENCES = SETTING_ENTRIES.find((e) => e.key === "setting:models")!;
/**
 * The install's settings are its owner's: an account (public sign-up) gets its own GPU and account, a guest the way to
 * connect a GPU; both get the licences, which they may read.
 */
const ACCOUNT_SETTINGS = [
  visitorSetting("your-gpu", "Your GPU", "/settings#your-gpu", Cpu, "comfyui gpu connect own server open source"),
  visitorSetting("your-keys", "Your keys", "/settings#your-keys", KeyRound, "fal fal.ai replicate api key token paid models nano banana kling veo billing"),
  visitorSetting("account", "Account", "/settings#account", UserRound, "email sign out delete account"),
  LICENCES,
];
const GUEST_SETTINGS = [visitorSetting("connect", "Connect your GPU", "/connect", Cpu, "comfyui gpu own server sign up account open source"), LICENCES];

/** The settings the palette offers this viewer (none of the install's to anyone but its owner). */
export function settingEntries(viewer: Pick<ViewerInfo, "owner" | "account"> | undefined): (PaletteEntry & { icon: LucideIcon })[] {
  if (viewer?.owner) return SETTING_ENTRIES;
  return viewer?.account ? ACCOUNT_SETTINGS : GUEST_SETTINGS;
}

/** Things to do rather than pages to open (Go to): the theme, the source, and for a guest, signing up or in. */
const THEME_HREF = "action:theme";
const ACTIONS: (PaletteEntry & { icon: LucideIcon })[] = [
  { key: "action:theme", kind: "page", label: "Toggle dark mode", hint: "Theme", href: THEME_HREF, keywords: "dark light theme night mode appearance", icon: SunMoon },
  { key: "action:github", kind: "page", label: "Source on GitHub", hint: "Open source", href: FUOBE_REPO, keywords: "github code repo repository open source download install self host", icon: Code },
];
const GUEST_ACTIONS: (PaletteEntry & { icon: LucideIcon })[] = [
  { key: "action:signup", kind: "page", label: "Sign up free", hint: "Account", href: signInHref("signup"), keywords: "sign up register create account join", icon: UserPlus },
  { key: "action:login", kind: "page", label: "Log in", hint: "Account", href: signInHref("login"), keywords: "log in login sign in account", icon: LogIn },
];
// Icons as elements made once (a component picked during render would remount on every keystroke).
const iconEl = (Icon: LucideIcon) => <Icon className="text-muted-foreground" />;
const ICONS = new Map<string, React.ReactNode>([...PAGES, ...SETTING_ENTRIES, ...ACCOUNT_SETTINGS, ...GUEST_SETTINGS, ...ACTIONS, ...GUEST_ACTIONS].map((e) => [e.key, iconEl(e.icon)]));
const KIND_ICONS: Partial<Record<PaletteKind, React.ReactNode>> = { app: iconEl(LayoutGrid), motion: iconEl(Film), effect: iconEl(Wand2), model: iconEl(Clapperboard), skill: iconEl(Play) };
/** A model's icon by the studio it opens in: a voice or music model isn't a clapperboard. */
const MODEL_ICONS = { audio: iconEl(AudioLines), image: iconEl(ImageIcon) };
const modelIcon = (href: string) =>
  /^\/audio\b/.test(href) ? MODEL_ICONS.audio : /^\/(image|edit|inpaint|outpaint|upscale\/image|image-to-3d)\b/.test(href) ? MODEL_ICONS.image : undefined;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// The hints are marked as shortcuts so CommandItem drops its check mark, which would share the row's free space with them.
function Row({ entry, onPick }: { entry: PaletteEntry; onPick: (e: PaletteEntry) => void }) {
  return (
    <CommandItem value={entry.key} onSelect={() => onPick(entry)} className="h-9 gap-2.5 text-[14px]">
      {ICONS.get(entry.key) ?? (entry.kind === "model" ? modelIcon(entry.href) : undefined) ?? KIND_ICONS[entry.kind] ?? KIND_ICONS.app}
      <span className="min-w-0 truncate">{entry.label}</span>
      {entry.hint && <span data-slot="command-shortcut" className="ml-auto shrink-0 truncate pl-2 text-[12px] text-muted-foreground max-sm:max-w-[40%]">{entry.hint}</span>}
    </CommandItem>
  );
}

function RecentRow({ g, onOpen }: { g: Generation; onOpen: (g: Generation) => void }) {
  const title = userTitle(g);
  return (
    <CommandItem value={`recent:${g.id}`} onSelect={() => onOpen(g)} className="h-11 gap-2.5 text-[14px]">
      <span className="relative size-8 shrink-0 overflow-hidden rounded-md bg-muted">{g.outputs[0] && <MediaThumb output={g.outputs[0]} g={g} />}</span>
      <span className="min-w-0 truncate">{title}</span>
      <span data-slot="command-shortcut" className="ml-auto shrink-0 pl-2 text-[12px] text-muted-foreground">{g.modelName}</span>
    </CommandItem>
  );
}

function Hints() {
  const mod = useModKey();
  return (
    <div className="flex items-center gap-3 border-t px-3 py-2 text-[12px] text-muted-foreground [@media(hover:none)]:hidden">
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> to move
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd> to open
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Esc</Kbd> to close
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </div>
  );
}

/** What the palette lists and searches; mounted only while it's open. */
function PaletteBody({ onPick, onOpenRecent, onClose }: { onPick: (e: PaletteEntry) => void; onOpenRecent: (g: Generation) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  // Not deferred: ranking ~900 entries takes a millisecond, and Enter must act on the list for what was typed.
  const query = q;
  const dq = useDebounced(q.trim(), 200);
  const mode = useEngineMode();
  const access = useModelAccess();
  const settings = settingEntries(useViewer().data);
  // The apps, motions, effects and models load on first open (and stay for the session).
  const index = useQuery({
    queryKey: ["palette-index"],
    queryFn: async () => (await fetch("/api/search-index")).json() as Promise<PaletteIndex>,
    staleTime: Infinity,
  });
  const recent = useGenerations({ q: dq || undefined, limit: 5, statuses: ["succeeded"] }, { keepPrevious: true });
  // Skills that run by themselves: "Run <skill>…" opens its Run form.
  const skills = useSkills();
  const guest = useIsGuest();
  const entries = useMemo(
    () => [...PAGES, ...ACTIONS, ...(guest ? GUEST_ACTIONS : []), ...settings, ...skillEntries(skills.data ?? []), ...(index.data ? indexEntries(index.data, mode, access) : [])],
    [index.data, mode, access, skills.data, settings, guest],
  );
  const groups = useMemo(() => rankPalette(entries, query), [entries, query]);
  const recentItems = (recent.data ?? []).filter((g) => g.outputs[0]);
  const searching = !!query.trim();
  // cmdk keeps no selection once the rows change (shouldFilter is off): every new query starts on its
  // best match, so Enter opens it; arrows move from there.
  const best = searching ? (groups[0]?.entries[0]?.key ?? (recentItems[0] ? `recent:${recentItems[0].id}` : "")) : "new";
  const [moved, setMoved] = useState<{ query: string; value: string } | null>(null);
  const selected = moved?.query === query ? moved.value : best;

  return (
    <CommandPrimitive shouldFilter={false} loop value={selected} onValueChange={(value) => setMoved({ query, value })} label="Search Fuobe" className="flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
      <div className="flex items-center gap-2 border-b px-3">
        <CommandPrimitive.Input
          value={q}
          onValueChange={setQ}
          autoFocus
          placeholder="Search pages, apps, motions, effects, models…"
          aria-label="Search Fuobe"
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
        />
        {index.isLoading && searching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading the catalog" />}
        {/* Touch screens have no Esc (and the hint row is hidden there): a visible way out. */}
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 hidden h-8 shrink-0 items-center rounded-md px-2 text-[14px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground [@media(hover:none)]:inline-flex"
        >
          Cancel
        </button>
      </div>
      <CommandList className="max-h-[min(60vh,440px)] p-1.5">
        {searching ? (
          <>
            <CommandEmpty className="py-10 text-center text-[13px] text-muted-foreground">
              {index.isLoading ? "Looking through apps, motions and models…" : `Nothing matches “${query.trim()}”. Try a shorter word.`}
            </CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.kind} heading={g.label}>
                {g.entries.map((e) => (
                  <Row key={e.key} entry={e} onPick={onPick} />
                ))}
              </CommandGroup>
            ))}
            {recentItems.length > 0 && (
              <CommandGroup heading={KIND_LABELS.recent}>
                {recentItems.map((g) => (
                  <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            <CommandGroup>
              {/* Enter on an empty query keeps what ⌘K always did: a new creation. */}
              <CommandItem value="new" onSelect={() => onPick({ key: "new", kind: "page", label: "New creation", href: NEW_CREATION_HREF })} className="h-9 gap-2.5 text-[14px]">
                <Plus className="text-muted-foreground" />
                New creation
                <span data-slot="command-shortcut" className="ml-auto text-[12px] text-muted-foreground">Home</span>
              </CommandItem>
            </CommandGroup>
            {recentItems.length > 0 && (
              <CommandGroup heading={KIND_LABELS.recent}>
                {recentItems.map((g) => (
                  <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={KIND_LABELS.page}>
              {PAGES.map((e) => (
                <Row key={e.key} entry={e} onPick={onPick} />
              ))}
            </CommandGroup>
            <CommandGroup heading={KIND_LABELS.setting}>
              {settings.map((e) => (
                <Row key={e.key} entry={e} onPick={onPick} />
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <Hints />
    </CommandPrimitive>
  );
}

/**
 * The ⌘K / Ctrl+K palette: every page, settings section, app, camera motion, effect and model, and
 * your recent creations, with a forgiving search (src/lib/command-search.ts). Rendered once, in the
 * app frame.
 */
export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const [viewing, setViewing] = useState<Generation | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // Set when the palette closes onto something else (a page, the viewer): focus stays with that.
  const leaving = useRef(false);
  const { resolvedTheme, setTheme } = useTheme();
  const pick = useCallback(
    (e: PaletteEntry) => {
      setOpen(false);
      if (e.href === THEME_HREF) return setTheme(resolvedTheme === "dark" ? "light" : "dark");
      if (/^https?:/.test(e.href)) return void window.open(e.href, "_blank", "noopener,noreferrer");
      leaving.current = true;
      router.push(e.href);
    },
    [router, setOpen, resolvedTheme, setTheme],
  );
  const openRecent = useCallback(
    (g: Generation) => {
      leaving.current = true;
      setOpen(false);
      setViewing(g);
    },
    [setOpen],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  // Dismissed (Esc, Cancel, a click outside, ⌘K again): focus goes back to where it was, the
  // composer you were typing in or the Search row, not to the top of the page.
  const restoreFocus = useCallback((e: Event) => {
    e.preventDefault();
    const el = returnFocus.current;
    returnFocus.current = null;
    if (leaving.current) {
      leaving.current = false;
      return;
    }
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search Fuobe"
        description="Go to a page, an app, a camera motion, an effect, a model, a settings section or a recent creation."
        className={cn("top-[8vh] gap-0 p-0 sm:top-[14vh] sm:max-w-xl")}
        onCloseAutoFocus={restoreFocus}
      >
        <PaletteBody onPick={pick} onOpenRecent={openRecent} onClose={close} />
      </CommandDialog>
      {viewing && (
        <Suspense fallback={null}>
          <Viewer generation={viewing} index={0} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>
  );
}
