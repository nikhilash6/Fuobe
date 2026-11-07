"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadFile } from "@/lib/api";
import { CHAT_LIMITS, MANGO_CHILLI, type CharacterCard } from "@/lib/chat/catalog";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { CharacterFace } from "./character-face";
import { ChilliDot } from "./dialogs";
import { chatSend } from "./hooks";

const PALETTES: [string, string][] = [
  ["#241a3a", "#6a5ee7"],
  ["#2a0f1e", "#d4567c"],
  ["#0d1b2a", "#3a86ff"],
  ["#3b2a20", "#e0a458"],
  ["#10261c", "#3fb68b"],
  ["#1c1c1c", "#8a7650"],
  ["#1a0508", "#a4161a"],
  ["#0b3954", "#ff8552"],
];

interface Draft {
  name: string;
  tagline: string;
  persona: string;
  scenario: string;
  greeting: string;
  mature: boolean;
  accent: [string, string];
  portrait: string | null;
}

const EMPTY: Draft = { name: "", tagline: "", persona: "", scenario: "", greeting: "", mature: false, accent: PALETTES[0], portrait: null };

/** A portrait prompt for the Image studio from what the person wrote. */
const portraitPrompt = (d: Draft) =>
  `Editorial portrait of ${d.name || "a character"}${d.tagline ? `, ${d.tagline}` : ""}. ${d.persona.slice(0, 300)} Head-and-shoulders, 3:4 vertical, cinematic soft key light, shallow depth of field, rich colour, fashion magazine quality.`;

interface BuilderProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: CharacterCard | null;
  mature: boolean;
  onSaved?: (c: CharacterCard, start: boolean) => void;
}

/** Make or change a character: their look, who they are, where the story starts and their first line. */
export function CharacterBuilder(props: BuilderProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-[640px]">
        {/* Made fresh each time it opens, from the character being edited or blank. */}
        {props.open && <BuilderBody key={props.editing?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function BuilderBody({ onOpenChange, editing, mature, onSaved }: BuilderProps) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() =>
    editing ? { name: editing.name, tagline: editing.tagline, persona: editing.persona, scenario: editing.scenario, greeting: editing.greeting, mature: editing.mature, accent: editing.accent, portrait: editing.portrait } : EMPTY,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const add = async (f: File | undefined) => {
    if (!f) return;
    setPreview(URL.createObjectURL(f));
    setUploading(true);
    try {
      const a = await uploadFile(f);
      setD((x) => ({ ...x, portrait: a.url }));
    } catch (e) {
      setPreview(null);
      toastError(e, "That picture couldn't be added.");
    } finally {
      setUploading(false);
    }
  };

  const ready = d.name.trim().length > 0 && d.persona.trim().length >= 10 && !uploading;

  const save = async (start: boolean) => {
    setBusy(start ? "start" : "save");
    try {
      const c = editing
        ? await chatSend<CharacterCard>(`/api/chat/characters/${editing.id}`, "PATCH", d)
        : await chatSend<CharacterCard>("/api/chat/characters", "POST", d);
      void qc.invalidateQueries({ queryKey: ["chat", "characters"] });
      onOpenChange(false);
      onSaved?.(c, start);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy("delete");
    try {
      await chatSend(`/api/chat/characters/${editing.id}`, "DELETE");
      void qc.invalidateQueries({ queryKey: ["chat", "characters"] });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const field = "text-[13px] font-medium";
  return (
    <>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "New character"}</DialogTitle>
          <DialogDescription>Characters stay in role, remember the story and move it forward. Every character is a fictional adult.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void add(e.target.files?.[0])} />
            <button type="button" onClick={() => file.current?.click()} className="group relative block w-full" aria-label="Add a portrait">
              <CharacterFace name={d.name || "?"} accent={d.accent} portrait={preview ?? d.portrait} rounded="card" className="aspect-[3/4] w-full" />
              <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5 rounded-full bg-black/55 py-1.5 text-[12px] font-medium text-white opacity-90 backdrop-blur-sm group-hover:opacity-100">
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                {d.portrait ? "Change portrait" : "Add a portrait"}
              </span>
            </button>
            {d.portrait && (
              <button
                type="button"
                onClick={() => {
                  setD({ ...d, portrait: null });
                  setPreview(null);
                }}
                className="flex w-full items-center justify-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" /> Remove portrait
              </button>
            )}
            <Link
              href={`/image?prompt=${encodeURIComponent(portraitPrompt(d))}&format=3:4`}
              target="_blank"
              className="flex items-center justify-center gap-1.5 rounded-full border py-1.5 text-[12.5px] hover:bg-accent"
            >
              <Sparkles className="size-3.5" />
              Make one in Image
            </Link>
            <div className="flex flex-wrap justify-center gap-1.5 pt-1" role="radiogroup" aria-label="Colours">
              {PALETTES.map((p) => {
                const on = p[0] === d.accent[0] && p[1] === d.accent[1];
                return (
                  <button
                    key={p.join()}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Colours ${p.join(" and ")}`}
                    onClick={() => setD({ ...d, accent: p })}
                    className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", on && "ring-2 ring-foreground")}
                    style={{ background: `linear-gradient(145deg, ${p[0]}, ${p[1]})` }}
                  />
                );
              })}
            </div>
          </div>
          <div className="min-w-0 space-y-3.5">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={field}>Name</span>
                <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Aurelie Blanc" maxLength={CHAT_LIMITS.nameChars} autoFocus />
              </label>
              <label className="block space-y-1.5">
                <span className={field}>One line about them</span>
                <Input value={d.tagline} onChange={(e) => setD({ ...d, tagline: e.target.value })} placeholder="Perfumer with a secret" maxLength={CHAT_LIMITS.taglineChars} />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className={field}>Who they are and how they talk</span>
              <Textarea
                value={d.persona}
                onChange={(e) => setD({ ...d, persona: e.target.value })}
                placeholder="34, runs a tiny perfume house in Grasse. Precise, warm, a little mischievous. Describes everything by its scent."
                rows={3}
                maxLength={CHAT_LIMITS.personaChars}
              />
            </label>
            <label className="block space-y-1.5">
              <span className={field}>
                Where the story starts <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Textarea
                value={d.scenario}
                onChange={(e) => setD({ ...d, scenario: e.target.value })}
                placeholder="You walk into her shop just before closing, looking for a gift."
                rows={2}
                maxLength={CHAT_LIMITS.scenarioChars}
              />
            </label>
            <label className="block space-y-1.5">
              <span className={field}>
                Their first line <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Textarea
                value={d.greeting}
                onChange={(e) => setD({ ...d, greeting: e.target.value })}
                placeholder="*looks up from a row of tiny bottles* We're closing, but… you have the face of someone looking for something rare."
                rows={2}
                maxLength={CHAT_LIMITS.greetingChars}
              />
            </label>
            {mature && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-[13.5px]">
                <input type="checkbox" checked={d.mature} onChange={(e) => setD({ ...d, mature: e.target.checked })} className="size-4 accent-[#ff6a2b]" />
                <ChilliDot />
                <span>{MANGO_CHILLI.short} character (only shows while the mode is on)</span>
              </label>
            )}
          </div>
        </div>
        <DialogFooter className="items-center gap-2">
          {editing && (
            <Button variant="ghost" onClick={() => void remove()} disabled={!!busy} className="mr-auto text-muted-foreground">
              {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={() => void save(false)} disabled={!ready || !!busy}>
            {busy === "save" && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button onClick={() => void save(true)} disabled={!ready || !!busy}>
            {busy === "start" && <Loader2 className="animate-spin" />}
            Save and chat
          </Button>
        </DialogFooter>
    </>
  );
}
