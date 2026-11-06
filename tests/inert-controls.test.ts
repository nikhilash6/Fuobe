import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardStateWords, stacksOffReason } from "@/lib/library";

/**
 * Controls that look like they act must act, or say why they can't: a Library card with nothing to open, a view setting
 * a tab doesn't use, a Refresh that failed, a key cap no key is bound to.
 */
const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("Library cards and view settings", () => {
  it("names the state of a card that has nothing to open", () => {
    expect(cardStateWords("queued")).toBe("queued");
    expect(cardStateWords("running")).toBe("still generating");
    expect(cardStateWords("failed")).toBe("failed");
    expect(cardStateWords("canceled")).toBe("stopped");
  });

  it("gives no pointer or hover to a card that can't open, select or expand", () => {
    const card = src("src/components/library/asset-card.tsx");
    expect(card).toContain("const acts = selecting || !!stack || done;");
    expect(card).toContain('acts && "cursor-pointer hover:bg-accent"');
    expect(card).not.toMatch(/"group\/card relative flex min-h-16 cursor-pointer/);
  });

  it("says why Stack batches doesn't apply in Trash and Uploads", () => {
    expect(stacksOffReason("trash")).toMatch(/Trash/);
    expect(stacksOffReason("uploads")).toMatch(/Uploads/);
    expect(stacksOffReason("all")).toBeUndefined();
    expect(src("src/components/library-view.tsx")).toContain("noStacks={stacksOffReason(tab.id)}");
  });
});

describe("buttons that answer every press", () => {
  it("a failed balance Refresh says so", () => {
    expect(src("src/components/keys/use-key-info.ts")).toMatch(/catch \{[^}]*toast\.error\("Couldn't refresh the balance/);
  });

  it("New creation shows no Enter key cap that nothing is bound to", () => {
    expect(src("src/components/nav/create-menu.tsx")).not.toContain("↵");
  });

  it("the Kinetic export buttons wait, with words, while the scene isn't ready", () => {
    const sheet = src("src/components/kinetic/export-sheet.tsx");
    expect(sheet).toContain("disabled={!!blocked || !!waiting ||");
    expect(src("src/components/kinetic/editor.tsx")).toContain('waiting={plan ? null : "Getting the scene ready…"}');
  });
});
