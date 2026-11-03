import { createElement, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { CANVAS_TEMPLATES, isGenerator, planCanvas } from "@/lib/catalog/canvas";
import { firstTemplates, moreTemplates, TEMPLATE_SECTIONS, templateSections, type Viewing } from "@/lib/canvas-sections";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { canvasIntro, templateCards, templateDetail, templateIds, templateModels } from "@/lib/canvas-template-cards";
import { guestRead, isLibraryChange } from "@/lib/guest-access";
import { templateCover } from "@/lib/template-covers";

// Canvas's first screen: what a canvas is, then ready boards (its templates) by section, each with a page of its own.
// Visitors see a board only once its real cover exists, and never the model names or the engine words.

const { TemplateCard } = await import("@/components/canvas/template-card");
// The model names come from the owner's own request (useTemplateModels), as if it had answered.
const MODELS = templateModels();
const html = (props: Record<string, unknown>) => {
  const qc = new QueryClient();
  qc.setQueryData(["canvas-template-models"], MODELS);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(TemplateCard as FC<Record<string, unknown>>, props)));
};

const cards = templateCards();
const hasCover = (id: string) => !!templateCover("canvas", id);
const visitor: Viewing = { visitor: true, hasCover };
const owner: Viewing = { visitor: false, hasCover };

/** Words visitors never read on a card or a template's page. */
const ENGINE_WORDS = /Fuobe DoP|Effects 2\.0|\bGPU\b|Variant|\bComfyUI\b|\bfal\b|Replicate/;

describe("Canvas templates as ready boards", () => {
  it("each sits in a known section with a rank of its own, its steps and what it makes", () => {
    const keys = TEMPLATE_SECTIONS.map((s) => s.key as string);
    for (const t of CANVAS_TEMPLATES) {
      expect(keys, t.id).toContain(t.group ?? "");
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.makes.length, t.id).toBeGreaterThan(10);
    }
    for (const s of TEMPLATE_SECTIONS) {
      const ranks = CANVAS_TEMPLATES.filter((t) => (t.group ?? "") === s.key).map((t) => t.rank);
      expect(new Set(ranks).size, s.title).toBe(ranks.length);
    }
    expect(CANVAS_TEMPLATES.filter((t) => t.starter === false).map((t) => t.id)).toEqual(["keyframes-animation", "blockout-film"]);
  });

  it("say what they are in plain words: no model names, no engine words", () => {
    for (const t of CANVAS_TEMPLATES.filter((x) => x.starter !== false)) {
      const names = new Set<string>();
      for (const engine of ["cloud", "open"] as const)
        for (const n of t.build(engine).nodes.filter(isGenerator)) {
          const name = getModel(n.data.modelId ?? "")?.name;
          if (name && name.length > 4) names.add(name);
        }
      const words = [t.name, t.description, t.makes, ...t.steps, ...Object.values(t.inputs ?? {})].join("\n");
      expect(words, t.id).not.toMatch(ENGINE_WORDS);
      for (const name of names) expect(words, `${t.id}: ${name}`).not.toContain(name);
    }
    for (const s of TEMPLATE_SECTIONS) expect(`${s.title} ${s.note}`).not.toMatch(ENGINE_WORDS);
  });

  it("a card's line is short and speaks to the visitor, and its flow names each step in a word or two", () => {
    for (const t of CANVAS_TEMPLATES.filter((x) => x.starter !== false)) {
      expect(t.description.length, t.id).toBeLessThanOrEqual(90);
      expect(t.description, t.id).not.toMatch(/the subject/i);
      expect(t.flow.length, t.id).toBeGreaterThanOrEqual(2);
      for (const w of t.flow) expect(w.length, `${t.id} ${w}`).toBeLessThanOrEqual(10);
    }
    for (const t of CANVAS_TEMPLATES.filter((x) => x.group === "effect-films")) expect(t.description.length, t.id).toBeLessThanOrEqual(70);
  });

  it("the words a board starts with describe only what is wanted, with people as fashion models", () => {
    for (const t of CANVAS_TEMPLATES.filter((x) => x.starter !== false)) {
      const words = t
        .build("open")
        .nodes.map((n) => [n.data.text, n.data.prompt, ...(n.data.rows ?? []).flat()].filter(Boolean).join(" "))
        .join(" ");
      expect(words, t.id).not.toMatch(/\b(lighthouse|fisherman|fox|owl|otter|paper boat)\b/i);
    }
  });

  it("an effect film's board plans as it is once a photo is in", () => {
    for (const t of CANVAS_TEMPLATES.filter((x) => x.group === "effect-films"))
      for (const engine of ["cloud", "open"] as const) {
        const g = t.build(engine);
        g.nodes.find((n) => n.id === "photo")!.data.url = "/api/files/u/me.png";
        expect(planCanvas(g, { engineMode: engine }).errors, `${t.id} ${engine}`).toEqual([]);
      }
  });
});

describe("Who sees which ready board", () => {
  it("a visitor: only the boards with a real cover, the effect films in rank order, nothing else", () => {
    const sections = templateSections(cards, visitor);
    for (const s of sections) for (const t of s.items) expect(hasCover(t.id), t.id).toBe(true);
    const films = sections.find((s) => s.key === "effect-films")!;
    expect(films.items.map((t) => t.id)).toEqual(
      ["pearl-earring", "monet-muse", "superstar", "fairytale-castle", "blue-depth", "agamemnon", "dolphin-ride", "skatedog", "street-colossus", "fallen-angel"].filter((id) => hasCover(`effect-chain-${id}`)).map((id) => `effect-chain-${id}`),
    );
    // A section with nothing to show is left out; the owner's other templates aren't a visitor's.
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
    expect(moreTemplates(cards, visitor)).toEqual([]);
    expect(sections.flatMap((s) => s.items).some((t) => t.id === "blockout-film" || t.id === "keyframes-animation")).toBe(false);
  });

  it("the owner: every ready board, covered first then by rank, and Blockout under More templates", () => {
    const sections = templateSections(cards, owner);
    expect(sections.map((s) => s.title)).toEqual(["Films and campaigns", "Effect films"]);
    const all = sections.flatMap((s) => s.items);
    expect(all).toHaveLength(CANVAS_TEMPLATES.length - 2);
    for (const s of sections) {
      const covered = s.items.map((t) => hasCover(t.id));
      expect(covered, s.title).toEqual([...covered].sort((a, b) => Number(b) - Number(a)));
    }
    expect(sections[0].items[0].id).toBe(hasCover("product-angles") ? "product-angles" : sections[0].items.find((t) => hasCover(t.id))?.id ?? "product-angles");
    expect(moreTemplates(cards, owner).map((t) => t.id).sort()).toEqual(["blockout-film", "keyframes-animation"]);
  });

  it("with boards of one's own, one short row: the first three covered boards", () => {
    const row = firstTemplates(cards, owner);
    expect(row).toHaveLength(3);
    expect(row.every((t) => hasCover(t.id))).toBe(true);
    expect(row[0].id).toBe("effect-chain-pearl-earring");
  });
});

describe("A template's card", () => {
  const t = cards.find((c) => c.id === "effect-chain-pearl-earring")!;
  const blank = cards.find((c) => c.id === "script-film")!;

  it("for a visitor: the cover, a link to its page and plain words, no models", () => {
    const h = html({ t, engine: "open", busy: false });
    expect(h).toContain('href="/canvas/start/effect-chain-pearl-earring"');
    expect(h).toContain("See how it works");
    expect(h).toContain("/previews/presets/peak/effect-pearl-earring.jpg?v=");
    expect(h).not.toContain("Use template");
    expect(h).not.toMatch(ENGINE_WORDS);
    for (const m of MODELS[t.id].open.models) expect(h).not.toContain(m);
  });

  it("for the owner: Use template, the models it runs on, and No cover yet where visitors see nothing", () => {
    const h = html({ t, engine: "open", busy: false, owner: true, onUse: () => {} });
    expect(h).toContain("Use template");
    expect(h).toContain(MODELS[t.id].open.models[0]);
    expect(h).toContain("free on your GPU");
    expect(h).not.toContain("No cover yet");
    expect(html({ t: blank, engine: "open", busy: false, owner: true, onUse: () => {} })).toContain(hasCover("script-film") ? "Use template" : "No cover yet");
  });
});

describe("A template's page and the first screen's strip", () => {
  it("every template has a prerendered page; an unknown one has none", () => {
    expect(templateIds()).toEqual(CANVAS_TEMPLATES.map((t) => t.id));
    expect(templateDetail("no-such-board")).toBeUndefined();
  });

  it("an effect film says what goes in, its steps, what comes out, and links to its Video effect", () => {
    const d = templateDetail("effect-chain-pearl-earring")!;
    expect(d.inputs).toMatchObject([{ id: "photo", type: "image-input", label: "Your photo", hint: "A photo of a person, facing the camera." }]);
    expect(d.steps).toHaveLength(3);
    expect(d.steps[1]).toMatch(/^An edit sets the scene: Repaint the picture as a Dutch Golden Age oil portrait/);
    expect(d.makes).toMatch(/moving shot/);
    // One tap gives a filled, ready shot: the effect's own example is loaded.
    expect(d.oneStep).toEqual({ href: "/video?preset=effect-pearl-earring&example=effect-pearl-earring.1", label: "Try this effect in Video" });
    expect(d.inputs[0].sample).toMatchObject({ kind: "image", thumb: expect.stringMatching(/^\/examples\/effect-pearl-earring\/1\/in-image\.384\.webp\?v=/) });
    for (const c of CANVAS_TEMPLATES.filter((x) => x.oneStep)) expect(getPreset(c.oneStep!.href.split("preset=")[1]), c.id).toBeTruthy();
  });

  it("a board's words show as they start: a prompt's text, a table's rows", () => {
    expect(templateDetail("image-animate")!.inputs[0]).toMatchObject({ type: "prompt", text: expect.any(String) });
    const table = templateDetail("table-film")!.inputs.find((i) => i.type === "table")!;
    expect(table.table!.rows.length).toBeGreaterThan(0);
  });

  it("the strip is one real effect film: its first frame, its peak and its clip, each at a versioned URL", () => {
    const intro = canvasIntro()!;
    // Agamemnon: a man in a white shirt on a hillside, then a bronze-armoured king (the photo and the scene differ at a glance).
    expect(intro.templateId).toBe("effect-chain-agamemnon");
    expect(intro.photo.src).toMatch(/^\/previews\/presets\/effect-agamemnon\.jpg\?v=[0-9a-f]{8}$/);
    expect(intro.film.poster).toMatch(/\?v=[0-9a-f]{8}$/);
    expect(intro.film.video).toMatch(/\.mp4\?v=[0-9a-f]{8}$/);
    expect(canvasIntro("script-film")).toBeUndefined();
  });

  it("is open to guests (a page), while making a board stays the owner's", () => {
    expect(guestRead("/canvas/start/effect-chain-pearl-earring")).toEqual({ kind: "pass" });
    expect(isLibraryChange("POST", "/api/canvases")).toBe(true);
  });
});

describe("A template's cover on its card", () => {
  const covered = cards.filter((c) => hasCover(c.id));
  // The boards with no cover yet, and one made up (every board may have its cover by now).
  const bare = [...cards.filter((c) => !hasCover(c.id)), { ...cards[0], id: "effect-chain-not-yet" }];
  // The cover box: the card's first 16:9 box, up to the card's body.
  const coverBox = (h: string) => h.slice(h.indexOf("aspect-[16/9]"), h.indexOf("<h3"));

  it("shows the finished scene whole: nothing over it but the icon badge, the steps under the title", () => {
    for (const t of covered) {
      const h = html({ t, engine: "open", busy: false });
      expect(coverBox(h), t.id).not.toContain("data-step-flow");
      expect(h.slice(h.indexOf("<h3")), t.id).toContain("data-step-flow");
      expect(coverBox(h), t.id).not.toContain("bg-black/60");
    }
  });

  it("for the owner, one without a cover is a tinted panel with its icon and No cover yet, its steps under the title as on every card", () => {
    for (const t of bare) {
      const h = html({ t, engine: "open", busy: false, owner: true, onUse: () => {} });
      expect(h, t.id).toContain("No cover yet");
      expect(h, t.id).toContain("data-no-cover");
      expect(h, t.id).not.toContain("<svg viewBox=");
      // The same line as a covered card's, so a row of cards keeps one height.
      expect(h.slice(h.indexOf("<h3")), t.id).toContain("data-step-flow");
    }
  });

  it("a visitor never gets one without a cover, and the model line is the owner's", () => {
    const shown = templateSections(cards, visitor).flatMap((s) => s.items);
    expect(shown.every((t) => hasCover(t.id))).toBe(true);
    for (const t of cards.filter((c) => !hasCover(c.id))) expect(shown.map((x) => x.id)).not.toContain(t.id);
    for (const t of shown) {
      const h = html({ t, engine: "open", busy: false });
      for (const m of [...MODELS[t.id].open.models, ...MODELS[t.id].cloud.models]) expect(h, `${t.id}: ${m}`).not.toContain(m);
      expect(h).not.toMatch(/Fuobe DoP|Qwen|free on your GPU/);
    }
  });

  it("the page's data holds no model name (the owner's line asks for them: GET /api/canvases/template-models, closed to visitors)", () => {
    const data = JSON.stringify(templateCards());
    const names = new Set(Object.values(MODELS).flatMap((m) => [...m.open.models, ...m.cloud.models]));
    expect(names.size).toBeGreaterThan(0);
    for (const n of names) expect(data, n).not.toContain(`"${n}"`);
    expect(guestRead("/api/canvases/template-models")).toEqual({ kind: "closed" });
  });
});
