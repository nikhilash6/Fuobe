"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, ImagePlus, KeyRound, Link2, Link2Off, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TAB_PILL, TabRow, onAttr } from "@/components/ui/tab-row";
import { uploadFile } from "@/lib/api";
import { MANGO_CHILLI, type PlayFormat, type WriteTool } from "@/lib/chat/catalog";
import type { ChatMe, ChatThreadView } from "@/lib/chat/types";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { CharacterFace } from "./character-face";
import { chatSend } from "./hooks";
import { ReplyBody } from "./prose";
import { WorkshopCover } from "./workshop";

/** Mango Chilli's mark: its two colours, used only for this mode. */
export const CHILLI_BG = "bg-[linear-gradient(135deg,#ffb020_0%,#ff6a2b_55%,#e8352b_100%)]";

export function ChilliDot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-2.5 rounded-full", CHILLI_BG, className)} aria-hidden />;
}

// ---------------------------------------------------------------------------

/** Turn Mango Chilli mode on, after the person says they're 18 or older. */
export function MangoChilliDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [adult, setAdult] = useState(false);
  const [saving, setSaving] = useState(false);
  const turnOn = async () => {
    setSaving(true);
    try {
      const me = await chatSend<ChatMe>("/api/chat/me", "PATCH", { mature: true, adult: true });
      qc.setQueryData(["chat", "me"], me);
      void qc.invalidateQueries({ queryKey: ["chat"] });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[420px]">
        <div className={cn("relative h-28", CHILLI_BG)}>
          <span className="absolute bottom-3 left-5 font-heading text-[34px] leading-none text-white drop-shadow-sm">Mango Chilli</span>
        </div>
        <div className="space-y-4 px-5 pb-5">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="text-[17px]">Turn on {MANGO_CHILLI.name}?</DialogTitle>
            <DialogDescription className="text-[14px] leading-relaxed">{MANGO_CHILLI.blurb} Every character stays a fictional adult. You can turn it off any time.</DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-[14px] leading-snug has-[:checked]:border-[#ff6a2b]">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 size-4 accent-[#ff6a2b]" />
            {MANGO_CHILLI.confirm}
          </label>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button disabled={!adult || saving} onClick={() => void turnOn()} className={cn("text-white hover:opacity-90", CHILLI_BG)}>
              {saving && <Loader2 className="animate-spin" />}
              Turn on
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** Suggestions from OpenRouter's list (src/lib/catalog/llm-providers.ts); any model id works. */
const KEY_MODELS = [
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)" },
  { id: "openrouter/free", label: "Any free model" },
  { id: "deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash" },
  { id: "x-ai/grok-4.7", label: "Grok 4.7" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
];

/** Chat settings: Mango Chilli mode, and which model answers (Fuobe's free one, or the person's own OpenRouter key). */
export function ChatSettingsDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: ChatMe | undefined }) {
  const qc = useQueryClient();
  const [chilli, setChilli] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const update = (m: ChatMe) => {
    qc.setQueryData(["chat", "me"], m);
    void qc.invalidateQueries({ queryKey: ["chat"] });
  };
  const patch = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      update(await chatSend<ChatMe>("/api/chat/me", "PATCH", body));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const saveKey = async () => {
    setBusy("key");
    try {
      await chatSend("/api/chat/key", "PUT", { key: key.trim() });
      setKey("");
      update(await chatSend<ChatMe>("/api/chat/me", "GET"));
      toast.success("Key saved. Replies now come from your OpenRouter account.");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const removeKey = async () => {
    setBusy("remove");
    try {
      await chatSend("/api/chat/key", "DELETE");
      update(await chatSend<ChatMe>("/api/chat/me", "GET"));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const engine = me?.engine ?? "site";
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Chat settings</DialogTitle>
          </DialogHeader>

          <section className="space-y-3">
            <h3 className="text-[13px] font-medium text-muted-foreground">Who answers</h3>
            <TabRow role="radiogroup" aria-label="Who answers" fade={false} className="w-fit">
              <button role="radio" aria-checked={engine === "site"} className={TAB_PILL} {...onAttr(engine === "site")} onClick={() => engine !== "site" && void patch({ engine: "site" }, "engine")}>
                Fuobe&apos;s free model
              </button>
              <button
                role="radio"
                aria-checked={engine === "key"}
                className={TAB_PILL}
                {...onAttr(engine === "key")}
                disabled={!me?.key}
                onClick={() => engine !== "key" && void patch({ engine: "key" }, "engine")}
                title={me?.key ? undefined : "Add your OpenRouter key below first"}
              >
                Your OpenRouter key
              </button>
            </TabRow>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {engine === "site"
                ? "Free, on Fuobe's own GPUs."
                : "Replies come from your OpenRouter account, with the model you pick. OpenRouter bills you for paid models."}
            </p>
            {me?.key ? (
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center gap-2 text-[14px]">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="flex-1">Key ending in {me.key.last4}</span>
                  <Button variant="ghost" size="sm" onClick={() => void removeKey()} disabled={busy === "remove"}>
                    {busy === "remove" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove
                  </Button>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-muted-foreground">Model</span>
                  <div className="flex flex-wrap gap-1.5">
                    {KEY_MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => void patch({ model: m.id }, "model")}
                        className={cn("rounded-full border px-2.5 py-1 text-[12.5px]", me.key?.model === m.id ? "border-primary bg-brand-faint text-brand-text" : "hover:bg-accent")}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    defaultValue={me.key.model}
                    placeholder="Any OpenRouter model id"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== me.key?.model && void patch({ model: e.target.value.trim() }, "model")}
                    className="mt-1.5"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border p-3">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Use your own key for stronger models or when the free one is busy. Get one at{" "}
                  <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="text-brand-text underline underline-offset-2">
                    openrouter.ai
                  </a>
                  . It&apos;s stored encrypted and never shown again.
                </p>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-…" aria-label="OpenRouter key" />
                  <Button onClick={() => void saveKey()} disabled={!key.trim() || busy === "key"}>
                    {busy === "key" && <Loader2 className="animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2 border-t pt-4">
            <div className="flex items-center gap-3">
              <ChilliDot />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">{MANGO_CHILLI.name}</p>
                <p className="text-[13px] leading-snug text-muted-foreground">{MANGO_CHILLI.blurb}</p>
              </div>
              <Switch
                checked={!!me?.mature}
                disabled={busy === "mature"}
                onCheckedChange={(on) => (on ? setChilli(true) : void patch({ mature: false }, "mature"))}
                aria-label={MANGO_CHILLI.name}
              />
            </div>
          </section>
        </DialogContent>
      </Dialog>
      <MangoChilliDialog open={chilli} onOpenChange={setChilli} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** A writing tool's short form; its answers become the chat's first message. */
export function WriteToolDialog({ tool, onOpenChange, onStart }: { tool: WriteTool | null; onOpenChange: (o: boolean) => void; onStart: (values: Record<string, string>, tone: string | null) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [tone, setTone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!tool && tool.fields.every((f) => f.optional || values[f.id]?.trim());
  return (
    <Dialog
      open={!!tool}
      onOpenChange={(o) => {
        if (!o) {
          setValues({});
          setTone(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        {tool && (
          <>
            <DialogHeader>
              <DialogTitle>{tool.name}</DialogTitle>
              <DialogDescription>{tool.blurb}</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!ready) return;
                setBusy(true);
                try {
                  await onStart(values, tone);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tool.fields.map((f, i) => (
                <label key={f.id} className="block space-y-1.5">
                  <span className="text-[13px] font-medium">
                    {f.label}
                    {f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
                  </span>
                  {f.long ? (
                    <Textarea
                      autoFocus={i === 0}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                      placeholder={f.placeholder}
                      rows={3}
                      maxLength={2000}
                    />
                  ) : (
                    <Input autoFocus={i === 0} value={values[f.id] ?? ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} placeholder={f.placeholder} maxLength={200} />
                  )}
                </label>
              ))}
              {tool.tones && (
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium">Tone</span>
                  <div className="flex flex-wrap gap-1.5">
                    {tool.tones.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTone(tone === t ? null : t)}
                        aria-pressed={tone === t}
                        className={cn("rounded-full border px-3 py-1 text-[13px]", tone === t ? "border-primary bg-brand-faint text-brand-text" : "hover:bg-accent")}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={!ready || busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  Write it
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** A Play format that needs words or a picture first. */
export function PlayDialog({ play, onOpenChange, onStart }: { play: PlayFormat | null; onOpenChange: (o: boolean) => void; onStart: (input: string, image: string | null) => Promise<void> }) {
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ preview: string; url?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const add = async (f: File | undefined) => {
    if (!f) return;
    const preview = URL.createObjectURL(f);
    setImage({ preview });
    try {
      const a = await uploadFile(f);
      setImage({ preview, url: a.url });
    } catch (e) {
      setImage(null);
      toastError(e, "That picture couldn't be added.");
    }
  };
  const ready = !!play && (play.picture ? !!image?.url : !play.ask || input.trim().length > 0);
  return (
    <Dialog
      open={!!play}
      onOpenChange={(o) => {
        if (!o) {
          setInput("");
          setImage(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        {play && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!ready) return;
              setBusy(true);
              try {
                await onStart(input, image?.url ?? null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5">
                <WorkshopCover format={play} className="size-9 shrink-0 rounded-lg" />
                {play.name}
              </DialogTitle>
              <DialogDescription>{play.blurb}</DialogDescription>
            </DialogHeader>
            {play.picture && (
              <>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void add(e.target.files?.[0])} />
                <button
                  type="button"
                  onClick={() => file.current?.click()}
                  className="relative grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-2xl border border-dashed bg-muted/40 text-muted-foreground hover:bg-muted"
                >
                  {image ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.preview} alt="" className="absolute inset-0 size-full object-cover" />
                      {!image.url && <Loader2 className="relative size-6 animate-spin text-white drop-shadow" />}
                    </>
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-[14px]">
                      <ImagePlus className="size-6" />
                      {play.id === "style-critique" ? "Add a full-length photo of the outfit" : "Add the photo you want notes on"}
                    </span>
                  )}
                </button>
              </>
            )}
            {play.ask && (
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium">{play.ask.label}</span>
                <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={play.ask.placeholder} maxLength={600} />
              </label>
            )}
            <DialogFooter>
              <Button type="submit" disabled={!ready || busy}>
                {busy && <Loader2 className="animate-spin" />}
                Play
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** Share a chat: a preview of what goes public, then its link, its picture card and Stop sharing. */
export function ShareDialog({ thread, open, onOpenChange }: { thread: ChatThreadView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const token = thread.shareToken;
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/c/${token}` : null;
  const shown = thread.messages.filter((m) => m.content.trim()).slice(-12);
  const c = thread.characterCard;
  const refresh = () => qc.invalidateQueries({ queryKey: ["chat", "thread", thread.id] });

  const create = async () => {
    setBusy("create");
    try {
      const r = await chatSend<{ token: string }>(`/api/chat/threads/${thread.id}/share`, "POST", {});
      qc.setQueryData<ChatThreadView>(["chat", "thread", thread.id], (t) => (t ? { ...t, shareToken: r.token } : t));
      const link = `${window.location.origin}/c/${r.token}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Link copied. Anyone with it can read this chat.");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const stop = async () => {
    setBusy("stop");
    try {
      await chatSend(`/api/chat/threads/${thread.id}/share`, "DELETE");
      qc.setQueryData<ChatThreadView>(["chat", "thread", thread.id], (t) => (t ? { ...t, shareToken: null } : t));
      void refresh();
      toast.success("Stopped sharing. The link no longer works.");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const native = async () => {
    if (!url) return;
    if (navigator.share) await navigator.share({ title: thread.title, url }).catch(() => {});
    else await copy();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Share this chat</DialogTitle>
          <DialogDescription>
            {token ? "Anyone with the link can read the part below. New messages aren't added: share again to update it." : "Makes a public link to the last messages below. Pictures you sent stay private."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[42svh] space-y-3 overflow-y-auto rounded-2xl border bg-muted/30 p-4">
          {c && (
            <div className="flex items-center gap-2.5 pb-1">
              <CharacterFace name={c.name} accent={c.accent} portrait={c.portrait} className="size-8" />
              <span className="font-heading text-[19px] leading-none">{c.name}</span>
            </div>
          )}
          {shown.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3 py-2 text-[14px] text-background">
                {m.content || "(a picture)"}
              </p>
            ) : (
              <div key={m.id} className="text-[14px]">
                <ReplyBody text={m.content} compact />
              </div>
            ),
          )}
        </div>
        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border bg-background p-1.5 pl-3">
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">{url}</span>
              <Button size="sm" onClick={() => void copy()}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void native()}>
                <Link2 />
                Share…
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <a href={`/c/${token}/opengraph-image`} download={`${thread.title.slice(0, 40) || "chat"}.png`}>
                  <Download />
                  Picture card
                </a>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void create()} disabled={!!busy}>
                {busy === "create" && <Loader2 className="animate-spin" />}
                Update
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void stop()} disabled={!!busy} className="ml-auto text-muted-foreground">
                {busy === "stop" ? <Loader2 className="animate-spin" /> : <Link2Off />}
                Stop sharing
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            <Button onClick={() => void create()} disabled={!!busy}>
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Link2 />}
              Create link
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
