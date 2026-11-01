/**
 * The Project status page (/status): a short summary, and docs/STATUS.md rendered under it for the studio's owner. Pure, so it can be tested:
 * where the log's links go, the ids of its headings and its outline, and the date it was last updated.
 */
import { defaultUrlTransform } from "react-markdown";
import { FUOBE_REPO } from "./connections";

/** The whole log on GitHub, and the folder its relative links point into. */
export const STATUS_ON_GITHUB = `${FUOBE_REPO}/blob/main/docs/STATUS.md`;
const DOCS = `${FUOBE_REPO}/blob/main/docs/`;

/**
 * A link in the log: a relative one (research/README.md, ../scripts/eval/README.md) is a file in the repo's docs/
 * folder, so it opens on GitHub; the site has no such page. Addresses, #anchors and site paths stay as they are.
 */
export function statusLink(url: string): string {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return defaultUrlTransform(url);
  return new URL(url, DOCS).href;
}

/** A heading's id: "2. Feature matrix vs Higgsfield" → "2-feature-matrix-vs-higgsfield". */
export const headingId = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The log's sections (## and ###, outside code blocks), for the page's table of contents. */
export function statusOutline(md: string): { depth: 2 | 3; text: string; id: string }[] {
  let fenced = false;
  return md.split("\n").flatMap((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced && /^(##|###) (.+?)\s*$/.exec(line);
    if (!m) return [];
    const text = m[2].replace(/[`*_]/g, "");
    return [{ depth: m[1].length as 2 | 3, text, id: headingId(text) }];
  });
}

/** "Last updated: 2026-10-30 (round 5, part 2)" → "2026-10-30". */
export const statusDate = (md: string): string | undefined => /Last updated:\s*(\d{4}-\d{2}-\d{2})/.exec(md)?.[1];

/** The log without its own title: the page has one. */
export const statusBody = (md: string): string => md.replace(/^# .*\n+/, "");
