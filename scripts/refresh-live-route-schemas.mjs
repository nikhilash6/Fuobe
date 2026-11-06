#!/usr/bin/env node
/**
 * Saves the input schemas of the hosted routes Fuobe runs (fal.ai and Replicate) as test fixtures, so
 * tests/provider-conformance-live-routes.test.ts can check the requests Fuobe builds against the providers' own schemas
 * without the network. Only public pages are read (GET, no key): fal's per-endpoint queue OpenAPI and the schema
 * Replicate embeds in each model's API page. Nothing is run or paid for.
 *
 *   node scripts/refresh-live-route-schemas.mjs                       read every endpoint already saved again
 *   node scripts/refresh-live-route-schemas.mjs fal:<endpoint> …      add or read these again (replicate:<owner>/<name>[:<version>])
 *   node scripts/refresh-live-route-schemas.mjs --list <file>         the endpoints in a file, one a line
 *   node scripts/refresh-live-route-schemas.mjs --check               read them and print what changed, without writing
 *
 * The fixtures keep what a request is checked against: types, enums and consts, defaults, limits, required fields, and
 * each field's description (where some limits are stated only in words). Titles, examples and UI hints are left out.
 * The routes not yet run with a live key (src/lib/catalog/hosted-untested.ts) keep one file per endpoint, refreshed by
 * scripts/refresh-provider-schemas.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "tests/fixtures/provider-schemas");
const FILES = { fal: path.join(DIR, "fal/live-routes.json"), replicate: path.join(DIR, "replicate/live-routes.json") };
const UA = "Mozilla/5.0 (Fuobe schema fixtures; GET public docs)";
const TODAY = new Date().toISOString().slice(0, 10);

/** The schema keywords a request is checked against. */
const KEEP = new Set([
  "type", "enum", "const", "default", "nullable", "format", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems", "uniqueItems",
  "required", "properties", "items", "anyOf", "oneOf", "allOf", "additionalProperties", "description",
]);

/** A schema with every $ref inlined (`defs`: the document's components) and only the KEEP keywords. */
function compact(node, defs, seen = new Set()) {
  if (Array.isArray(node)) return node.map((n) => compact(n, defs, seen));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop();
    if (seen.has(name)) return {};
    const target = defs[name];
    if (!target) throw new Error(`unknown $ref ${node.$ref}`);
    const rest = { ...node };
    delete rest.$ref;
    return compact({ ...target, ...rest }, defs, new Set([...seen, name]));
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, compact(s, defs, seen)]));
    else if (k === "description") out[k] = String(v).trim();
    // Values, not schemas: kept as they are.
    else if (k === "default" || k === "enum" || k === "const" || k === "required") out[k] = v;
    else out[k] = typeof v === "object" ? compact(v, defs, seen) : v;
  }
  return out;
}

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json,text/html;q=0.9,*/*;q=0.5" }, redirect: "follow" });
    if (res.ok) return res.text();
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} from ${url}`);
    await new Promise((ok) => setTimeout(ok, 2000 * attempt));
  }
}

/** fal: the per-endpoint queue OpenAPI; the input is the POST body of the endpoint's own path. */
async function falSchema(endpoint) {
  const source = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${endpoint}`;
  const doc = JSON.parse(await get(source));
  const posts = Object.entries(doc.paths ?? {}).filter(([, v]) => v.post);
  const post = posts.find(([p]) => p === `/${endpoint}`) ?? posts[0];
  const ref = post?.[1].post.requestBody?.content?.["application/json"]?.schema?.$ref;
  if (!ref) throw new Error(`no input schema for ${endpoint}`);
  return { source, input: compact({ $ref: ref }, doc.components?.schemas ?? {}) };
}

/** Replicate: the version schema the model's API page embeds (dereferenced); a pinned version's own page. */
async function replicateSchema(slug) {
  const [name, version] = slug.split(":");
  const source = version ? `https://replicate.com/${name}/versions/${version}/api` : `https://replicate.com/${name}/api/schema`;
  const html = await get(source);
  let found;
  const walk = (o, depth = 0) => {
    if (found || !o || typeof o !== "object" || depth > 10) return;
    const v = o.version;
    if (v && typeof v === "object" && v._extras?.dereferenced_openapi_schema && (!version || v.id === version)) found = v;
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      // not JSON: skip
    }
  }
  if (!found) throw new Error(`no version schema on ${source}`);
  const schemas = found._extras.dereferenced_openapi_schema.components.schemas;
  return { source, version: found.id, input: compact(schemas.Input, schemas) };
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { about: "", endpoints: {} };
  }
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const listAt = args.indexOf("--list");
const named = args.filter((a, i) => !a.startsWith("--") && (listAt < 0 || i !== listAt + 1));
if (listAt >= 0) named.push(...fs.readFileSync(args[listAt + 1], "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
const saved = { fal: load(FILES.fal), replicate: load(FILES.replicate) };
const wanted = named.length
  ? named.map((n) => {
      const [provider, ...rest] = n.split(":");
      if (!(provider in FILES)) throw new Error(`name an endpoint as fal:<id> or replicate:<owner>/<name>[:<version>], not ${n}`);
      return { provider, endpoint: rest.join(":") };
    })
  : Object.entries(saved).flatMap(([provider, f]) => Object.keys(f.endpoints).map((endpoint) => ({ provider, endpoint })));

let changed = 0;
let failed = 0;
const queue = [...wanted];
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const { provider, endpoint } = job;
    try {
      const got = provider === "fal" ? await falSchema(endpoint) : await replicateSchema(endpoint);
      const before = saved[provider].endpoints[endpoint];
      const same = before && JSON.stringify(before.input) === JSON.stringify(got.input);
      if (!same) {
        changed++;
        console.log(`${before ? "changed" : "new"}: ${provider}:${endpoint}`);
      }
      if (!check) saved[provider].endpoints[endpoint] = { fetched: same ? before.fetched : TODAY, source: got.source, ...(got.version && { version: got.version }), input: got.input };
    } catch (e) {
      failed++;
      console.log(`failed: ${provider}:${endpoint}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

if (!check) {
  for (const [provider, file] of Object.entries(FILES)) {
    const f = saved[provider];
    const endpoints = Object.fromEntries(Object.entries(f.endpoints).sort(([a], [b]) => a.localeCompare(b)));
    if (!Object.keys(endpoints).length) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const about = `Input schemas of the ${provider === "fal" ? "fal.ai" : "Replicate"} endpoints Fuobe's live hosted routes call, read from the provider's public pages by scripts/refresh-live-route-schemas.mjs. tests/provider-conformance-live-routes.test.ts checks the requests Fuobe builds against them.`;
    // One endpoint a line, so a refresh's diff names the endpoints that changed.
    const lines = Object.entries(endpoints).map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)}`);
    fs.writeFileSync(file, `{\n "about": ${JSON.stringify(about)},\n "endpoints": {\n${lines.join(",\n")}\n }\n}\n`);
  }
}
console.log(`${wanted.length} read, ${changed} ${check ? "differ" : "changed or new"}, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
