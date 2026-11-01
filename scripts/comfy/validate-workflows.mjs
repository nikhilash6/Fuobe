#!/usr/bin/env node
// Validate every workflow in workflows/comfyui/manifest.json against a running ComfyUI.
//
//   node validate-workflows.mjs                 # all workflows
//   node validate-workflows.mjs wan22-i2v-14b   # some
//   node validate-workflows.mjs --keep-dummies  # do not delete the zero-byte model files afterwards
//   node validate-workflows.mjs --shared        # never send global queue clear / interrupt (shared GPU server)
//   node validate-workflows.mjs --subset-only qwen-image-21-t2i   # GET /object_info only: add the classes these
//                                               # workflows use to object_info.subset.json; nothing is posted
//
// For each manifest entry:
//   1. create zero-byte placeholder files for missing models (models/<folder>/<file>) so loader
//      combos accept the names (deleted again at the end unless --keep-dummies; real files are never touched),
//   2. upload tiny fixtures (png / mask png / wav / mp4) via POST /upload/image,
//   3. apply sample values to every binding (exactly what the app will do),
//   4. POST /prompt and require HTTP 200 + prompt_id + empty node_errors,
//   5. immediately delete it from the queue (POST /queue {"delete":[id]}, POST /interrupt {prompt_id} if it
//      somehow started) so nothing actually runs. A "blocker" prompt (chain of KJNodes Sleep nodes) keeps the
//      single worker busy meanwhile, so validation prompts are only ever *pending*. At the end the blocker is
//      interrupted and POST /queue {"clear":true} + POST /interrupt are sent (skip with --shared).
// Results go to manifest.json ("validated", "validationError") and validation-state.json;
// also writes workflows/comfyui/object_info.subset.json for the node classes the library uses (a custom class under
// the pack build-library.mjs names for it: packOfClass).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, STATE_FILE } from './build-library.mjs';
import { packOfClass } from './build-requirements.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(REPO, 'workflows', 'comfyui');
const FIXTURES = path.join(HERE, 'fixtures');
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const COMFYUI_DIR = process.env.COMFYUI_DIR || '/home/user/ComfyUI';
const MODELS_DIR = process.env.COMFYUI_MODELS_DIR || path.join(COMFYUI_DIR, 'models');

const args = process.argv.slice(2);
const keepDummies = args.includes('--keep-dummies');
// --shared: do not POST a global /queue clear + /interrupt at the end (only touch our own prompt ids).
const sharedServer = args.includes('--shared');
// --subset-only: for a ComfyUI that is busy rendering. Classes already in the subset keep their entries.
const subsetOnly = args.includes('--subset-only');
const only = new Set(args.filter((a) => !a.startsWith('--')));

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, body) {
  const res = await fetch(COMFYUI_URL + route, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function upload(localFile, remoteName) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(localFile)]), remoteName);
  fd.append('overwrite', 'true');
  const r = await api('POST', '/upload/image', fd);
  if (r.status !== 200) throw new Error(`upload ${remoteName} failed: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.name;
}

// Sample values the validator feeds through each binding.
function sampleValue(key, entry, uploads) {
  switch (key) {
    case 'prompt': return 'Fuobe validation prompt: a red fox running through snow, cinematic lighting';
    case 'negativePrompt': return 'blurry, low quality';
    case 'image': case 'image2': case 'image3': case 'image4': case 'endImage': case 'paletteImage': return uploads.png;
    case 'paletteText': return 'Color palette: #E4572E, #29335C, #F3A712, #A8C686, #669BBC.';
    case 'description': return 'A heavy wooden door creaks open slowly, then slams shut with a short stone-hall reverb.';
    case 'gridPrompt': return 'A 2x2 grid contact sheet of four film stills from the same scene:';
    case 'sheetPrompt': return 'Character turnaround sheet, front, three-quarter, profile and back views:';
    case 'hints': return 'Fuobe';
    case 'instruction': return String(entry.defaults?.instruction ?? 'Translate into {language}.').replaceAll('{language}', 'Spanish');
    case 'mask': return uploads.mask;
    case 'maskPrompt': return 'the person on the left';
    case 'fadeCurve': return uploads.wav;
    case 'skipPass2': return true; // switches: the non-default branch, so both values are known to pass
    case 'cutout': return false;
    case 'video': case 'video2': case 'video3': case 'video4': return uploads.mp4;
    case 'audio': case 'audio2': return uploads.wav;
    case 'tracks': {
      // Wan-Move: one {x,y} per output frame per track (a moving stroke + a static anchor)
      const n = Number(entry.defaults?.frames ?? 81);
      const stroke = Array.from({ length: n }, (_, i) => ({ x: 200 + Math.round((300 * i) / (n - 1)), y: 300 - Math.round((100 * i) / (n - 1)) }));
      const anchor = Array.from({ length: n }, () => ({ x: 600, y: 220 }));
      return JSON.stringify([stroke, anchor]);
    }
    case 'seed': return 123456789;
    case 'tags': return 'synthwave, upbeat, female vocals, 120 bpm';
    case 'lyrics': return '[verse]\nNeon lights on the open road\n[chorus]\nWe keep on running';
    case 'loraHigh': return 'fuobe_validate_lora_high.safetensors';
    case 'loraLow': return 'fuobe_validate_lora_low.safetensors';
    case 'lora': return 'fuobe_validate_lora.safetensors';
    case 'loraStrength': return 0.8;
    case 'cameraMotion': return 'Pan Left';
    case 'filenamePrefix': return `fuobe/validate/${entry.id}`;
    default:
      if (entry.defaults && entry.defaults[key] !== undefined) return entry.defaults[key];
      return undefined;
  }
}

const DUMMY_LORAS = { loraHigh: 'fuobe_validate_lora_high.safetensors', loraLow: 'fuobe_validate_lora_low.safetensors', lora: 'fuobe_validate_lora.safetensors' };
// Loader inputs whose combo lists the server's input folder (the same loaders build-library.mjs requires a binding for).
const UPLOAD_INPUTS = { LoadImage: 'image', LoadImageMask: 'image', LoadVideo: 'file', VHS_LoadVideo: 'video', LoadAudio: 'audio', VHS_LoadAudioUpload: 'audio', AUSBOSS_NODES_ImageCropRotatePad: 'image' };

function ensureDummy(folder, file, created) {
  const p = path.join(MODELS_DIR, folder, file);
  if (fs.existsSync(p)) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
  created.push(p);
}

function summarizeError(json) {
  if (typeof json !== 'object' || !json) return String(json).slice(0, 500);
  const parts = [];
  if (json.error) parts.push(`${json.error.type || 'error'}: ${json.error.message || ''}${json.error.details ? ` (${json.error.details})` : ''}`);
  for (const [nid, ne] of Object.entries(json.node_errors || {})) {
    for (const e of ne.errors || []) parts.push(`node ${nid} (${ne.class_type}): ${e.message}${e.details ? ` - ${e.details}` : ''}`);
  }
  return parts.join(' | ').slice(0, 1500) || JSON.stringify(json).slice(0, 500);
}

async function queueState() {
  const q = (await api('GET', '/queue')).json || {};
  const ids = (items) => (items || []).map((it) => it[1]);
  return { running: ids(q.queue_running), pending: ids(q.queue_pending) };
}

// A chain of 1-second KJNodes "Sleep" nodes that occupies ComfyUI's single execution worker, so
// validation prompts stay *pending* and can be deleted before they ever run. Without it, the first
// nodes of a just-queued prompt can start before /interrupt lands, and some nodes download weights
// the moment they execute (ComfyUI-RMBG, RIFE VFI, WanVideoWrapper wav2vec, ReActor detectors).
function blockerPrompt(seconds) {
  const g = {};
  let prev = null;
  for (let i = 0; i < seconds; i++) {
    g[`${9000 + i}`] = { class_type: 'Sleep', inputs: { input: prev ? [prev, 0] : 'fuobe-validate-blocker', minutes: 0, seconds: 1 } };
    prev = `${9000 + i}`;
  }
  g['8999'] = { class_type: 'PreviewAny', inputs: { source: [prev, 0] } };
  return g;
}

async function startBlocker(objectInfo) {
  if (!objectInfo.Sleep || !objectInfo.PreviewAny) {
    console.warn('! KJNodes "Sleep" node not available: falling back to queue-delete + interrupt right after each POST (nodes that download weights on execution may start).');
    return null;
  }
  const r = await api('POST', '/prompt', { prompt: blockerPrompt(600), client_id: 'fuobe-validate' });
  if (r.status !== 200 || !r.json?.prompt_id) throw new Error(`could not queue blocker prompt: ${summarizeError(r.json)}`);
  const id = r.json.prompt_id;
  for (let i = 0; i < 120; i++) {
    const q = await queueState();
    if (q.running.includes(id) || q.pending.includes(id)) return id;
    await sleep(250);
  }
  throw new Error('blocker prompt did not appear in the queue');
}

// The names the fixtures are uploaded under (upload() overwrites, so they keep them).
const FIXTURE_NAMES = ['fuobe_validate.png', 'fuobe_validate_mask.png', 'fuobe_validate.wav', 'fuobe_validate.mp4'];

/**
 * object_info.subset.json for every class the library uses. Classes this server lacks keep their recorded definition
 * (isolated-worker packs validated on another ComfyUI); `onlyMissing` keeps every recorded one and adds the others
 * (of the workflows named on the command line, or all). Returns the number of classes.
 */
function writeSubset(manifest, objectInfo, fixtureNames, { onlyMissing = false } = {}) {
  const classes = new Set();
  for (const entry of manifest.workflows) {
    if (onlyMissing && only.size && !only.has(entry.id)) continue;
    const g = JSON.parse(fs.readFileSync(path.join(OUT_DIR, entry.file), 'utf8'));
    for (const n of Object.values(g)) classes.add(n.class_type);
  }
  const prevSubset = readJson(path.join(OUT_DIR, 'object_info.subset.json'), {});
  const subset = onlyMissing ? { ...prevSubset } : {};
  for (const c of [...classes].sort()) {
    if (onlyMissing && c in prevSubset) continue;
    let def = objectInfo[c] || prevSubset[c] || null;
    // A custom class is recorded under its own pack, whatever pack the server says registered it.
    const mod = def?.python_module;
    const pack = typeof mod === 'string' && mod.startsWith('custom_nodes.') ? packOfClass(c, mod, prevSubset[c]?.python_module) : null;
    if (pack && mod !== `custom_nodes.${pack}`) def = { ...def, python_module: `custom_nodes.${pack}` };
    // Upload combos list whatever the server's input folder holds right now (other sessions' uploads too):
    // keep only the validation fixtures, so the file does not change with the server's state.
    const inp = UPLOAD_INPUTS[c];
    if (inp && (def?.input?.required?.[inp] ?? def?.input?.optional?.[inp])) {
      def = JSON.parse(JSON.stringify(def));
      const spec = def.input.required?.[inp] ?? def.input.optional?.[inp];
      if (Array.isArray(spec[0])) spec[0] = spec[0].filter((o) => fixtureNames.includes(o));
      else if (Array.isArray(spec[1]?.options)) spec[1].options = spec[1].options.filter((o) => fixtureNames.includes(o));
    }
    subset[c] = def;
  }
  const sorted = Object.fromEntries(Object.keys(subset).sort().map((k) => [k, subset[k]]));
  writeJson(path.join(OUT_DIR, 'object_info.subset.json'), sorted);
  return Object.keys(sorted).length;
}

async function main() {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest) throw new Error('manifest.json not found; run build-library.mjs first');
  const state = readJson(STATE_FILE, {});
  const objectInfo = (await api('GET', '/object_info')).json;
  if (subsetOnly) {
    console.log(`object_info.subset.json: ${writeSubset(manifest, objectInfo, FIXTURE_NAMES, { onlyMissing: true })} node classes.`);
    return;
  }

  const uploads = {
    png: await upload(path.join(FIXTURES, 'test.png'), 'fuobe_validate.png'),
    mask: await upload(path.join(FIXTURES, 'test_mask.png'), 'fuobe_validate_mask.png'),
    wav: await upload(path.join(FIXTURES, 'test.wav'), 'fuobe_validate.wav'),
    mp4: await upload(path.join(FIXTURES, 'test.mp4'), 'fuobe_validate.mp4'),
  };

  const created = [];
  const results = [];
  const blockerId = await startBlocker(objectInfo);
  try {
    for (const entry of manifest.workflows) {
      if (only.size && !only.has(entry.id)) continue;
      const file = path.join(OUT_DIR, entry.file);
      const text = fs.readFileSync(file, 'utf8');
      const prompt = JSON.parse(text);

      for (const m of entry.models || []) ensureDummy(m.folder, m.file, created);
      for (const [k, f] of Object.entries(DUMMY_LORAS)) if (entry.bindings[k]) ensureDummy('loras', f, created);

      const unbound = [];
      for (const [key, targets] of Object.entries(entry.bindings)) {
        const v = sampleValue(key, entry, uploads);
        if (v === undefined) {
          if (key !== 'upscaleModel') unbound.push(key); // upscaleModel keeps the workflow's (manifest) model
          continue;
        }
        for (const { node, input } of targets) {
          if (!prompt[node]) throw new Error(`${entry.id}: binding ${key} -> missing node ${node}`);
          prompt[node].inputs[input] = v;
        }
      }

      const r = await api('POST', '/prompt', { prompt, client_id: 'fuobe-validate' });
      const ok = r.status === 200 && r.json?.prompt_id && Object.keys(r.json.node_errors || {}).length === 0;
      if (r.json?.prompt_id) {
        // Validation happened synchronously inside POST /prompt; never let the job run.
        const id = r.json.prompt_id;
        await api('POST', '/queue', { delete: [id] });
        const q = await queueState();
        if (q.running.includes(id)) await api('POST', '/interrupt', { prompt_id: id });
        await api('POST', '/history', { delete: [id] });
      }
      const error = ok ? null : `HTTP ${r.status}: ${summarizeError(r.json)}`;
      results.push({ id: entry.id, ok, error, unbound });
      state[entry.id] = { sha256: sha256(text), validated: ok, error, at: new Date().toISOString() };
      entry.validated = ok;
      if (ok) delete entry.validationError;
      else entry.validationError = error;
      console.log(`${ok ? '✓' : '✗'} ${entry.id}${ok ? '' : `  ${error}`}${unbound.length ? `  (no sample for: ${unbound.join(', ')})` : ''}`);
    }
  } finally {
    if (blockerId) {
      await api('POST', '/queue', { delete: [blockerId] });
      await api('POST', '/interrupt', { prompt_id: blockerId });
    }
    if (!sharedServer) {
      // As specified for the dedicated validation server: leave nothing queued or running.
      await api('POST', '/queue', { clear: true });
      await api('POST', '/interrupt', {});
    }
    if (blockerId) {
      await sleep(1500); // Sleep nodes are 1 s each; the interrupt takes effect at the next node
      await api('POST', '/history', { delete: [blockerId] });
    }
    if (!keepDummies) {
      for (const p of created.reverse()) {
        try { if (fs.statSync(p).size === 0) fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  }

  const classCount = writeSubset(manifest, objectInfo, Object.values(uploads));

  writeJson(manifestPath, manifest);
  writeJson(STATE_FILE, Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} workflows validated. object_info.subset.json: ${classCount} node classes.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
