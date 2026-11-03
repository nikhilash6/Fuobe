import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import {
  contextUpdate,
  factMap,
  guessCategory,
  insertSlash,
  parseFrontmatter,
  parseMemoryImport,
  parseSkillMd,
  pickSlash,
  renderContext,
  skillSlug,
  slashQuery,
  slashSkills,
  toSkillMd,
  type ContextFact,
} from "@/lib/assist";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-assist-skills-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const skills = await import("@/server/skills");
const memory = await import("@/server/assist/memory");
const projects = await import("@/server/assist/projects");
const { zipStored, unzip } = await import("@/server/assist/unzip");
const { createElement } = await import("@/server/elements");
const { saveFile } = await import("@/server/storage");
const agent = await import("@/server/assist/agent");
const { db } = await import("@/server/db");
const tools = await import("@/server/assist/tools");
const downloadRoute = await import("@/app/api/assist/skills/[name]/download/route");


const md = (fm: string, body = "# Do it\n\n1. Step one.") => `---\n${fm}\n---\n\n${body}\n`;

/** A small valid PDF: one page per entry, each line drawn with Helvetica (empty lines: no text layer). */
function makePdf(pages: string[][], title?: string): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, i) => {
    const ops = lines.map((l, k) => `BT /F1 12 Tf 72 ${720 - k * 18} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
  });
  if (title) objs.push(`<< /Title (${title}) >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${title ? ` /Info ${objs.length} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("SKILL.md parsing and validation", () => {
  it("reads the frontmatter: quoted values, block scalars, lists and the offline map", () => {
    const fm = parseFrontmatter(`name: product-photos
title: "Product: photos"
description: >
  Studio photos
  of products.
when-to-use: |
  Line one
  Line two
tags: [product, photo]
offline:
  kind: image
  aspect: "1:1"
  outputs: 4
# a comment`);
    expect(fm).toMatchObject({ name: "product-photos", title: "Product: photos", description: "Studio photos of products.", when_to_use: "Line one\nLine two", tags: ["product", "photo"] });
    expect(fm.offline).toEqual({ kind: "image", aspect: "1:1", outputs: "4" });
  });

  it("accepts a valid skill and fills the title from the name", () => {
    const r = parseSkillMd(md("name: recipe-reels\ndescription: Cooking reels from a recipe.\noffline:\n  kind: video\n  outputs: 9"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill).toMatchObject({ name: "recipe-reels", title: "Recipe reels", description: "Cooking reels from a recipe.", whenToUse: "", offline: { kind: "video", outputs: 4 } });
    expect(r.skill.body).toBe("# Do it\n\n1. Step one.");
  });

  it("names what's wrong, prefixed the way Supercomputer does", () => {
    const err = (text: string) => {
      const r = parseSkillMd(text);
      return r.ok ? null : r.error;
    };
    expect(err("# no frontmatter")).toMatch(/^Check SKILL\.md and try again: it needs a frontmatter block/);
    expect(err(md("description: x"))).toMatch(/has no name/);
    expect(err(md("name: Product Photos\ndescription: x"))).toMatch(/isn't a valid name/);
    expect(err(md("name: a--b\ndescription: x"))).toMatch(/isn't a valid name/);
    expect(err(md("name: ok-name"))).toMatch(/no description/);
    expect(err(md(`name: ok\ndescription: ${"x".repeat(1100)}`))).toMatch(/keep it under 1024/);
    expect(err(md("name: ok\ndescription: x", ""))).toMatch(/no instructions/);
  });

  it("writes a skill back to SKILL.md that parses to the same skill", () => {
    const s = { name: "a-b", title: "A: b", description: "Does a thing\nwell", whenToUse: "When asked", icon: "film", studio: "/video", tags: ["x", "y z"], body: "# Hi\n\nText" };
    const r = parseSkillMd(toSkillMd(s));
    expect(r.ok && r.skill).toMatchObject({ name: "a-b", title: "A: b", description: "Does a thing well", whenToUse: "When asked", icon: "film", studio: "/video", tags: ["x", "y z"], body: "# Hi\n\nText" });
  });

  it("round-trips backslashes, quotes, '#' and colons through SKILL.md, unchanged on every save", () => {
    const s = { name: "esc", title: 'Back\\slash "quoted" #1: yes', description: "Save to C:\\new\\tables — 50% #brand 'ok'", whenToUse: "When it's \\n literally", tags: ["a#b", 'c"d'], body: "Body" };
    let md1 = toSkillMd(s);
    for (let k = 0; k < 3; k++) {
      const r = parseSkillMd(md1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.skill).toMatchObject({ title: s.title, description: s.description, whenToUse: s.whenToUse });
      md1 = toSkillMd({ ...r.skill, tags: s.tags });
    }
    // Hand-written YAML: a lone backslash in double quotes is kept, single quotes double up.
    expect(parseFrontmatter(`a: "C:\\d"\nb: 'it''s'\nc: plain # comment`)).toEqual({ a: "C:\\d", b: "it's", c: "plain" });
  });

  it("makes names from titles", () => {
    expect(skillSlug("Café Reels — 2026!")).toBe("cafe-reels-2026");
    expect(skillSlug("!!!")).toBe("my-skill");
  });
});

describe("/name in the composer", () => {
  const known = (n: string) => ["product-photoshoot", "thumbnail-generation"].includes(n);
  it("takes leading skill tokens off the message, leaving unknown ones in the text", () => {
    expect(slashSkills("/product-photoshoot /thumbnail-generation  a coffee ad", known)).toEqual({ skills: ["product-photoshoot", "thumbnail-generation"], text: "a coffee ad" });
    expect(slashSkills("/nope do it", known)).toEqual({ skills: [], text: "/nope do it" });
    expect(slashSkills("make /product-photoshoot", known)).toEqual({ skills: [], text: "make /product-photoshoot" });
    expect(slashSkills("/product-photoshoot", known)).toEqual({ skills: ["product-photoshoot"], text: "" });
  });
  it("“Use a skill” adds a / after the chosen skills, and picking fills it in without touching them", () => {
    const k = ["katana", "narration", "product-photoshoot"];
    // The reviewer's case: /katana stays, narration is added.
    const a = insertSlash("/katana make it pop", k);
    expect(a).toEqual({ text: "/katana / make it pop", caret: 9 });
    const q = slashQuery(a.text, a.caret)!;
    expect(q).toEqual({ start: 8, query: "" });
    const b = pickSlash(a.text, a.caret, q.start, "narration");
    expect(b).toEqual({ text: "/katana /narration make it pop", caret: 19 });
    expect(slashSkills(b.text, (n) => k.includes(n))).toEqual({ skills: ["katana", "narration"], text: "make it pop" });
    // Empty box, plain text, a token without a trailing space, two tokens, a / already waiting.
    expect(insertSlash("", k)).toEqual({ text: "/", caret: 1 });
    expect(insertSlash("make it pop", k)).toEqual({ text: "/ make it pop", caret: 1 });
    expect(insertSlash("/katana", k)).toEqual({ text: "/katana /", caret: 9 });
    expect(insertSlash("/katana /narration hi", k)).toEqual({ text: "/katana /narration / hi", caret: 20 });
    expect(insertSlash("/katana /nar hi", k)).toEqual({ text: "/katana /nar hi", caret: 12 });
    expect(insertSlash("/katana / hi", k)).toEqual({ text: "/katana / hi", caret: 9 });
    // An unknown /word is text, not a skill: the new / goes before it.
    expect(insertSlash("/hello there", k)).toEqual({ text: "/ /hello there", caret: 1 });
    // Picking while typing a partial replaces only that partial.
    expect(pickSlash("/product-photoshoot /nar a bottle", 24, 20, "narration")).toEqual({ text: "/product-photoshoot /narration a bottle", caret: 31 });
  });

  it("finds the /partial at the caret only at the start of the message", () => {
    expect(slashQuery("/pro", 4)).toEqual({ start: 0, query: "pro" });
    expect(slashQuery("/product-photoshoot /thu", 24)).toEqual({ start: 20, query: "thu" });
    expect(slashQuery("hello /pro", 10)).toBeNull();
    expect(slashQuery("/", 1)).toEqual({ start: 0, query: "" });
  });
});

describe("memory import", () => {
  it("reads headings, bullets, numbered items and category prefixes; drops boilerplate and duplicates", () => {
    const items = parseMemoryImport(`Here is what I remember about you:

## Preferences
- Prefers vertical 9:16 videos
- Prefers vertical 9:16 videos.
1. Likes warm, filmic grading

**Communication**
* Wants short answers

Tooling: Uses an RTX 4090 with ComfyUI
- ok`);
    expect(items).toEqual([
      { category: "Preference", text: "Prefers vertical 9:16 videos" },
      { category: "Preference", text: "Likes warm, filmic grading" },
      { category: "Communication", text: "Wants short answers" },
      { category: "Tooling", text: "Uses an RTX 4090 with ComfyUI" },
    ]);
  });
  it("reads a real ChatGPT memory answer: lead-in, bold labels, dates and the sign-off", () => {
    const items = parseMemoryImport(`Sure! Here's what I remember about you:

1. **Name**: Sam
2. **Preferences**: Prefers vertical 9:16 videos for social.
3. **Work:** Runs a small video studio in Lisbon.
4. Uses ComfyUI on an RTX 4090.
5. [2025-03-12] Likes warm, *filmic* colour grading.
6. March 3, 2025 — Wants replies short and direct.

**Your communication preferences:**
- I remember that you hate emoji in captions.

Here’s everything I know.
Let me know if you'd like me to update or forget any of these!`);
    expect(items).toEqual([
      { category: "Notes", text: "Name: Sam" },
      { category: "Preference", text: "Prefers vertical 9:16 videos for social." },
      { category: "Tooling", text: "Work: Runs a small video studio in Lisbon." },
      { category: "Environment", text: "Uses ComfyUI on an RTX 4090." },
      { category: "Style", text: "Likes warm, filmic colour grading." },
      { category: "Communication", text: "Wants replies short and direct." },
      { category: "Communication", text: "You hate emoji in captions." },
    ]);
  });

  it("reads JSON exports too", () => {
    expect(parseMemoryImport(JSON.stringify({ memories: [{ content: "Brand colour is teal #1E9E8F", category: "convention" }, "Call me Sam"] }))).toEqual([
      { category: "Convention", text: "Brand colour is teal #1E9E8F" },
      { category: "Communication", text: "Call me Sam" },
    ]);
  });
  it("guesses categories from the words", () => {
    expect(guessCategory("Always export 4:5 for Instagram")).toBe("Convention");
    expect(guessCategory("My GPU has 12 GB of VRAM")).toBe("Environment");
    expect(guessCategory("Keep replies brief")).toBe("Communication");
    expect(guessCategory("The sky is blue")).toBe("Notes");
  });
});

describe("context updates", () => {
  const facts = (extra: ContextFact[] = []): ContextFact[] => [{ section: "now", key: "date", text: "Today is 2026-10-19." }, { section: "memory", key: "m1", text: "- (m1) [Preference] 9:16" }, ...extra];
  it("renders sections and sends only what changed", () => {
    expect(renderContext(facts())).toBe("## This chat\nToday is 2026-10-19.\n\n## Memory (what you know about the user)\n- (m1) [Preference] 9:16");
    const sent = factMap(facts());
    expect(contextUpdate(sent, facts())).toBeNull();
    const next = [{ section: "now" as const, key: "date", text: "Today is 2026-10-20." }, { section: "active" as const, key: "katana", text: "### /katana — Katana\nDo it" }];
    const u = contextUpdate(sent, next)!;
    expect(u).toMatch(/^Context update/);
    expect(u).toContain("Today is 2026-10-20.");
    expect(u).toContain("### /katana — Katana");
    expect(u).toContain("No longer applies: (m1) [Preference] 9:16");
    expect(contextUpdate(factMap(next), [next[0]])).toContain("Stop following the /katana skill.");
  });
});

describe("skills on the server", () => {
  it("loads every built-in from skills/: 21, valid, unique, each with when-to-use and an icon", () => {
    const list = skills.listSkills();
    const builtin = list.filter((s) => s.source === "builtin");
    expect(builtin).toHaveLength(21);
    expect(new Set(builtin.map((s) => s.name)).size).toBe(21);
    for (const s of builtin) {
      expect(s.whenToUse, s.name).not.toBe("");
      expect(s.icon, s.name).toBeTruthy();
      expect(s.chars, s.name).toBeGreaterThan(600);
    }
    for (const n of ["product-photoshoot", "ugc-video", "short-film", "narration", "thumbnail-generation", "image-repurposer", "faceless-video", "video-repurposer", "character-sheet", "youtube-script", "video-montage", "katana", "brand-asset-creation", "marketing-studio-cards"]) {
      expect(builtin.map((s) => s.name)).toContain(n);
    }
    // Studio links point at pages that exist (a text-only skill like youtube-script has none).
    expect(builtin.find((s) => s.name === "youtube-script")?.studio).toBeUndefined();
    for (const s of builtin) {
      if (!s.studio) continue;
      const route = s.studio.split("?")[0].replace(/^\/apps\/.+$/, "/apps/[id]").replace(/^\/(audio|video-tools|upscale)\/.+$/, "/$1/[mode]");
      const page = path.join(process.cwd(), "src/app/(studio)", route, "page.tsx");
      expect(fs.existsSync(page), `${s.name} → ${s.studio}`).toBe(true);
    }
  });

  it("links each skill to the studio that does its job", async () => {
    const { TEMPLATE_INDEX } = await import("@/lib/catalog/marketing");
    const { getModel } = await import("@/lib/catalog");
    const studio = Object.fromEntries(skills.listSkills().filter((s) => s.source === "builtin").map((s) => [s.name, s.studio]));
    expect(studio).toMatchObject({
      "faceless-video": "/faceless",
      katana: "/katana",
      "ad-multiplier": "/ads/multiplier",
      "marketing-studio-cards": "/marketing",
      "character-sheet": "/character-sheet",
      localization: "/audio/translate",
      "ugc-video": "/marketing?template=ugc-honest-review",
      "amazon-listing-images": "/marketing?template=mk-clean-listing",
      "product-photoshoot": "/marketing",
      "visual-studio": "/video?model=minimax-h3",
      "video-montage": "/video-tools/join",
    });
    // Templates and models named in a link exist (the page would otherwise open on its default).
    for (const [name, link] of Object.entries(studio)) {
      const q = new URL(link ?? "/", "http://x").searchParams;
      if (q.get("template")) expect(TEMPLATE_INDEX.get(q.get("template")!), name).toBeTruthy();
      if (q.get("model")) expect(getModel(q.get("model")!), name).toBeTruthy();
    }
  });

  it("creates, edits, duplicates, switches off and deletes the user's skills", () => {
    expect(() => skills.createSkill({ name: "katana", title: "K", description: "d", body: "b" })).toThrow(/built-in skill/);
    expect(() => skills.createSkill({ name: "upload", title: "U", description: "d", body: "b" })).toThrow(/reserved/);
    expect(() => skills.createSkill({ name: "Bad Name", title: "B", description: "d", body: "b" })).toThrow(/valid name/);
    const s = skills.createSkill({ name: "recipe-reels", title: "Recipe reels", description: "Cooking reels.", whenToUse: "A recipe", body: "# Steps", icon: "film" });
    expect(s).toMatchObject({ source: "user", enabled: true, icon: "film" });
    expect(() => skills.createSkill({ name: "recipe-reels", title: "x", description: "d", body: "b" })).toThrow(/already have/);
    expect(skills.updateSkill("recipe-reels", { body: "# New steps", name: "recipe-videos" })).toMatchObject({ name: "recipe-videos", body: "# New steps" });
    expect(skills.getSkill("recipe-reels")).toBeNull();
    expect(() => skills.updateSkill("katana", { body: "x" })).toThrow(/can't be edited/);
    expect(() => skills.deleteSkill("katana")).toThrow(/can't be deleted/);
    const copy = skills.duplicateSkill("katana");
    expect(copy).toMatchObject({ name: "katana-copy", source: "user", title: "Katana (copy)" });
    expect(skills.setSkillEnabled("katana", false).enabled).toBe(false);
    expect(skills.enabledSkills().some((x) => x.name === "katana")).toBe(false);
    skills.setSkillEnabled("katana", true);
    skills.deleteSkill("recipe-videos");
    skills.deleteSkill("katana-copy");
    expect(skills.listSkills().filter((x) => x.source === "user")).toHaveLength(0);
  });

  it("imports .zip / .skill archives with one SKILL.md and keeps the text files beside it", () => {
    const skill = Buffer.from(md("name: zipped\ndescription: From a zip."));
    const zip = zipStored([
      { name: "zipped/SKILL.md", data: skill },
      { name: "zipped/refs/style.md", data: Buffer.from("Use pastel colours.") },
      { name: "zipped/logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
      { name: "__MACOSX/zipped/._SKILL.md", data: Buffer.from("junk") },
    ]);
    expect(unzip(zip).map((e) => e.name)).toContain("zipped/refs/style.md");
    const r = skills.importSkill({ name: "zipped.skill", data: zip });
    expect(r).toMatchObject({ replaced: false, skipped: ["logo.png"], skill: { name: "zipped", files: [{ path: "refs/style.md" }] } });
    expect(skills.skillFile("zipped", "refs/style.md")).toBe("Use pastel colours.");
    expect(skills.skillFile("zipped", "../../etc/passwd")).toBeNull();
    expect(() => skills.importSkill({ name: "zipped.zip", data: zip })).toThrow(/already have/);
    expect(skills.importSkill({ name: "zipped.zip", data: zip }, { replace: true }).replaced).toBe(true);
    // A plain SKILL.md works too; broken archives and missing SKILL.md get a clear message.
    expect(skills.importSkill({ name: "SKILL.md", data: Buffer.from(md("name: plain-md\ndescription: A file.")) }).skill.name).toBe("plain-md");
    expect(() => skills.importSkill({ name: "x.zip", data: Buffer.from("not a zip") })).toThrow(/isn't a ZIP/);
    expect(() => skills.importSkill({ name: "x.zip", data: zipStored([{ name: "a/readme.md", data: Buffer.from("hi") }]) })).toThrow(/no SKILL\.md/);
    expect(() =>
      skills.importSkill({ name: "two.zip", data: zipStored([{ name: "a/SKILL.md", data: skill }, { name: "b/SKILL.md", data: skill }]) }),
    ).toThrow(/more than one skill/);
    expect(() => skills.importSkill({ name: "k.zip", data: zipStored([{ name: "SKILL.md", data: Buffer.from(md("name: katana\ndescription: mine")) }]) })).toThrow(/built-in/);
    expect(() => skills.importSkill({ name: "x.exe", data: Buffer.from("MZ") })).toThrow(/Upload a \.zip/);
  });

  it("exports a skill with its files as a .zip that imports back, recipe examples left out by default", async () => {
    skills.createSkill({ name: "lamp-turntable", title: "Lamp turntable", description: "A turntable from a product photo.", body: "# Turntable\n\n1. Spin it." });
    const recipe = {
      fuobeRecipe: 1,
      params: [{ id: "product", label: "Product photo", type: "image", required: true, example: "/api/files/uploads/2026-10-20/lamp.png" }],
      steps: [
        {
          key: "spin",
          kind: "generate",
          request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "slow turntable", inputs: { images: ["{{product}}"], audio: "/api/files/uploads/2026-10-20/bed.mp3" } },
        },
      ],
      verified: { cloud: { plan: "2026-10-29", dryRun: "2026-10-29", real: null, catalog: "sha256:abc" } },
      source: { from: "library", generations: ["V1StGXR8_Z5j"], at: "2026-10-29" },
    };
    skills.setSkillFile("lamp-turntable", "recipe.json", JSON.stringify(recipe));
    skills.setSkillFile("lamp-turntable", "notes.md", "Keep it under 5 seconds.");
    expect(skills.getSkill("lamp-turntable")).toMatchObject({ recipe: true });
    const entries = unzip(skills.skillArchive("lamp-turntable")!);
    expect(entries.map((e) => e.name).sort()).toEqual(["lamp-turntable/SKILL.md", "lamp-turntable/notes.md", "lamp-turntable/recipe.json"]);
    const shared = JSON.parse(entries.find((e) => e.name.endsWith("recipe.json"))!.data.toString("utf8"));
    expect(shared.source).toBeUndefined();
    expect(shared.verified).toBeUndefined();
    expect(shared.params[0].example).toBeUndefined();
    // The fixed music bed is a file of this install: it becomes an input the other one asks for.
    expect(shared.params[1]).toEqual({ id: "file_1", label: "Audio for “spin”", type: "audio", required: true });
    expect(shared.steps[0].request.inputs.audio).toBe("{{file_1}}");
    // &examples=1 keeps them (and the source), but never this install's checks.
    const full = JSON.parse(unzip(skills.skillArchive("lamp-turntable", { examples: true })!).find((e) => e.name.endsWith("recipe.json"))!.data.toString("utf8"));
    expect(full).toMatchObject({ params: [{ example: "/api/files/uploads/2026-10-20/lamp.png" }], source: { from: "library" } });
    expect(full.verified).toBeUndefined();
    expect(JSON.stringify(full)).not.toContain("sha256:abc");
    // Round trip: Upload reads the zip back, with its recipe (an uploaded recipe is never "checked" here).
    const back = skills.importSkill({ name: "lamp-turntable.zip", data: skills.skillArchive("lamp-turntable", { examples: true })! }, { replace: true });
    expect(back.skill).toMatchObject({ name: "lamp-turntable", recipe: true, files: expect.arrayContaining([expect.objectContaining({ path: "recipe.json" }), expect.objectContaining({ path: "notes.md" })]) });
    const stored = JSON.parse(skills.skillFile("lamp-turntable", "recipe.json")!);
    expect(stored.verified).toBeUndefined();
    expect(stored.params[0].example).toBe("/api/files/uploads/2026-10-20/lamp.png");
    // The download route serves the zip.
    const res = await downloadRoute.GET(new Request("http://x/api/assist/skills/lamp-turntable/download?format=zip"), { params: Promise.resolve({ name: "lamp-turntable" }) } as never);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(unzip(Buffer.from(await res.arrayBuffer())).map((e) => e.name)).toContain("lamp-turntable/recipe.json");
    expect((await downloadRoute.GET(new Request("http://x/api/assist/skills/lamp-turntable/download"), { params: Promise.resolve({ name: "lamp-turntable" }) } as never)).headers.get("Content-Type")).toMatch(/markdown/);
  });

  it("load_skill on a skill with a recipe adds its Run it section", async () => {
    const out = await tools.executeTool("load_skill", { name: "lamp-turntable" }, { engine: "cloud" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toContain("# Lamp turntable (/lamp-turntable)");
    expect(out.content).toContain("## Run it");
    expect(out.content).toContain("`product` — Product photo: an image; required");
    expect(out.content).toContain("run_skill");
    // A skill without one is unchanged.
    expect((await tools.executeTool("load_skill", { name: "katana" }, { engine: "cloud" })).content).not.toContain("## Run it");
    skills.deleteSkill("lamp-turntable");
  });

  it("caps what an archive may unpack to", () => {
    const big = zipStored([{ name: "SKILL.md", data: Buffer.alloc(3_000_000, 65) }]);
    expect(() => unzip(big)).toThrow(/over 2 MB/);
  });

  it("counts the bytes it inflates, not the sizes the headers claim", () => {
    // A crafted archive: 10 deflated entries of 1.5 MB each that all claim to be 10 bytes.
    const entries = Array.from({ length: 10 }, (_, k) => ({ name: Buffer.from(`f${k}.md`), data: zlib.deflateRawSync(Buffer.alloc(1_500_000, 65)) }));
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(8, 8);
      lh.writeUInt32LE(e.data.length, 18);
      lh.writeUInt32LE(10, 22);
      lh.writeUInt16LE(e.name.length, 26);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(8, 10);
      ch.writeUInt32LE(e.data.length, 20);
      ch.writeUInt32LE(10, 24);
      ch.writeUInt16LE(e.name.length, 28);
      ch.writeUInt32LE(offset, 42);
      parts.push(lh, e.name, e.data);
      central.push(ch, e.name);
      offset += 30 + e.name.length + e.data.length;
    }
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    const bomb = Buffer.concat([...parts, dir, end]);
    expect(bomb.length).toBeLessThan(100_000);
    expect(() => unzip(bomb)).toThrow(/unpacks to more than 8 MB/);
    expect(unzip(bomb, { maxTotalBytes: 20_000_000 })).toHaveLength(10);
    expect(() => unzip(bomb, { maxFileBytes: 1_000_000 })).toThrow(/f0\.md is over 1 MB/);
  });
});

describe("memory", () => {
  it("adds, dedupes, edits and deletes; project memories need their project", () => {
    const a = memory.addMemory({ text: "Prefers  vertical 9:16", category: "Preference" });
    expect(a).toMatchObject({ scope: "personal", projectId: null, text: "Prefers vertical 9:16", source: "user" });
    expect(memory.addMemory({ text: "prefers vertical 9:16!", category: "Convention" }).id).toBe(a.id);
    expect(memory.listMemories({ scope: "personal" })).toHaveLength(1);
    expect(memory.updateMemory(a.id, { text: "Prefers vertical 9:16 for Reels" }).text).toBe("Prefers vertical 9:16 for Reels");
    expect(() => memory.addMemory({ text: "x", category: "Notes", scope: "project" })).toThrow(/needs its project/);
    expect(() => memory.addMemory({ text: "x".repeat(600), category: "Notes" })).toThrow(/under 500/);
    expect(() => memory.addMemory({ text: "x", category: "Nope" as never })).toThrow(/Pick a category/);
    expect(memory.deleteMemory(a.id)).toBe(true);
    expect(memory.deleteMemory(a.id)).toBe(false);
  });

  it("imports in bulk without duplicates, and keeps project memory inside its project", () => {
    const p = projects.createProject({ name: "Mem project", usePersonalMemory: false });
    expect(memory.importMemories([{ text: "Personal one", category: "Notes" }, { text: "Personal one", category: "Notes" }], "personal", null)).toEqual({ added: 1, skipped: 1 });
    memory.addMemory({ text: "Only for this project", category: "Convention", projectId: p.id });
    expect(memory.memoriesFor(p.id, false).map((m) => m.text)).toEqual(["Only for this project"]);
    expect(memory.memoriesFor(p.id, true).map((m) => m.text)).toEqual(["Only for this project", "Personal one"]);
    expect(memory.memoriesFor(null).map((m) => m.text)).toEqual(["Personal one"]);
  });
});

describe("projects", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";
    server = http.createServer((req, res) => {
      if (req.url === "/brand") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(`<html><head><title>Oatly-ish &amp; Co</title><meta name="description" content="Oat milk, playfully."><style>.x{}</style></head><body><nav>Menu</nav><h1>About us</h1><p>We make oat milk.</p><script>evil()</script><ul><li>Teal</li><li>Cream</li></ul></body></html>`);
      } else if (req.url === "/guide.pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end(makePdf([["Brand guide", "Teal and cream, rounded type."]], "Oat Brand Guide"));
      } else if (req.url === "/image") {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from([0x89, 0x50]));
      } else {
        res.statusCode = 404;
        res.end("no");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
    delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
  });

  it("reads pages as text: title, description, body without scripts, styles or navigation", () => {
    expect(projects.htmlToText('<title>A &amp; B</title><body><nav>x</nav><p>One</p><script>no()</script><p>Two&nbsp;&#8212; three</p></body>')).toEqual({ title: "A & B", text: "One\nTwo — three" });
  });

  it("adds links, files, elements and notes, up to 20, and refetches a link", async () => {
    const p = projects.createProject({ name: "Spring", instructions: "Pastel, 9:16.", color: "rose", skills: ["product-photoshoot"] });
    const link = await projects.addSource(p.id, { kind: "link", url: `${base}/brand` });
    expect(link).toMatchObject({ kind: "link", status: "ready", title: "Oatly-ish & Co" });
    expect(link.excerpt).toContain("We make oat milk.");
    expect(link.excerpt).not.toMatch(/evil|Menu/);
    const bad = await projects.addSource(p.id, { kind: "link", url: `${base}/image` });
    expect(bad).toMatchObject({ status: "error" });
    expect(bad.error).toMatch(/upload it instead/);
    const missing = await projects.addSource(p.id, { kind: "link", url: `${base}/gone` });
    expect(missing.status).toBe("error");
    expect((await projects.refreshSource(p.id, missing.id)).status).toBe("error");
    const txt = saveFile({ data: Buffer.from("Line 1\nLine 2"), contentType: "text/plain", name: "brief.txt", source: "upload" });
    expect(await projects.addSource(p.id, { kind: "file", url: txt.url, name: "brief.txt" })).toMatchObject({ kind: "file", status: "ready", excerpt: "Line 1\nLine 2" });
    const png = saveFile({ data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png", source: "upload" });
    expect(await projects.addSource(p.id, { kind: "file", url: png.url })).toMatchObject({ kind: "image", url: png.url });
    const el = createElement({ name: "Maya", kind: "character", description: "Our mascot", references: [png.url] });
    expect(await projects.addSource(p.id, { kind: "element", elementId: el.id })).toMatchObject({ kind: "element", title: "Maya", elementId: el.id });
    const note = await projects.addSource(p.id, { kind: "text", text: "Brand voice\nPlayful." });
    expect(note).toMatchObject({ kind: "text", title: "Brand voice" });
    expect(projects.sourceText(p.id, note.id)?.text).toBe("Brand voice\nPlayful.");
    for (let i = projects.getProject(p.id)!.sources.length; i < 20; i++) await projects.addSource(p.id, { kind: "text", text: `Note ${i}` });
    await expect(projects.addSource(p.id, { kind: "text", text: "21st" })).rejects.toThrow(/up to 20 sources/);
    expect(projects.deleteSource(p.id, note.id)).toBe(true);
    expect(projects.getProject(p.id)!.sources).toHaveLength(19);
  });

  it("renaming or deleting a project's only skill keeps the project usable", async () => {
    const { skillsFor, canUseSkill } = await import("@/server/assist/context");
    skills.createSkill({ name: "only-one", title: "Only one", description: "The project's skill.", body: "# Do" });
    const p = projects.createProject({ name: "One skill", skills: ["only-one"] });
    const t = agent.createThread({ engine: "cloud", agent: "offline", projectId: p.id });
    agent.addMessage(t.id, "/only-one hello");
    expect(skillsFor(p.id).map((s) => s.name)).toEqual(["only-one"]);
    skills.updateSkill("only-one", { name: "only-two" });
    expect(projects.getProject(p.id)!.skills).toEqual(["only-two"]);
    expect(canUseSkill("only-two", p.id)).toBe(true);
    skills.deleteSkill("only-two");
    expect(projects.getProject(p.id)!.skills).toEqual([]);
    // With none of its own left, the project falls back to every enabled skill.
    expect(skillsFor(p.id).length).toBeGreaterThan(10);
    expect(canUseSkill("narration", p.id)).toBe(true);
    // A project that still lists a skill that has vanished (an old row) falls back too.
    db().prepare("UPDATE assist_projects SET skills_json = ? WHERE id = ?").run(JSON.stringify(["gone-skill"]), p.id);
    expect(canUseSkill("narration", p.id)).toBe(true);
  });

  it("reads PDFs (uploads and links) as text; an unreadable PDF is refused and takes no place", async () => {
    const p = projects.createProject({ name: "Guides" });
    const pdf = saveFile({ data: makePdf([["Brand guide", "Use teal (#1E9E8F) on cream."], ["Voice", "Playful, short sentences."]]), contentType: "application/pdf", name: "guide.pdf", source: "upload" });
    const s = await projects.addSource(p.id, { kind: "file", url: pdf.url, name: "guide.pdf" });
    expect(s).toMatchObject({ kind: "file", status: "ready", title: "guide.pdf" });
    const text = projects.sourceText(p.id, s.id)!.text!;
    expect(text).toContain("Use teal (#1E9E8F) on cream.");
    expect(text.indexOf("Brand guide")).toBeLessThan(text.indexOf("Playful, short sentences."));
    const link = await projects.addSource(p.id, { kind: "link", url: `${base}/guide.pdf` });
    expect(link).toMatchObject({ kind: "link", status: "ready", title: "Oat Brand Guide" });
    expect(link.excerpt).toContain("Teal and cream, rounded type.");
    // No text layer (a scan) and not a PDF at all: refused with a reason, nothing saved.
    const scan = saveFile({ data: makePdf([[]]), contentType: "application/pdf", name: "scan.pdf", source: "upload" });
    await expect(projects.addSource(p.id, { kind: "file", url: scan.url, name: "scan.pdf" })).rejects.toThrow(/no text to read/);
    const junk = saveFile({ data: Buffer.from("not a pdf"), contentType: "application/pdf", name: "junk.pdf", source: "upload" });
    await expect(projects.addSource(p.id, { kind: "file", url: junk.url, name: "junk.pdf" })).rejects.toMatchObject({ status: 422 });
    expect(projects.getProject(p.id)!.sources).toHaveLength(2);
  });

  it("deleting a project keeps its chats as personal chats and drops its memory", () => {
    const p = projects.createProject({ name: "Doomed" });
    const t = agent.createThread({ engine: "cloud", agent: "offline", projectId: p.id });
    memory.addMemory({ text: "Doomed memory", category: "Notes", projectId: p.id });
    expect(projects.getProject(p.id)!.chats).toBe(1);
    expect(agent.listThreads({ project: p.id }).map((x) => x.id)).toEqual([t.id]);
    expect(projects.deleteProject(p.id)).toBe(true);
    expect(agent.getThread(t.id)!.thread.projectId).toBeNull();
    expect(agent.listThreads({ project: null }).map((x) => x.id)).toContain(t.id);
    expect(memory.listMemories({ scope: "project", projectId: p.id })).toHaveLength(0);
  });
});
