/**
 * Settings → About → Thanks & licences: every open model, LoRA, ComfyUI node pack and library Fuobe uses, with who made
 * it, what Fuobe uses it for, its licence and any condition in plain words. Built from the same data as CREDITS.md
 * (src/lib/licences.ts, the catalog, the ComfyUI manifest) and the LoRA list (src/lib/lora-licences.ts), so it never
 * drifts from them. Pure: the page reads the manifest and the packages and passes them in.
 *
 * Some licences ask the app to name them ("Built with DINOv3", MiniMax H3's "MiniMax H3"): those rows carry `credits`,
 * and the page names each one at the top, which is where Fuobe meets that condition.
 */
import {
  ATTRIBUTIONS,
  buildLicenceList,
  kindLabel,
  licenceInfo,
  modelCardOf,
  NODE_PACKS,
  OPENMDW_NOTICE,
  type LicenceClass,
  type LicenceInfo,
  type LicenceModelInput,
  type LicenceWorkflowInput,
} from "./licences";
import { CHARACTER_LICENCES } from "./catalog/character-swap";
import type { LoraInfo } from "./model-access";

export type ThanksGroupId = "image" | "video" | "audio" | "3d" | "text" | "loras" | "packs" | "code";

export interface ThanksLicence {
  name: string;
  url?: string;
}

export interface ThanksRow {
  /** Unique on the page (a model id, a LoRA file, a pack or package name). */
  id: string;
  name: string;
  /** Who made it, when the data says. */
  maker?: string;
  /** Its own page (a model card, a repository), when the data has one. */
  url?: string;
  /** What Fuobe uses it for, in plain words. */
  use: string;
  licences: ThanksLicence[];
  /** The condition its licence sets, in plain words ("Non-commercial use only"); none for an open licence. */
  condition?: string;
  /** Names its licence asks the app to show ("Built with DINOv3"): this page shows them. */
  credits?: string[];
}

export interface ThanksGroup {
  id: ThanksGroupId;
  title: string;
  rows: ThanksRow[];
}

export interface Thanks {
  /** Each name a licence asks Fuobe to show, with what carries it. */
  credits: { text: string; names: string[] }[];
  groups: ThanksGroup[];
}

/** A package the app ships with (package.json's dependencies), as its own package.json describes it. */
export interface ThanksPackage {
  name: string;
  description?: string;
  license?: string;
  author?: string;
  url?: string;
}

/** A catalog model as the list needs it: the licence list's fields and its tagline. */
export type ThanksModelInput = LicenceModelInput & { tagline?: string };

/** A workflow as the list needs it: the licence list's fields and the node packs it loads. */
export type ThanksWorkflowInput = LicenceWorkflowInput & { packs?: string[] };

export interface ThanksInput {
  models: ThanksModelInput[];
  workflows: ThanksWorkflowInput[];
  loras: LoraInfo[];
  packages: ThanksPackage[];
  /** Names cloud models' results carry (src/lib/av/model3d.ts CLOUD_NOTICES), by model id. */
  cloudCredits?: Record<string, string[]>;
}

export const GROUP_TITLE: Record<ThanksGroupId, string> = {
  image: "Image models",
  video: "Video models",
  audio: "Audio",
  "3d": "3D",
  text: "Text",
  loras: "LoRAs",
  packs: "ComfyUI node packs",
  code: "Code and libraries",
};

const GROUP_ORDER: ThanksGroupId[] = ["image", "video", "audio", "3d", "text", "loras", "packs", "code"];

const FUOBE_REPO = "https://github.com/workingprototype/Fuobe";
const COMFYUI_REPO = "https://github.com/comfyanonymous/ComfyUI";
const SPDX = (id: string) => `https://spdx.org/licenses/${id}.html`;

/** A model's kind, or a library workflow's capability, as a group. */
export function groupOf(kind: string): ThanksGroupId {
  if (kind === "image" || kind === "video" || kind === "audio" || kind === "text") return kind;
  if (/3d|splat|mesh/i.test(kind)) return "3d";
  if (/video|v2v|i2v|t2v|flf2v|interpolat|vfx|lipsync|lip-sync|animate/i.test(kind)) return "video";
  if (/audio|music|tts|voice|speech|sfx|v2a|asr|separat|foley|sound|dub/i.test(kind)) return "audio";
  if (/caption|ocr|transcri|translat|describe|prompt|llm/i.test(kind)) return "text";
  return "image";
}

/** The owner of a Hugging Face, GitHub or civitai page ("Shakker-Labs"), when the URL names one. */
export function ownerOf(url: string | undefined): string | undefined {
  const m = url && /^https:\/\/(?:huggingface\.co|github\.com)\/([^/]+)\/[^/]+/.exec(url);
  return m ? m[1] : undefined;
}

/** The first clause of a sentence (a tagline's "· 20 GB GPU" or a note's "; GPL-3.0 code" left out). */
const firstClause = (s: string) => s.split(/ · |; |: |\. /)[0].replace(/\.$/, "").trim();

/** "A, B and C", or the first three "and N more". */
function names(list: string[]): string {
  if (list.length > 3) return `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
}

/** A licence class as a condition in plain words; none for one that lets you sell what you make. */
function classCondition(info: Pick<LicenceInfo, "class" | "excludes" | "note">): string | undefined {
  switch (info.class) {
    case "commercial":
    case "paid-api":
      return undefined;
    case "conditions":
      return /^Commercial use on your GPU\b/.test(info.note) ? "Commercial use on your own GPU only" : "Commercial use with conditions";
    case "regions":
      return info.excludes ? `Not licensed in ${info.excludes}` : "Not licensed everywhere";
    case "non-commercial":
      return "Non-commercial use only";
    case "research":
      return "Research use only";
    case "unknown":
      return "No licence stated: see its page";
  }
}

const CLASS_OF_FLAG = { "non-commercial": "non-commercial", territory: "regions", conditions: "conditions" } as const satisfies Record<string, LicenceClass>;

const LORA_USE: Record<string, string> = { look: "A look", motion: "A camera move", effect: "An effect", adapter: "Part of a Fuobe recipe" };

/** A LoRA's base model in words ("wan2.2-i2v-a14b" → "Wan 2.2"). */
export function baseLabel(base: string): string {
  const b = base.toLowerCase();
  const known: [RegExp, string][] = [
    [/^z-image/, "Z-Image"],
    [/^wan-?2\.2/, "Wan 2.2"],
    [/^wan-?2\.1/, "Wan 2.1"],
    [/^ltx-?2\.5/, "LTX-2.5"],
    [/^ltx-?2\.3/, "LTX-2.3"],
    [/^ltx/, "LTX"],
    [/^qwen-image-2\.1|^qwen21/, "Qwen-Image 2.1"],
    [/^qwen/, "Qwen-Image"],
    [/^flux-?2|^flux\.2/, "FLUX.2"],
    [/^flux-?3|^flux\.3/, "FLUX 3"],
    [/^flux/, "FLUX.1"],
    [/^krea/, "Krea 2"],
    [/^sdxl/, "SDXL"],
    [/^hunyuan/, "HunyuanVideo"],
  ];
  return known.find(([re]) => re.test(b))?.[1] ?? base;
}

/** A licence's name as a visitor reads it: one nobody recorded is "Not stated". */
export const shownName = (name: string): string => (name === "Not recorded" ? "Not stated" : name);

/** Package licences by SPDX id get a link to their text; anything else is shown as written. */
const spdxLink = (id: string | undefined): string | undefined => (id && /^[A-Za-z0-9.+-]+$/.test(id) && !/^SEE/i.test(id) ? SPDX(id) : undefined);

/** The licences of a model row, by name (deduplicated), each with where to read it. */
function rowLicences(texts: string[], links: (string | null)[]): ThanksLicence[] {
  const out = new Map<string, ThanksLicence>();
  texts.forEach((t, i) => {
    const name = shownName(licenceInfo(t).name);
    if (!out.has(name)) out.set(name, { name, ...(links[i] && { url: links[i]! }) });
  });
  return [...out.values()];
}

export function buildThanks(input: ThanksInput): Thanks {
  const groups = new Map<ThanksGroupId, ThanksRow[]>(GROUP_ORDER.map((g) => [g, []]));
  const credits = new Map<string, string[]>();
  const credit = (text: string, name: string) => {
    const names = credits.get(text) ?? [];
    if (!names.includes(name)) names.push(name);
    credits.set(text, names);
  };

  // Open models: one row per set of open weights, as CREDITS.md lists them.
  const list = buildLicenceList(input.models, input.workflows);
  const model = new Map(input.models.map((m) => [m.id, m]));
  const workflow = new Map(input.workflows.map((w) => [w.id, w]));
  for (const r of list.rows) {
    const m = model.get(r.id);
    const wf = workflow.get(r.workflows[0]);
    const own = r.notices.filter((n) => n !== OPENMDW_NOTICE);
    const conditions = [
      ...r.flags.map((f) => classCondition({ class: CLASS_OF_FLAG[f], excludes: r.excludes, note: "" })),
      r.notices.includes(OPENMDW_NOTICE) ? OPENMDW_NOTICE : undefined,
    ].filter(Boolean);
    own.forEach((n) => credit(n, r.name));
    const card = wf?.models?.map((x) => modelCardOf(x.url)).find(Boolean);
    groups.get(groupOf(r.kind))!.push({
      id: `model:${r.id}`,
      name: r.name,
      maker: r.inCatalog ? r.by : ownerOf(card),
      ...(card && { url: card }),
      use: m?.tagline ? firstClause(m.tagline) : `A ready-made ComfyUI workflow: ${kindLabel(r.kind).toLowerCase()}`,
      licences: rowLicences(r.licences, r.links),
      ...(conditions.length && { condition: conditions.join(". ") }),
      ...(own.length && { credits: own }),
    });
  }
  // Cloud models whose results carry a name too (TRELLIS.2 and TripoSplat on fal encode with DINOv3).
  for (const [id, texts] of Object.entries(input.cloudCredits ?? {})) {
    const m = model.get(id);
    if (m) texts.forEach((n) => credit(n, m.name));
  }

  // LoRAs: the library's, the preset map's, the Character swap's and Open-H3 Regenerate's.
  for (const l of input.loras) {
    const own = l.licence.notices ?? [];
    own.forEach((n) => credit(n, l.name));
    const condition = classCondition(l.licence);
    groups.get("loras")!.push({
      id: `lora:${l.file}`,
      name: l.name,
      maker: ownerOf(l.licence.url),
      ...(l.licence.url && { url: l.licence.url }),
      use: `${LORA_USE[l.group] ?? "A LoRA"} for ${baseLabel(l.base)}`,
      licences: [{ name: shownName(l.licence.name), ...(l.licence.url && { url: l.licence.url }) }],
      ...(condition && { condition }),
      ...(own.length && { credits: own }),
    });
  }

  // ComfyUI node packs: what their note says they do, else the tools that load them.
  const users = new Map<string, string[]>();
  for (const r of list.rows) {
    for (const id of r.workflows) for (const pack of workflow.get(id)?.packs ?? []) users.set(pack, [...new Set([...(users.get(pack) ?? []), r.name])]);
  }
  for (const p of NODE_PACKS) {
    const condition = classCondition(p.licence);
    const said = firstClause(p.licence.note);
    const loads = names(users.get(p.name) ?? []);
    groups.get("packs")!.push({
      id: `pack:${p.name}`,
      name: p.name,
      maker: ownerOf(p.repo),
      url: p.repo,
      use: !/licen[cs]e|Apache|\bMIT\b|GPL|repository/i.test(said) && said.split(" ").length > 3 ? said : loads ? `Nodes for ${loads}` : "Nodes for ComfyUI",
      licences: [{ name: shownName(p.licence.name), ...(p.licence.url && p.licence.url !== p.repo ? { url: p.licence.url } : {}) }],
      ...(condition && { condition }),
    });
  }

  // Code: Fuobe itself, ComfyUI, the code and data its tools credit, and the packages the app ships with.
  const code = groups.get("code")!;
  code.push({ id: "code:fuobe", name: "Fuobe", url: FUOBE_REPO, use: "This app, open source", licences: [{ name: "MIT", url: `${FUOBE_REPO}/blob/main/LICENSE` }] });
  code.push({ id: "code:comfyui", name: "ComfyUI", maker: "Comfy Org", url: COMFYUI_REPO, use: "Runs the open models on your GPU", licences: [{ name: "GPL-3.0", url: SPDX("GPL-3.0-only") }] });
  // The Character swap's workflow (its models, LoRAs and node packs are listed above).
  for (const l of CHARACTER_LICENCES.filter((x) => /workflow/i.test(x.item))) {
    code.push({ id: `code:${l.item}`, name: l.item, maker: ownerOf(l.url), url: l.url, use: "The Character swap's ComfyUI graph", licences: [{ name: l.name, url: l.url }] });
  }
  ATTRIBUTIONS.forEach((a, i) => {
    const by = /copyright \(c\) \d{4} (.+)$/i.exec(a.text)?.[1] ?? /\bby (.+)$/.exec(a.text)?.[1];
    const name = a.text.replace(/, copyright \(c\).*$/i, "").replace(/ by .+$/, "");
    const url = licenceInfo(a.licence).url ?? spdxLink(a.licence);
    code.push({
      id: `credit:${i}`,
      name,
      ...(by && { maker: by }),
      ...(a.url && { url: a.url }),
      use: a.for,
      licences: [{ name: a.licence, ...(url && /spdx\.org|huggingface\.co/.test(url) ? { url } : {}) }],
      ...(a.note && /own licen[cs]es/.test(a.note) && { condition: a.note.replace(/\.$/, "") }),
    });
  });
  for (const p of [...input.packages].sort((a, b) => a.name.localeCompare(b.name))) {
    const url = spdxLink(p.license);
    code.push({
      id: `package:${p.name}`,
      name: p.name,
      ...(p.author && { maker: p.author }),
      url: p.url ?? `https://www.npmjs.com/package/${p.name}`,
      use: p.description ? firstClause(p.description) : "Part of the app",
      licences: [{ name: p.license || "See its page", ...(url && { url }) }],
    });
  }

  return {
    credits: [...credits].map(([text, names]) => ({ text, names })),
    groups: GROUP_ORDER.map((id) => ({ id, title: GROUP_TITLE[id], rows: groups.get(id)! })).filter((g) => g.rows.length),
  };
}

/** What the search box matches a row on: everything the row shows, in lower case. */
export function searchText(r: ThanksRow): string {
  return [r.name, r.maker, r.use, ...r.licences.map((l) => l.name), r.condition, ...(r.credits ?? [])].filter(Boolean).join(" ").toLowerCase();
}

/** A package.json's author or repository as a maker and a page ("Colin McDonnell <…>" → "Colin McDonnell"). */
export function packageFacts(pkg: { name?: string; description?: string; license?: unknown; author?: unknown; repository?: unknown; homepage?: unknown }): Omit<ThanksPackage, "name"> {
  const author = typeof pkg.author === "string" ? pkg.author : (pkg.author as { name?: string } | undefined)?.name;
  const repo = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository as { url?: string } | undefined)?.url;
  const github = repo && /github\.com[/:]([^/]+)\/([^/#.]+)/.exec(repo);
  const shorthand = repo && /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
  const url = github ? `https://github.com/${github[1]}/${github[2]}` : shorthand ? `https://github.com/${shorthand[1]}/${shorthand[2]}` : typeof pkg.homepage === "string" ? pkg.homepage : undefined;
  const maker = author?.replace(/\s*[<(].*$/, "").trim() || (github?.[1] ?? shorthand?.[1]);
  return {
    ...(pkg.description && { description: pkg.description }),
    ...(typeof pkg.license === "string" && { license: pkg.license }),
    ...(maker && { author: maker }),
    ...(url && { url }),
  };
}
