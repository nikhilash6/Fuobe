"use client";

import { ArrowUp, ImagePlus, Loader2, Square, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { uploadFile } from "@/lib/api";
import { CHAT_LIMITS } from "@/lib/chat/catalog";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
  set: (text: string) => void;
}

/**
 * Fuobe Chat's message box: Enter sends, Shift+Enter starts a new line, one picture can go with a message (picked,
 * pasted or dropped). While a reply is written the send button stops it.
 */
export const ChatComposer = forwardRef<
  ComposerHandle,
  {
    onSend: (text: string, image: string | null) => void | Promise<void>;
    onStop?: () => void;
    busy?: boolean;
    disabled?: boolean;
    placeholder: string;
    pictures?: boolean;
    autoFocus?: boolean;
    footer?: ReactNode;
    large?: boolean;
    mature?: boolean;
  }
>(function ChatComposer({ onSend, onStop, busy, disabled, placeholder, pictures = true, autoFocus, footer, large, mature }, ref) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ preview: string; url?: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    set: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = input.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(t.length, t.length);
      });
    },
  }));

  const add = async (f: File | undefined) => {
    if (!f || !/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return;
    const preview = URL.createObjectURL(f);
    setImage({ preview });
    try {
      const a = await uploadFile(f);
      setImage((cur) => (cur?.preview === preview ? { preview, url: a.url } : cur));
    } catch (e) {
      setImage(null);
      toastError(e, "That picture couldn't be added.");
    }
  };

  const uploading = !!image && !image.url;
  const ready = !disabled && !busy && !uploading && (text.trim().length > 0 || !!image?.url);

  const send = async () => {
    if (!ready) return;
    const t = text.trim();
    const img = image?.url ?? null;
    setText("");
    setImage(null);
    await onSend(t, img);
  };

  return (
    <div
      className={cn(
        "relative rounded-[22px] border bg-background p-2 shadow-soft transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer",
        mature && "focus-within:border-[#e8572b] focus-within:ring-[#ff8a3d]/20",
      )}
      onDragOver={(e) => pictures && e.preventDefault()}
      onDrop={(e) => {
        if (!pictures) return;
        e.preventDefault();
        void add(e.dataTransfer.files[0]);
      }}
    >
      {image && (
        <div className="px-2 pt-1.5 pb-1">
          <div className="relative size-16 overflow-hidden rounded-xl border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.preview} alt="" className="size-full object-cover" />
            {uploading && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-white drop-shadow" />}
            <button type="button" onClick={() => setImage(null)} className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/70 text-white" aria-label="Remove picture">
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}
      <textarea
        ref={input}
        value={text}
        autoFocus={autoFocus}
        maxLength={CHAT_LIMITS.messageChars}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const f = pictures ? [...e.clipboardData.files].find((x) => x.type.startsWith("image/")) : undefined;
          if (f) {
            e.preventDefault();
            void add(f);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        rows={1}
        aria-label="Message"
        className={cn(
          "field-sizing-content max-h-56 w-full resize-none bg-transparent px-3 py-2 leading-relaxed outline-none placeholder:text-subtle-foreground",
          large ? "min-h-16 text-[17px]" : "min-h-11 text-base",
        )}
      />
      <div className="flex items-center gap-1.5 px-1">
        {pictures && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                void add(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => file.current?.click()}
              disabled={disabled || busy}
              className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="Add a picture"
              title="Add a picture"
            >
              <ImagePlus className="size-[18px]" />
            </button>
          </>
        )}
        <div className="min-w-0 flex-1">{footer}</div>
        {busy && onStop ? (
          <Button size="icon" variant="secondary" className="size-10 shrink-0 rounded-full" onClick={onStop} aria-label="Stop the reply">
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className={cn("size-10 shrink-0 rounded-full", mature && "bg-[linear-gradient(135deg,#ffb020,#e8352b)] text-white hover:opacity-90")}
            disabled={!ready}
            onClick={() => void send()}
            aria-label="Send"
          >
            {uploading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        )}
      </div>
    </div>
  );
});
