import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThanksView } from "@/components/thanks/thanks-view";
import { CLOUD_NOTICES } from "@/lib/av/model3d";
import { MODELS } from "@/lib/catalog";
import { ATTRIBUTIONS, buildLicenceList, licenceInfo, NODE_PACKS, OPENMDW_NOTICE } from "@/lib/licences";
import { loraLicenceRows } from "@/lib/lora-licences";
import { BUILT_ON_PACKAGES, baseLabel, buildThanks, COMFYUI, groupOf, MAKERS, makersOf, ownerOf, packageFacts, searchText, shownName } from "@/lib/thanks";
import { readThanks } from "@/server/thanks";

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "comfyui", "manifest.json"), "utf8")) as {
  workflows: { id: string; title: string; capability: string; license?: string; models?: { url?: string; sizeGb?: number }[] }[];
};
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };

const thanks = readThanks(ROOT);
const html = renderToStaticMarkup(createElement(ThanksView, { thanks }));
/** The page's text as a visitor reads it: tags out, entities back to characters. */
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");
const rows = thanks.groups.flatMap((g) => g.rows);
const shown = (s: string) => text.includes(s);

describe("Thanks & licences", () => {
  it("lists every open model CREDITS.md lists, with each of its licences by name", () => {
    const list = buildLicenceList(
      MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, hidden: m.hidden, routes: m.routes })),
      manifest.workflows,
    );
    expect(list.rows.length).toBeGreaterThan(100);
    for (const r of list.rows) {
      expect(rows.some((x) => x.id === `model:${r.id}`), r.id).toBe(true);
      expect(shown(r.name), r.name).toBe(true);
      for (const l of r.licences) expect(shown(shownName(licenceInfo(l).name)), `${r.name}: ${l}`).toBe(true);
    }
  });

  it("lists every LoRA, node pack, credit and package the app ships with", () => {
    const loras = loraLicenceRows();
    expect(loras.length).toBeGreaterThan(100);
    for (const l of loras) {
      expect(rows.some((x) => x.id === `lora:${l.file}`), l.file).toBe(true);
      expect(shown(l.name), l.name).toBe(true);
      expect(shown(shownName(l.licence.name)), `${l.name}: ${l.licence.name}`).toBe(true);
    }
    for (const p of NODE_PACKS) {
      expect(shown(p.name), p.name).toBe(true);
      expect(shown(shownName(p.licence.name)), `${p.name}: ${p.licence.name}`).toBe(true);
    }
    for (const a of ATTRIBUTIONS) expect(shown(a.text.replace(/, copyright \(c\).*$/i, "").replace(/ by .+$/, "")), a.text).toBe(true);
    for (const name of Object.keys(pkg.dependencies)) expect(rows.some((x) => x.id === `package:${name}`), name).toBe(true);
    expect(shown("ComfyUI")).toBe(true);
    expect(shown("Fuobe")).toBe(true);
  });

  it("names every notice a licence asks the app to show, and marks the rows that carry one", () => {
    const list = buildLicenceList(MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, routes: m.routes })), manifest.workflows);
    const wanted = new Set([...list.notices.map((n) => n.text), ...Object.values(CLOUD_NOTICES).flat()].filter((n) => n !== OPENMDW_NOTICE));
    expect([...wanted]).toEqual(expect.arrayContaining(["MiniMax H3", "Built with DINOv3", "Built with Llama"]));
    for (const n of wanted) {
      expect(thanks.credits.map((c) => c.text), n).toContain(n);
      expect(shown(n), n).toBe(true);
      expect(rows.some((r) => r.credits?.includes(n)), n).toBe(true);
    }
    // The licence that asks for its notices to travel with the weights is a condition, not a name to show.
    expect(thanks.credits.map((c) => c.text)).not.toContain(OPENMDW_NOTICE);
    expect(rows.some((r) => r.condition?.includes(OPENMDW_NOTICE))).toBe(true);
  });

  it("groups the rows the way the page jumps to them, each with what Fuobe uses it for and a licence", () => {
    expect(thanks.groups.map((g) => g.id)).toEqual(expect.arrayContaining(["image", "video", "audio", "3d", "loras", "packs", "code"]));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.use.trim(), r.id).not.toBe("");
      expect(r.licences.length, r.id).toBeGreaterThan(0);
      expect(searchText(r)).toContain(r.name.toLowerCase());
    }
    for (const g of thanks.groups) expect(html).toContain(`id="thanks-${g.id}"`);
    // Plain conditions, no internal words.
    expect(text).toMatch(/Non-commercial use only/);
    expect(text).toMatch(/Not licensed in the US, the EU, the UK and South Korea/);
    expect(text).not.toMatch(/unverified|not checked|research holds|placeholder/i);
  });

  it("reads plain facts from the data", () => {
    expect(groupOf("model3d")).toBe("3d");
    expect(groupOf("interpolate")).toBe("video");
    expect(groupOf("enhance-voice")).toBe("audio");
    expect(groupOf("bg-remove")).toBe("image");
    expect(ownerOf("https://huggingface.co/Shakker-Labs/AWPortrait-Z")).toBe("Shakker-Labs");
    expect(ownerOf("https://civitai.com/models/1")).toBeUndefined();
    expect(baseLabel("wan2.2-i2v-a14b")).toBe("Wan 2.2");
    expect(baseLabel("z-image-turbo")).toBe("Z-Image");
    expect(packageFacts({ author: "Colin McDonnell <zod@colinhacks.com>", repository: { url: "git+https://github.com/colinhacks/zod.git" }, license: "MIT" })).toEqual({
      author: "Colin McDonnell",
      url: "https://github.com/colinhacks/zod",
      license: "MIT",
    });
    expect(packageFacts({ repository: "vercel/next.js" })).toEqual({ author: "vercel", url: "https://github.com/vercel/next.js" });
    // A repository name with a dot keeps it ("three.js"), and ".git" is dropped.
    expect(packageFacts({ repository: { url: "git+https://github.com/mrdoob/three.js.git" } }).url).toBe("https://github.com/mrdoob/three.js");
    // A model's licence is said once per name, linked where the data has a page.
    const empty = buildThanks({ models: [], workflows: [], loras: [], packages: [] });
    expect(empty.groups.map((g) => g.id)).toEqual(["packs", "code"]);
  });

  it("thanks ComfyUI first in Built on, with its page and licence, and keeps its row under Code and libraries", () => {
    const [comfy] = thanks.builtOn;
    expect(comfy).toMatchObject({ id: "comfyui", name: "ComfyUI", maker: "Comfy Org", url: COMFYUI.url, licence: { name: "GPL-3.0" } });
    expect(comfy.url).toBe("https://github.com/Comfy-Org/ComfyUI");
    expect(comfy.licence?.url).toMatch(/^https:\/\/spdx\.org\/licenses\/GPL-3\.0/);
    expect(comfy.use).toMatch(/your own GPU/);
    // On the page: Built on comes first, ComfyUI first in it, then the model makers, the named credits and the list.
    const at = (s: string) => html.indexOf(s);
    expect(at('id="thanks-built-on"')).toBeGreaterThan(-1);
    expect(at('id="thanks-built-on"')).toBeLessThan(at(">ComfyUI<"));
    expect(at(">ComfyUI<")).toBeLessThan(at('id="thanks-makers"'));
    expect(at('id="thanks-makers"')).toBeLessThan(at('id="thanks-credits"'));
    expect(at('id="thanks-credits"')).toBeLessThan(at('id="thanks-list"'));
    expect(html).toContain(`href="${COMFYUI.url}"`);
    expect(html).toContain(`href="${comfy.licence!.url}"`);
    expect(thanks.groups.find((g) => g.id === "code")!.rows.find((r) => r.id === "code:comfyui")).toMatchObject({ name: "ComfyUI", url: COMFYUI.url });
  });

  it("thanks in Built on only what Fuobe really uses, each with a link and, for code, its licence", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "comfyui", "manifest.json"), "utf8")) as {
      workflows: { models?: { url?: string }[]; customNodes?: { name: string }[] }[];
    };
    const ids = thanks.builtOn.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["comfyui", "huggingface", "package:next", "package:react", "package:three", "ffmpeg"]));
    for (const b of thanks.builtOn) {
      expect(b.url, b.id).toMatch(/^https:\/\//);
      expect(b.use.trim(), b.id).not.toBe("");
      expect(shown(b.name), b.name).toBe(true);
      if (b.id === "huggingface") {
        // A host, not code: the open weights come from there.
        expect(raw.workflows.some((w) => w.models?.some((m) => m.url?.startsWith("https://huggingface.co/")))).toBe(true);
        expect(b.licence).toBeUndefined();
        continue;
      }
      expect(b.licence?.name, b.id).toBeTruthy();
      expect(b.licence?.url, b.id).toMatch(/^https:\/\//);
      if (b.id.startsWith("package:")) {
        const name = b.id.slice("package:".length);
        expect(Object.keys(pkg.dependencies), name).toContain(name);
        const own = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")) as { license?: string };
        expect(b.licence?.name).toBe(own.license);
      }
      if (b.id === "ffmpeg") {
        const cloud = MODELS.some((m) => m.routes.some((r) => /ffmpeg/i.test(r.endpoint)));
        const comfyPack = raw.workflows.some((w) => w.customNodes?.some((n) => n.name === "ComfyUI-VideoHelperSuite"));
        expect(cloud || comfyPack).toBe(true);
      }
    }
    expect(BUILT_ON_PACKAGES.every((p) => ids.includes(`package:${p.pkg}`) === p.pkg in pkg.dependencies)).toBe(true);
    // With nothing to go on, only ComfyUI is thanked.
    expect(buildThanks({ models: [], workflows: [], loras: [], packages: [] }).builtOn.map((b) => b.id)).toEqual(["comfyui"]);
  });

  it("thanks the model makers whose models Fuobe runs, premium image and video makers first, each linking to its rows", () => {
    const modelRows = thanks.groups.filter((g) => !["loras", "packs", "code"].includes(g.id)).flatMap((g) => g.rows);
    expect(thanks.makers.map((m) => m.id)).toEqual(expect.arrayContaining(["qwen", "ideogram", "bfl", "wan", "minimax", "lightricks", "tencent", "meta", "stability"]));
    const premium = new Set(MAKERS.filter((m) => m.premium).map((m) => m.id));
    const firstOther = thanks.makers.findIndex((m) => !premium.has(m.id));
    expect(firstOther).toBeGreaterThan(0);
    expect(thanks.makers.slice(firstOther).every((m) => !premium.has(m.id))).toBe(true);
    for (const m of thanks.makers) {
      // Only makers some row runs, with the count of those rows and the families found.
      expect(m.count, m.id).toBeGreaterThan(0);
      expect(m.count, m.id).toBe(modelRows.filter((r) => r.makers?.includes(m.id)).length);
      expect(m.models.length, m.id).toBeGreaterThan(0);
      const def = MAKERS.find((d) => d.id === m.id)!;
      for (const f of m.models) expect(def.families.map((x) => x.name), m.id).toContain(f);
      expect(html).toContain(`href="#by-${m.id}"`);
      expect(shown(m.name), m.name).toBe(true);
    }
    // Within each tier, the most used first.
    for (const tier of [thanks.makers.slice(0, firstOther), thanks.makers.slice(firstOther)]) {
      expect(tier.map((m) => m.count)).toEqual([...tier.map((m) => m.count)].sort((a, b) => b - a));
    }
    // Qwen-Image and Ideogram 4 are thanked by name, and every premium maker shows before "Show more".
    expect(thanks.makers.find((m) => m.id === "qwen")!.models[0]).toBe("Qwen-Image");
    expect(thanks.makers.find((m) => m.id === "ideogram")!.models).toEqual(["Ideogram 4"]);
    const more = html.indexOf("more makers");
    for (const m of thanks.makers.slice(0, firstOther)) expect(html.indexOf(`href="#by-${m.id}"`), m.id).toBeLessThan(more === -1 ? Infinity : more);
    // A maker no row runs isn't thanked.
    expect(buildThanks({ models: [], workflows: [], loras: [], packages: [] }).makers).toEqual([]);
  });

  it("finds a tool's makers in the files it downloads, its name and its vendor", () => {
    // A text reader stored in another model's folder counts for its own maker, not the folder's.
    expect(makersOf("Krea 2 Turbo", "Krea", ["https://huggingface.co/Comfy-Org/Fibo-2.0/resolve/main/split_files/text_encoders/qwen3vl_4b_int8_convrot.safetensors"])).toEqual([
      ["qwen", "Qwen-VL"],
      ["krea", "Krea 2"],
    ]);
    // A file whose name says nothing is read by its repository.
    expect(makersOf("Clean up voice", "nvidia", ["https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/main/model.safetensors"])).toEqual([["nvidia", "RE-USE"]]);
    expect(makersOf("Chatterbox Multilingual", "Resemble AI", [])).toEqual([["resemble", "Chatterbox"]]);
    expect(makersOf("Fuobe Soul", "Fuobe Original", ["https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors"])).toEqual([["tongyi", "Z-Image"]]);
    expect(makersOf("Avoid me", "Someone", [])).toEqual([]);
  });

  it("shows each name a licence asks for, with how many rows carry it and the full list behind Show all", () => {
    const plain = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    for (const c of thanks.credits) {
      expect(text, c.text).toContain(c.text);
      if (c.names.length === 1) {
        expect(text).toContain(`In ${c.names[0]}`);
        continue;
      }
      expect(text).toContain(`In ${c.names.length} models and tools`);
      const at = html.indexOf(`>${c.text}<`, html.indexOf('id="thanks-credits"'));
      const block = plain(html.slice(at, html.indexOf("</details>", at)));
      expect(block, c.text).toContain("<details");
      expect(block, c.text).toContain("Show all");
      for (const n of c.names) expect(block, n).toContain(n);
    }
    expect(text).toMatch(/Some licences ask us to show their name/);
  });
});
