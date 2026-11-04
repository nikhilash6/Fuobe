// A finished job's results, as the worker reads them from its own ComfyUI for the studio (docs/gpu-workers.md). Each
// is the file its ComfyUI saved, but without what a save node writes into it that the run never asked for. Two save
// nodes write the run's graph whatever --disable-metadata says:
//   - VideoHelperSuite's save node (VHS_VideoCombine) writes it, and the PC's local time, into each clip unless its
//     save_metadata is false. The worker sets save_metadata false on every such node in each prompt it sends.
//   - Core ComfyUI's SVG save node puts it into every SVG it saves (a <metadata> element). The worker takes that
//     element out, so the kept copy and the upload both come without it.

/** Does a <metadata> element start at `i` (not "<metadataX")? */
function opensAt(lower, i) {
  if (!lower.startsWith("<metadata", i)) return false;
  const next = lower[i + 9];
  return next === undefined || next === ">" || next === "/" || /\s/.test(next);
}

/** Where a <metadata> element starts at or after `from`, or -1. */
function openTag(lower, from) {
  for (let i = lower.indexOf("<metadata", from); i >= 0; i = lower.indexOf("<metadata", i + 1)) if (opensAt(lower, i)) return i;
  return -1;
}

/**
 * An SVG's text without its <metadata> elements (with what they hold: CDATA sections, comments, other elements).
 * An element that never closes takes the rest of the text with it. Everything else stays as it was, byte for byte.
 */
export function svgWithoutMetadata(text) {
  // Only A to Z made lower case, so each index in `lower` is the same place in `text` (toLowerCase can change a length).
  const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let out = "";
  let i = 0;
  for (;;) {
    const start = openTag(lower, i);
    if (start < 0) return out + text.slice(i);
    out += text.slice(i, start);
    const gt = text.indexOf(">", start);
    if (gt < 0) return out;
    if (text[gt - 1] === "/") {
      i = gt + 1;
      continue;
    }
    // Its end: the matching close tag, past any CDATA section, comment or element of the same name inside it.
    let depth = 1;
    let j = gt + 1;
    while (depth > 0) {
      const lt = text.indexOf("<", j);
      if (lt < 0) return out;
      const skip = text.startsWith("<![CDATA[", lt) ? "]]>" : text.startsWith("<!--", lt) ? "-->" : null;
      if (skip) {
        const e = text.indexOf(skip, lt + 4);
        if (e < 0) return out;
        j = e + skip.length;
      } else if (/^<\/metadata\s*>/.test(lower.slice(lt, lt + 32))) {
        depth--;
        j = text.indexOf(">", lt) + 1;
      } else if (opensAt(lower, lt)) {
        const e = text.indexOf(">", lt);
        if (e < 0) return out;
        if (text[e - 1] !== "/") depth++;
        j = e + 1;
      } else j = lt + 1;
    }
    i = j;
  }
}

/** Is this a read of an SVG result from ComfyUI's /view? */
function svgView(url, init) {
  if (init?.method && init.method.toUpperCase() !== "GET") return false;
  let u;
  try {
    u = new URL(url, "http://127.0.0.1");
  } catch {
    return false;
  }
  return /(^|\/)view$/.test(u.pathname) && /\.svg$/i.test(u.searchParams.get("filename") ?? "");
}

/** A result read from its ComfyUI: an SVG comes without its <metadata> elements; every other answer as it came. */
export async function plainResult(url, res, init) {
  if (!res?.ok || !svgView(url, init)) return res;
  const text = svgWithoutMetadata(await res.text());
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(text, { status: res.status, statusText: res.statusText, headers });
}

/**
 * A graph whose save nodes are told to write no metadata. VideoHelperSuite's save node (VHS_VideoCombine) writes the
 * run's graph and the PC's local time into each clip unless its save_metadata is false, whatever --disable-metadata
 * says. Every such node gets save_metadata false (a format that has no such option ignores it). Nothing else changes.
 */
export function graphWithoutMetadata(graph) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return graph;
  const out = {};
  for (const [id, n] of Object.entries(graph)) {
    out[id] = n && typeof n === "object" && n.class_type === "VHS_VideoCombine" ? { ...n, inputs: { ...(n.inputs ?? {}), save_metadata: false } } : n;
  }
  return out;
}

/** Is this a prompt sent to ComfyUI (a POST to /prompt)? */
function promptPost(url, init) {
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return false;
  try {
    return /(^|\/)prompt$/.test(new URL(url, "http://127.0.0.1").pathname);
  } catch {
    return false;
  }
}

/** A prompt's body, as JSON text, with its graph's save nodes told to write no metadata. Any other body stays as it is. */
export function plainPromptBody(body) {
  if (typeof body !== "string") return body;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object" || !parsed.prompt || typeof parsed.prompt !== "object") return body;
  return JSON.stringify({ ...parsed, prompt: graphWithoutMetadata(parsed.prompt) });
}

/**
 * A fetch to its own ComfyUI: each prompt goes with its save nodes told to write no metadata (plainPromptBody), and
 * result reads go through plainResult.
 */
export const withPlainResults = (fetchFn) => (url, init) => {
  const sent = promptPost(url, init) ? { ...init, body: plainPromptBody(init.body) } : init;
  return fetchFn(url, sent).then((res) => plainResult(url, res, sent));
};
