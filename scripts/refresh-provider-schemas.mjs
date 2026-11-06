#!/usr/bin/env node
/**
 * Download the providers' own API schemas for the hosted routes that tests/provider-conformance.test.ts checks, into
 * tests/fixtures/provider-schemas/. A provider that changes an endpoint shows up as a diff of these files, and the test
 * then says which request or answer no longer fits.
 *
 * Public GETs only. No key is read or sent, and no model is run:
 *   fal.ai     https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>   (the endpoint's queue OpenAPI)
 *   Replicate  https://replicate.com/<owner>/<model>/api/schema                       (the model page's latest version:
 *              its OpenAPI schema and its example prediction, as the page embeds them)
 *
 * Run:  node scripts/refresh-provider-schemas.mjs                         (every endpoint in index.json)
 *       node scripts/refresh-provider-schemas.mjs --only <endpoint> …     (those only; the rest are kept)
 *       node scripts/refresh-provider-schemas.mjs --add fal:<endpoint> --add replicate:<owner>/<model>
 *
 * Files are written with sorted keys, so a refresh with no change upstream leaves no diff.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "tests/fixtures/provider-schemas");
const INDEX = path.join(DIR, "index.json");
const UNTESTED = path.join(ROOT, "src/lib/catalog/hosted-untested.ts");

const args = process.argv.slice(2);
const flagValues = (flag) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
const only = new Set(args.includes("--only") ? args.slice(args.indexOf("--only") + 1).filter((a) => !a.startsWith("--")) : []);
const adds = flagValues("--add");

/** The file a schema is kept in: the endpoint with each "/" as "__". */
export const fileFor = (provider, endpoint) => path.join(DIR, provider, `${endpoint.replaceAll("/", "__")}.json`);

/** Objects with their keys sorted (arrays keep their order): the same schema always writes the same bytes. */
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
  return v;
}

async function get(url, accept) {
  for (let attempt = 1; ; attempt++) {
    try {
      // No Authorization header: these are public pages.
      const res = await fetch(url, { headers: { accept, "user-agent": "fuobe-schema-refresh" }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { final: true });
      return await res.text();
    } catch (e) {
      if (e.final || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function falSchema(endpoint) {
  const text = await get(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpoint)}`, "application/json");
  const doc = JSON.parse(text);
  if (!doc?.paths?.[`/${endpoint}`]?.post) throw new Error(`fal.ai has no queue submit for ${endpoint}`);
  return doc;
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(decode(s));
    } catch {
      return null;
    }
  }
};

async function replicateSchema(model) {
  const html = await get(`https://replicate.com/${model}/api/schema`, "text/html");
  const blobs = [...html.matchAll(/<script id="react-component-props-[^"]+" type="application\/json">([\s\S]*?)<\/script>/g)].map((m) => parse(m[1])).filter(Boolean);
  const withVersion = blobs.find((b) => b.version?.id && b.version?._extras?.dereferenced_openapi_schema);
  if (!withVersion) throw new Error(`replicate.com/${model}/api/schema shows no version schema`);
  const api = blobs.find((b) => b && typeof b === "object" && "usesVersionlessApi" in b);
  const v = withVersion.version;
  const ex = api?.example;
  return {
    model,
    source: `https://replicate.com/${model}/api/schema`,
    uses_versionless_api: api?.usesVersionlessApi ?? null,
    version_id: v.id,
    version_created_at: v.created_at ?? null,
    openapi_schema: v._extras.dereferenced_openapi_schema,
    example_prediction: ex ? { status: ex.status ?? null, input: ex.input ?? null, output: ex.output ?? null } : null,
  };
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return { fal: [], replicate: [] };
  }
}

async function main() {
  const index = readIndex();
  index.fal ??= [];
  index.replicate ??= [];
  for (const a of adds) {
    const [provider, ...rest] = a.split(":");
    const id = rest.join(":");
    if (!["fal", "replicate"].includes(provider) || !id) throw new Error(`--add takes fal:<endpoint> or replicate:<owner>/<model>, not ${a}`);
    if (!index[provider].includes(id)) index[provider].push(id);
    if (only.size) only.add(id);
  }
  index.fal.sort();
  index.replicate.sort();
  const jobs = [...index.fal.map((e) => ["fal", e]), ...index.replicate.map((e) => ["replicate", e])].filter(([, e]) => !only.size || only.has(e));
  const results = { unchanged: [], updated: [], new: [], failed: [] };
  for (const [provider, endpoint] of jobs) {
    try {
      const doc = provider === "fal" ? await falSchema(endpoint) : await replicateSchema(endpoint);
      const file = fileFor(provider, endpoint);
      const text = `${JSON.stringify(sorted(doc), null, 2)}\n`;
      const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (before !== text) fs.writeFileSync(file, text);
      results[before === null ? "new" : before === text ? "unchanged" : "updated"].push(`${provider}:${endpoint}`);
    } catch (e) {
      results.failed.push(`${provider}:${endpoint} (${e.message})`);
    }
  }
  const about = "The providers' own schemas for tests/provider-conformance.test.ts, written by scripts/refresh-provider-schemas.mjs (public GETs only).";
  fs.writeFileSync(INDEX, `${JSON.stringify({ about, fal: index.fal, replicate: index.replicate }, null, 2)}\n`);
  // Endpoints the untested list names that no schema is kept for (the provider can't be told from the name: --add it).
  const listed = new Set([...index.fal, ...index.replicate]);
  const untested = fs.existsSync(UNTESTED) ? [...fs.readFileSync(UNTESTED, "utf8").matchAll(/^\s*"([a-z0-9.\-]+\/[a-z0-9.\-/]+)",\s*$/gim)].map((m) => m[1]) : [];
  const missing = untested.filter((e) => !listed.has(e));
  for (const [k, list] of Object.entries(results)) if (list.length) console.log(`${k} (${list.length}):\n  ${list.join("\n  ")}`);
  if (missing.length) console.log(`not kept yet (add with --add fal:<endpoint> or --add replicate:<owner>/<model>):\n  ${missing.join("\n  ")}`);
  if (results.failed.length) process.exitCode = 1;
}

await main();
