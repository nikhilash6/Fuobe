"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TAB_PILL, TabRow, onAttr } from "@/components/ui/tab-row";
import { askToSignUp, useHydrated, useIsGuest, useViewer } from "@/lib/api";
import { BUILT_IN_CHARACTERS, CHAT_KINDS, isChatKind, MANGO_CHILLI, STARTERS, WRITE_TOOLS, workshopFormat, writeTool, type CharacterCard, type ChatKind, type PlayFormat, type WriteTool } from "@/lib/chat/catalog";
import { playMessage, toolMessage } from "@/lib/chat/prompt";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { RailButton } from "@/components/assist/shell";
import { CharacterBuilder } from "./character-builder";
import { CharacterFace } from "./character-face";
import { ChatComposer } from "./composer";
import { ChatSettingsDialog, ChilliDot, CHILLI_BG, MangoChilliDialog, PlayDialog, WriteToolDialog } from "./dialogs";
import { chatSend, useCharacters, useChatMe, useStartChat } from "./hooks";
import { EngineLine } from "./bits";
import { MakeBox } from "./make";
import { WorkshopGrid } from "./workshop";

/**
 * Fuobe Chat's home: one box to start talking, the kinds of chat (Chat, Ideas, Write, Characters, Play), the
 * characters, and recent chats. A guest sees all of it; starting anything opens the sign-up card.
 */
export function ChatHome() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const viewer = useViewer();
  const guest = useIsGuest();
  // Until the page has hydrated it reads as unknown, so the first render matches the server's HTML even when the
  // viewer is already cached (the nav reads it too).
  const hydrated = useHydrated();
  const known = hydrated && viewer.isSuccess;
  const signedIn = known && !guest;
  const me = useChatMe(signedIn);
  const characters = useCharacters(signedIn);
  const start = useStartChat();

  // A link can open a kind, a writing tool or a game with its form (?kind=, ?tool=, ?play=).
  const [kind, setKind] = useState<ChatKind>(() => {
    const k = sp.get("kind");
    return workshopFormat(sp.get("play")) ? "play" : writeTool(sp.get("tool")) ? "write" : isChatKind(k) ? k : "chat";
  });
  const [tool, setTool] = useState<WriteTool | null>(() => writeTool(sp.get("tool")));
  const [play, setPlay] = useState<PlayFormat | null>(() => {
    const p = workshopFormat(sp.get("play"));
    return p && (p.ask || p.picture) ? p : null;
  });
  const [building, setBuilding] = useState<{ open: boolean; editing: CharacterCard | null }>({ open: false, editing: null });
  const [settings, setSettings] = useState(false);
  const [chilli, setChilli] = useState(false);
  const [starting, setStarting] = useState(false);
  const [making, setMaking] = useState(() => sp.get("make") === "1");
  const mature = !!me.data?.mature;

  // On a phone the tabs scroll sideways: the chosen one always shows (also when a link opens on a later tab).
  useEffect(() => {
    document.querySelector('[aria-label="Kind of chat"] [aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [kind, making]);

  const gate = () => {
    if (guest) {
      askToSignUp("run");
      return false;
    }
    return signedIn;
  };

  const go = async (s: Parameters<typeof start>[0]) => {
    if (!gate()) return;
    setStarting(true);
    try {
      const t = await start(s);
      router.push(`/chat/${t.id}`);
    } catch (e) {
      if ((e as { code?: string }).code === "mature-off") setChilli(true);
      else toastError(e);
      setStarting(false);
    }
  };

  // Links that start a chat at once: ?character=, a game with nothing to fill in, and ?from=<shared chat> ("Chat with them").
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !known) return;
    const character = sp.get("character");
    const from = sp.get("from");
    const p = workshopFormat(sp.get("play"));
    const now = p && !p.ask && !p.picture ? p : null;
    if (!character && !from && !now) return;
    handled.current = true;
    if (guest) {
      askToSignUp("run");
      return;
    }
    // A link's one-time start: it shows the button busy while the chat is made.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (now) void go({ kind: "play", play: now.id, text: playMessage(now.id, "") });
    else if (character) void go({ kind: "character", characterId: character });
    else if (from) {
      chatSend<CharacterCard>("/api/chat/characters", "POST", { fromShare: from })
        .then((c) => {
          void qc.invalidateQueries({ queryKey: ["chat", "characters"] });
          return go({ kind: "character", characterId: c.id });
        })
        .catch((e) => ((e as { code?: string }).code === "mature-off" ? setChilli(true) : toastError(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, guest]);

  const cast = useMemo(() => (signedIn ? (characters.data?.items ?? null) : BUILT_IN_CHARACTERS.filter((c) => !c.mature)), [signedIn, characters.data]);
  const k = CHAT_KINDS.find((x) => x.id === kind)!;
  const typing = kind === "chat" || kind === "ideas" || kind === "write";

  return (
    <div className="flex h-content min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1.5 px-4 sm:px-6">
        <RailButton />
        <Link href="/chat" className="font-heading text-[22px] leading-none">
          Chat
        </Link>
        <div className="flex-1" />
        {signedIn && (
          <>
            <button
              type="button"
              onClick={() => (mature ? setSettings(true) : setChilli(true))}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors",
                mature ? "border-transparent text-white " + CHILLI_BG : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-pressed={mature}
              title={mature ? `${MANGO_CHILLI.name} is on` : `Turn on ${MANGO_CHILLI.name}`}
            >
              {!mature && <ChilliDot />}
              {MANGO_CHILLI.short}
            </button>
            <Button variant="ghost" size="icon" onClick={() => setSettings(true)} aria-label="Chat settings">
              <Settings2 />
            </Button>
          </>
        )}
        <PhoneNavButton />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto w-full max-w-[880px] pt-[6vh] pb-20 sm:pt-[9vh]">
          <h1 className="font-heading text-[clamp(40px,7vw,64px)] leading-[1.02] tracking-[-0.01em] text-balance">{mature ? "Say what you really mean." : "Talk it through."}</h1>
          <p className="mt-3 max-w-[56ch] text-[15.5px] text-pretty text-muted-foreground">
            Ask anything, brainstorm ideas you can make in one tap, write captions and scripts, or step into a story with a character. Free on Fuobe.
          </p>

          <TabRow role="tablist" aria-label="Kind of chat" className="mt-8 w-fit max-w-full">
            {CHAT_KINDS.flatMap((x) => {
              const tab = (
                <button
                  key={x.id}
                  role="tab"
                  aria-selected={!making && x.id === kind}
                  className={TAB_PILL}
                  {...onAttr(!making && x.id === kind)}
                  onClick={() => {
                    setMaking(false);
                    setKind(x.id);
                  }}
                >
                  {x.label}
                </button>
              );
              // Make sits beside Ideas: from talking about it to making it.
              return x.id !== "ideas"
                ? [tab]
                : [
                    tab,
                    <button key="make" role="tab" aria-selected={making} className={TAB_PILL} {...onAttr(making)} onClick={() => setMaking(true)}>
                      Make
                    </button>,
                  ];
            })}
          </TabRow>

          {making && <MakeBox owner={!!me.data?.owner} guest={known && guest} />}

          {!making && typing && (
            <div className="mt-4">
              <ChatComposer
                key={kind}
                large
                autoFocus={signedIn}
                mature={mature}
                placeholder={k.placeholder}
                disabled={starting}
                busy={starting}
                onSend={(text, image) => go({ kind, text, image })}
                footer={signedIn ? <EngineLine me={me.data} /> : known && guest ? <span className="px-1 text-[12.5px] text-muted-foreground">Free with an account</span> : null}
              />
            </div>
          )}

          <section className={cn("mt-6", making && "hidden")}>
            {kind === "chat" || kind === "ideas" ? (
              <div className="grid gap-x-6 sm:grid-cols-2">
                {STARTERS[kind].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void go({ kind, text: s })}
                    className="group flex items-baseline gap-3 border-b py-3 text-left text-[15px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="text-subtle-foreground transition-colors group-hover:text-brand-text" aria-hidden>
                      {kind === "ideas" ? "✦" : "›"}
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            ) : kind === "write" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {WRITE_TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => gate() && setTool(t)}
                    className="rounded-2xl border bg-background p-4 text-left transition-[border-color,box-shadow] hover:border-primary hover:shadow-soft focus-visible:ring-4 focus-visible:ring-brand-faint focus-visible:outline-none"
                  >
                    <span className="font-heading text-[21px] leading-none">{t.name}</span>
                    <span className="mt-1.5 block text-[13.5px] text-muted-foreground">{t.blurb}</span>
                  </button>
                ))}
              </div>
            ) : kind === "play" ? (
              <WorkshopGrid
                onPick={(p) => {
                  if (!gate()) return;
                  if (p.ask || p.picture) setPlay(p);
                  else void go({ kind: "play", play: p.id, text: playMessage(p.id, "") });
                }}
              />
            ) : null}
          </section>

          {!making && (kind === "character" || kind === "chat") && (
            <section className="mt-12">
              <div className="mb-4 flex items-end justify-between gap-3">
                <h2 className="font-heading text-[28px] leading-none">Characters</h2>
                {kind === "chat" && (
                  <button type="button" onClick={() => setKind("character")} className="text-[13px] text-muted-foreground hover:text-foreground">
                    See all
                  </button>
                )}
              </div>
              <CharacterShelf
                cast={cast}
                row={kind === "chat"}
                onPick={(c) => void go({ kind: "character", characterId: c.id })}
                onEdit={(c) => setBuilding({ open: true, editing: c })}
                onNew={() => gate() && setBuilding({ open: true, editing: null })}
              />
            </section>
          )}

        </div>
      </div>

      <WriteToolDialog
        tool={tool}
        onOpenChange={(o) => !o && setTool(null)}
        onStart={async (values, tone) => {
          if (!tool) return;
          await go({ kind: "write", tool: tool.id, text: toolMessage(tool.id, values, tone) });
        }}
      />
      <PlayDialog play={play} onOpenChange={(o) => !o && setPlay(null)} onStart={async (input, image) => (play ? go({ kind: "play", play: play.id, text: playMessage(play.id, input), image }) : undefined)} />
      <CharacterBuilder
        open={building.open}
        editing={building.editing}
        mature={mature}
        onOpenChange={(o) => setBuilding((b) => ({ ...b, open: o }))}
        onSaved={(c, startNow) => {
          if (startNow) void go({ kind: "character", characterId: c.id });
          else toast.success(`${c.name} is saved.`);
        }}
      />
      <ChatSettingsDialog open={settings} onOpenChange={setSettings} me={me.data} />
      <MangoChilliDialog open={chilli} onOpenChange={setChilli} />
    </div>
  );
}

function CharacterShelf({
  cast,
  row,
  onPick,
  onEdit,
  onNew,
}: {
  cast: CharacterCard[] | null;
  row: boolean;
  onPick: (c: CharacterCard) => void;
  onEdit: (c: CharacterCard) => void;
  onNew: () => void;
}) {
  const shown = cast ? (row ? cast.slice(0, 5) : cast) : null;
  return (
    <div className={cn(row ? "scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4")}>
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "grid aspect-[3/4] shrink-0 snap-start place-items-center rounded-[18px] border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
          row && "w-[42vw] max-w-[180px] sm:w-auto sm:max-w-none",
        )}
      >
        <span className="flex flex-col items-center gap-2 text-[14px]">
          <Plus className="size-5" />
          New character
        </span>
      </button>
      {shown
        ? shown.map((c) => (
            <div key={c.id} className={cn("group relative shrink-0 snap-start", row && "w-[42vw] max-w-[180px] sm:w-auto sm:max-w-none")}>
              {/* The card keeps its rounded frame; only the picture inside it zooms on hover. */}
              <button
                type="button"
                onClick={() => onPick(c)}
                className="relative block w-full overflow-hidden rounded-[18px] text-left [transform:translateZ(0)] focus-visible:ring-4 focus-visible:ring-brand-faint focus-visible:outline-none"
                aria-label={`Chat with ${c.name}`}
              >
                <CharacterFace
                  name={c.name}
                  accent={c.accent}
                  portrait={c.portrait}
                  rounded="card"
                  className="aspect-[3/4] w-full rounded-none transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 pt-12 text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="font-heading text-[20px] leading-tight">{c.name}</span>
                    {c.mature && <ChilliDot className="size-2" />}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-white/80">{c.tagline}</span>
                </span>
              </button>
              {!c.builtIn && (
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
          ))
        : Array.from({ length: row ? 4 : 7 }, (_, i) => <Skeleton key={i} className={cn("aspect-[3/4] shrink-0 rounded-[18px]", row && "w-[42vw] max-w-[180px] sm:w-auto")} />)}
    </div>
  );
}

