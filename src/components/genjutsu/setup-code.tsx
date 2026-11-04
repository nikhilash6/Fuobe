"use client";

import { ClipboardPaste, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { copyText } from "@/lib/clipboard";
import { decodeSetup, encodeSetup, type GenjutsuSetup } from "@/lib/catalog/genjutsu";

/**
 * Higgsfield's "share a setup by code", done locally: Copy setup puts a link with the settings as a short code
 * (/genjutsu?setup=gj2.…) on the clipboard; Paste setup reads a code or such a link back. The clip itself isn't in
 * it; reference images are files of this install.
 */
export function SetupCode({ setup, onPaste }: { setup: GenjutsuSetup; onPaste: (s: GenjutsuSetup) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const copy = async () => {
    const link = `${window.location.origin}/genjutsu?setup=${encodeSetup(setup)}`;
    if (await copyText(link)) toast("Setup copied", { description: "A link with this mode, model and references — paste it here, or send it to someone on this site." });
    else toast.error("Couldn't copy — your browser blocked the clipboard");
  };
  const paste = () => {
    const s = decodeSetup(text);
    if (!s) {
      // A later code version (gj3.…): this install is older than the one that made it.
      const v = /gj(\d+)\./.exec(text);
      if (v && Number(v[1]) > 2) return void toast.error("That setup comes from a newer Fuobe. Update this one to paste it.");
      return void toast.error("That isn't a Genjutsu setup code (they start with gj1. or gj2.)");
    }
    onPaste(s);
    setOpen(false);
    setText("");
  };
  return (
    // The same space between Copy setup, Paste setup and the engine switch after them (the ghost buttons' own padding counts).
    <div className="mr-1 flex items-center gap-0.5">
      <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void copy()} aria-label="Copy setup">
        <Copy className="size-3.5" />
        <span className="hidden sm:inline">Copy setup</span>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="rounded-full" aria-label="Paste setup">
            <ClipboardPaste className="size-3.5" />
            <span className="hidden sm:inline">Paste setup</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,360px)] space-y-2 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              paste();
            }}
            className="space-y-2"
          >
            <label htmlFor="gj-setup-code" className="block text-[13px] font-medium">
              Paste a setup code or link
            </label>
            <Input id="gj-setup-code" value={text} onChange={(e) => setText(e.target.value)} placeholder="gj2.… or a /genjutsu?setup= link" className="h-8 text-[13px]" autoFocus />
            <div className="flex justify-end">
              <Button type="submit" size="sm" className="rounded-full" disabled={!text.trim()}>
                Use this setup
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
