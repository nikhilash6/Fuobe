"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, MoreHorizontal, Pencil, RotateCcw, Share2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RailButton } from "@/components/assist/shell";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CHAT_KINDS, playFormat, writeTool, type CharacterCard } from "@/lib/chat/catalog";
import type { Generation } from "@/lib/catalog/types";
import type { ChatMessage, ChatThreadView } from "@/lib/chat/types";
import { toastError } from "@/lib/refusals";
import { copyLine } from "@/lib/service-copy";
import { cn } from "@/lib/utils";
import { EngineLine, KindIcon, TypingDots, useReveal } from "./bits";
import { CharacterFace } from "./character-face";
import { ChatComposer, type ComposerHandle } from "./composer";
import { ChatSettingsDialog, ChilliDot, MangoChilliDialog, ShareDialog } from "./dialogs";
import { chatSend, useChatMe, useChatThread, useReply } from "./hooks";
import { PlanCard } from "./plan-card";
import { Markdown, ReplyBody } from "./prose";

/** One chat: its messages, the reply as it's written, and the box to carry on. */
export function ThreadView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { state, ask, stop, revealId: reveal } = useReply(id);
  // A kept message: look for its reply until it's here.
  const view = useChatThread(id, true, state.phase === "pending");
  const me = useChatMe();
  const t = view.data;
  const generations = useMemo(() => new Map((t?.generations ?? []).map((g) => [g.id, g])), [t?.generations]);
  const waitingForLater = state.phase === "pending" && t?.messages.at(-1)?.role === "user";
  const [sharing, setSharing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [chilli, setChilli] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const mature = !!me.data?.mature;
  const busy = state.phase === "waiting" || state.phase === "writing";

  // A new chat arrives with the person's first message: ask for its reply once.
  const asked = useRef(false);
  useEffect(() => {
    if (!t || asked.current) return;
    asked.current = true;
    if (t.messages.at(-1)?.role === "user") void ask({});
  }, [t, ask]);

  // Messages that arrive while the page is open animate in; the ones it opened with don't.
  const [openedAt] = useState(() => Date.now());

  // Follow the chat to its end, unless the person scrolled up to read: at once when it opens, smoothly after.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const firstScroll = useRef(true);
  const streamed = state.phase === "writing" ? state.text.length : 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pinned.current || !t) return;
    const instant = firstScroll.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    firstScroll.current = false;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
  }, [t, t?.messages.length, streamed, state.phase]);

  const send = async (text: string, image: string | null) => {
    pinned.current = true;
    // A light tap on phones that have it, as the message goes.
    navigator.vibrate?.(8);
    if (editing) {
      const m = editing;
      setEditing(null);
      await ask({ text, edit: m.id, image });
    } else await ask({ text, image });
  };

  if (view.isError) {
    const code = (view.error as { code?: string }).code;
    return (
      <Frame>
        <div className="mx-auto max-w-md py-24 text-center">
          <p className="font-heading text-[26px]">{code === "mature-off" ? "This chat is in Mango Chilli mode" : "This chat isn't here any more"}</p>
          <p className="mt-2 text-[14px] text-muted-foreground">{code === "mature-off" ? "Turn the mode on to open it." : "It may have been deleted."}</p>
          <div className="mt-5 flex justify-center gap-2">
            {code === "mature-off" && <Button onClick={() => setChilli(true)}>Turn on Mango Chilli</Button>}
            <Button variant="outline" asChild>
              <Link href="/chat">Back to chats</Link>
            </Button>
          </div>
        </div>
        <MangoChilliDialog open={chilli} onOpenChange={setChilli} onDone={() => void view.refetch()} />
      </Frame>
    );
  }

  const c = t?.characterCard ?? null;
  const label = !t ? "" : c ? c.tagline : t.kind === "play" ? (playFormat(t.play)?.name ?? "Workshop") : t.kind === "write" ? (writeTool(t.tool)?.name ?? "Write") : CHAT_KINDS.find((k) => k.id === t.kind)?.label;
  const lastAssistant = t?.messages.findLast((m) => m.role === "assistant");
  const lastUser = t?.messages.findLast((m) => m.role === "user");
  const canRetry = !!t && !busy && t.messages.at(-1)?.role === "assistant" && t.messages.length > 1;

  return (
    <Frame>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5">
        <RailButton />
        <Button variant="ghost" size="icon" asChild aria-label="Chat home" className="xl:hidden">
          <Link href="/chat">
            <ArrowLeft />
          </Link>
        </Button>
        {t && (c ? <CharacterFace name={c.name} accent={c.accent} portrait={c.portrait} className="size-8" /> : <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground"><KindIcon kind={t.kind} className="size-4" /></span>)}
        <div className="min-w-0 flex-1">
          {renaming && t ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("title");
                setRenaming(false);
                try {
                  const r = await chatSend<ChatThreadView>(`/api/chat/threads/${id}`, "PATCH", { title: v });
                  qc.setQueryData<ChatThreadView>(["chat", "thread", id], (x) => (x ? { ...x, title: r.title } : x));
                  void qc.invalidateQueries({ queryKey: ["chat", "threads"] });
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              <input name="title" defaultValue={t.title} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} maxLength={80} className="w-full rounded-md bg-muted px-2 py-1 text-[15px] font-medium outline-none" />
            </form>
          ) : (
            <>
              <p className="flex items-center gap-1.5 truncate text-[15px] leading-tight font-medium">
                {c ? c.name : t?.title}
                {t?.mature && <ChilliDot className="size-2" />}
              </p>
              {label && <p className="truncate text-[12px] leading-tight text-muted-foreground">{c ? label : t?.title !== label ? label : null}</p>}
            </>
          )}
        </div>
        {t && (
          <Button variant="ghost" size="sm" onClick={() => setSharing(true)}>
            <Share2 />
            <span className="hidden sm:inline">{t.shareToken ? "Shared" : "Share"}</span>
          </Button>
        )}
        {t && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettings(true)}>Chat settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 /> Delete chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <PhoneNavButton />
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-[760px] py-6">
          {c && (
            <div className="mb-8 flex flex-col items-center text-center">
              <CharacterFace name={c.name} accent={c.accent} portrait={c.portrait} rounded="card" className="aspect-[3/4] w-32 shadow-strong sm:w-40" />
              <p className="mt-4 font-heading text-[30px] leading-none">{c.name}</p>
              <p className="mt-1.5 max-w-[46ch] text-[14px] text-muted-foreground">{c.tagline}</p>
            </div>
          )}
          {!t ? (
            <div className="space-y-4 pt-6">
              <div className="ml-auto h-10 w-2/3 animate-pulse rounded-3xl bg-muted" />
              <div className="h-24 w-full animate-pulse rounded-2xl bg-muted/60" />
            </div>
          ) : (
            <ol className="flex flex-col">
              {t.messages.map((m, i) => {
                const prev = t.messages[i - 1];
                const next = t.messages[i + 1];
                // A run: messages from the same side with no long pause between them sit close, and only the last
                // one has the tail (and the character's face).
                const gap = !prev || m.createdAt - prev.createdAt > 60 * 60_000;
                const first = gap || prev.role !== m.role;
                const tail = !next || next.role !== m.role || next.createdAt - m.createdAt > 60 * 60_000 || (m.role === "assistant" && busy && i === t.messages.length - 1);
                const fresh = m.createdAt > openedAt || m.id.startsWith("tmp_");
                return (
                  <li key={m.id} className={cn(first ? "mt-5" : "mt-1", i === 0 && "mt-0")}>
                    {gap && i > 0 && <p className="mb-3 text-center text-[11.5px] text-subtle-foreground">{stamp(m.createdAt)}</p>}
                    {m.role === "user" ? (
                      <UserTurn
                        m={m}
                        tail={tail}
                        fresh={fresh}
                        editable={!busy && m.id === lastUser?.id && !m.id.startsWith("tmp_")}
                        onEdit={() => {
                          setEditing(m);
                          composer.current?.set(m.content);
                        }}
                      />
                    ) : (
                      <AssistantTurn
                        m={m}
                        threadId={id}
                        generations={generations}
                        onAnimate={(url) => void ask({ text: "Animate this", image: url })}
                        onAgain={(() => {
                          const said = t.messages.slice(0, i).findLast((x) => x.role === "user");
                          return said?.content ? () => void ask({ text: said.content, image: said.image }) : undefined;
                        })()}
                        character={c}
                        first={first}
                        tail={tail}
                        fresh={fresh}
                        reveal={m.id === reveal}
                        last={m.id === lastAssistant?.id}
                        canRetry={canRetry}
                        onRetry={() => void ask({ retry: true })}
                      />
                    )}
                  </li>
                );
              })}
              {busy && (
                <li aria-live="polite" className={cn(t.messages.at(-1)?.role === "assistant" ? "mt-1" : "mt-5")}>
                  <Row character={c} tail>
                    {state.phase === "writing" ? (
                      <Bubble side="them" tail fresh>
                        <ReplyBody text={state.text} />
                      </Bubble>
                    ) : (
                      <Bubble side="them" tail fresh className="px-4 py-3.5">
                        <TypingDots label={c ? `${c.name} is writing` : "Writing"} />
                      </Bubble>
                    )}
                  </Row>
                  {state.phase === "waiting" && (state.starting || (state.position ?? 0) > 0) && (
                    <p className={cn("mt-1.5 text-[12px] text-muted-foreground", c && "ml-9")}>
                      {state.starting && !state.position
                        ? "Warming up · just a moment"
                        : state.position === 1
                          ? copyLine("chatNext", {}, "You're next")
                          : copyLine("chatAhead", { n: (state.position ?? 1) - 1 }, "{n} ahead of you")}
                    </p>
                  )}
                </li>
              )}
              {waitingForLater && (
                <li className="mt-4 animate-in duration-300 fade-in-0">
                  <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground", c && "ml-9")} role="status">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />
                      Your message is saved — we&apos;ll answer here as soon as it&apos;s ready.
                    </span>
                    {me.data?.key && me.data.engine === "site" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 rounded-full"
                        onClick={async () => {
                          try {
                            qc.setQueryData(["chat", "me"], await chatSend("/api/chat/me", "PATCH", { engine: "key" }));
                            await ask({});
                          } catch (e) {
                            toastError(e);
                          }
                        }}
                      >
                        Answer with my model
                      </Button>
                    )}
                  </div>
                </li>
              )}
              {state.phase === "failed" && (
                <li className="mt-5 animate-in duration-200 fade-in-0">
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-muted/40 p-3.5 text-[14px]">
                    <p className="min-w-0 flex-1">
                      {state.code === "limit" && state.retryAt
                        ? `You've chatted a lot in a short while — more free replies at ${new Date(state.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`
                        : state.message}
                    </p>
                    {state.code === "key-refused" || state.code === "no-model" ? (
                      <Button size="sm" variant="secondary" onClick={() => setSettings(true)}>
                        Chat settings
                      </Button>
                    ) : state.code === "mature-off" ? (
                      <Button size="sm" variant="secondary" onClick={() => setChilli(true)}>
                        Turn on Mango Chilli
                      </Button>
                    ) : null}
                    {t.messages.at(-1)?.role === "user" && state.code !== "limit" && (
                      <Button size="sm" onClick={() => void ask({})}>
                        <RotateCcw />
                        Write it again
                      </Button>
                    )}
                  </div>
                </li>
              )}
            </ol>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto w-full max-w-[760px]">
          {editing && (
            <div className="mb-1.5 flex items-center gap-2 px-2 text-[12.5px] text-muted-foreground">
              <Pencil className="size-3.5" />
              Changing your last message. Everything after it is written again.
              <button type="button" className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={() => setEditing(null)}>
                <X className="size-3.5" /> Cancel
              </button>
            </div>
          )}
          <ChatComposer
            ref={composer}
            mature={mature}
            busy={busy}
            onStop={stop}
            disabled={!t}
            placeholder={c ? `Reply to ${c.name.split(" ")[0]}…` : "Reply…"}
            onSend={send}
            footer={<EngineLine me={me.data} />}
          />
          <p className="mt-1.5 text-center text-[11.5px] text-subtle-foreground">{c ? "Write actions in *asterisks*. Replies by an AI model." : "Replies by an AI model."}</p>
        </div>
      </div>

      {t && <ShareDialog thread={t} open={sharing} onOpenChange={setSharing} />}
      <ChatSettingsDialog open={settings} onOpenChange={setSettings} me={me.data} />
      <MangoChilliDialog open={chilli} onOpenChange={setChilli} />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>Its messages go for good{t?.shareToken ? ", and its share link stops working" : ""}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await chatSend(`/api/chat/threads/${id}`, "DELETE");
                  void qc.invalidateQueries({ queryKey: ["chat", "threads"] });
                  router.push("/chat");
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex h-content min-w-0 flex-col">{children}</div>;
}


/** "Today 14:02", "Yesterday 09:10" or "12 Nov 18:30": the label over a run after a long pause. */
function stamp(t: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  return `${days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/** The spring a new bubble rises with (a little overshoot, settled in a third of a second). */
const SPRING = "animate-in fade-in-0 zoom-in-90 slide-in-from-bottom-3 duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:animate-none";

/** A message bubble: the person's on the right in the brand colour, the other side's on the left in grey. */
function Bubble({ side, tail, fresh, className, children }: { side: "me" | "them"; tail?: boolean; fresh?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[min(85%,620px)] min-w-0 rounded-[22px] px-4 py-2.5 text-[15.5px] leading-relaxed break-words",
        side === "me" ? "origin-bottom-right bg-primary text-primary-foreground [&_a]:text-primary-foreground [&_em]:text-primary-foreground/80 [&_strong]:text-primary-foreground" : "origin-bottom-left bg-muted text-foreground",
        tail && (side === "me" ? "rounded-br-[6px]" : "rounded-bl-[6px]"),
        fresh && SPRING,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The other side's row: the character's face at the foot of a run, room for it on the rest. */
function Row({ character, tail, children }: { character: CharacterCard | null; tail?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      {character && (tail ? <CharacterFace name={character.name} accent={character.accent} portrait={character.portrait} className="size-7" /> : <span className="w-7 shrink-0" aria-hidden />)}
      {children}
    </div>
  );
}

function UserTurn({ m, tail, fresh, editable, onEdit }: { m: ChatMessage; tail: boolean; fresh: boolean; editable: boolean; onEdit: () => void }) {
  return (
    <div className="group flex flex-col items-end gap-1">
      {m.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.image} alt="Your picture" className={cn("max-h-72 max-w-[70%] origin-bottom-right rounded-[22px] border object-cover", fresh && SPRING)} />
      )}
      {m.content && (
        <Bubble side="me" tail={tail} fresh={fresh}>
          <Markdown text={m.content} className="space-y-2" />
        </Bubble>
      )}
      {editable && (
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 max-sm:hidden">
          <Pencil className="size-3" /> Edit
        </button>
      )}
    </div>
  );
}

function AssistantTurn({
  m,
  threadId,
  generations,
  onAnimate,
  onAgain,
  character,
  first,
  tail,
  fresh,
  reveal,
  last,
  canRetry,
  onRetry,
}: {
  m: ChatMessage;
  threadId: string;
  generations: Map<string, Generation>;
  onAnimate: (url: string) => void;
  onAgain?: () => void;
  character: CharacterCard | null;
  first: boolean;
  tail: boolean;
  fresh: boolean;
  reveal: boolean;
  last: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const text = useReveal(m.content, reveal);
  const [copied, setCopied] = useState(false);
  const copy = (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(m.content).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Copy"
      title="Copy"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
  return (
    <div className="group">
      {character && first && <p className="mb-1 ml-9 text-[12px] text-muted-foreground">{character.name}</p>}
      <Row character={character} tail={tail}>
        <Bubble side="them" tail={tail} fresh={fresh}>
          <ReplyBody text={text} />
        </Bubble>
        {/* Earlier replies keep the run tight: their Copy sits beside the bubble and shows on hover. */}
        {!last && <span className="self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:hidden">{copy}</span>}
      </Row>
      {m.plan && (
        <div className={cn(character && "ml-9")}>
          <PlanCard threadId={threadId} message={m as ChatMessage & { plan: NonNullable<ChatMessage["plan"]> }} generations={generations} onAnimate={onAnimate} onAgain={onAgain} />
        </div>
      )}
      {last && (
        <div className={cn("mt-1 flex gap-0.5 text-muted-foreground", character && "ml-9")}>
          {copy}
          {canRetry && (
            <button type="button" onClick={onRetry} className="grid size-8 place-items-center rounded-full hover:bg-accent hover:text-foreground" aria-label="Write it again" title="Write it again">
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
