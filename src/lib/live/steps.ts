/**
 * Live edit's kept steps (pure). A step is one change the person chose to keep, with its own lossless master. The
 * stack is a tree: Undo moves to the parent, Redo to the newest child, and a Keep after an Undo starts a new branch
 * (the old one stays). Every render's base is a master or the original, never a live frame:
 *
 * 1. the base of a render is the head's master (hybrid, chain) or the original (compose);
 * 2. every kept master is a PNG at least as large as its base (for text to image, 1024 or more on the long side);
 * 3. no name used as a base was ever a live frame's bytes;
 * 4. a kept master is the settled picture that was on screen, byte for byte, when Keep came after the settle.
 */

export type Method = "hybrid" | "chain" | "compose";
export const METHODS: readonly Method[] = ["hybrid", "chain", "compose"];

export interface Master {
  /** A Fuobe file URL (/api/files/…), when the server keeps it. */
  url?: string;
  /** This browser's copy (IndexedDB key), when the server couldn't keep it. */
  idb?: string;
  /** Its name in ComfyUI's input folder (inputName). */
  name: string;
  w: number;
  h: number;
  sha256: string;
  format: "png" | "jpg" | "webp";
}

export interface Step {
  id: string;
  parent: string | null;
  /** What the person typed, and as the model read it. */
  text: string;
  norm: string;
  seed: number;
  method: Method;
  keepRes: number;
  mask?: { name: string; url?: string };
  master: Master;
  /** The render's time. */
  ms: number;
  at: number;
  /** Kept only in this browser (the account's space was full). */
  local?: boolean;
}

export interface StackState {
  steps: Step[];
  head: string | null;
}

export class StepError extends Error {}

export class StepStack {
  private steps: Step[];
  private headId: string | null;
  /** sha256 of every live frame shown in this session: none may become a base. */
  private readonly liveShas = new Set<string>();
  private n: number;

  constructor(state: StackState = { steps: [], head: null }) {
    this.steps = state.steps.map((s) => ({ ...s, master: { ...s.master } }));
    this.headId = state.head && this.steps.some((s) => s.id === state.head) ? state.head : (this.steps.at(-1)?.id ?? null);
    this.n = this.steps.reduce((m, s) => Math.max(m, Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  }

  /** Start from a picture (step 0, the original: its bytes as they came, JPEG allowed). */
  static from(original: Master, at = Date.now()): StepStack {
    return new StepStack({ steps: [{ id: "s0", parent: null, text: "", norm: "", seed: 0, method: "hybrid", keepRes: 0, master: original, ms: 0, at }], head: "s0" });
  }

  get empty(): boolean {
    return this.steps.length === 0;
  }

  get head(): Step | null {
    return this.steps.find((s) => s.id === this.headId) ?? null;
  }

  get original(): Step | null {
    return this.steps.find((s) => s.parent === null) ?? null;
  }

  get all(): readonly Step[] {
    return this.steps;
  }

  byId(id: string): Step | undefined {
    return this.steps.find((s) => s.id === id);
  }

  /** The steps from the original to the head. */
  path(): Step[] {
    const out: Step[] = [];
    for (let s = this.head; s; s = s.parent ? (this.byId(s.parent) ?? null) : null) out.unshift(s);
    return out;
  }

  /** The step before the head, if any. */
  previous(): Step | null {
    const h = this.head;
    return h?.parent ? (this.byId(h.parent) ?? null) : null;
  }

  /** What the next render edits (invariant 1): null for text to image. */
  base(method: Method): Master | null {
    const m = method === "compose" ? this.original?.master : this.head?.master;
    if (m && this.liveShas.has(m.sha256)) throw new StepError("A live frame can't be a base");
    return m ?? null;
  }

  /** compose: the kept texts on the path, then the live text, as one instruction. */
  composePrompt(live: string): string {
    return [...this.path().map((s) => s.norm).filter(Boolean), live].filter(Boolean).join(". ");
  }

  /** A live frame was shown: its bytes may never become a base (invariant 3). */
  sawLive(sha256: string): void {
    this.liveShas.add(sha256);
  }

  isLive(sha256: string): boolean {
    return this.liveShas.has(sha256);
  }

  /** Keep a step on top of the head (or as the first picture, for text to image). */
  keep(s: Omit<Step, "id" | "parent" | "at"> & { at?: number }): Step {
    const base = this.head;
    if (base && s.master.format !== "png") throw new StepError("A kept master must be a PNG");
    if (this.liveShas.has(s.master.sha256)) throw new StepError("A live frame can't be kept as a master");
    if (base && s.method !== "compose" && s.master.w * s.master.h < base.master.w * base.master.h) throw new StepError("A kept master can't be smaller than its base");
    if (!base && Math.max(s.master.w, s.master.h) < 1024) throw new StepError("A first picture is kept at 1024 or more");
    const step: Step = { ...s, id: `s${++this.n}`, parent: base?.id ?? null, at: s.at ?? Date.now(), master: { ...s.master } };
    this.steps.push(step);
    this.headId = step.id;
    return step;
  }

  canUndo(): boolean {
    return !!this.head?.parent;
  }

  canRedo(): boolean {
    return this.children(this.headId).length > 0;
  }

  undo(): Step | null {
    const p = this.previous();
    if (!p) return null;
    this.headId = p.id;
    return p;
  }

  redo(): Step | null {
    const kids = this.children(this.headId);
    const next = kids.sort((a, b) => b.at - a.at || Number(b.id.slice(1)) - Number(a.id.slice(1)))[0];
    if (!next) return null;
    this.headId = next.id;
    return next;
  }

  jump(id: string): Step | null {
    const s = this.byId(id);
    if (s) this.headId = s.id;
    return s ?? null;
  }

  /** Update a step's master where it lives (the server saved it, or only this browser has it). */
  place(id: string, where: Partial<Pick<Master, "url" | "idb">> & { local?: boolean }): void {
    const s = this.byId(id);
    if (!s) return;
    if (where.url) s.master.url = where.url;
    if (where.idb) s.master.idb = where.idb;
    if (where.local !== undefined) s.local = where.local;
  }

  private children(id: string | null): Step[] {
    return id ? this.steps.filter((s) => s.parent === id) : [];
  }

  toJSON(): StackState {
    return { steps: this.steps.map((s) => ({ ...s, master: { ...s.master } })), head: this.headId };
  }
}

/** A stored stack, checked: anything malformed gives an empty stack. */
export function restoreStack(raw: unknown): StepStack {
  const st = raw as StackState;
  if (!st || !Array.isArray(st.steps)) return new StepStack();
  const ok = st.steps.every(
    (s) =>
      s &&
      typeof s.id === "string" &&
      (s.parent === null || typeof s.parent === "string") &&
      typeof s.text === "string" &&
      typeof s.seed === "number" &&
      s.master &&
      typeof s.master.name === "string" &&
      typeof s.master.sha256 === "string" &&
      typeof s.master.w === "number" &&
      typeof s.master.h === "number",
  );
  return ok ? new StepStack({ steps: st.steps, head: typeof st.head === "string" ? st.head : null }) : new StepStack();
}
