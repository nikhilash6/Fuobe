#!/usr/bin/env node
// Export ComfyUI UI-format workflows (official templates or custom-node example
// workflows) to API format by driving the real ComfyUI frontend in headless
// Chromium: app.loadGraphData(ui) -> app.graphToPrompt() -> output.
//
// Doing the conversion inside the frontend is the only faithful way to handle
// subgraphs, primitive/reroute nodes, bypassed nodes, V3 dynamic inputs and
// widget ordering.
//
// Usage:
//   node export-templates.mjs                 # export every source used by library.spec.mjs
//   node export-templates.mjs video_wan2_2_14B_i2v custom_nodes/ComfyUI-MMAudio/example_workflows/mmaudio_test.json
//
// Env:
//   COMFYUI_URL   (default http://127.0.0.1:8188)
//   COMFYUI_DIR   (default /home/user/ComfyUI)  used to find templates + custom-node examples
//   CHROMIUM_PATH (default: first /opt/pw-browsers/chromium-*/chrome-linux/chrome)
//
// Output (per source key) in scripts/comfy/build/raw/:
//   <key>.api.json    API-format prompt exactly as graphToPrompt produced it
//   <key>.meta.json   { source, version, models (url/directory metadata), missingNodeTypes, ... }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const COMFYUI_DIR = process.env.COMFYUI_DIR || '/home/user/ComfyUI';
const RAW_DIR = path.join(HERE, 'build', 'raw');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined; // let playwright try its default
}

export function findSitePackages() {
  const venvLib = path.join(COMFYUI_DIR, '.venv', 'lib');
  if (!fs.existsSync(venvLib)) return null;
  for (const py of fs.readdirSync(venvLib)) {
    const sp = path.join(venvLib, py, 'site-packages');
    if (fs.existsSync(path.join(sp, 'comfyui_workflow_templates_json'))) return sp;
  }
  return null;
}

export function templatesInfo() {
  const sp = findSitePackages();
  if (!sp) throw new Error(`comfyui_workflow_templates_json not found under ${COMFYUI_DIR}/.venv`);
  const dir = path.join(sp, 'comfyui_workflow_templates_json', 'templates');
  const versions = {};
  for (const d of fs.readdirSync(sp)) {
    const m = d.match(/^(comfyui_workflow_templates[a-z0-9_]*)-([\d.]+)\.dist-info$/);
    if (m) versions[m[1].replace(/_/g, '-')] = m[2];
  }
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const byName = {};
  for (const cat of index) for (const t of cat.templates) byName[t.name] = { ...t, category: cat.title };
  return { dir, versions, byName };
}

// Collect models metadata ({name,url,directory}) from node.properties.models,
// the workflow-level "models" array, and all subgraph definitions.
function collectModels(ui) {
  const out = new Map();
  const add = (m, nodeType) => {
    if (!m || !m.name) return;
    const prev = out.get(m.name);
    if (!prev || (!prev.url && m.url)) out.set(m.name, { name: m.name, url: m.url, directory: m.directory, nodeType });
  };
  const walk = (nodes) => {
    for (const n of nodes || []) for (const m of n?.properties?.models || []) add(m, n.type);
  };
  walk(ui.nodes);
  for (const sg of ui.definitions?.subgraphs || []) walk(sg.nodes);
  for (const m of ui.models || []) add(m);
  return [...out.values()];
}

function collectNodeTypes(ui) {
  const sgIds = new Set((ui.definitions?.subgraphs || []).map((s) => s.id));
  const types = new Set();
  const walk = (nodes) => {
    for (const n of nodes || []) if (!sgIds.has(n.type) && n.mode !== 2 && n.mode !== 4) types.add(n.type);
  };
  walk(ui.nodes);
  for (const sg of ui.definitions?.subgraphs || []) walk(sg.nodes);
  return [...types];
}

const FRONTEND_ONLY = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode', 'GetNode', 'SetNode']);

export function resolveSource(arg) {
  // A template name, or a path to a UI-format json (absolute, relative to COMFYUI_DIR, or relative to cwd).
  const { dir, versions, byName } = templatesInfo();
  const tplPath = path.join(dir, `${arg.replace(/\.json$/, '')}.json`);
  if (!arg.includes('/') && fs.existsSync(tplPath)) {
    const name = arg.replace(/\.json$/, '');
    return {
      key: name,
      file: tplPath,
      kind: 'template',
      sourceLabel: `official template ${name} from comfyui-workflow-templates ${versions['comfyui-workflow-templates']}`,
      versions,
      index: byName[name] || null,
    };
  }
  const candidates = [arg, path.join(COMFYUI_DIR, arg), path.resolve(arg)];
  const file = candidates.find((p) => path.isAbsolute(p) && fs.existsSync(p)) || candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error(`Cannot resolve source "${arg}" (not a template name or existing file)`);
  const rel = path.relative(COMFYUI_DIR, path.resolve(file));
  const key = path.basename(file).replace(/\.json$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_');
  let repoInfo = '';
  const m = rel.match(/^custom_nodes\/([^/]+)\/(.*)$/);
  if (m) {
    try {
      const head = fs.readFileSync(path.join(COMFYUI_DIR, 'custom_nodes', m[1], '.git', 'HEAD'), 'utf8').trim();
      repoInfo = head.startsWith('ref:')
        ? fs.readFileSync(path.join(COMFYUI_DIR, 'custom_nodes', m[1], '.git', head.slice(5).trim()), 'utf8').trim()
        : head;
    } catch { /* shallow clones may pack refs */ }
  }
  return {
    key,
    file: path.resolve(file),
    kind: m ? 'custom-node-example' : 'file',
    sourceLabel: m ? `custom-node example ${m[1]}/${m[2]}${repoInfo ? ` @ ${repoInfo.slice(0, 7)}` : ''}` : `file ${rel}`,
    versions,
    index: null,
  };
}

async function main() {
  // playwright-core is scripts/comfy's own dependency (npm install here), loaded only when the export runs:
  // build-library.mjs and the tests import this file's other exports with the root node_modules alone.
  const { chromium } = await import('playwright-core');
  let args = process.argv.slice(2);
  if (!args.length) {
    const { SPEC } = await import(path.join(HERE, 'library.spec.mjs'));
    args = [...new Set(SPEC.filter((s) => s.export).map((s) => s.export))];
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const objectInfo = await (await fetch(`${COMFYUI_URL}/object_info`)).json();

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--no-proxy-server'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 300)));
  await page.goto(COMFYUI_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.app && window.app.graph && typeof window.app.graphToPrompt === 'function' && typeof window.app.loadGraphData === 'function',
    null,
    { timeout: 180000 },
  );
  // Let extensions (VHS, KJNodes, WanVideoWrapper...) finish registering.
  await page.waitForTimeout(3000);

  const results = [];
  for (const arg of args) {
    let src;
    try {
      src = resolveSource(arg);
    } catch (e) {
      console.error(`✗ ${arg}: ${e.message}`);
      results.push({ arg, ok: false, error: e.message });
      continue;
    }
    const ui = JSON.parse(fs.readFileSync(src.file, 'utf8'));
    const nodeTypes = collectNodeTypes(ui);
    const missingNodeTypes = nodeTypes.filter((t) => !objectInfo[t] && !FRONTEND_ONLY.has(t));
    consoleErrors.length = 0;
    const res = await page.evaluate(async (uiJson) => {
      const app = window.app;
      const ok = await app.loadGraphData(uiJson, true, false, null, {
        skipAssetScans: true,
        silentAssetErrors: true,
        deferWarnings: true,
      });
      await new Promise((r) => setTimeout(r, 300));
      const p = await app.graphToPrompt();
      return { ok: ok !== false, output: p.output };
    }, ui);
    if (!res.ok || !res.output || !Object.keys(res.output).length) {
      console.error(`✗ ${src.key}: graph failed to load/convert ${consoleErrors.join(' | ')}`);
      results.push({ arg, key: src.key, ok: false, error: 'load/convert failed', consoleErrors: [...consoleErrors] });
      continue;
    }
    const meta = {
      key: src.key,
      sourceFile: src.file,
      kind: src.kind,
      source: src.sourceLabel,
      templateVersions: src.versions,
      index: src.index,
      models: collectModels(ui),
      uiNodeTypes: nodeTypes,
      missingNodeTypes,
      exportedAt: new Date().toISOString(),
      frontendVersion: await page.evaluate(() => window.__COMFYUI_FRONTEND_VERSION__),
      consoleErrors: [...consoleErrors],
    };
    fs.writeFileSync(path.join(RAW_DIR, `${src.key}.api.json`), JSON.stringify(res.output, null, 2) + '\n');
    fs.writeFileSync(path.join(RAW_DIR, `${src.key}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
    console.log(`✓ ${src.key}: ${Object.keys(res.output).length} nodes${missingNodeTypes.length ? ` (missing node types: ${missingNodeTypes.join(', ')})` : ''}`);
    results.push({ arg, key: src.key, ok: true, nodes: Object.keys(res.output).length, missingNodeTypes });
  }
  await browser.close();
  fs.writeFileSync(path.join(RAW_DIR, '_export-report.json'), JSON.stringify(results, null, 2) + '\n');
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
