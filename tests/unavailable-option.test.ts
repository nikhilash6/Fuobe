import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "@/components/shorts/ui";
import { UnavailableNote } from "@/components/ui/unavailable";
import { getMaker, makersFor, MOTION_H3, ORIGINALS, resolutionChoices } from "@/lib/catalog/genjutsu";
import { listWords, pressOption, runFix, unavailableOf, UNAVAILABLE_FALLBACK } from "@/lib/unavailable";

/*
 * One rule for every choice the current model or mode can't do (src/lib/unavailable.ts, src/components/ui/unavailable.tsx):
 * it stays in view, looks unavailable, is never drawn as picked, and pressing it says why with the way to get it.
 */

describe("unavailable choices", () => {
  it("reads a plain disabled option the same way, with its title as the reason", () => {
    expect(unavailableOf({ disabled: true, title: "Above the clip's own frame rate" })).toEqual({ why: "Above the clip's own frame rate" });
    expect(unavailableOf({ disabled: true })).toEqual({ why: UNAVAILABLE_FALLBACK });
    expect(unavailableOf({ title: "x" })).toBeUndefined();
    expect(unavailableOf({ unavailable: false })).toBeUndefined();
  });

  it("picks an available option and only explains an unavailable one", () => {
    const pick = vi.fn();
    const say = vi.fn();
    pressOption({ value: "480p" }, pick, say);
    expect(pick).toHaveBeenCalledWith("480p");
    pressOption({ value: "1080p", unavailable: { why: "1080p needs MiniMax H3" } }, pick, say);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("1080p", { why: "1080p needs MiniMax H3" });
  });

  it("runs the note's Switch, then closes the note", () => {
    const order: string[] = [];
    runFix({ why: "720p needs High quality", fix: { label: "Switch", run: () => order.push("switch") } }, () => order.push("close"));
    expect(order).toEqual(["switch", "close"]);
  });

  it("says lists in plain words", () => {
    expect(listWords(["720p"])).toBe("720p");
    expect(listWords(["720p", "1080p"])).toBe("720p and 1080p");
    expect(listWords(["720p", "1080p", "2K"])).toBe("720p, 1080p and 2K");
  });
});

describe("Segmented with a choice the model can't do", () => {
  const html = renderToStaticMarkup(
    createElement(Segmented<string>, {
      label: "Resolution",
      // The remembered value is one the model can't render: it is not drawn as picked.
      value: "1080p",
      onChange: () => {},
      options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p", unavailable: { why: "720p needs High quality" } },
        { value: "1080p", label: "1080p", disabled: true, title: "No model here renders 1080p yet" },
      ],
    }),
  );
  const button = (label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];

  it("keeps every option in view, focusable and pressable (never the disabled attribute)", () => {
    for (const l of ["480p", "720p", "1080p"]) expect(button(l)).not.toMatch(/\sdisabled=""/);
  });

  it("marks unavailable options aria-disabled, muted, not-allowed, with no hover light", () => {
    for (const l of ["720p", "1080p"]) {
      const b = button(l);
      expect(b).toContain('aria-disabled="true"');
      expect(b).toContain("cursor-not-allowed");
      expect(b).toContain("opacity-45");
      expect(b).not.toContain("hover:text-foreground");
      expect(b).not.toContain("bg-background text-foreground");
    }
    expect(button("720p")).toContain('title="720p needs High quality"');
    expect(button("480p")).not.toContain("aria-disabled");
  });

  it("never draws an unavailable value as the picked one, and keeps a Tab stop on one that can be picked", () => {
    expect(button("1080p")).toContain('aria-checked="false"');
    expect(button("480p")).toContain('tabindex="0"');
    expect(html).not.toContain('aria-checked="true"');
  });

  it("shows no note until one is pressed, and the note carries the Switch", () => {
    expect(html).not.toContain('role="status"');
    const note = renderToStaticMarkup(createElement(UnavailableNote, { reason: { why: "720p and 1080p need MiniMax H3", fix: { label: "Switch", run: () => {} } }, onClose: () => {} }));
    expect(note).toContain('role="status"');
    expect(note).toContain("720p and 1080p need MiniMax H3");
    expect(note).toMatch(/<button[^>]*>Switch<\/button>/);
  });
});

describe("Genjutsu resolutions for the picked model", () => {
  const options = makersFor("open", "motion");
  const lite = getMaker(ORIGINALS.motionLite, "open")!;
  const full = getMaker(ORIGINALS.motion, "open")!;
  const h3 = getMaker(MOTION_H3, "open")!;

  it("Motion transfer on Genjutsu Standard: 480p open, 720p one tap away on High, 1080p names the sharpest", () => {
    const [p480, p720, p1080] = resolutionChoices(lite, options, "standard");
    expect(p480).toEqual({ quality: "480p", ok: true });
    expect(p720).toMatchObject({ ok: false, why: "720p needs High quality", route: { pick: undefined, tier: "high", quality: "720p" } });
    expect(p1080).toMatchObject({ ok: false, why: "No model here renders 1080p yet · the sharpest is 720p, with High quality", route: { tier: "high", quality: "720p" } });
  });

  it("goes to another model when the other tier is switched off", () => {
    const on = (id: string) => id !== full.id;
    const [, p720] = resolutionChoices(lite, options, "standard", on);
    expect(p720).toMatchObject({ ok: false, why: "720p needs MiniMax H3", route: { pick: h3.id, quality: "720p" } });
    expect(p720.route?.tier).toBeUndefined();
  });

  it("offers no Switch when the picked model already is the sharpest", () => {
    const [p480, p720, p1080] = resolutionChoices(h3, options, "standard");
    expect([p480.ok, p720.ok]).toEqual([true, true]);
    expect(p1080).toEqual({ quality: "1080p", ok: false, why: "No model here renders 1080p yet · 720p is the sharpest", route: undefined });
  });

  it("the Switch keeps the rest of the setup: it only names the model, the tier and the resolution", () => {
    const calls: unknown[] = [];
    const [, p720] = resolutionChoices(lite, options, "standard");
    const route = p720.route!;
    runFix(
      {
        why: p720.why!,
        fix: {
          label: "Switch",
          run: () => {
            if (route.pick) calls.push(["pick", route.pick]);
            if (route.tier) calls.push(["tier", route.tier]);
            calls.push(["quality", route.quality]);
          },
        },
      },
      () => calls.push("close"),
    );
    expect(calls).toEqual([["tier", "high"], ["quality", "720p"], "close"]);
  });
});
