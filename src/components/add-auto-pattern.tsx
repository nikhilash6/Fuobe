"use client";

import { useState } from "react";
import { toast } from "sonner";
import { autoPatternsProblems } from "@/lib/auto-image";
import { cn } from "@/lib/utils";

/**
 * Settings → Auto image model's list, one line added: the setting as saved, with `line` after it. Already there: null.
 * Throws the problem when the line can't be a pattern.
 */
export function withAutoPattern(saved: string, line: string): string | null {
  const add = line.trim();
  const problem = autoPatternsProblems(add)[0];
  if (!add || problem) throw new Error(problem?.replace(/^Line 1 /, "It ") ?? "Type a word or a pattern first");
  const lines = saved.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(add)) return null;
  return [...lines.filter((l, i) => l || i < lines.length - 1), add].join("\n");
}

/**
 * The owner's "Add a pattern" on a run Ideogram 4 declined: a word, phrase or pattern (the words selected on the page, to
 * start with) goes on Auto's list in Settings, so Auto sends such prompts to Krea 2 Realism next time. Owner only: the
 * settings it changes are the owner's (an account gets a 403).
 */
export function AddAutoPattern({ className }: { className?: string }) {
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (line === null) return;
    setBusy(true);
    try {
      const got = (await (await fetch("/api/settings")).json()) as { settings?: { name: string; value: string }[] };
      const saved = got.settings?.find((s) => s.name === "autoImagePatterns")?.value ?? "";
      const next = withAutoPattern(saved, line);
      if (next === null) {
        toast.message("That pattern is on the list already");
        setLine(null);
        return;
      }
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoImagePatterns: next }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "Couldn't save the pattern");
      toast.success("Added: Auto sends prompts like this to Krea 2 Realism");
      setLine(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (line === null) {
    return (
      <button
        type="button"
        data-add-auto-pattern
        className={cn("ml-1 underline underline-offset-2 hover:text-foreground", className)}
        onClick={() => {
          // The words selected on the page, when there are a few, start the pattern.
          const picked = typeof window !== "undefined" ? (window.getSelection()?.toString().trim() ?? "") : "";
          setLine(picked.length <= 80 ? picked : "");
        }}
      >
        Add a pattern
      </button>
    );
  }
  return (
    <span className={cn("mt-1 flex items-center gap-1.5", className)}>
      <input
        autoFocus
        aria-label="Pattern for Auto"
        value={line}
        placeholder="a word, phrase or pattern"
        maxLength={300}
        disabled={busy}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void add();
          if (e.key === "Escape") setLine(null);
        }}
        className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[12px] text-foreground"
      />
      <button type="button" disabled={busy || !line.trim()} onClick={() => void add()} className="rounded-md border px-2 py-0.5 text-[12px] font-medium text-foreground hover:bg-accent disabled:opacity-50">
        Add
      </button>
      <button type="button" disabled={busy} onClick={() => setLine(null)} className="px-1 text-[12px] hover:text-foreground">
        Cancel
      </button>
    </span>
  );
}
