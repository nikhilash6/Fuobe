/**
 * Pieces of a web page found in time that grows with the page, never with its square: these readers run on pages and
 * files from other sites, on the server's one thread. A pattern like `<a[^>]*>` or `<b>[\s\S]*?</b>` tries again from
 * every opening and reads on to the end each time an opening never closes, so a page of a few MB made of openings
 * would hold the server for an hour. Here a tag stops at the next "<", and each closing tag is looked for once.
 */

export interface Element {
  name: string;
  /** The opening tag, as written (`<script type="…">`). */
  open: string;
  /** What is between the opening and the closing tag. */
  inner: string;
  start: number;
  end: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Each `<name …>…</name>` of these names, in order (names are matched in any case). An element ends at the first
 * closing tag of its name after it, as `<name\b[^>]*>[\s\S]*?</name>` would; an opening that never closes is skipped.
 */
export function elements(html: string, names: string | readonly string[], limit = Infinity): Element[] {
  const list = (typeof names === "string" ? [names] : [...names]).map((n) => n.toLowerCase());
  const out: Element[] = [];
  if (!list.length || limit <= 0) return out;
  const open = new RegExp(`<(${list.map(escape).join("|")})\\b[^<>]*>`, "gi");
  // Per name: where its next closing tag is (searched forward only, so each name's search reads the page once).
  const closes = new Map<string, { re: RegExp; at: number; end: number }>();
  for (let m = open.exec(html); m && out.length < limit; m = open.exec(html)) {
    const name = m[1].toLowerCase();
    const from = m.index + m[0].length;
    const close = nextClose(closes, html, name, from);
    if (!close) continue;
    out.push({ name, open: m[0], inner: html.slice(from, close.at), start: m.index, end: close.end });
    open.lastIndex = close.end;
  }
  return out;
}

function nextClose(closes: Map<string, { re: RegExp; at: number; end: number }>, html: string, name: string, from: number): { at: number; end: number } | null {
  let c = closes.get(name);
  if (!c) {
    c = { re: new RegExp(`</${escape(name)}\\s*>`, "gi"), at: -1, end: -1 };
    closes.set(name, c);
  }
  if (c.at === Infinity) return null;
  if (c.at < from) {
    c.re.lastIndex = from;
    const m = c.re.exec(html);
    if (!m) {
      c.at = Infinity;
      return null;
    }
    c.at = m.index;
    c.end = m.index + m[0].length;
  }
  return { at: c.at, end: c.end };
}

/** The page without these elements (each replaced by `by`). */
export function stripElements(html: string, names: readonly string[], by = " "): string {
  const found = elements(html, names);
  if (!found.length) return html;
  let out = "";
  let at = 0;
  for (const e of found) {
    out += html.slice(at, e.start) + by;
    at = e.end;
  }
  return out + html.slice(at);
}

/** The page without its comments (`<!-- … -->`); a comment that never ends is left as it is. */
export function stripComments(html: string, by = " "): string {
  let out = "";
  let at = 0;
  for (;;) {
    const start = html.indexOf("<!--", at);
    if (start < 0) break;
    const end = html.indexOf("-->", start + 4);
    if (end < 0) break;
    out += html.slice(at, start) + by;
    at = end + 3;
  }
  return at === 0 ? html : out + html.slice(at);
}

/** The text of the first `<name>…</name>`, or null. */
export const firstInner = (html: string, name: string): string | null => elements(html, name, 1)[0]?.inner ?? null;

/** What is inside `<body>`: from the first opening to the last closing tag (the whole page when there is none). */
export function bodyOf(html: string): string {
  const open = /<body\b[^<>]*>/i.exec(html);
  if (!open) return html;
  const from = open.index + open[0].length;
  const close = /<\/body\s*>/gi;
  close.lastIndex = from;
  let last = -1;
  for (let m = close.exec(html); m; m = close.exec(html)) last = m.index;
  return last < 0 ? html : html.slice(from, last);
}

/** Every `<name …>` tag's attributes, names lower-cased, values as written (quotes removed). */
export function tagAttrs(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${escape(name)}\\b[^<>]*>`, "gi"))].map((m) => attrsOf(m[0]));
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<[\w:-]+/, "").replace(/\/?>$/, "");
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** The content of the first `<meta>` whose name or property is one of these keys (in the keys' order), or "". */
export function metaContent(html: string, keys: readonly string[]): string {
  const all = tagAttrs(html, "meta");
  for (const k of keys) {
    const key = k.toLowerCase();
    const hit = all.find((a) => (a.name ?? a.property ?? a.itemprop ?? "").toLowerCase() === key && a.content);
    if (hit) return hit.content;
  }
  return "";
}
