import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Everything made with Kinetic Motion goes through Fuobe: saved as a result, downloaded from the Library. No motion
// code hands the person a file straight from the page.

const ROOT = process.cwd();
const files = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : [])) : [];

describe("no direct download of a motion render", () => {
  const sources = [...files(path.join(ROOT, "src/components/motion")), ...files(path.join(ROOT, "src/lib/motion")), path.join(ROOT, "src/components/marketing/end-card-motion.tsx")];

  it("finds the motion code", () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  it("never imports downloadBlob or makes a download link", () => {
    for (const f of sources) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/downloadBlob/);
      expect(src, f).not.toMatch(/\.download\s*=|download=|setAttribute\(\s*["']download/);
      expect(src, f).not.toMatch(/URL\.createObjectURL/);
    }
  });

  it("saves through an upload and a recorded result", () => {
    const save = fs.readFileSync(path.join(ROOT, "src/components/motion/save.ts"), "utf8");
    expect(save).toContain("uploadFile(");
    expect(save).toContain('"/api/generations/local"');
    expect(save).toContain('op: "motion"');
  });

  it("is written up in the public sign-up rules and the architecture notes", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs/public-signup.md"), "utf8");
    expect(doc).toMatch(/Kinetic Motion/);
    expect(doc).toContain("POST /api/generations/local");
    expect(fs.readFileSync(path.join(ROOT, "docs/ARCHITECTURE.md"), "utf8")).toMatch(/Kinetic Motion/);
  });
});
