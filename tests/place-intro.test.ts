import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The one-time note for an account whose runs moved to this studio's GPUs when hosted runs went on: it had a GPU or a
 * key of its own and ran there before it first ran here (the server's `ranOwn`), and has picked no place since. Both
 * buttons keep a pick on the server ("Keep my GPU as the default" its GPU; OK this studio's GPUs), so it shows once for
 * the account, on any device. `{Run}` is the page's own button.
 */

vi.mock("@/lib/api", async (load) => ({ ...(await load<typeof import("@/lib/api")>()), useHydrated: () => true }));

const { placeIntro } = await import("@/lib/place-intro");
const { PlaceIntro } = await import("@/components/studio/place-intro");

const gpu = { connected: true };
const none = { connected: false };
const base = { kind: "account" as const, hosted: true, ranOwn: true, placeName: "Studio North GPUs" };

describe("who gets the note", () => {
  it("an account with its GPU that ran there first, and no pick yet", () => {
    expect(placeIntro({ ...base, gpu }, "Generate")).toEqual({
      lead: "Runs now go to Studio North GPUs, free.",
      rest: "Your GPU is one tap away: Free ▾, next to Generate.",
      keep: { label: "Keep my GPU as the default", runOn: "gpu" },
    });
  });
  it("a key only: open models run here now, its key still runs the cloud ones", () => {
    expect(placeIntro({ ...base, gpu: none, keys: ["replicate"] }, "Render")).toEqual({
      lead: "Open models now run free on Studio North GPUs.",
      rest: "Your Replicate key still runs the cloud models: pick Cloud in the model list.",
      keep: { label: "Keep my key as the default", runOn: "key", key: "replicate" },
    });
  });
  it("no one else: a pick made, no run elsewhere first, nothing of its own, a guest, hosted runs off", () => {
    expect(placeIntro({ ...base, gpu, runOn: "site" }, "Run")).toBeNull();
    expect(placeIntro({ ...base, gpu, ranOwn: false }, "Run")).toBeNull();
    expect(placeIntro({ ...base, gpu: none, keys: [] }, "Run")).toBeNull();
    expect(placeIntro({ ...base, kind: "guest", gpu }, "Run")).toBeNull();
    expect(placeIntro({ ...base, hosted: false, gpu }, "Run")).toBeNull();
    expect(placeIntro(undefined, "Run")).toBeNull();
  });
  it("the default name reads inside the sentence", () => {
    expect(placeIntro({ ...base, placeName: undefined, gpu }, "Run")?.lead).toBe("Runs now go to our GPUs, free.");
  });
});

describe("the note above Generate", () => {
  const render = (viewer: object | undefined) => {
    const client = new QueryClient();
    if (viewer) client.setQueryData(["status"], { providers: {}, demoMode: "off", engineMode: "both", cloudProvider: "auto", viewer });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PlaceIntro, { run: "Generate" })));
  };
  it("its two buttons, the first the old place", () => {
    const html = render({ ...base, gpu });
    expect(html).toContain("Runs now go to Studio North GPUs, free.");
    expect(html.indexOf("Keep my GPU as the default")).toBeLessThan(html.indexOf(">OK<"));
  });
  it("nothing once a pick is made, or while hosted runs are off", () => {
    expect(render({ ...base, gpu, runOn: "gpu" })).toBe("");
    expect(render({ ...base, hosted: false, gpu })).toBe("");
    expect(render(undefined)).toBe("");
  });
});
