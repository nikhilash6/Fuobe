#!/usr/bin/env node
// Writes Fuobe Connect's node allowlist (integrations/fuobe-connect/fuobe_connect/allowed_nodes.json): every node type
// the studio's graphs use. Fuobe Connect refuses a studio's graph with any other node, so run this before a Fuobe Connect
// release whenever a workflow or graph builder starts using a new node. tests/fuobe-connect-nodes.test.ts checks it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studioNodes } from "./lib/studio-nodes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONNECT_NODES = "integrations/fuobe-connect/fuobe_connect/allowed_nodes.json";

const list = studioNodes(root);
fs.writeFileSync(path.join(root, CONNECT_NODES), `${JSON.stringify({ nodes: list }, null, 1)}\n`);
console.log(`Fuobe Connect: ${list.length} allowed node types -> ${CONNECT_NODES}`);
