/**
 * "Pick another model" from a card (an item that runs on one's own GPU or key): the page's model picker opens. The studio
 * composer's picker answers it (the last one shown, when a page has more); a page with none doesn't offer the button.
 */

const openers: (() => void)[] = [];

/** A picker answers "Pick another model" while it is shown: returns what stops it. */
export function answerPickModel(open: () => void): () => void {
  openers.push(open);
  return () => {
    const i = openers.lastIndexOf(open);
    if (i >= 0) openers.splice(i, 1);
  };
}

/** Is there a picker on this page to open? */
export const canPickModel = (): boolean => openers.length > 0;

/** Open the page's model picker. False when there is none. */
export function pickAnotherModel(): boolean {
  const open = openers[openers.length - 1];
  open?.();
  return !!open;
}
