import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusInfo, ViewerInfo } from "@/lib/api";

/*
 * The engine switch for a guest or an account while open models run free on this install's GPUs: both sides always
 * show ("Open source" with "Free · {place}", then "Cloud" with "Your key"); Cloud without a key opens the Cloud panel
 * and the switch stays on Open source; with a key it switches. The model picker lists Cloud models in their own
 * section ("Cloud · your key"), and a one-time hint points at the switch. The owner's switch is the one it always was
 * (a self-hosted install's: tests/self-host-unchanged.test.ts and its golden files).
 */

const state = vi.hoisted(() => ({
  viewer: undefined as ViewerInfo | undefined,
  status: undefined as StatusInfo | undefined,
  mode: "both" as "both" | "open" | "cloud",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", async (load) => ({
  ...(await load<typeof import("@/lib/api")>()),
  useHydrated: () => true,
  useViewer: () => ({ data: state.viewer }),
  useStatus: () => ({ data: state.status }),
  useEngineMode: () => state.mode,
}));

const { EngineSwitch } = await import("@/components/studio/engine-switch");
const { PickerList } = await import("@/components/studio/model-picker");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { getModel } = await import("@/lib/catalog");
const { CLOUD_MODELS } = await import("@/lib/catalog/cloud-models.generated");
const ux = await import("@/lib/engine-ux");
const { placeOf } = await import("@/lib/place-name");

const PLACE = placeOf("Studio North GPUs");
/** Words no visitor reads about runs on this install's GPUs (as tests/hosted-words.test.ts). */
const FORBIDDEN = /studio's GPUs|\bworkers?\b|\blanes?\b|\btickets?\b|\bpool\b|\bhosted\b|\bqueue|\bcatalog|Press Retry|Try again later|isn't available here|Not available here|not checked|unverified|ComfyUI/i;

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** The radio buttons in order: their label and whether checked. */
const radios = (html: string) => [...html.matchAll(/role="radio" aria-checked="(true|false)"[^>]*aria-label="([^"]+)"/g)].map((m) => ({ label: m[2], checked: m[1] === "true" }));

const ownerViewer: ViewerInfo = { signedIn: true, owner: true, publicSignup: true };
const accountViewer: ViewerInfo = { signedIn: true, owner: false, publicSignup: true, account: { email: "ana@example.com" } };
const guestViewer: ViewerInfo = { signedIn: false, owner: false, publicSignup: true };

function hostedStatus(v: Partial<NonNullable<StatusInfo["viewer"]>> = {}, engineMode: "open" | "both" = "open"): StatusInfo {
  return {
    providers: { comfyui: { label: "Your GPU", configured: true } },
    demoMode: "off",
    engineMode,
    cloudProvider: "auto",
    onboarded: true,
    viewer: { kind: "account", gpu: { connected: false }, keys: [], paidAllowed: true, hosted: true, placeName: PLACE.label, ...v },
  } as StatusInfo;
}
const ownerStatus = { providers: { comfyui: { label: "ComfyUI", configured: true } }, demoMode: "off", engineMode: "both", cloudProvider: "auto", onboarded: true } as StatusInfo;

const sw = (value: "open" | "cloud" = "open", more: Record<string, unknown> = {}) => render(createElement(EngineSwitch, { value, onChange: () => {}, ...more }));

beforeEach(() => {
  state.viewer = accountViewer;
  state.status = hostedStatus();
  state.mode = "open";
});

describe("an account with no key of its own", () => {
  it("sees both sides, Open source first and free on the place, Cloud with its key and a lock", () => {
    const html = sw();
    expect(html).toContain('data-engine-switch="visitor"');
    expect(radios(html)).toEqual([
      { label: "Open source, free on Studio North GPUs", checked: true },
      { label: "Cloud, needs your own key", checked: false },
    ]);
    const text = textOf(html);
    // A phone reads an icon and a short word under it ("Free", "Key"); a wider screen the name and the full line.
    expect(text).toContain("Open source Free Free · Studio North GPUs");
    expect(text).toContain("Cloud Key Your key");
    expect(html).toMatch(/class="sm:hidden">Free</);
    expect(html).toMatch(/class="sm:hidden">Key</);
    expect(html).toMatch(/aria-label="Cloud, needs your own key"[\s\S]*lucide-lock/);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("choosing Cloud opens the Cloud panel and the switch stays on Open source", () => {
    const e = ux.visitorEngine(state.status)!;
    expect(ux.visitorPick("cloud", e)).toBe("panel");
    expect(ux.visitorPick("open", e)).toBe("open");
    // Whatever engine the page asks for, the switch shows Open source until a key exists.
    expect(radios(sw("cloud"))[0]).toEqual({ label: "Open source, free on Studio North GPUs", checked: true });
  });

  it("a header with no room for words keeps the icons only on a phone, and the lock", () => {
    const html = sw("open", { wordless: true });
    expect(html).not.toMatch(/class="sm:hidden">Free</);
    expect(html).toContain("lucide-lock");
  });

  it("a studio open source only (no Cloud at all): the switch as it was", () => {
    state.status = hostedStatus({ paidAllowed: false });
    expect(ux.visitorEngine(state.status)).toBeNull();
    expect(sw()).not.toContain("data-engine-switch");
  });
});

describe("an account with its own key", () => {
  it("switches between both sides", () => {
    state.status = hostedStatus({ keys: ["fal"] }, "both");
    state.mode = "both";
    const e = ux.visitorEngine(state.status)!;
    expect(e.keyless).toBe(false);
    expect(ux.visitorPick("cloud", e)).toBe("cloud");
    expect(radios(sw("cloud"))).toEqual([
      { label: "Open source, free on Studio North GPUs", checked: false },
      { label: "Cloud, on your own key", checked: true },
    ]);
    expect(sw("cloud")).not.toContain("lucide-lock");
  });
});

describe("a guest", () => {
  it("sees the same two sides (acting asks to sign up)", () => {
    state.viewer = guestViewer;
    state.status = hostedStatus({ kind: "guest", keys: undefined });
    const html = sw();
    expect(radios(html).map((r) => r.label)).toEqual(["Open source, free on Studio North GPUs", "Cloud, needs your own key"]);
    expect(ux.visitorEngine(state.status)).toMatchObject({ guest: true, keyless: true });
  });
});

describe("the owner, and visitors while hosted runs are off", () => {
  it("the owner keeps the switch as it was: Cloud first, no captions", () => {
    state.viewer = ownerViewer;
    state.status = ownerStatus;
    state.mode = "both";
    const html = sw();
    expect(html).not.toContain("data-engine-switch");
    expect(radios(html)).toEqual([
      { label: "Cloud", checked: false },
      { label: "Open source", checked: true },
    ]);
    expect(textOf(html)).not.toContain("Free");
    expect(ux.visitorEngine(state.status)).toBeNull();
    expect(ux.cloudModelAsk(state.status)).toBe("add-key");
  });

  it("an account while hosted runs are off: no visitor switch, the add-key flow as before", () => {
    state.status = hostedStatus({ hosted: false, placeName: undefined });
    expect(ux.visitorEngine(state.status)).toBeNull();
    expect(sw()).not.toContain("data-engine-switch");
    expect(ux.cloudModelAsk(state.status)).toBe("add-key");
  });

  it("a tool for a self-hosted Fuobe only keeps its plain badge", () => {
    expect(sw("open", { selfHostedOnly: true })).not.toContain("data-engine-switch");
  });
});

describe("the model picker", () => {
  const open = getModel("oss-z-image-turbo")!;
  const cloud = getModel("nano-banana-pro")!;
  const list = () =>
    render(createElement(PickerList, { models: [open, cloud], value: open, onChange: () => {}, engine: "open", onEngineChange: () => {}, onPicked: () => {}, onNeedsKey: () => {} }));

  it("lists Cloud models under the open ones, labelled, each selectable with what it needs", () => {
    const html = list();
    const text = textOf(html);
    expect(text).toContain(ux.CLOUD_SECTION_LABEL);
    expect(text.indexOf(open.name)).toBeLessThan(text.indexOf(ux.CLOUD_SECTION_LABEL));
    expect(text.indexOf(ux.CLOUD_SECTION_LABEL)).toBeLessThan(text.indexOf(cloud.name));
    expect(html).toContain(`aria-label="${cloud.name} needs your fal.ai key"`);
    expect(text).toContain(ux.CLOUD_PICKER_NOTE);
    // Its own switch keeps to icons on a phone (the search field keeps its room).
    expect(html).toMatch(/data-engine-switch="visitor"[\s\S]*class="hidden sm:inline">Open source</);
    expect(ux.cloudModelAsk(state.status)).toBe("panel");
  });

  it("for a guest too", () => {
    state.viewer = guestViewer;
    state.status = hostedStatus({ kind: "guest", keys: undefined });
    expect(textOf(list())).toContain(ux.CLOUD_SECTION_LABEL);
  });

  it("keeps its old section name while hosted runs are off", () => {
    state.status = hostedStatus({ hosted: false, placeName: undefined });
    const text = textOf(list());
    expect(text).toContain("Paid models · with your own key");
    expect(text).toContain("Paid models like Nano Banana and Kling need your own fal.ai or Replicate key");
    expect(text).not.toContain(ux.CLOUD_SECTION_LABEL);
  });
});

describe("the words", () => {
  it("the Cloud panel names real Cloud models, by their names and makers", () => {
    expect(ux.CLOUD_SHOWCASE.length).toBeGreaterThanOrEqual(3);
    expect(ux.CLOUD_SHOWCASE.length).toBeLessThanOrEqual(4);
    for (const s of ux.CLOUD_SHOWCASE) {
      const m = CLOUD_MODELS.find((x) => x.id === s.id);
      expect(m, s.id).toBeDefined();
      expect(m).toMatchObject({ name: s.name, vendor: s.vendor, engine: "cloud" });
      expect(s.why.length, s.id).toBeLessThanOrEqual(70);
    }
  });

  it("are plain, short, say the place by its name, and never name the machinery", () => {
    for (const place of [PLACE, placeOf(null)]) {
      const panel = ux.cloudPanelWords(place);
      const hint = ux.engineHintText(place);
      expect(panel.stay).toBe("Stay on Open source (free)");
      expect(panel.lead).toContain("fal.ai or Replicate key");
      expect(panel.lead).toMatch(/bills you/);
      expect(ux.cloudPanelWords(place, "Veo 3.1").title).toBe("Veo 3.1 is a Cloud model");
      expect(ux.addProviderKeyLabel("fal")).toBe("Add a fal.ai key");
      expect(ux.addProviderKeyLabel("replicate")).toBe("Add a Replicate key");
      expect(`${hint.lead} ${hint.rest}`).toBe(`Free open-source models run on ${place.text}. Want frontier models? Switch to Cloud with your own key.`);
      expect(ux.engineCaption.open(place)).toBe(`Free · ${place.label}`);
      const all = [...Object.values(panel), ...Object.values(hint), ux.engineCaption.open(place), ux.engineCaption.cloud, ux.CLOUD_KEYLESS_TIP, ux.CLOUD_SECTION_LABEL, ux.CLOUD_PICKER_NOTE, ...ux.CLOUD_SHOWCASE.map((s) => s.why)];
      for (const w of all) {
        expect(w, w).not.toMatch(FORBIDDEN);
        // Short sentences: none over 25 words.
        for (const sentence of w.split(/(?<=\.)\s/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
      }
      // The product names stay: the sides are "Open source" and "Cloud".
      expect(all.join(" ")).not.toMatch(/\b(Paid side|Premium|Pro side|Open-weight)\b/);
    }
  });

  it("a panel opened for a model offers only the keys that run it", () => {
    expect(ux.panelProviders(["replicate"])).toEqual(["replicate"]);
    expect(ux.panelProviders(["replicate", "fal"])).toEqual(["fal", "replicate"]);
    expect(ux.panelProviders()).toEqual(["fal", "replicate"]);
  });

  it("the hint is remembered per account", () => {
    expect(ux.engineHintKey("ana@example.com")).toBe(ux.engineHintKey(" Ana@Example.com "));
    expect(ux.engineHintKey("ana@example.com")).not.toBe(ux.engineHintKey("bo@example.com"));
    expect(ux.engineHintKey("ana@example.com")).not.toContain("ana");
  });
});
