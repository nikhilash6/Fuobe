"use client";

import { ArrowRight, Loader2, Network, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IntentLink } from "@/components/intent-link";
import { useCanvasActions, useCanvases } from "@/components/canvas/use-canvas";
import { timeAgo } from "@/lib/format";
import { toastError } from "@/lib/refusals";

/** How many of the owner's boards the Canvas menu lists, the newest edited first. */
export const RECENT_BOARDS = 4;

/** Makes an empty board and opens it; `busy` while it is being made. */
function useNewBoard() {
  const router = useRouter();
  const { create } = useCanvasActions();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const c = await create({});
      router.push(`/canvas/${c.id}`);
    } catch (e) {
      toastError(e, "Couldn't make a new board. Please try again.");
      setBusy(false);
    }
  };
  return { busy, start };
}

/** The phone sheet's New board button (the Canvas family, the owner's). */
export function NewBoardButton() {
  const { busy, start } = useNewBoard();
  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy}
      className="nav-focus mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:bg-primary/85"
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
      New board
    </button>
  );
}

/**
 * The Canvas menu's first column for the owner (loaded only when the owner opens that menu): a New board button, then
 * their most recent boards, or, with none yet, `fallback` (the visitor's lead card: a finished board's scene). Board
 * previews are full-size files, so the rows show an icon, not a picture. `labelledBy`: the column's label.
 */
export default function CanvasOwnerStart({ col, labelledBy, fallback }: { col: number; labelledBy: string; fallback?: ReactNode }) {
  const boards = useCanvases();
  const { busy, start } = useNewBoard();
  const recent = [...(boards.data ?? [])].sort((a, b) => (b.editedAt ?? b.updatedAt) - (a.editedAt ?? a.updatedAt)).slice(0, RECENT_BOARDS);
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col gap-2">
      <li>
        <button
          type="button"
          data-col={col}
          data-row={0}
          onClick={() => void start()}
          disabled={busy}
          className="nav-focus flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[14px] font-semibold text-primary-foreground hover:bg-primary/90 active:bg-primary/85 motion-safe:transition-colors"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          New board
        </button>
      </li>
      {boards.isPending ? (
        // Their boards are on the way: a lead card's place, so nothing moves when they come.
        <li aria-hidden className="flex flex-col">
          <span className="aspect-[4/3] max-h-[max(64px,calc(100dvh-640px))] w-full rounded-t-[14px] bg-muted" />
          <span className="h-[59px] rounded-b-[14px] bg-muted/60" />
        </li>
      ) : recent.length > 0 ? (
        <li className="flex flex-col gap-0.5">
          <p className="pt-1 pb-1 text-[12px] leading-4 font-medium text-muted-foreground">Your recent boards</p>
          {recent.map((b, i) => (
            <IntentLink
              key={b.id}
              href={`/canvas/${b.id}`}
              data-col={col}
              data-row={i + 1}
              title={b.name}
              className="nav-row nav-mark-start -mx-2 flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5"
            >
              <span aria-hidden className="grid h-[27px] w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
                <Network className="size-4 text-muted-foreground" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] leading-[18px] font-medium">{b.name}</span>
                <span className="truncate text-[12px] leading-4 text-muted-foreground">{b.editedAt ? `Edited ${timeAgo(b.editedAt)}` : "Never edited"}</span>
              </span>
            </IntentLink>
          ))}
          <IntentLink
            href="/canvas"
            data-col={col}
            data-row={recent.length + 1}
            className="nav-row group/all -mx-2 inline-flex h-10 items-center gap-1 self-start rounded-[10px] px-2 text-[13px] font-medium text-brand-text"
          >
            All your boards
            <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
          </IntentLink>
        </li>
      ) : (
        fallback && <li>{fallback}</li>
      )}
    </ul>
  );
}
