import { describe, expect, it } from "vitest";
import { EXPLORE_KEY, EXPLORE_MAX, explorable, exploreProgress, nextToTry, parseExplored, withExplored } from "@/lib/nav-explore";
import { entry, studioCount } from "@/lib/nav-model";

describe("explored list in storage", () => {
  it("is kept under one key", () => {
    expect(EXPLORE_KEY).toBe("fuobe:explored");
  });

  it("reads anything unexpected as nothing tried", () => {
    expect(parseExplored(null)).toEqual([]);
    expect(parseExplored(undefined)).toEqual([]);
    expect(parseExplored("")).toEqual([]);
    expect(parseExplored("{not json")).toEqual([]);
    expect(parseExplored('{"a":1}')).toEqual([]);
    expect(parseExplored("[1,2,3]")).toEqual([]);
    expect(parseExplored('["cinema", 3, null, "shorts", "cinema", ""]')).toEqual(["cinema", "shorts"]);
  });

  it("adds an id once, at the end, and keeps the newest", () => {
    const one = withExplored([], "cinema");
    expect(one).toEqual(["cinema"]);
    expect(withExplored(one, "cinema")).toBe(one);
    expect(withExplored(one, "shorts")).toEqual(["cinema", "shorts"]);
    expect(withExplored(one, "")).toBe(one);
    const full = Array.from({ length: EXPLORE_MAX }, (_, i) => `x${i}`);
    const more = withExplored(full, "cinema");
    expect(more).toHaveLength(EXPLORE_MAX);
    expect(more[0]).toBe("x1");
    expect(more.at(-1)).toBe("cinema");
    expect(parseExplored(JSON.stringify([...full, "a", "b"]))).toHaveLength(EXPLORE_MAX);
  });
});

describe("explore progress", () => {
  it("counts the studios a viewer sees, in the units shown everywhere else (28 studios)", () => {
    expect(exploreProgress("guest", []).total).toBe(studioCount());
    expect(exploreProgress("owner", []).total).toBe(studioCount());
    for (const e of explorable("guest")) expect(e.kind).toBe("studio");
    expect(explorable("guest").map((e) => e.id)).not.toContain("settings");
  });

  it("counts only what is explorable and visible", () => {
    expect(exploreProgress("guest", ["cinema", "shorts", "marketing"]).done).toBe(3);
    // Settings, tools and ids that don't exist don't count.
    expect(exploreProgress("guest", ["cinema", "settings", "audio-clean", "image", "nope"]).done).toBe(1);
  });
});

describe("next to try", () => {
  it("prefers what shares the most goals with the last one tried", () => {
    const next = nextToTry("guest", ["cinema"], "cinema")!;
    expect(next.goals).toContain("film");
    expect(next.id).not.toBe("cinema");
    const afterSell = nextToTry("guest", ["marketing"], "marketing")!;
    expect(afterSell.goals).toContain("sell");
  });

  it("skips what was tried, and starts with a group's lead (a premium studio)", () => {
    const first = nextToTry("guest", []);
    expect(first?.id).toBe("cinema");
    expect(first?.lead).toBe(true);
    const tried = ["image", "video"];
    const next = nextToTry("guest", tried);
    expect(tried).not.toContain(next?.id);
    expect(next?.popular).toBe(true);
  });

  it("never suggests settings or tools, and nothing once everything is tried", () => {
    const all = explorable("owner").map((e) => e.id);
    expect(nextToTry("owner", all)).toBeUndefined();
    let list: string[] = [];
    for (let i = 0; i < 45; i++) {
      const n = nextToTry("account", list, list.at(-1));
      if (!n) break;
      expect(n.kind).toBe("studio");
      expect(entry(n.id)?.visibility ?? ["account"]).toContain("account");
      list = withExplored(list, n.id);
    }
    expect(exploreProgress("account", list)).toEqual({ done: studioCount(), total: studioCount() });
  });
});
