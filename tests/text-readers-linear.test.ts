import { describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.mock("server-only", () => ({}));
process.env.FUOBE_DATA_DIR = tempDir("fuobe-linear-");

/**
 * The readers that turn a page, a skill file or pasted text from somewhere else into text run on the server's one
 * thread: a pattern whose time grows with the square of its input would stop every request while it runs. Each reader
 * gets inputs built to make such a pattern backtrack (many openings with no closing, long runs of spaces) and must
 * finish them quickly. A linear reader does each in milliseconds; a quadratic one takes seconds.
 */

const N = Number(process.env.LINEAR_TEST_N) || 120_000;
const BUDGET_MS = Number(process.env.LINEAR_TEST_BUDGET_MS) || 600;

const fill = (token: string) => token.repeat(Math.ceil(N / token.length));

const HTML_TOKENS = [
  "<",
  "<a ",
  "<<",
  "</",
  "<!--",
  "<!-- ",
  "<script",
  "<script>",
  "<style>",
  "<svg ",
  "<nav>",
  "<head>",
  "<header ",
  "<form ",
  "<title",
  "<title>",
  "<meta ",
  "<meta name='description' ",
  "<meta property=\"og:description\" content=\"",
  "<meta property='og:title' ",
  "<body",
  "<body>",
  "<li",
  "<br",
  "<br ",
  "<h1>",
  "<h2 ",
  "<link ",
  "<img ",
  "<a href='",
  "<script type=\"application/ld+json\">",
  "&",
  "&#",
  "&#x",
  "&amp",
  "&nbsp;",
  "\u00a0",
  " ",
  "\t",
  " \n",
  "\n",
  "=\"",
  "'",
  "a",
  "  ",
  " \n",
];

/** One long opening tag (a single "<"), whose attributes would each start a scan to the end. */
const LONG_TAGS = [
  `<meta ${fill("name='description' ")}`,
  `<meta ${fill("property='og:title' ")}>`,
  `<div class="${fill("logo")}`,
  `<html ${fill("lang=x ")}`,
  `<script ${fill("type=application/ld+json ")}`,
  `<title>${fill(" ")}x</title>`,
];

const slow: string[] = [];
function within(label: string, run: () => unknown) {
  const t = performance.now();
  run();
  const ms = performance.now() - t;
  if (ms >= BUDGET_MS) slow.push(`${label}: ${Math.round(ms)} ms`);
}
const noneSlow = () => expect(slow.splice(0)).toEqual([]);

describe("readers of outside text take time in step with their input", () => {
  it("a web page added as an Assist project source", async () => {
    const { htmlToText } = await import("@/server/assist/projects");
    for (const t of HTML_TOKENS) {
      within(`htmlToText ${JSON.stringify(t)}`, () => htmlToText(fill(t)));
      within(`htmlToText x+${JSON.stringify(t)}`, () => htmlToText(`<html><body><p>x</p>${fill(t)}`));
    }
    for (const [i, t] of LONG_TAGS.entries()) within(`htmlToText long tag ${i}`, () => htmlToText(t));
    noneSlow();
  });

  it("a page an Explainer reads from a link", async () => {
    const { pageText } = await import("@/server/faceless");
    for (const t of HTML_TOKENS) {
      within(`pageText ${JSON.stringify(t)}`, () => pageText(fill(t)));
      within(`pageText x+${JSON.stringify(t)}`, () => pageText(`<html><body><p>x</p>${fill(t)}`));
    }
    for (const [i, t] of LONG_TAGS.entries()) within(`pageText long tag ${i}`, () => pageText(t));
    noneSlow();
  });

  it("a brand's website and a product link", async () => {
    const { parseSite, productsFromPage } = await import("@/server/brand");
    for (const t of HTML_TOKENS) {
      within(`parseSite ${JSON.stringify(t)}`, () => parseSite(fill(t), "https://brand.example/"));
      within(`productsFromPage ${JSON.stringify(t)}`, () => productsFromPage(fill(t), "https://brand.example/p"));
    }
    for (const [i, t] of LONG_TAGS.entries()) within(`parseSite long tag ${i}`, () => productsFromPage(t, "https://brand.example/"));
    noneSlow();
  });

  it("a skill's SKILL.md and pasted memories", async () => {
    const { parseSkillMd, parseMemoryImport } = await import("@/lib/assist");
    const spaces = " ".repeat(N);
    const cases: [string, string][] = [
      ["value with spaces", `---\nname: a\ndescription: a${spaces}b\n---\nbody`],
      ["quoted value", `---\nname: a\ndescription: "${"\\".repeat(N)}\n---\nbody`],
      ["key with spaces", `---\nname${spaces}\n---\nbody`],
      ["comment marks", `---\nname: a\ndescription: ${fill("a #")}\n---\nbody`],
      ["many dashes lines", `---\n${fill("---  x\n")}`],
      ["block", `---\nname: a\ndescription: |\n${fill("  line\n")}---\nbody`],
      ["list", `---\nname: a\ntags:\n${fill("  - t\n")}---\nbody`],
      ["no end", `---\n${fill("a: b\n")}`],
      ["spaces only", spaces],
    ];
    for (const [label, text] of cases) within(`parseSkillMd ${label}`, () => parseSkillMd(text));
    for (const t of [" ", "\n", "- ", "* ", "#", "1. ", "\u00a0", "a", "{", "[", '"']) within(`parseMemoryImport ${JSON.stringify(t)}`, () => parseMemoryImport(fill(t)));
    noneSlow();
  });
});
