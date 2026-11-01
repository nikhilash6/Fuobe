import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Links into Settings (/settings#id) land on a section or field that exists. */

const root = path.join(__dirname, "../src");
const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const form = fs.readFileSync(path.join(root, "components/settings-form.tsx"), "utf8");
/** The anchors Settings has: its sections' and fields' ids (id="…", or a Section's id prop on its own line), the form's and the sections around it. */
const page = [form, ...["components/gpu/account-gpu-section.tsx", "components/keys/your-keys.tsx", "components/owner-settings.tsx", "components/accounts-admin.tsx"].map((f) => fs.readFileSync(path.join(root, f), "utf8"))].join("\n");
const anchors = new Set([...page.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]));

describe("Settings deep links", () => {
  it("every /settings#… link in the app has its anchor", () => {
    const links = files(root).flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\/settings#([a-z0-9-]+)/g)].map((m) => ({ file: path.relative(root, f), id: m[1] })));
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(anchors.has(l.id), `${l.file} links to /settings#${l.id}`).toBe(true);
  });

  it("every \"Settings → …\" the app tells people names a section or field Settings has", () => {
    // Section titles ("Prompt enhancement · Claude or Ollama": the whole, or either side of the "·") and field labels.
    // (An account's own sections, Your GPU and Your keys, are titled by their heading.)
    const titles = [...page.matchAll(/\btitle="([^"]+)"/g), ...page.matchAll(/<h2\b[^>]*>\s*([^<{]+?)\s*<\/h2>/g)].map((m) => m[1]);
    const labels = [...page.matchAll(/\blabel="([^"]+)"/g)].map((m) => m[1]);
    const norm = (x: string) => x.replace(/&amp;/g, "&").replace(/\s*·\s*/g, " ").toLowerCase();
    const names = [...titles, ...titles.flatMap((t) => t.split("·").map((x) => x.trim())), ...labels].map(norm);
    const places = files(root).flatMap((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        // What people read, not the comments around it.
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        // Another app's settings (LM Studio's Developer → Server Settings, Unsloth Studio's avatar → Settings) aren't Fuobe's.
        .flatMap((l) => [...l.replace(/&amp;/g, "&").matchAll(/(?<!(?:→|Server) )Settings → ([^`"'.,;:()${}<]+)/g)].map((m) => ({ file: path.relative(root, f), place: m[1].trim() }))),
    );
    expect(places.length).toBeGreaterThan(20);
    const unknown = places.filter((p) => p.place && !names.some((n) => norm(p.place) === n || norm(p.place).startsWith(`${n} `)));
    expect(unknown.map((p) => `${p.file}: Settings → ${p.place}`)).toEqual([]);
  });

  it("the AI-Toolkit URL the training messages ask for has its field, with Save & test", () => {
    const section = form.slice(form.indexOf('id="training"'), form.indexOf("</Section>", form.indexOf('id="training"')));
    expect(section).toMatch(/name="aiToolkitUrl"[\s\S]*provider="ai-toolkit"/);
    expect(section).toMatch(/name="aiToolkitToken"/);
    const training = fs.readFileSync(path.join(root, "server/training.ts"), "utf8");
    expect(training).toContain("Settings → Training");
  });
});
