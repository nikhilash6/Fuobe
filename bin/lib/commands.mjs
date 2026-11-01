// The fuobe commands. Each gets a context (`ctx`) with the parsed options, a REST client for the
// server and the process's streams, so tests can run them without a terminal.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyValue, UsageError } from "./args.mjs";
import { defaultModel, fileInputs, generationRequest, localFiles, voiceSampleProblem, withInputHint } from "./build.mjs";
import { ApiError } from "./client.mjs";
import { configPath, normalizeUrl, readConfig, removeConfig, writeConfig } from "./config.mjs";
import { clip, countOutputs, formatCost, formatDuration, previewText, statusText, table, TERMINAL, timeAgo } from "./format.mjs";
import { findSkillDirs, packSkill, parseSource, skillHead } from "./skills.mjs";

/** Exit codes: 0 done, 1 failed (a generation failed, the server said no), 2 usage, 3 still running at --timeout, 130 stopped with Ctrl+C. */
export const EXIT = { ok: 0, failed: 1, usage: 2, timeout: 3, interrupted: 130 };

const MAX_UPLOAD = 200 * 1024 * 1024;
const UPLOAD_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
};

// ---------------------------------------------------------------------------
// Options shared by generate and estimate

/** @typedef {import("./args.mjs").OptionSpec} OptionSpec */

/** @type {OptionSpec} */
const KIND = { type: "string", choices: ["image", "video", "audio"], value: "kind", describe: "With no --model: the studio whose default model to use (default image)" };
/** @type {OptionSpec} */
const ENGINE = { type: "string", choices: ["open", "cloud"], value: "engine", describe: "Open source (ComfyUI) or cloud; with no --model, picks that engine's default" };

/** @type {Record<string, OptionSpec>} */
export const GEN_OPTIONS = {
  model: { type: "string", short: "m", value: "id", describe: "Model id (fuobe models); default: the studio's own pick" },
  kind: KIND,
  engine: ENGINE,
  op: { type: "string", value: "op", describe: "Operation (t2i, edit, i2v, t2v, tts…), when the inputs leave it open" },
  image: { type: "string", short: "i", multiple: true, value: "file|url", describe: "An image: the one to edit, the start frame, or references (repeat for more)" },
  "end-image": { type: "string", value: "file|url", describe: "End frame (start + end frame video)" },
  mask: { type: "string", value: "file|url", describe: "Inpaint mask" },
  video: { type: "string", multiple: true, value: "file|url", describe: "The video to edit, extend, trim, lip-sync… (two or more: clips to join or reference)" },
  "ref-video": { type: "string", multiple: true, value: "file|url", describe: "Reference clips (reference to video)" },
  audio: { type: "string", multiple: true, value: "file|url", describe: "Audio: a voice to lip-sync, a track to mux, a recording to transcribe" },
  "background-audio": { type: "string", value: "file|url", describe: "A second track mixed under --audio (mux)" },
  "ref-audio": { type: "string", multiple: true, value: "file|url", describe: "Reference audio clips" },
  "voice-audio": { type: "string", multiple: true, value: "file|url", describe: "A voice to clone (text to speech) or change into; a second one for a dialogue's other speaker" },
  aspect: { type: "string", short: "a", value: "ratio", describe: "Aspect ratio, e.g. 16:9, 9:16, 1:1" },
  duration: { type: "number", short: "d", value: "seconds", describe: "Length of a video or audio clip" },
  resolution: { type: "string", short: "r", value: "res", describe: "e.g. 720p, 1080p, 2K" },
  count: { type: "number", short: "n", value: "n", describe: "How many takes (1–8)" },
  seed: { type: "number", value: "n" },
  negative: { type: "string", value: "text", describe: "Negative prompt" },
  look: { type: "string", value: "id", describe: "A Fuobe Soul look (fuobe-soul, fuobe-soul-hd): v1-general, v1-y2k, v2-y2k-studio…" },
  "look-strength": { type: "number", value: "0-1", describe: "How strongly the look's LoRAs apply (default 1)" },
  sound: { type: "boolean", describe: "Native sound on (--no-sound for off), on video models that offer it" },
  enhance: { type: "boolean", describe: "Let Fuobe rewrite the prompt first" },
  voice: { type: "string", value: "id", describe: "Voice id for text to speech" },
  language: { type: "string", value: "lang", describe: "Language to translate or dub into" },
  "source-language": { type: "string", value: "lang", describe: "Spoken language of the source" },
  start: { type: "number", value: "seconds", describe: "Trim: where the kept part starts" },
  end: { type: "number", value: "seconds", describe: "Trim: where the kept part ends" },
  param: { type: "string", short: "p", multiple: true, value: "key=value", describe: "Any other model setting (repeat for more)" },
};

/** @type {Record<string, OptionSpec>} */
const WAIT_OPTIONS = {
  timeout: { type: "number", value: "seconds", describe: "Stop waiting after this long (default 1800; 0 = no limit)" },
  interval: { type: "number", value: "seconds", describe: "How often to check (default 2)" },
};

// ---------------------------------------------------------------------------
// Helpers

const enc = encodeURIComponent;

/** The prompt from the positionals ("-" reads it from stdin). */
async function promptFrom(ctx) {
  const text = ctx.positionals.join(" ");
  if (text !== "-") return text;
  return (await ctx.io.readStdin()).trim();
}

/** A local input that exists, is a file and isn't too big; returns its absolute path. */
function checkFile(ctx, file) {
  const abs = path.resolve(ctx.io.cwd, file);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new UsageError(`Can't find ${file}. Give a file path, an https:// link or a /api/files/… URL.`);
  }
  if (!st.isFile()) throw new UsageError(`${file} isn't a file`);
  if (st.size > MAX_UPLOAD) throw new UsageError(`${file} is ${Math.round(st.size / 1024 / 1024)} MB; Fuobe takes files up to 200 MB`);
  return abs;
}

/** Check every file first, so a missing second one fails before the first (maybe big) one goes up. */
const checkFiles = (ctx, files) => files.forEach((f) => checkFile(ctx, f));

/** Upload a local file through /api/uploads; returns its /api/files/… URL. */
export async function uploadFile(ctx, file) {
  const abs = checkFile(ctx, file);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const type = UPLOAD_TYPES[ext] ?? "application/octet-stream";
  const blob = typeof fs.openAsBlob === "function" ? await fs.openAsBlob(abs, { type }) : new Blob([fs.readFileSync(abs)], { type });
  const form = new FormData();
  form.append("file", blob, path.basename(abs));
  ctx.note(`Uploading ${file}…`);
  const asset = await ctx.client.request("POST", "/api/uploads", { form });
  return asset.url;
}

async function uploadAll(ctx, values) {
  const files = localFiles(fileInputs(values));
  checkFiles(ctx, files);
  const uploaded = new Map();
  for (const file of files) uploaded.set(file, await uploadFile(ctx, file));
  return uploaded;
}

/**
 * The model to use: --model, else the studio default for --kind / --engine (said on stderr). With
 * --voice-audio, a model that clones the sample (a dialogue for two), so none is silently ignored.
 */
async function modelFor(ctx) {
  const v = ctx.values;
  const inputs = fileInputs(v);
  const voices = inputs.filter(([slot]) => slot === "voiceAudio" || slot === "voiceAudio2").length;
  if (v.model) {
    if (voices) {
      const list = await ctx.client.request("GET", "/api/models", { query: { q: v.model, hidden: 1 } });
      const problem = voiceSampleProblem(list.items?.find((m) => m.id === v.model), voices, list.defaults);
      if (problem) throw new UsageError(problem, ctx.command);
    }
    return v.model;
  }
  const list = await ctx.client.request("GET", "/api/models", { query: { kind: v.kind ?? "image" } });
  const id = defaultModel(list, {
    kind: v.kind,
    engine: v.engine,
    op: v.op,
    hasImages: inputs.some(([slot]) => slot === "images"),
    // With --kind audio, voice samples are the voices a cloning model speaks in.
    hasMedia: inputs.some(([slot]) => !["images", "endImage", "mask", ...(v.kind === "audio" ? ["voiceAudio", "voiceAudio2"] : [])].includes(slot)),
    voices: v.kind === "audio" ? voices : 0,
  });
  const name = list.items?.find((m) => m.id === id)?.name;
  ctx.note(`Using ${name ? `${name} (${id})` : id}. Pick another with --model; fuobe models lists them.`);
  return id;
}

function checkEngine(ctx, preview) {
  const want = ctx.values.engine;
  if (want && ctx.values.model && preview.engine !== want) {
    throw new UsageError(
      `${preview.modelName} is ${preview.engine === "open" ? "an open-source" : "a cloud"} model, but you asked for --engine ${want}. Pick a ${want === "open" ? "open-source" : "cloud"} model (fuobe models --engine ${want}) or leave out --engine.`,
      ctx.command,
    );
  }
}

/** POST /api/generations, or its `?preview=1`; a request the planner refuses says which options fix it. */
async function postGeneration(ctx, body, { preview = false } = {}) {
  try {
    return await ctx.client.request("POST", "/api/generations", { json: body, ...(preview && { query: { preview: 1 } }) });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 422)) throw e;
    const ids = /^Unknown model /.test(e.message) ? await ctx.client.request("GET", "/api/models", { query: { hidden: 1 } }).then((r) => r.items.map((m) => m.id), () => []) : [];
    throw new ApiError(withInputHint(e.message, ids), e.status);
  }
}

const absolute = (ctx, url) => ctx.client.resolve(url);

/**
 * File name for output `i` of a generation: <id>.<ext>, or <id>-<n>.<ext> when it has several. The
 * id and extension come from the server, so anything but letters, digits, - and _ is replaced: a
 * name can't climb out of --out or hide as a dot-file.
 */
export function outputName(g, i) {
  const ext = /^\.[a-z\d]{1,10}$/i.exec(path.extname(new URL(g.outputs[i].url, "http://x").pathname))?.[0] ?? ".bin";
  const id = String(g.id ?? "").replace(/[^\w-]/g, "_") || "output";
  return `${id}${g.outputs.length > 1 ? `-${i + 1}` : ""}${ext}`;
}

const megabytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Print finished generations: outputs as full URLs, text results inline. */
function report(ctx, gens) {
  for (const g of gens) {
    const took = g.completedAt ? ` in ${formatDuration(g.completedAt - g.createdAt)}` : "";
    const demo = g.provider === "mock" ? " (demo)" : "";
    if (g.status === "succeeded") {
      ctx.print(`Done ${g.id} · ${g.modelName ?? g.modelId} · ${countOutputs(g.outputs)}${took}${demo}`);
      for (const o of g.outputs) {
        ctx.print(`  ${absolute(ctx, o.url)}`);
        if (typeof o.text === "string") ctx.print(o.text.length > 4000 ? `${o.text.slice(0, 4000)}\n  … ${o.text.length} characters in all; the whole text is at the URL above` : o.text);
      }
    } else if (g.status === "failed") ctx.print(`Failed ${g.id} · ${g.modelName ?? g.modelId}: ${g.error ?? "no reason given"}`);
    else if (g.status === "canceled") ctx.print(`Canceled ${g.id} · ${g.modelName ?? g.modelId}`);
    else ctx.print(`${g.id} · ${statusText(g)} · ${g.modelName ?? g.modelId}${g.message && !g.message.toLowerCase().startsWith(g.status) ? ` · ${g.message}` : ""}`);
  }
}

/**
 * Poll generations until every one is finished (or the timeout, or Ctrl+C). Shows progress on a
 * terminal; prints a line per change otherwise (not with --json).
 * @returns {Promise<{ gens: any[], stopped?: "timeout" | "interrupted" }>}
 */
export async function waitFor(ctx, ids) {
  const v = ctx.values;
  const timeout = (v.timeout ?? 1800) * 1000;
  const interval = Math.max(0.2, v.interval ?? 2) * 1000;
  const started = ctx.io.now();
  const gens = new Map();
  const seen = new Map();
  // Ctrl+C ends the pending sleep too, so the process exits at once (not after --interval).
  const pause = new AbortController();
  const stopped = new Promise((resolve) => pause.signal.addEventListener("abort", resolve, { once: true }));
  const off = ctx.io.onInterrupt(() => pause.abort());
  const live = ctx.io.stderrIsTTY && !v.json;
  try {
    for (;;) {
      for (const id of ids) if (!TERMINAL.has(gens.get(id)?.status)) gens.set(id, await getGeneration(ctx, id));
      const all = ids.map((id) => gens.get(id));
      const done = all.filter((g) => TERMINAL.has(g.status)).length;
      if (live) {
        const one = all.length === 1 ? statusText(all[0]) : `${done} of ${all.length} done`;
        ctx.io.stderr.write(`\r\x1b[2K${one} · ${formatDuration(ctx.io.now() - started)}`);
      } else if (!v.json) {
        for (const g of all) {
          if (seen.get(g.id) !== g.status) ctx.note(`${g.id} ${g.status}${g.status === "failed" && g.error ? `: ${g.error}` : ""}`);
          seen.set(g.id, g.status);
        }
      }
      if (done === all.length) return { gens: all };
      if (timeout > 0 && ctx.io.now() - started >= timeout) return { gens: all, stopped: "timeout" };
      await Promise.race([ctx.io.sleep(interval, pause.signal), stopped]);
      if (pause.signal.aborted) return { gens: all, stopped: "interrupted" };
    }
  } finally {
    off();
    if (live) ctx.io.stderr.write("\r\x1b[2K");
  }
}

/** Save every output of the finished generations into `dir`. */
async function saveOutputs(ctx, gens, dir) {
  const files = [];
  const root = path.resolve(ctx.io.cwd, dir);
  for (const g of gens) {
    if (g.status !== "succeeded") continue;
    for (let i = 0; i < g.outputs.length; i++) {
      const dest = path.join(root, outputName(g, i));
      if (path.dirname(dest) !== root) throw new ApiError(`The server sent an output name (${g.id}) that would land outside ${dir}; nothing was saved for it.`);
      const bytes = await ctx.client.download(g.outputs[i].url, dest);
      files.push({ id: g.id, url: absolute(ctx, g.outputs[i].url), path: dest, bytes });
      if (!ctx.values.json) ctx.print(`Saved ${path.relative(ctx.io.cwd, dest) || dest} (${megabytes(bytes)})`);
    }
  }
  return files;
}

/** Wait, report, download: shared by generate --wait, wait and download. Returns the exit code. */
async function finish(ctx, ids, { download }) {
  const { gens, stopped } = await waitFor(ctx, ids);
  const files = download && !stopped ? await saveOutputs(ctx, gens, ctx.values.out ?? ".") : [];
  if (ctx.values.json) ctx.json({ items: gens, ...(download && { files }), ...(stopped && { stopped }) });
  else if (!download || stopped) report(ctx, gens);
  else for (const g of gens.filter((x) => x.status !== "succeeded")) report(ctx, [g]);
  if (stopped === "interrupted") {
    ctx.note(`Stopped waiting. ${ids.length === 1 ? "It keeps" : "They keep"} running on the server: fuobe wait ${ids.join(" ")}`);
    return EXIT.interrupted;
  }
  if (stopped === "timeout") {
    ctx.note(`Still running after ${formatDuration((ctx.values.timeout ?? 1800) * 1000)}. Check again with: fuobe wait ${ids.join(" ")}`);
    return EXIT.timeout;
  }
  return gens.every((g) => g.status === "succeeded") ? EXIT.ok : EXIT.failed;
}

/** One generation by id; an unknown id says so in words. */
async function getGeneration(ctx, id) {
  try {
    const g = await ctx.client.request("GET", `/api/generations/${enc(id)}`);
    if (g?.id) return g;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  throw new ApiError(`There's no generation ${id} on ${ctx.target.url} (it may be in the Trash). fuobe list shows recent ones.`, 404);
}

function needIds(ctx, what = "a generation id") {
  if (!ctx.positionals.length) throw new UsageError(`Give ${what} (fuobe list shows recent ones)`, ctx.command);
  return ctx.positionals;
}

// ---------------------------------------------------------------------------
// login / logout / status

async function login(ctx) {
  const { io, values: v } = ctx;
  const file = configPath(io.env, io.home);
  let saved = {};
  try {
    saved = readConfig(file);
  } catch {
    ctx.note(`${file} isn't valid JSON; signing in replaces it.`);
  }
  let url = v.url ?? io.env.FUOBE_URL ?? (io.stdinIsTTY ? await io.ask(`Fuobe server [${saved.url ?? "http://localhost:3000"}]: `) : "") ?? "";
  url = normalizeUrl(url.trim() || saved.url || "http://localhost:3000");
  // Reachable, and does it ask for a token? (A 401 answers both.)
  let needsToken = false;
  try {
    const probe = await ctx.connect({ url }).request("GET", "/api/generations", { query: { limit: 1 } });
    if (!Array.isArray(probe?.items)) throw new ApiError(`${url} answered, but it doesn't look like a Fuobe server. Check the address.`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    needsToken = true;
  }
  let token = v.token ?? io.env.FUOBE_TOKEN;
  if (!token && needsToken) {
    if (!io.stdinIsTTY) throw new ApiError(`Fuobe at ${url} has a password. Pass --token fuobe_… (create one in Settings → Security → API tokens, ${url}/settings#security).`, 401);
    ctx.note(`This Fuobe has a password. Create an API token in Settings → Security → API tokens (${url}/settings#security) and paste it here.`);
    token = (await io.ask("API token: ", { hidden: true })).trim();
  }
  if (token && !/^fuobe_[\w-]+$/.test(token)) ctx.note("That doesn't look like a Fuobe token (they start with fuobe_), but trying it anyway.");
  if (token) await ctx.connect({ url, token }).request("GET", "/api/generations", { query: { limit: 1 } });
  writeConfig(file, { url, ...(token && { token }) });
  if (v.json) return ctx.json({ url, token: !!token, needsToken, config: file });
  ctx.print(`Signed in to ${url}${token ? " with an API token" : needsToken ? "" : " (it has no password, so no token is needed)"}.`);
  ctx.print(`Saved to ${file} (readable by you only). Try: fuobe models --kind image`);
  return EXIT.ok;
}

async function logout(ctx) {
  const file = configPath(ctx.io.env, ctx.io.home);
  const removed = removeConfig(file);
  if (ctx.values.json) return ctx.json({ removed, config: file });
  ctx.print(removed ? `Removed ${file}.` : "You weren't signed in (no saved config).");
  if (ctx.io.env.FUOBE_TOKEN) ctx.note("FUOBE_TOKEN is still set in your environment.");
  return EXIT.ok;
}

async function status(ctx) {
  if (ctx.positionals.length) {
    const gens = [];
    for (const id of ctx.positionals) gens.push(await getGeneration(ctx, id));
    if (ctx.values.json) ctx.json(gens.length === 1 ? gens[0] : { items: gens });
    else report(ctx, gens);
    return gens.some((g) => g.status === "failed" || g.status === "canceled") ? EXIT.failed : EXIT.ok;
  }
  const s = await ctx.client.request("GET", "/api/status");
  // Reads need the token too once a password is set: this says whether ours works.
  await ctx.client.request("GET", "/api/generations", { query: { limit: 1 } });
  const t = ctx.target;
  if (ctx.values.json) return ctx.json({ url: t.url, urlFrom: t.urlFrom, token: !!t.token, tokenFrom: t.tokenFrom ?? null, ...(t.savedTokenFor && { savedTokenFor: t.savedTokenFor }), ...s });
  const providers = Object.values(s.providers ?? {})
    .filter((p) => p.label)
    .map((p) => `${p.label} ${p.configured ? "✓" : "–"}`);
  ctx.print(`Fuobe at ${t.url}${t.urlFrom === "default" ? "" : ` (from ${t.urlFrom})`}`);
  ctx.print(`Engine mode: ${s.engineMode} · Placeholder results: ${s.demoMode === "on" ? "on" : "off"} · Preferred cloud: ${s.cloudProvider}`);
  ctx.print(`Providers: ${providers.join(", ")}`);
  // Older servers don't say which local model server they use.
  const local = s.llm?.local;
  if (s.llm) {
    // The servers it looked at: the pinned one, or all of them in Automatic.
    const names = (s.llm.detected ?? []).map((d) => d.label);
    const tried = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "Ollama, LM Studio or Unsloth Studio");
    ctx.print(`Local LLM: ${local ? `${local.label} at ${local.url}${local.model ? ` · ${local.model}` : ""}` : (s.llm.problem ?? `none answering (${tried})`)}`);
  }
  ctx.print(
    t.token
      ? `API token: accepted (from ${t.tokenFrom})`
      : `API token: none (this Fuobe has no password)${t.savedTokenFor ? `. The saved one is for ${t.savedTokenFor}, so it isn't sent here` : ""}`,
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// models / estimate / generate / wait / download / list / cancel / upload

async function models(ctx) {
  const v = ctx.values;
  const res = await ctx.client.request("GET", "/api/models", { query: { kind: v.kind, engine: v.engine, op: v.op, q: v.search ?? (ctx.positionals.join(" ") || undefined), hidden: v.hidden ? 1 : undefined } });
  const items = v.limit ? res.items.slice(0, v.limit) : res.items;
  if (v.json) return ctx.json({ ...res, items });
  if (!items.length) {
    ctx.print(`No models match.${res.engineMode !== "both" ? ` This Fuobe runs ${res.engineMode === "open" ? "open-source" : "cloud"} models only (Settings → Engine mode).` : ""}`);
    return EXIT.ok;
  }
  // How a run goes today (Settings → placeholder results decide with the providers); an older server only says `connected`.
  const runs = (m) => m.runs ?? (m.connected ? "real" : "demo");
  const mark = { real: "", demo: " (demo)", refused: " (not set up)" };
  // A Fuobe Original runs on both engines (open+cloud); --engine lists it as that engine's model.
  const rows = items.map((m) => [m.id, m.name, (m.engines ?? [m.engine]).map((e) => (e === "open" ? "open" : "cloud")).join("+"), `${m.price}${mark[runs(m)] ?? ""}`, m.ops.join(", ")]);
  ctx.print(table(["ID", "NAME", "ENGINE", "PRICE", "DOES"], rows, ctx.io.columns));
  const count = (r) => items.filter((m) => runs(m) === r).length;
  const notes = [`${items.length} model${items.length === 1 ? "" : "s"}${items.length < res.items.length ? ` of ${res.items.length}` : ""}.`];
  if (res.demoMode === "on") notes.push("Placeholder results are on (Settings → Placeholder results): every run returns placeholder media, for free.");
  else if (count("demo")) notes.push("Those marked (demo) return placeholder media, for free.");
  if (count("refused")) notes.push("Those marked (not set up) need their provider set up in Settings first.");
  ctx.note(notes.join(" "));
  return EXIT.ok;
}

/** Local files aren't uploaded to price a run (or to check the options): a placeholder URL stands in for each. */
const standIns = (values) => new Map(localFiles(fileInputs(values)).map((f) => [f, `/api/files/uploads/estimate/${path.basename(f)}`]));

async function estimate(ctx) {
  const prompt = await promptFrom(ctx);
  checkFiles(ctx, localFiles(fileInputs(ctx.values)));
  const modelId = await modelFor(ctx);
  const body = generationRequest({ prompt, modelId, values: ctx.values, uploaded: standIns(ctx.values) });
  const p = await postGeneration(ctx, body, { preview: true });
  checkEngine(ctx, p);
  if (ctx.values.json) return ctx.json(p);
  ctx.print(previewText(p));
  return EXIT.ok;
}

async function generate(ctx) {
  const v = ctx.values;
  const prompt = await promptFrom(ctx);
  checkFiles(ctx, localFiles(fileInputs(v)));
  const modelId = await modelFor(ctx);
  // Built with stand-ins first, so a bad option or a missing input fails before anything is uploaded.
  const draft = generationRequest({ prompt, modelId, values: v, uploaded: standIns(v) });
  if ((v.engine && v.model) || localFiles(fileInputs(v)).length) checkEngine(ctx, await postGeneration(ctx, draft, { preview: true }));
  const uploaded = await uploadAll(ctx, v);
  const { items } = await postGeneration(ctx, generationRequest({ prompt, modelId, values: v, uploaded }));
  const ids = items.map((g) => g.id);
  if (v.wait || v.out) {
    if (!v.json) ctx.note(`Started ${ids.length === 1 ? ids[0] : `${ids.length} jobs`} on ${items[0]?.modelName ?? modelId}${items[0]?.provider === "mock" ? " (a demo: placeholder media, free)" : ""}.`);
    return finish(ctx, ids, { download: !!v.out });
  }
  if (v.json) return ctx.json({ items });
  const g = items[0];
  ctx.print(`Started ${ids.join(" ")} on ${g?.modelName ?? modelId}${g?.provider === "mock" ? " (a demo: placeholder media, free)" : ""}${g?.costUsd ? `, about ${formatCost(g.costUsd * items.length)}` : ""}.`);
  ctx.print(`Wait for it: fuobe wait ${ids.join(" ")}   Save it: fuobe download ${ids.join(" ")} --out .`);
  return EXIT.ok;
}

async function wait(ctx) {
  return finish(ctx, needIds(ctx), { download: !!ctx.values.out });
}

async function download(ctx) {
  const ids = needIds(ctx);
  if (ctx.values.wait === false) {
    const gens = [];
    for (const id of ids) gens.push(await getGeneration(ctx, id));
    const pending = gens.filter((g) => !TERMINAL.has(g.status));
    if (pending.length) throw new ApiError(`${pending.map((g) => g.id).join(", ")} ${pending.length === 1 ? "isn't" : "aren't"} finished yet (${pending.map(statusText).join(", ")}). Leave out --no-wait to wait for ${pending.length === 1 ? "it" : "them"}.`);
    const files = await saveOutputs(ctx, gens, ctx.values.out ?? ".");
    if (ctx.values.json) ctx.json({ items: gens, files });
    else report(ctx, gens.filter((g) => g.status !== "succeeded"));
    return gens.every((g) => g.status === "succeeded") ? EXIT.ok : EXIT.failed;
  }
  return finish(ctx, ids, { download: true });
}

async function list(ctx) {
  const v = ctx.values;
  const { items } = await ctx.client.request("GET", "/api/generations", { query: { kind: v.kind, limit: v.limit ?? 20, statuses: v.status, q: v.search, models: v.model } });
  if (v.json) return ctx.json({ items });
  if (!items.length) {
    ctx.print("Nothing yet. Try: fuobe generate \"a red fox in the snow\" --wait");
    return EXIT.ok;
  }
  const now = ctx.io.now();
  ctx.print(table(["ID", "STATUS", "KIND", "MODEL", "CREATED", "PROMPT"], items.map((g) => [g.id, statusText(g), g.kind, g.modelName ?? g.modelId, timeAgo(g.createdAt, now), g.prompt ?? g.request?.title ?? ""]), ctx.io.columns));
  return EXIT.ok;
}

async function cancel(ctx) {
  const gens = [];
  for (const id of needIds(ctx)) {
    await getGeneration(ctx, id);
    gens.push(await ctx.client.request("POST", `/api/generations/${enc(id)}/cancel`));
  }
  if (ctx.values.json) return ctx.json({ items: gens });
  for (const g of gens) ctx.print(`${g.id} · ${statusText(g)}`);
  return EXIT.ok;
}

async function upload(ctx) {
  const files = needIds(ctx, "a file to upload");
  checkFiles(ctx, files);
  const urls = [];
  for (const f of files) urls.push({ file: f, url: await uploadFile(ctx, f) });
  if (ctx.values.json) return ctx.json({ items: urls });
  for (const u of urls) ctx.print(u.url);
  ctx.note("Use these URLs as inputs: --image, --video, --audio, or a tool's arguments.");
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// skills

async function skillsList(ctx) {
  const { items } = await ctx.client.request("GET", "/api/assist/skills");
  if (ctx.values.json) return ctx.json({ items });
  ctx.print(table(["NAME", "ON", "SOURCE", "TITLE"], items.map((s) => [s.name, s.enabled ? "on" : "off", s.source === "builtin" ? "built-in" : "yours", s.title]), ctx.io.columns));
  return EXIT.ok;
}

async function skillsShow(ctx, name) {
  const res = await ctx.client.raw("GET", `/api/assist/skills/${enc(name)}/download`);
  const md = await res.text();
  if (ctx.values.json) return ctx.json({ name, markdown: md });
  ctx.io.stdout.write(md.endsWith("\n") ? md : `${md}\n`);
  return EXIT.ok;
}

async function skillsToggle(ctx, name, enabled) {
  const s = await ctx.client.request("PATCH", `/api/assist/skills/${enc(name)}`, { json: { enabled } });
  if (ctx.values.json) return ctx.json(s);
  ctx.print(`/${s.name} is ${s.enabled ? "on: Assist and MCP clients can use it" : "off"}.`);
  return EXIT.ok;
}

/** Upload one packed or single-file skill; returns a result line (ok or the server's reason). */
async function sendSkill(ctx, fileName, data) {
  const form = new FormData();
  form.append("file", new Blob([data], { type: fileName.endsWith(".md") ? "text/markdown" : "application/zip" }), fileName);
  try {
    const r = await ctx.client.request("POST", "/api/assist/skills/upload", { form, query: { replace: ctx.values.replace ? 1 : undefined } });
    return { ok: true, name: r.skill.name, title: r.skill.title, replaced: r.replaced, skipped: r.skipped ?? [] };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status === 401 || e.status === undefined) throw e;
    const hint = e.status === 409 && /already have/.test(e.message) ? " (add --replace to overwrite it)" : "";
    return { ok: false, file: fileName, error: `${e.message}${hint}` };
  }
}

/** Clone a repository (shallow) into a temporary folder; the caller removes it. */
function clone(ctx, src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-skills-"));
  ctx.note(`Cloning ${src.url}${src.ref ? ` (${src.ref})` : ""}…`);
  const args = ["clone", "--depth", "1", "--quiet", ...(src.ref ? ["--branch", src.ref] : []), "--", src.url, dir];
  const r = spawnSync("git", args, { stdio: ["ignore", "ignore", "pipe"], env: { ...ctx.io.env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8" });
  if (r.error?.code === "ENOENT") {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new ApiError("git isn't installed. Download the skill as a .zip and run: fuobe skills add <file.zip>");
  }
  if (r.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    const why = (r.stderr || "").trim().split("\n").pop() || `git exited with ${r.status}`;
    // GitHub asks for a login when a repository doesn't exist (or is private).
    if (/could not read Username|Authentication failed|Repository not found|terminal prompts disabled/i.test(why)) {
      throw new ApiError(`Couldn't clone ${src.url}: it doesn't exist, or it's private. Check the name, or download the skill as a .zip and run: fuobe skills add <file.zip>`);
    }
    if (src.ref && /Remote branch .* not found/i.test(why)) throw new ApiError(`${src.url} has no branch or tag ${src.ref}`);
    throw new ApiError(`Couldn't clone ${src.url}: ${why}`);
  }
  return dir;
}

async function skillsAdd(ctx, source) {
  const stat = (p) => {
    try {
      return fs.statSync(path.resolve(ctx.io.cwd, p));
    } catch {
      return null;
    }
  };
  const src = parseSource(source, stat);
  const wanted = new Set(ctx.values.skill ?? []);
  const results = [];
  let temp = null;
  try {
    if (src.type === "markdown" || src.type === "archive") {
      const file = path.resolve(ctx.io.cwd, src.path);
      results.push(await sendSkill(ctx, src.type === "markdown" ? "SKILL.md" : path.basename(file), fs.readFileSync(file)));
    } else if (src.type === "link") {
      ctx.note(`Downloading ${src.url}…`);
      const res = await ctx.io.fetch(src.url);
      if (!res.ok) throw new ApiError(`Couldn't download ${src.url} (HTTP ${res.status})`);
      const name = /\.md(\?|$)/i.test(src.url) ? "SKILL.md" : path.basename(new URL(src.url).pathname);
      results.push(await sendSkill(ctx, name, Buffer.from(await res.arrayBuffer())));
    } else {
      let root = src.type === "dir" ? path.resolve(ctx.io.cwd, src.path) : (temp = clone(ctx, src));
      if (src.type === "git" && src.subpath) root = path.join(root, src.subpath);
      const dirs = findSkillDirs(root).filter((d) => {
        const head = skillHead(fs.readFileSync(path.join(d, "SKILL.md"), "utf8"));
        const name = head.name ?? path.basename(d);
        return wanted.size ? wanted.has(name) || wanted.has(path.basename(d)) : !head.internal;
      });
      if (!dirs.length) throw new ApiError(wanted.size ? `None of ${[...wanted].join(", ")} is in ${source}.` : `No SKILL.md found in ${source}.`);
      for (const d of dirs) {
        const packed = packSkill(d);
        const r = await sendSkill(ctx, `${path.basename(d)}.zip`, packed.zip);
        results.push({ ...r, ...(r.ok ? {} : { file: path.relative(root, d) || path.basename(d) }), skipped: [...new Set([...(r.skipped ?? []), ...packed.skipped])] });
      }
    }
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
  if (ctx.values.json) ctx.json({ items: results });
  else {
    for (const r of results) {
      if (r.ok) ctx.print(`${r.replaced ? "Replaced" : "Added"} /${r.name} · ${r.title}${r.skipped.length ? ` (left out: ${r.skipped.join(", ")})` : ""}`);
      else ctx.print(`Skipped ${r.file}: ${r.error}`);
    }
    if (results.some((r) => r.ok)) ctx.note("Type /name in Assist to use one; MCP clients get them as prompts.");
  }
  return results.some((r) => r.ok) ? EXIT.ok : EXIT.failed;
}

async function skills(ctx) {
  const [sub, ...rest] = ctx.positionals;
  const arg = (what) => {
    if (!rest[0]) throw new UsageError(`fuobe skills ${sub} needs ${what}`, "skills");
    return rest[0];
  };
  switch (sub ?? "list") {
    case "list":
    case "ls":
      return skillsList(ctx);
    case "show":
      return skillsShow(ctx, arg("a skill name"));
    case "add":
      return skillsAdd(ctx, arg("a SKILL.md, a .zip / .skill file, a folder, owner/repo or a git URL"));
    case "enable":
      return skillsToggle(ctx, arg("a skill name"), true);
    case "disable":
      return skillsToggle(ctx, arg("a skill name"), false);
    default:
      throw new UsageError(`Unknown skills command “${sub}”: use list, show, add, enable or disable`, "skills");
  }
}

// ---------------------------------------------------------------------------
// MCP: tools, tool, mcp

async function rpc(ctx, method, params) {
  const res = await ctx.client.request("POST", "/api/mcp", { json: { jsonrpc: "2.0", id: 1, method, params } });
  if (res?.error) throw new ApiError(res.error.message ?? "The MCP call failed");
  return res.result;
}

async function tools(ctx) {
  const { tools: list } = await rpc(ctx, "tools/list", {});
  if (ctx.values.json) return ctx.json({ items: list });
  ctx.print(table(["TOOL", "WHAT IT DOES"], list.map((t) => [t.name, t.description.split(/(?<=\.)\s/)[0]]), ctx.io.columns));
  ctx.note('Run one with: fuobe tool <name> \'{"key": "value"}\' (or --arg key=value). fuobe tool <name> --schema shows its arguments.');
  return EXIT.ok;
}

async function tool(ctx) {
  const [name, json] = ctx.positionals;
  if (!name) throw new UsageError("Name the tool (fuobe tools lists them)", "tool");
  if (ctx.values.schema) {
    const t = (await rpc(ctx, "tools/list", {})).tools.find((x) => x.name === name);
    if (!t) throw new UsageError(`No tool called ${name} (fuobe tools lists them)`, "tool");
    if (ctx.values.json) return ctx.json(t);
    ctx.print(t.description);
    ctx.print(JSON.stringify(t.inputSchema, null, 2));
    return EXIT.ok;
  }
  let args = {};
  if (json) {
    const text = json === "-" ? await ctx.io.readStdin() : json;
    try {
      args = JSON.parse(text);
    } catch {
      throw new UsageError(`The arguments aren't valid JSON: ${clip(text, 60)}`, "tool");
    }
  }
  for (const pair of ctx.values.arg ?? []) {
    const [k, val] = keyValue(pair, "--arg");
    args[k] = val;
  }
  const r = await rpc(ctx, "tools/call", { name, arguments: args });
  const texts = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
  if (r.isError) throw new ApiError(toolFailure(name, texts.join("\n")));
  if (ctx.values.json) ctx.json(r.structuredContent ?? (texts.length === 1 ? parsed(texts[0]) : r));
  else
    for (const t of texts) {
      const p = parsed(t);
      ctx.print(typeof p === "string" ? p : JSON.stringify(p, null, 2));
    }
  return EXIT.ok;
}

/**
 * Why a tool call failed, in words. A failed argument check comes back as a list of {path, message}
 * ("jobs.0.model_id: Required."), a priced plan as {jobs: [{error}]}, anything else as its text.
 */
export function toolFailure(name, text) {
  const p = parsed(text);
  if (Array.isArray(p) && p.length && p.every((i) => i && typeof i.message === "string")) {
    const issues = p.map((i) => `${Array.isArray(i.path) && i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}.`).join(" ");
    return `${name} needs other arguments: ${issues} (fuobe tool ${name} --schema lists them)`;
  }
  const errors = p && typeof p === "object" ? [p.error, ...(Array.isArray(p.jobs) ? p.jobs.map((j, i) => j?.error && `job ${i + 1}: ${j.error}`) : [])].filter((e) => typeof e === "string" && e) : [];
  return `${name} failed: ${errors.length ? errors.join("; ") : text.trim() || "no reason given"}`;
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The command that connects Claude Code (and the JSON other MCP clients take). */
export function mcpSetup(target) {
  const endpoint = `${target.url}/api/mcp`;
  const header = target.token ? ` --header "Authorization: Bearer ${target.token}"` : "";
  return {
    endpoint,
    command: `claude mcp add --transport http fuobe ${endpoint}${header}`,
    config: { mcpServers: { fuobe: { type: "http", url: endpoint, ...(target.token && { headers: { Authorization: `Bearer ${target.token}` } }) } } },
  };
}

async function mcp(ctx) {
  const setup = mcpSetup(ctx.target);
  if (ctx.values.json) return ctx.json(setup);
  ctx.print(setup.command);
  ctx.note(`\nOther MCP clients (Claude Desktop, Cursor, Codex…) take this server entry:\n${JSON.stringify(setup.config, null, 2)}`);
  if (ctx.target.token) ctx.note("These lines include your API token: keep them out of shared places.");
  else if (ctx.target.savedTokenFor)
    ctx.note(`No token in these lines: the one "fuobe login" saved is for ${ctx.target.savedTokenFor}. If ${ctx.target.url} has a password, add --token fuobe_… for it.`);
  return EXIT.ok;
}

// ---------------------------------------------------------------------------

/**
 * @typedef {object} Command
 * @property {string} summary
 * @property {string} usage
 * @property {Record<string, OptionSpec>} [options]
 * @property {string[]} [examples]
 * @property {true} [ownConfig] reads the saved config itself (login, logout), so a broken one doesn't stop it
 * @property {true} [passthrough] takes its arguments as they are (eval hands them to the harness's own parser)
 * @property {(ctx: any) => Promise<number | void>} run
 */

// ---------------------------------------------------------------------------
// eval

/** The evaluation harness (scripts/eval), which lives in the Fuobe checkout next to this CLI. */
async function evalHarness(ctx) {
  const entry = new URL("../../scripts/eval/eval.mjs", import.meta.url);
  if (!fs.existsSync(entry)) throw new ApiError("fuobe eval runs from a Fuobe checkout: scripts/eval isn't next to this CLI (clone the repo and run it there).");
  const { main: harness } = await import(entry.href);
  // The harness finds its server the way this CLI does (--url / --token, FUOBE_URL / FUOBE_TOKEN, then the
  // saved config, from the same home), so the saved token still rides only to the server it was saved for.
  // Handing it over as FUOBE_TOKEN would send it to whatever server a later --url names.
  return harness(ctx.positionals, { stdout: ctx.io.stdout, stderr: ctx.io.stderr, env: ctx.io.env, home: ctx.io.home, fetch: ctx.io.fetch });
}

/** @type {Record<string, Command>} */
export const COMMANDS = {
  login: {
    summary: "Save the server address and API token",
    usage: "fuobe login [--url <url>] [--token <token>]",
    examples: ["fuobe login", "fuobe login --url https://studio.example.com --token fuobe_…"],
    ownConfig: true,
    run: login,
  },
  logout: { summary: "Forget the saved address and token", usage: "fuobe logout", ownConfig: true, run: logout },
  status: {
    summary: "The server (engine, providers, sign-in), or the state of generations",
    usage: "fuobe status [<id>…]",
    examples: ["fuobe status", "fuobe status V1StGXR8_Z5j"],
    run: status,
  },
  models: {
    summary: "List the models you can run",
    usage: "fuobe models [--kind <kind>] [--engine open|cloud] [--search <words>]",
    options: {
      kind: { type: "string", short: "k", choices: ["image", "video", "audio", "text", "model3d"], describe: "What it makes" },
      engine: { type: "string", short: "e", choices: ["open", "cloud"], describe: "Open source (ComfyUI on your GPU) or cloud (paid APIs)" },
      search: { type: "string", short: "s", value: "words", describe: "Words that must all match (name, vendor, what it does, id)" },
      op: { type: "string", value: "op", describe: "Only models that run this operation (t2i, i2v, tts…)" },
      hidden: { type: "boolean", describe: "Include the helper models studios use behind the scenes" },
      limit: { type: "number", value: "n", describe: "Show at most n" },
    },
    examples: ["fuobe models --kind video --engine open", "fuobe models --search kling", "fuobe models --op tts --json"],
    run: models,
  },
  estimate: {
    summary: "Price a generation without running it",
    usage: 'fuobe estimate "<prompt>" [--model <id>] [generate options]',
    options: GEN_OPTIONS,
    examples: ['fuobe estimate "a fox in the snow" --model nano-banana-pro --count 4', 'fuobe estimate "slow push-in" --model kling-3 --image still.png --duration 10'],
    run: estimate,
  },
  generate: {
    summary: "Make images, video, audio, 3D or text",
    usage: 'fuobe generate "<prompt>" [--model <id>] [--image <file|url>]… [--wait] [--out <dir>]',
    options: {
      ...GEN_OPTIONS,
      wait: { type: "boolean", short: "w", describe: "Wait until it's done and print the results" },
      out: { type: "string", short: "o", value: "dir", describe: "Wait, then save the outputs here" },
      ...WAIT_OPTIONS,
    },
    examples: [
      'fuobe generate "a red fox in fresh snow, golden hour" --wait',
      'fuobe generate "she turns and smiles" --model kling-3 --image portrait.jpg --aspect 9:16 --duration 5 --out .',
      'fuobe generate "a cosy cabin" --engine open --count 4 --wait',
      'fuobe generate "Welcome to the studio." --kind audio --out audio/',
    ],
    run: generate,
  },
  wait: {
    summary: "Wait for generations to finish",
    usage: "fuobe wait <id>… [--out <dir>] [--timeout <seconds>]",
    options: { out: { type: "string", short: "o", value: "dir", describe: "Also save the outputs here" }, ...WAIT_OPTIONS },
    examples: ["fuobe wait V1StGXR8_Z5j", "fuobe wait V1StGXR8_Z5j 3Kp9x2LmQa7c --out renders/"],
    run: wait,
  },
  download: {
    summary: "Save a generation's outputs (waits for it first)",
    usage: "fuobe download <id>… [--out <dir>]",
    options: {
      out: { type: "string", short: "o", value: "dir", describe: "Folder to save into (default: here)" },
      wait: { type: "boolean", describe: "Wait for unfinished ones (default; --no-wait fails instead)" },
      ...WAIT_OPTIONS,
    },
    examples: ["fuobe download V1StGXR8_Z5j --out renders/"],
    run: download,
  },
  list: {
    summary: "Your recent generations",
    usage: "fuobe list [--kind <kind>] [--limit <n>]",
    options: {
      kind: { type: "string", short: "k", choices: ["image", "video", "audio", "text", "model3d"], describe: "Only this kind of result" },
      limit: { type: "number", short: "l", value: "n", describe: "How many (default 20, up to 200)" },
      status: { type: "string", value: "status", describe: "queued, running, succeeded, failed or canceled (comma-separated)" },
      search: { type: "string", short: "s", value: "words", describe: "Words in the prompt" },
      model: { type: "string", short: "m", value: "id", describe: "Only this model's" },
    },
    examples: ["fuobe list --kind video --limit 5", "fuobe list --status failed --json"],
    run: list,
  },
  cancel: { summary: "Stop queued or running generations", usage: "fuobe cancel <id>…", run: cancel },
  upload: {
    summary: "Upload files and print their URLs (to use as inputs)",
    usage: "fuobe upload <file>…",
    examples: ["fuobe upload product.png"],
    run: upload,
  },
  skills: {
    summary: "List, read, add, switch on or off Assist skills",
    usage: "fuobe skills [list | show <name> | add <source> | enable <name> | disable <name>]",
    options: {
      skill: { type: "string", multiple: true, value: "name", describe: "add: only these skills from a folder or repository" },
      replace: { type: "boolean", describe: "add: overwrite your own skill of the same name" },
    },
    examples: [
      "fuobe skills list",
      "fuobe skills add ./my-skill",
      "fuobe skills add owner/repo --skill launch-video",
      "fuobe skills add https://github.com/owner/repo/tree/main/skills/launch-video",
      "fuobe skills disable katana",
    ],
    run: skills,
  },
  tools: { summary: "List the MCP tools (the studio jobs agents can run)", usage: "fuobe tools", run: tools },
  tool: {
    summary: "Run one MCP tool with JSON arguments",
    usage: "fuobe tool <name> ['<json>' | -] [--arg key=value]… [--schema]",
    options: {
      arg: { type: "string", multiple: true, value: "key=value", describe: "One argument (values that read as JSON are JSON)" },
      schema: { type: "boolean", describe: "Show the tool's description and arguments instead" },
    },
    examples: [
      "fuobe tool search_models --arg kind=video --arg query=kling",
      'fuobe tool estimate_job \'{"tool": "katana", "arguments": {"reference": "/api/files/…", "photos": ["/api/files/…"]}}\'',
      "fuobe tool katana --schema",
    ],
    run: tool,
  },
  mcp: {
    summary: "Print the command that connects an agent over MCP",
    usage: "fuobe mcp",
    examples: ["fuobe mcp", "fuobe mcp --json"],
    run: mcp,
  },
  eval: {
    summary: "Measure Fuobe Originals: run a suite, score, review blind, compare runs",
    usage: "fuobe eval <run|report|review|compare|promote|covers|history|validate|setup|trash> [options]   (from a Fuobe checkout)",
    examples: ["fuobe eval run --suite selftest --engine demo", "fuobe eval run --suite soul --engine open --looks v1-general --variants recipe,prompt-only", "fuobe eval compare latest~1 latest --fail-on clip --threshold 1"],
    passthrough: true,
    run: evalHarness,
  },
  worker: {
    summary: "Run this PC's GPU as a worker for a studio (docs/gpu-workers.md)",
    usage: "fuobe worker <setup | run | pause [--now] [--for 2h] | resume | status | bench | install [--yes]>",
    examples: ["fuobe worker setup", "fuobe worker run", "fuobe worker pause --for 2h", "fuobe worker pause --now", "fuobe worker resume"],
    passthrough: true,
    ownConfig: true,
    run: async (ctx) => (await import("./worker/index.mjs")).worker(ctx.positionals, ctx.io),
  },
};

/** Other names people type. */
export const ALIASES = { ls: "list", gen: "generate", model: "models", skill: "skills" };
