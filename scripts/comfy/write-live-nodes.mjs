#!/usr/bin/env node
// Write Fuobe's live edit nodes (fuobe_live.py) into a ComfyUI custom_nodes folder:
//   node scripts/comfy/write-live-nodes.mjs <ComfyUI>/custom_nodes
// The source lives in src/lib/comfy-live-nodes.ts (the start file and the download card carry the same bytes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { LIVE_NODES_FILE_NAME, LIVE_NODES_SOURCE } = await import(pathToFileURL(path.join(HERE, '..', '..', 'src', 'lib', 'comfy-live-nodes.ts')).href);
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error('usage: node scripts/comfy/write-live-nodes.mjs <ComfyUI>/custom_nodes');
  process.exit(2);
}
const to = path.join(dir, LIVE_NODES_FILE_NAME);
fs.writeFileSync(to, LIVE_NODES_SOURCE);
console.log(`wrote ${to}`);
