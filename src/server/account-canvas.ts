import "server-only";
import { nanoid } from "nanoid";
import { outline, type CanvasSummary } from "@/lib/catalog/canvas";
import { FIRST_PAGE_ID, pageName, readPages, type CanvasPage } from "@/lib/catalog/canvas-board";
import { db } from "./db";

/**
 * An account's own canvases (public sign-up): boards it builds and keeps, in a table of their own, never in the owner's
 * `canvases`. Every read and change names the account, so one account never reaches another's board, and the owner's
 * boards are never in reach. A board here holds only its pages: running a canvas stays the owner's (an account's Run
 * says so), so there are no runs to keep.
 */

export const ACCOUNT_CANVAS_LIMITS = {
  /** Boards an account keeps. */
  boards: 50,
  /** A board's pages as JSON (characters). */
  bytes: 1_000_000,
  /** Saves a minute (the editor's autosave is debounced, so this is far above what editing sends). */
  savesPerMinute: 120,
} as const;

// The table is made in db.ts (ACCOUNT_CANVAS_TABLES).

interface Row {
  id: string;
  account_id: string;
  name: string;
  pages_json: string;
  template_id: string | null;
  created_at: number;
  updated_at: number;
}

/** An account's board as the editor opens it. */
export interface AccountCanvas {
  id: string;
  name: string;
  pages: CanvasPage[];
  templateId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Why a change was refused, with the status the route answers. */
export class AccountCanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const toCanvas = (r: Row): AccountCanvas => ({
  id: r.id,
  name: r.name,
  pages: readPages(JSON.parse(r.pages_json)),
  templateId: r.template_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const cleanName = (name: string | undefined, fallback: string) => (name?.trim() || fallback).slice(0, 80);

function pagesJson(pages: CanvasPage[]): string {
  const json = JSON.stringify({ pages });
  if (json.length > ACCOUNT_CANVAS_LIMITS.bytes) throw new AccountCanvasError("This board is too big to save. Remove a few nodes or pages, then try again.", 413);
  return json;
}

export function listAccountCanvases(accountId: string): CanvasSummary[] {
  const rows = db().prepare("SELECT * FROM account_canvases WHERE account_id = ? ORDER BY updated_at DESC LIMIT ?").all(accountId, ACCOUNT_CANVAS_LIMITS.boards) as Row[];
  return rows.map((r) => {
    const c = toCanvas(r);
    return {
      id: c.id,
      name: c.name,
      nodeCount: c.pages.reduce((n, p) => n + p.graph.nodes.length, 0),
      pageCount: c.pages.length,
      templateId: c.templateId,
      preview: null,
      outline: outline(c.pages[0].graph),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      editedAt: c.updatedAt,
    };
  });
}

/** One of the account's boards, or null (another account's board, or none, reads the same). */
export function getAccountCanvas(accountId: string, id: string): AccountCanvas | null {
  const r = db().prepare("SELECT * FROM account_canvases WHERE id = ? AND account_id = ?").get(id, accountId) as Row | undefined;
  return r ? toCanvas(r) : null;
}

export function createAccountCanvas(accountId: string, input: { name?: string; pages?: CanvasPage[]; templateId?: string | null }): AccountCanvas {
  const count = (db().prepare("SELECT COUNT(*) AS n FROM account_canvases WHERE account_id = ?").get(accountId) as { n: number }).n;
  if (count >= ACCOUNT_CANVAS_LIMITS.boards) throw new AccountCanvasError(`You can keep up to ${ACCOUNT_CANVAS_LIMITS.boards} canvases. Delete one to save another.`, 409);
  const pages = input.pages?.length ? input.pages : [{ id: FIRST_PAGE_ID, name: pageName(0), graph: { nodes: [], edges: [] } }];
  const now = Date.now();
  const row: Row = {
    id: nanoid(12),
    account_id: accountId,
    name: cleanName(input.name, "Untitled canvas"),
    pages_json: pagesJson(pages),
    template_id: input.templateId?.slice(0, 60) ?? null,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO account_canvases (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toCanvas(row);
}

/** A new name and/or pages for one of the account's boards; null when it has no such board. */
export function updateAccountCanvas(accountId: string, id: string, patch: { name?: string; pages?: CanvasPage[] }): AccountCanvas | null {
  const current = getAccountCanvas(accountId, id);
  if (!current) return null;
  const name = cleanName(patch.name, current.name);
  const json = patch.pages?.length ? pagesJson(patch.pages) : JSON.stringify({ pages: current.pages });
  db().prepare("UPDATE account_canvases SET name = ?, pages_json = ?, updated_at = ? WHERE id = ? AND account_id = ?").run(name, json, Date.now(), id, accountId);
  return getAccountCanvas(accountId, id);
}

export function deleteAccountCanvas(accountId: string, id: string): boolean {
  return db().prepare("DELETE FROM account_canvases WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0;
}

/** Every board of an account, when the account is deleted. */
export function deleteAccountCanvases(accountId: string): number {
  return db().prepare("DELETE FROM account_canvases WHERE account_id = ?").run(accountId).changes;
}
