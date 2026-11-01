// A stand-in for nvidia-smi (the worker's GPU check, bin/lib/worker/gpu.mjs): it answers the two queries the worker
// makes from a JSON file the test writes: { "usedMb": 900, "tempC": 50, "apps": [{ "pid": 1, "name": "python.exe",
// "usedMb": null }] } (usedMb null prints [N/A], as Windows does).
//
//   node tests/helpers/fake-nvidia-smi.mjs <state.json> --query-gpu=memory.used,temperature.gpu --format=csv,noheader,nounits
import fs from "node:fs";

const [file, ...args] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, "utf8"));
if (args.some((a) => a.startsWith("--query-gpu"))) process.stdout.write(`${s.usedMb}, ${s.tempC ?? 40}\n`);
else if (args.some((a) => a.startsWith("--query-compute-apps"))) for (const a of s.apps ?? []) process.stdout.write(`${a.pid}, ${a.name}, ${a.usedMb === null || a.usedMb === undefined ? "[N/A]" : a.usedMb}\n`);
else process.exit(2);
