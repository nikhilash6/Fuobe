import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Settings → Workers, the lanes a worker may run: a lane it can run every workflow of shows plainly, one it can run some
 * workflows of says how many ("24 of 26 workflows") and is offered like the others, and only a lane it can run none of
 * says its files are missing. Allow all it can run takes every lane it can run any workflow of.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/settings/workers",
  useSearchParams: () => new URLSearchParams(),
}));

const { LanesEditor, allowAllItCanRun, laneFit, laneNote } = await import("@/components/workers-admin");

const FULL = "aaaaaaaaaaaa";
const PART = "bbbbbbbbbbbb";
const NONE = "cccccccccccc";
const worker = { lanes: [FULL], partLanes: { [PART]: { runnable: 24, of: 26 } } };

describe("a worker's lanes in Settings", () => {
  it("every workflow: no note; some: how many of how many; none: files missing", () => {
    expect(laneFit(worker, FULL)).toEqual({ kind: "all" });
    expect(laneFit(worker, PART)).toEqual({ kind: "some", runnable: 24, of: 26 });
    expect(laneFit(worker, NONE)).toEqual({ kind: "none" });
    expect(laneNote(laneFit(worker, FULL))).toBeNull();
    expect(laneNote(laneFit(worker, PART))).toBe("(24 of 26 workflows)");
    expect(laneNote(laneFit(worker, NONE))).toBe("(files missing)");
    // A server from before sends no part lanes: only full lanes, as before.
    expect(laneFit({ lanes: [FULL] }, PART)).toEqual({ kind: "none" });
  });

  it("Allow all it can run takes the part lanes too, each keeping a wait it had, and leaves out lanes it can't run", () => {
    const next = allowAllItCanRun(worker, { [PART]: { delayMs: 5000 }, [NONE]: { delayMs: 0 } });
    expect(next).toEqual({ [FULL]: { delayMs: 0 }, [PART]: { delayMs: 5000 } });
  });

  it("the list shows the count on a part lane, files missing only where none runs, and the button counts the part lanes", () => {
    const w = {
      id: "w1",
      name: "Owner PC",
      pool: "pool",
      state: "ready",
      words: "Ready",
      pausedServer: false,
      pausedLocal: false,
      drain: false,
      autoResume: null,
      hours: null,
      allow: {},
      warmLane: null,
      facts: {},
      seenAt: null,
      version: null,
      current: null,
      ...worker,
    };
    const lanes = [
      { lane: FULL, label: "Full lane", workflows: 3 },
      { lane: PART, label: "Qwen Image 2.1", workflows: 26 },
      { lane: NONE, label: "Missing lane", workflows: 2 },
    ];
    const html = renderToStaticMarkup(createElement(LanesEditor, { w, lanes, onSave: () => {} }));
    expect(html).toContain("(24 of 26 workflows)");
    expect(html.match(/\(files missing\)/g)).toHaveLength(1);
    expect(html.indexOf("Missing lane")).toBeGreaterThan(html.indexOf("Qwen Image 2.1"));
    expect(html.indexOf("(files missing)")).toBeGreaterThan(html.indexOf("Missing lane"));
    expect(html).toContain("Allow all it can run (2)");
    expect(html).toContain("(2 it can run)");
  });
});
