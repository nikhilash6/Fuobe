import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { headingId, STATUS_ON_GITHUB, statusBody, statusDate, statusLink, statusOutline } from "@/lib/status-page";

/** Project status (/status): docs/STATUS.md under a public summary, with working links and a table of contents. */

const md = fs.readFileSync(path.join(__dirname, "../docs/STATUS.md"), "utf8");

describe("the Project status page", () => {
  it("opens the log's relative links on GitHub, where the files are (the site has no such pages)", () => {
    const repo = "https://github.com/workingprototype/fuobe/blob/main";
    expect(statusLink("research/README.md")).toBe(`${repo}/docs/research/README.md`);
    expect(statusLink("cli.md")).toBe(`${repo}/docs/cli.md`);
    expect(statusLink("../scripts/eval/README.md")).toBe(`${repo}/scripts/eval/README.md`);
    expect(statusLink("workers/tribe-v2.md")).toBe(`${repo}/docs/workers/tribe-v2.md`);
    // Addresses, anchors and the site's own pages are left alone; unsafe schemes are dropped as before.
    expect(statusLink("https://fal.ai/models")).toBe("https://fal.ai/models");
    expect(statusLink("#known-issues")).toBe("#known-issues");
    expect(statusLink("/workflows")).toBe("/workflows");
    expect(statusLink("javascript:alert(1)")).toBe("");
    expect(STATUS_ON_GITHUB).toBe(`${repo}/docs/STATUS.md`);
  });

  it("every relative link in the log names a file in the repo", () => {
    const links = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !/^([a-z]+:|#|\/)/i.test(u));
    expect(links.length).toBeGreaterThan(10);
    for (const l of links) {
      const file = path.join(__dirname, "../docs", decodeURIComponent(l.split("#")[0]));
      expect(fs.existsSync(file), l).toBe(true);
    }
  });

  it("lists the log's sections for the table of contents, with the ids its headings get", () => {
    const outline = statusOutline(md);
    expect(outline.filter((h) => h.depth === 2).length).toBeGreaterThanOrEqual(4);
    expect(outline[0]).toEqual({ depth: 2, text: "1. What has been verified", id: "1-what-has-been-verified" });
    expect(headingId("Edit & apps")).toBe("edit-apps");
    expect(new Set(outline.map((h) => h.id)).size).toBe(outline.length);
    expect(statusOutline("## A\n```\n## not a heading\n```\n### B")).toEqual([
      { depth: 2, text: "A", id: "a" },
      { depth: 3, text: "B", id: "b" },
    ]);
  });

  it("reads the log's date and drops its own title (the page has one)", () => {
    expect(statusDate(md)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(statusDate("_Last updated: 2026-10-30 (round 5, part 2)._")).toBe("2026-10-30");
    expect(statusBody("# Fuobe — project status\n\n_Last updated_")).toBe("_Last updated_");
  });
});
