import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Home's first screen is in its first HTML: no route skeleton stands in front of it on a full load (see
// src/components/studio/route-loading.tsx for why), and every other studio page keeps its own skeleton for a click
// in the menus.

const root = path.join(__dirname, "..");
const studio = path.join(root, "src/app/(studio)");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Home's first paint", () => {
  it("has no loading.tsx around Home: a Suspense boundary that big is sent last, behind its skeleton", () => {
    expect(fs.existsSync(path.join(studio, "loading.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(studio, "page.tsx"))).toBe(true);
  });

  it("keeps a route skeleton for every other studio page, in its own folder", () => {
    const missing = fs
      .readdirSync(studio, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("(") && fs.existsSync(path.join(studio, e.name, "page.tsx")))
      .map((e) => e.name)
      .filter((name) => !fs.existsSync(path.join(studio, name, "loading.tsx")));
    // A new studio folder: add `export { default } from "@/components/studio/route-loading";` as its loading.tsx.
    expect(missing).toEqual([]);
  });

  it("the shared skeleton is the studio's", () => {
    expect(read("src/components/studio/route-loading.tsx")).toMatch(/<StudioRouteSkeleton generic=\{<StudioSkeleton \/>\}/);
  });

  it("Home's page needs no request data, so it stays prerendered for everyone", () => {
    const page = read("src/app/(studio)/page.tsx");
    expect(page).not.toMatch(/\b(cookies|headers|connection)\(/);
    expect(read("src/app/(studio)/layout.tsx")).not.toMatch(/\b(cookies|headers|connection)\(|async function/);
  });

  it("Home's Recent placeholder goes once its read has failed", () => {
    expect(read("src/components/home-view.tsx")).toMatch(/!recent\.data && recent\.failureCount === 0 && \(/);
  });
});
