import { describe, expect, it } from "vitest";
import { againWhere } from "@/lib/demo-mode";
import { draftRenderPaid } from "@/lib/output-actions";

describe("a one-tap Run again says what it spends", () => {
  const off = { placeholders: false };
  const on = { placeholders: true };

  it("on your GPU, on the studio's GPUs, paid in the cloud", () => {
    expect(againWhere({ engine: "open" }, off)).toBe(" on your GPU");
    expect(againWhere({ engine: "open", place: "pool" }, off)).toBe(" on the studio's GPUs");
    expect(againWhere({ engine: "cloud" }, off)).toBe(" · paid");
  });

  it("follows the placeholder switch as it is now, not the old result", () => {
    // An old placeholder result, placeholders now off: the rerun is real and says so.
    expect(againWhere({ engine: "cloud", provider: "mock" } as { engine: string }, off)).toBe(" · paid");
    // An old real result, placeholders now on: the rerun is a free stand-in, so nothing is added.
    expect(againWhere({ engine: "cloud", provider: "fal" } as { engine: string }, on)).toBe("");
    expect(againWhere({ engine: "open" }, on)).toBe("");
  });

  it("adds nothing before the run is known", () => {
    expect(againWhere(undefined, off)).toBe("");
    expect(againWhere(null, off)).toBe("");
  });

  it("marks a draft's 1080p render as paid unless placeholders are on", () => {
    expect(draftRenderPaid(false)).toBe(" · paid");
    expect(draftRenderPaid(undefined)).toBe(" · paid");
    expect(draftRenderPaid(true)).toBe("");
  });
});
