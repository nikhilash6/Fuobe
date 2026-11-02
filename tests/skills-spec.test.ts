import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkillMd, toSkillMd } from "@/lib/assist";

/**
 * Fuobe's skills follow the Agent Skills spec (agentskills.io), so `npx skills add
 * workingprototype/Fuobe` installs them into Claude Code, Codex, Cursor… and claude.ai accepts
 * them: only the spec's keys at the top, Fuobe's own fields as one-line strings under `metadata`.
 */

const SPEC_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const root = process.cwd();
const skillFiles = [
  ...fs.readdirSync(path.join(root, "skills")).map((d) => path.join(root, "skills", d, "SKILL.md")),
  ...fs.readdirSync(path.join(root, ".agents/skills")).map((d) => path.join(root, ".agents/skills", d, "SKILL.md")),
].filter((f) => fs.existsSync(f));

/** A one-line YAML scalar every parser reads as the same string: plain (no indicator first, no ": " or " #"), or double-quoted JSON. */
function yamlString(v: string): string | null {
  if (v.startsWith('"')) {
    try {
      const s = JSON.parse(v) as unknown;
      return typeof s === "string" ? s : null;
    } catch {
      return null;
    }
  }
  if (!v || /^[-?:,[\]{}#&*!|>'"%@`\s]/.test(v) || /: |\s#|:$|\s$/.test(v)) return null;
  if (/^(true|false|null|yes|no|on|off|~|[-+]?[\d.][\d._eE+-]*)$/i.test(v)) return null;
  return v;
}

/** The frontmatter as the spec reads it: top-level keys and the metadata map, every value a string. */
function frontmatter(text: string) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const top: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMeta = false;
  for (const line of m[1].split("\n")) {
    const kv = /^( {2})?([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);
    if (!kv) throw new Error(`can't read “${line}”`);
    const [, indent, key, raw = ""] = kv;
    if (indent) {
      if (!inMeta) throw new Error(`indented line outside metadata: ${line}`);
      const v = yamlString(raw);
      if (v === null) throw new Error(`metadata.${key} isn't a safe one-line string: ${raw}`);
      metadata[key] = v;
      continue;
    }
    inMeta = key === "metadata" && !raw;
    if (inMeta) continue;
    const v = yamlString(raw);
    if (v === null) throw new Error(`${key} isn't a safe one-line string: ${raw}`);
    top[key] = v;
  }
  return { top, metadata, keys: m[1].split("\n").flatMap((l) => (/^[A-Za-z_]/.test(l) ? [l.split(":")[0]] : [])) };
}

describe("skills follow the Agent Skills spec", () => {
  it("finds the 21 built-in skills and the agent skill", () => {
    expect(skillFiles).toHaveLength(22);
  });

  for (const file of skillFiles) {
    const name = path.basename(path.dirname(file));
    it(`${path.relative(root, file)}: spec keys only, safe YAML, and Fuobe still reads it`, () => {
      const text = fs.readFileSync(file, "utf8");
      const { top, metadata, keys } = frontmatter(text);
      for (const k of keys) expect(SPEC_KEYS.has(k), `${name}: “${k}” isn't an Agent Skills key (put it under metadata)`).toBe(true);
      expect(top.name).toBe(name);
      expect(top.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(top.description.length).toBeGreaterThan(20);
      expect(top.description.length).toBeLessThanOrEqual(1024);
      expect(top.compatibility?.length ?? 0).toBeLessThanOrEqual(500);
      const parsed = parseSkillMd(text);
      expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.skill).toMatchObject({ name, description: top.description, title: metadata.title, whenToUse: metadata.when_to_use });
      if (metadata.icon) expect(parsed.skill.icon).toBe(metadata.icon);
      if (metadata.studio) expect(parsed.skill.studio).toBe(metadata.studio);
      if (metadata.offline_kind) expect(parsed.skill.offline?.kind).toBe(metadata.offline_kind);
      // Other agents are told how to reach Fuobe.
      expect(text).toMatch(/\n## Using Fuobe from an agent\n|\n## 1\. Connect/);
    });
  }

  it("names only MCP tools that exist in the agent sections", async () => {
    const { TOOLS } = await import("@/server/assist/tools");
    const known = new Set([...TOOLS.map((t) => t.name), "estimate_cost", "estimate_job"]);
    for (const file of skillFiles) {
      const section = fs.readFileSync(file, "utf8").split("## Using Fuobe from an agent")[1];
      if (!section) continue;
      const named = [...section.matchAll(/`([a-z]+(?:_[a-z]+)+|generate|katana)`/g)].map((m) => m[1]);
      for (const t of named) expect(known.has(t), `${path.relative(root, file)} names \`${t}\``).toBe(true);
    }
  });

  it("names only models that exist", async () => {
    const { MODELS } = await import("@/lib/catalog");
    const { STYLES } = await import("@/lib/catalog/faceless");
    // Faceless / Explainer style ids (`pastel-flat-2d`…) are named the same way in the faceless-video skill.
    const ids = new Set([...MODELS.map((m) => m.id), ...STYLES.map((st) => st.id)]);
    for (const file of skillFiles) {
      // `seedance-2-5`, `oss-wan22-14b`…: backticked words with a hyphen and a digit, or an oss- prefix.
      const named = [...fs.readFileSync(file, "utf8").matchAll(/`([a-z][a-z0-9.]*(?:-[a-z0-9.]+)+)`/g)].map((m) => m[1]).filter((w) => /\d/.test(w) || w.startsWith("oss-"));
      for (const id of named) expect(ids.has(id), `${path.relative(root, file)} names \`${id}\``).toBe(true);
    }
  });

  it("reads the hints of a built-in from metadata the way it read them from the top level", () => {
    const r = parseSkillMd(fs.readFileSync(path.join(root, "skills/ugc-video/SKILL.md"), "utf8"));
    expect(r.ok && r.skill).toMatchObject({ title: "UGC Studio", icon: "smartphone", tags: ["ugc", "ads", "video", "social"], offline: { kind: "video", aspect: "9:16", style: expect.stringMatching(/^handheld smartphone/) } });
    const amazon = parseSkillMd(fs.readFileSync(path.join(root, "skills/amazon-listing-images/SKILL.md"), "utf8"));
    expect(amazon.ok && amazon.skill.offline).toMatchObject({ kind: "image", aspect: "1:1", outputs: 2 });
  });
});

describe("SKILL.md written by Fuobe (download, duplicate, the Create form)", () => {
  const skill = {
    name: "launch-video",
    title: "Launch video: v2",
    description: "A 20-second launch video — from one photo.",
    whenToUse: 'The user says "launch video"\nor "teaser"',
    icon: "rocket",
    studio: "/marketing?template=x",
    tags: ["launch", "video"],
    offline: { kind: "video" as const, aspect: "9:16", outputs: 2, style: "bold #brand colours" },
    body: "# Launch\n\nSteps.",
  };

  it("writes the spec's keys at the top and Fuobe's under metadata, and reads back the same skill", () => {
    const md = toSkillMd(skill);
    const { keys, metadata } = frontmatter(md);
    expect(keys).toEqual(["name", "description", "metadata"]);
    expect(metadata).toEqual({
      title: "Launch video: v2",
      when_to_use: 'The user says "launch video" or "teaser"',
      icon: "rocket",
      studio: "/marketing?template=x",
      tags: "launch, video",
      offline_kind: "video",
      offline_aspect: "9:16",
      offline_outputs: "2",
      offline_style: "bold #brand colours",
    });
    const r = parseSkillMd(md);
    expect(r.ok && r.skill).toEqual({ ...skill, whenToUse: 'The user says "launch video" or "teaser"', body: "# Launch\n\nSteps." });
  });

  it("still reads skills written the old way (Fuobe's fields at the top level)", () => {
    const old = `---\nname: old-style\ntitle: Old style\ndescription: Old.\nwhen_to_use: Always\nicon: film\nstudio: /video\ntags: [a, b]\noffline:\n  kind: image\n  outputs: 3\n---\n\n# Old\n`;
    const r = parseSkillMd(old);
    expect(r.ok && r.skill).toMatchObject({ title: "Old style", whenToUse: "Always", icon: "film", studio: "/video", tags: ["a", "b"], offline: { kind: "image", outputs: 3 } });
  });
});
