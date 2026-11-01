"use client";

import { ArrowUp, AtSign, Check, Loader2, MoreHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BrandKit, Product } from "@/lib/catalog/marketing";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useBrandChat, useEstimate, type ChatMessage } from "@/components/marketing/hooks";
import { insertMention, mentionMatches, mentionQuery } from "./mention";

const NAME_KEY = "fuobe:first-name";
const CHIPS = ["A lifestyle ad with the product in everyday use", "A clean studio shot with a bold headline", "A playful, colorful ad for social media"];
const PLACEHOLDERS = ["Generate 4 ads for my product…", "Change the background to a holiday setting for our winter sale…", "Make 4 ad variations to A/B test…", "Write 5 versions with different headlines and CTAs…", "Tag your product with @…"];

const nameListeners = new Set<() => void>();
function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function useFirstName(): [string, (n: string) => void] {
  const name = useSyncExternalStore(
    (cb) => {
      nameListeners.add(cb);
      return () => nameListeners.delete(cb);
    },
    readName,
    () => "",
  );
  return [
    name,
    (n: string) => {
      try {
        localStorage.setItem(NAME_KEY, n.trim());
      } catch {}
      nameListeners.forEach((l) => l());
    },
  ];
}

function Proposal({ msg, brand, products, engine, onConfirmed }: { msg: ChatMessage; brand: BrandKit; products: Product[]; engine: "cloud" | "open"; onConfirmed: (batchId: string) => void }) {
  const { confirm } = useBrandChat(brand.id);
  const p = msg.proposal!;
  const total = p.items.reduce((n, i) => n + i.count, 0);
  const est = useEstimate<{ costUsd: number | null; demo: boolean }>("/api/ads/estimate", msg.batchId ? null : { brandId: brand.id, engine, items: p.items, direction: p.direction });
  const names = p.items.map((i) => products.find((x) => x.id === i.productId)?.name).filter(Boolean);
  return (
    <div className="mt-2 rounded-xl border bg-background p-3">
      <p className="text-[13px] font-medium">
        {total} ad{total === 1 ? "" : "s"} for {names.join(", ") || brand.name}
      </p>
      {p.direction && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{p.direction}</p>}
      {msg.batchId ? (
        <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-success">
          <Check className="size-3.5" /> On their way to the grid
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() =>
              confirm.mutate(
                { messageId: msg.id, engine },
                { onSuccess: (r) => (toast.success(`Generating ${total} ads`, { duration: 1500 }), onConfirmed(r.batchId)), onError: (e) => toastError(e) },
              )
            }
            disabled={confirm.isPending}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            {confirm.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Create {total} ads{est.data ? ` · ${est.data.demo ? "demo" : est.data.costUsd == null ? "" : `≈ ${formatCost(est.data.costUsd)}`}` : ""}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The brand chat: ask for ads in plain words, @mention products, confirm what it proposes. Typing "@"
 * opens the product list without taking the focus: the typed name filters it, ↑↓ pick, Enter or Tab
 * puts "@Name" in place of what was typed. `onClose` (the phone sheet) adds a close button and moves
 * "Clear chat" into a menu, so the two never sit on top of each other.
 */
export function AdChat({ brand, products, engine, onBatch, onClose, className }: { brand: BrandKit; products: Product[]; engine: "cloud" | "open"; onBatch: (batchId: string) => void; onClose?: () => void; className?: string }) {
  const { query, say, clear } = useBrandChat(brand.id);
  const [name, setName] = useFirstName();
  const [text, setText] = useState("");
  const [ph, setPh] = useState(0);
  const [caret, setCaret] = useState(0);
  const [menu, setMenu] = useState<"closed" | "typed" | "button">("closed");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const messages = query.data ?? [];
  const typed = menu === "typed" ? mentionQuery(text, caret) : null;
  const open = menu === "button" || (menu === "typed" && !!typed);
  const matches = menu === "typed" ? mentionMatches(products, typed?.query ?? "") : products;
  const current = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => {
    const t = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, say.isPending]);
  const sendText = (t: string) => {
    const v = t.trim();
    if (!v) return;
    setText("");
    setMenu("closed");
    say.mutate(v, { onError: (e) => toastError(e) });
  };
  const insert = (p: Product) => {
    const at = box.current?.selectionStart ?? caret;
    const next = insertMention(text, menu === "typed" ? caret : at, p.name);
    setText(next.text);
    setCaret(next.caret);
    setMenu("closed");
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const follow = (el: HTMLTextAreaElement) => {
    const c = el.selectionStart ?? el.value.length;
    setCaret(c);
    if (mentionQuery(el.value, c)) setMenu((m) => (m === "button" ? m : "typed"));
    else setMenu((m) => (m === "typed" ? "closed" : m));
  };
  const optionId = (i: number) => `${listId}-o${i}`;
  return (
    <aside className={cn("flex min-h-0 flex-col rounded-2xl border bg-background", className)} aria-label="Brand chat">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-[14px] font-semibold">Chat</p>
        <div className="flex items-center gap-1">
          {messages.length > 0 &&
            (onClose ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Chat options">
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => clear.mutate()}>
                    <Trash2 /> Clear chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => clear.mutate()} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Clear chat">
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Clear chat</TooltipContent>
              </Tooltip>
            ))}
          {onClose && (
            <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Close the chat">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div>
            <p className="font-heading text-[22px] leading-tight">
              {name ? `${name}, what` : "What"} ads should we make for {brand.name}?
            </p>
            {!name && (
              <input
                placeholder="Your first name (optional)"
                aria-label="Your first name"
                onKeyDown={(e) => e.key === "Enter" && setName((e.target as HTMLInputElement).value)}
                onBlur={(e) => e.target.value && setName(e.target.value)}
                className="mt-2 h-8 w-full rounded-lg border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
              />
            )}
            <div className="mt-3 flex flex-col gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} type="button" onClick={() => sendText(c)} className="rounded-xl bg-secondary px-3 py-2 text-left text-[13px] hover:bg-accent">
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed", m.role === "user" ? "bg-brand-faint text-foreground" : "bg-muted")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.role === "assistant" && m.proposal && <Proposal msg={m} brand={brand} products={products} engine={engine} onConfirmed={onBatch} />}
            </div>
          </div>
        ))}
        {say.isPending && (
          <div className="flex justify-start">
            <span className="rounded-2xl bg-muted px-3 py-2 text-[13px]">
              <span className="shimmer-text animate-shimmer-text">Thinking…</span>
            </span>
          </div>
        )}
      </div>
      <div className="border-t p-2.5">
        {/* The product list opens above the whole box (its anchor), so what's typed stays in view. */}
        <Popover open={open} onOpenChange={(o) => setMenu(o ? "button" : "closed")}>
          <PopoverAnchor asChild>
            <div className="rounded-2xl border bg-background p-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint">
              <textarea
                ref={box}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setActive(0);
                  follow(e.target);
                }}
                onSelect={(e) => follow(e.currentTarget)}
                onKeyDown={(e) => {
                  if (open && menu === "typed" && matches.length) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((current + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                      return;
                    }
                    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                      e.preventDefault();
                      insert(matches[current]);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    sendText(text);
                  }
                }}
                rows={2}
                placeholder={PLACEHOLDERS[ph]}
                aria-label="Message"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open && menu === "typed"}
                aria-controls={listId}
                aria-activedescendant={open && menu === "typed" && matches.length ? optionId(current) : undefined}
                className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-subtle-foreground"
              />
              <div className="flex items-center justify-between">
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:bg-accent" aria-label="Mention a product">
                    <AtSign className="size-3.5" /> Mention a product
                  </button>
                </PopoverTrigger>
                <button type="button" onClick={() => sendText(text)} disabled={!text.trim() || say.isPending} className={cn("grid size-8 place-items-center rounded-full", text.trim() ? "bg-primary text-primary-foreground" : "bg-muted text-subtle-foreground")} aria-label="Send">
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>
          </PopoverAnchor>
          <PopoverContent
            side="top"
            align="start"
            className="w-[var(--radix-popover-trigger-width)] min-w-56 max-w-80 p-1"
            collisionPadding={12}
            // Typing "@…" keeps the focus (and the typing) in the message box.
            onOpenAutoFocus={(e) => menu === "typed" && e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              box.current?.focus();
            }}
            onInteractOutside={(e) => e.target === box.current && e.preventDefault()}
          >
            <div id={listId} role="listbox" aria-label="Products">
              {matches.length ? (
                matches.map((p, i) => (
                  <button
                    key={p.id}
                    id={optionId(i)}
                    type="button"
                    role="option"
                    aria-selected={menu === "typed" && i === current}
                    onMouseDown={(e) => menu === "typed" && e.preventDefault()}
                    onClick={() => insert(p)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent", menu === "typed" && i === current && "bg-accent")}
                  >
                    <span className="size-6 shrink-0 overflow-hidden rounded bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images[0] && <img src={p.images[0]} alt="" className="size-full object-cover" />}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))
              ) : (
                <p className="p-2 text-[12px] text-muted-foreground">{products.length ? `No product matches “${typed?.query ?? ""}”.` : "No products yet."}</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </aside>
  );
}
