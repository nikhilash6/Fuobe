import "server-only";

/**
 * Work for accounts ("Your GPU") that the whole server shares a few slots for: the files an account's runs send to its
 * own ComfyUI (each held in memory a few times while it goes, and a slow tunnel can take minutes), and the 3D finish
 * of an account's model. One account holds one slot at a time, and a free slot goes to the next account in turn
 * (round-robin: an account that just had one goes to the back of the line), so one slow or busy account never holds
 * up the others.
 */

/** Files sent at once across the server. */
export const ACCOUNT_SENDS = 2;

interface Line {
  slots: number;
  /** Slots in use, by account. */
  busy: Map<string, number>;
  total: number;
  /** Who waits, by account, in turn order (a Map keeps the order its keys were set in). */
  waiting: Map<string, (() => void)[]>;
}

declare global {
  var __fuobeAccountLines: Map<string, Line> | undefined;
}

function line(name: string, slots: number): Line {
  const all = (globalThis.__fuobeAccountLines ??= new Map());
  let l = all.get(name);
  if (!l) all.set(name, (l = { slots, busy: new Map(), total: 0, waiting: new Map() }));
  return l;
}

function take(l: Line, account: string): void {
  l.total++;
  l.busy.set(account, (l.busy.get(account) ?? 0) + 1);
}

/** Hand free slots to the accounts waiting, in turn, skipping one that holds a slot already. */
function handOn(l: Line): void {
  while (l.total < l.slots) {
    let next: string | undefined;
    for (const account of l.waiting.keys()) {
      if (!l.busy.get(account)) {
        next = account;
        break;
      }
    }
    if (next === undefined) return;
    const list = l.waiting.get(next)!;
    const go = list.shift()!;
    // To the back of the line with what it still has waiting.
    l.waiting.delete(next);
    if (list.length) l.waiting.set(next, list);
    take(l, next);
    go();
  }
}

/** Run `fn` when the account's turn comes in the line `name` (`slots` at once across the server, one per account). */
export async function inTurn<T>(name: string, slots: number, account: string, fn: () => Promise<T>): Promise<T> {
  const l = line(name, slots);
  if (l.total < l.slots && !l.busy.get(account)) take(l, account);
  else
    await new Promise<void>((go) => {
      const list = l.waiting.get(account);
      if (list) list.push(go);
      else l.waiting.set(account, [go]);
    });
  try {
    return await fn();
  } finally {
    l.total--;
    const left = (l.busy.get(account) ?? 1) - 1;
    if (left > 0) l.busy.set(account, left);
    else l.busy.delete(account);
    // It just had its turn: the others go first.
    const own = l.waiting.get(account);
    if (own) {
      l.waiting.delete(account);
      l.waiting.set(account, own);
    }
    handOn(l);
  }
}

/** Run `fn` (read one file and send it to the account's ComfyUI) when the account may send. */
export const accountSend = <T,>(account: string, fn: () => Promise<T>): Promise<T> => inTurn("send", ACCOUNT_SENDS, account, fn);

/** Tests: how many run now in a line, for whom, and who waits (in turn order). */
export function lineState(name: string): { total: number; busy: Record<string, number>; waiting: string[] } {
  const l = globalThis.__fuobeAccountLines?.get(name);
  if (!l) return { total: 0, busy: {}, waiting: [] };
  return { total: l.total, busy: Object.fromEntries(l.busy), waiting: [...l.waiting].flatMap(([a, list]) => list.map(() => a)) };
}

/** Tests: the file sends. */
export const accountSends = () => lineState("send");
